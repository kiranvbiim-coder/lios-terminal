import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { LiosPluginManifestV1 } from "@shared/pluginSdk";
import type { P13PluginExecutionBinding } from "./p13PluginNetworkBroker";
import { authorizeBrokeredFilePath, type PluginExecutionGrant } from "./p13PluginHost";
import { validateWorkspaceWriteReturnDestination } from "./exec/backends/workspace-transfer";

const MAX_FILE_BYTES = 1024 * 1024;
export const p13PluginWriteReturnSchema = z.object({
  protocol: z.literal("lios-plugin-broker/1"),
  kind: z.literal("filesystem.write_return"),
  requestId: z.string().uuid(),
  executionRequestId: z.string().uuid(),
  componentId: z.string().trim().min(1).max(300),
  scope: z.enum(["project", "user_selected"]),
  rootIndex: z.number().int().min(0).max(49).default(0),
  relativePath: z.string().min(1).max(300),
  bodyBase64: z.string().max(Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface P13StagedFileReturn {
  readonly executionRequestId: string;
  readonly componentId: string;
  readonly scope: "project" | "user_selected";
  readonly rootIndex: number;
  readonly relativePath: string;
  readonly size: number;
  readonly sha256: string;
  readonly data: Buffer;
}

export interface P13DeclaredFileReturn {
  readonly scope: "project" | "user_selected";
  readonly rootIndex: number;
  readonly relativePath: string;
}

export interface P13PluginWriteReturnOptions {
  manifest: LiosPluginManifestV1;
  grant: PluginExecutionGrant;
  lookupExecution: (requestId: string) => P13PluginExecutionBinding | null;
  /** Owner explicitly declares destinations before a child can stage bytes. */
  allowedPaths?: (executionRequestId: string) => readonly P13DeclaredFileReturn[];
  /** Staging only: must not persist to host paths during an auxiliary call. */
  stageReturn?: (file: P13StagedFileReturn) => void;
}

function denied(requestId: string, code: string) {
  return {
    protocol: "lios-plugin-broker/1",
    kind: "filesystem.error",
    requestId,
    code,
    message: "Governed filesystem return denied.",
  };
}

/**
 * A write-return is a memory-only proposal for the canonical owner, NOT a
 * filesystem write. The P13 Node host still fails closed for direct privileged
 * plugin activation; normal activation provides no staging hook.
 */
export function createP13PluginWriteReturnHandler(options: P13PluginWriteReturnOptions) {
  const declared = new Set([
    ...options.manifest.connectors.map(x => x.componentId),
    ...options.manifest.tools.map(x => x.componentId),
    ...options.manifest.agents.map(x => x.componentId),
  ]);
  return async (raw: unknown): Promise<unknown | null> => {
    const parsed = p13PluginWriteReturnSchema.safeParse(raw);
    if (!parsed.success) return null;
    const request = parsed.data;
    if (!options.allowedPaths || !options.stageReturn) {
      return denied(request.requestId, "filesystem_staging_unavailable");
    }
    const binding = options.lookupExecution(request.executionRequestId);
    if (!binding || binding.componentId !== request.componentId ||
        !declared.has(request.componentId) ||
        typeof binding.context.userId !== "number" ||
        !Number.isSafeInteger(binding.context.userId) || binding.context.userId <= 0 ||
        typeof binding.context.organizationId !== "number" ||
        !Number.isSafeInteger(binding.context.organizationId) || binding.context.organizationId <= 0 ||
        typeof binding.context.projectId !== "number" ||
        !Number.isSafeInteger(binding.context.projectId) || binding.context.projectId <= 0) {
      return denied(request.requestId, "filesystem_execution_scope_invalid");
    }
    const permission = request.scope === "project"
      ? "filesystem.project.write" : "filesystem.user_selected.write";
    if (!options.manifest.permissions.includes(permission)) {
      return denied(request.requestId, "filesystem_permission_denied");
    }
    const root = request.scope === "project"
      ? (request.rootIndex === 0 ? options.grant.projectRoot : null)
      : options.grant.userSelectedWriteRoots[request.rootIndex];
    if (!root) return denied(request.requestId, "filesystem_root_not_granted");
    try {
      const relativePath = validateWorkspaceWriteReturnDestination({
        root, relativePath: request.relativePath,
      });
      if (!options.allowedPaths(request.executionRequestId).some(declared =>
        declared.scope === request.scope && declared.rootIndex === request.rootIndex &&
        declared.relativePath === relativePath
      )) {
        return denied(request.requestId, "filesystem_output_not_declared");
      }
      authorizeBrokeredFilePath(path.join(root, relativePath), "write", options.manifest, {
        ...options.grant,
        projectRoot: request.scope === "project" ? root : null,
        userSelectedWriteRoots: request.scope === "user_selected" ? [root] : [],
      });
      // Roundtrip equality rules out noncanonical/ambiguous encodings.
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.bodyBase64)) {
        return denied(request.requestId, "filesystem_return_encoding_invalid");
      }
      const data = Buffer.from(request.bodyBase64, "base64");
      if (data.length > MAX_FILE_BYTES || data.toString("base64") !== request.bodyBase64) {
        return denied(request.requestId, "filesystem_return_size_invalid");
      }
      const digest = crypto.createHash("sha256").update(data).digest("hex");
      if (digest !== request.sha256) return denied(request.requestId, "filesystem_return_digest_mismatch");
      // Revalidation before the only host-controlled staging hook.
      if (options.lookupExecution(request.executionRequestId) !== binding) {
        return denied(request.requestId, "filesystem_execution_revoked");
      }
      options.stageReturn(Object.freeze({
        executionRequestId: request.executionRequestId,
        componentId: request.componentId,
        scope: request.scope,
        rootIndex: request.rootIndex,
        relativePath,
        size: data.length,
        sha256: digest,
        data: Buffer.from(data),
      }));
      return {
        protocol: "lios-plugin-broker/1",
        kind: "filesystem.staged",
        requestId: request.requestId,
        size: data.length,
        sha256: digest,
      };
    } catch {
      return denied(request.requestId, "filesystem_return_denied");
    }
  };
}
