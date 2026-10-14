import path from "node:path";
import { z } from "zod";
import type { LiosPluginManifestV1 } from "@shared/pluginSdk";
import type { P13PluginExecutionBinding } from "./p13PluginNetworkBroker";
import { authorizeBrokeredFilePath, type PluginExecutionGrant, type P13PluginFileReadAuthorizer } from "./p13PluginHost";
import { readWorkspaceRegularFile } from "./exec/backends/workspace-transfer";

const MAX_FILE_READ = 1024 * 1024;
export const p13PluginFileReadSchema = z.object({
  protocol: z.literal("lios-plugin-broker/1"),
  kind: z.literal("filesystem.read"),
  requestId: z.string().uuid(),
  executionRequestId: z.string().uuid(),
  componentId: z.string().trim().min(1).max(300),
  scope: z.enum(["project","user_selected"]),
  rootIndex: z.number().int().min(0).max(49).default(0),
  relativePath: z.string().min(1).max(300),
  maxBytes: z.number().int().positive().max(MAX_FILE_READ).default(MAX_FILE_READ),
}).strict();

export interface P13PluginFileAuxiliaryOptions {
  manifest: LiosPluginManifestV1;
  grant: PluginExecutionGrant;
  lookupExecution: (requestId: string) => P13PluginExecutionBinding | null;
  /** Absent means deny. Rechecked after reading, before returning any bytes. */
  authorizeFileRead?: P13PluginFileReadAuthorizer;
}

function deny(requestId: string, code: string) {
  return {protocol:"lios-plugin-broker/1",kind:"filesystem.error",requestId,code,
    message:"Governed filesystem read denied."};
}

/** Host-only auxiliary read transport. The signed plugin's manifest and root
 * grant are necessary but not sufficient: the server-owned live principal
 * and project/root authorizer must also allow the exact requested scope.
 * Write-return remains a distinct, disabled-by-default lifecycle.
 */
export function createP13PluginFileAuxiliaryHandler(options:P13PluginFileAuxiliaryOptions) {
  const declared = new Set([
    ...options.manifest.connectors.map(x=>x.componentId),
    ...options.manifest.tools.map(x=>x.componentId),
    ...options.manifest.agents.map(x=>x.componentId),
  ]);
  return async (raw:unknown):Promise<unknown|null> => {
    const result=p13PluginFileReadSchema.safeParse(raw);
    if(!result.success)return null;
    const request=result.data;
    const execution=options.lookupExecution(request.executionRequestId);
    if(!execution || execution.componentId!==request.componentId ||
       !declared.has(request.componentId) ||
       // Filesystem reads require the same positive, safe principal triple as
       // write-return proposals. Missing/invalid org identity must fail closed.
       typeof execution.context.userId!=="number" ||
       !Number.isSafeInteger(execution.context.userId) || execution.context.userId<=0 ||
       typeof execution.context.organizationId!=="number" ||
       !Number.isSafeInteger(execution.context.organizationId) || execution.context.organizationId<=0 ||
       typeof execution.context.projectId!=="number" ||
       !Number.isSafeInteger(execution.context.projectId) || execution.context.projectId<=0) {
      return deny(request.requestId,"filesystem_execution_scope_invalid");
    }
    const permission=request.scope==="project"?"filesystem.project.read":"filesystem.user_selected.read";
    if(!options.manifest.permissions.includes(permission))
      return deny(request.requestId,"filesystem_permission_denied");
    const root=request.scope==="project"
      ? (request.rootIndex===0?options.grant.projectRoot:null)
      : options.grant.userSelectedReadRoots[request.rootIndex];
    if(!root)return deny(request.requestId,"filesystem_root_not_granted");
    const authorize = () => {
      try {
        return options.authorizeFileRead?.({
          context: execution.context,
          componentId: request.componentId,
          scope: request.scope,
          root,
          rootIndex: request.rootIndex,
        }) === true;
      } catch {
        return false;
      }
    };
    if (!authorize()) return deny(request.requestId,"filesystem_execution_scope_invalid");
    try {
      authorizeBrokeredFilePath(path.join(root,request.relativePath),"read",options.manifest,{
        ...options.grant,
        projectRoot: request.scope==="project"?root:null,
        userSelectedReadRoots:request.scope==="user_selected"?[root]:[],
      });
      const file=readWorkspaceRegularFile({
        root,relativePath:request.relativePath,maxFileBytes:request.maxBytes,
      });
      if(options.lookupExecution(request.executionRequestId)!==execution || !authorize())
        return deny(request.requestId,"filesystem_execution_revoked");
      return {protocol:"lios-plugin-broker/1",kind:"filesystem.response",
        requestId:request.requestId,size:file.size,sha256:file.sha256,
        bodyBase64:file.data.toString("base64")};
    }catch {
      return deny(request.requestId,"filesystem_read_denied");
    }
  };
}
