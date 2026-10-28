import { z } from "zod";
import { governedVisualIntentSchema, governedVisualAnswerRequestSchema, governedVisualProjectionSchema, resolveGovernedVisualAnswer, type GovernedVisualIntent, type GovernedVisualAnswerRequest, type GovernedVisualProjection } from "@shared/governedVisualAnswer";
import { getProjectChat } from "./projectChatStore";
import { getArtifact, getArtifactVersion, compareArtifactVersions } from "./artifactStore";
import { admitArtifactVisualSources } from "./artifactExport";
import { getAuthorizedProjectSnapshotProjection } from "./p7ProjectIntelligenceStore";
import { compareP8ScenarioArtifacts } from "./p8ScenarioService";
import { hashLedgerValue } from "./ledgerStore";
import { tenantContext, type TenantContext } from "./tenantContext";
import { sourceScopeAllowsProjectData, assertNotAborted } from "./conversationRuntimeCore";
import type { ConversationToolDefinition } from "./conversationRuntime";
import {and,eq,isNull} from "drizzle-orm";
import {users} from "@shared/schema";
import {getDb} from "./db";

export class GovernedVisualAccessError extends Error { readonly status=403; }
const sameRefs=(left:readonly string[],right:readonly string[])=>{
  if(left.length!==right.length)return false;
  const ordered=[...right].sort();return [...left].sort().every((ref,index)=>ref===ordered[index]);
};

/** Display-only composition over current canonical owners. No model writes, refresh, execution or permissions. */
export async function resolveConversationVisual(ctx:TenantContext,chatId:number,raw:unknown,expected?:GovernedVisualAnswerRequest) {
  const intent=governedVisualIntentSchema.parse(raw);
  const [actor]=await getDb().select({id:users.id}).from(users).where(and(eq(users.id,ctx.userId),eq(users.active,true),eq(users.role,ctx.role),
    ctx.organizationId===null?isNull(users.organizationId):eq(users.organizationId,ctx.organizationId))).limit(1);
  if(!actor)throw new GovernedVisualAccessError("Current visual reader authority changed.");
  const chat=await getProjectChat(ctx,chatId);
  const projectId=chat.projectId;
  const refs=new Set<string>();
  const admitted:Array<{artifactId:string;version:number;contentHash:string}>=[];
  const read=async(ref:{artifactId:string;version:number;contentHash:string})=>{
    const artifact=await getArtifact(ctx,ref.artifactId);
    if(artifact.projectId!==projectId||projectId===null&&artifact.owningChatId!==chatId||artifact.status!=="active")
      throw new GovernedVisualAccessError("Saved visual is outside the current Chat/Project owner.");
    await admitArtifactVisualSources(ctx,ref.artifactId,ref.version,ref.contentHash);
    const version=await getArtifactVersion(ctx,ref.artifactId,ref.version);
    if(version.contentHash!==ref.contentHash||hashLedgerValue(version.content)!==ref.contentHash)
      throw new GovernedVisualAccessError("Saved visual does not match its exact content identity.");
    for(const source of version.sourceRefs)refs.add(source);
    admitted.push(ref);
    return {artifact,version};
  };
  let projection:GovernedVisualProjection;
  if(intent.owner==="p7"){
    if(projectId===null)throw new GovernedVisualAccessError("A saved Project snapshot requires its owning Project Chat.");
    const result=await getAuthorizedProjectSnapshotProjection(ctx,projectId,intent.snapshotId,intent.snapshotHash,intent.graphHash);
    const insight="insightId" in intent?result.lens.insights.find(item=>item.id===intent.insightId):null;
    if("insightId" in intent&&!insight)throw new GovernedVisualAccessError("Selected deterministic insight is unavailable in this exact snapshot.");
    for(const source of result.sourceRefs)refs.add(source);
    projection={kind:"project",graph:result.graph,insight:insight??null,timeline:result.timeline};
  }else if(intent.kind==="revision_comparison"){
    await read({artifactId:intent.artifactId,...intent.left});await read({artifactId:intent.artifactId,...intent.right});
    const {semantic:_semantic,...comparison}=await compareArtifactVersions(ctx,intent.artifactId,intent.left.version,intent.right.version);
    if(comparison.leftHash!==intent.left.contentHash||comparison.rightHash!==intent.right.contentHash)
      throw new GovernedVisualAccessError("Comparison no longer matches the selected saved revisions.");
    projection=governedVisualProjectionSchema.parse({kind:"revision_comparison",comparison});
  }else if(intent.kind==="scenario_comparison"){
    if(projectId===null)throw new GovernedVisualAccessError("Scenario comparison requires saved branches in the current Project.");
    for(const ref of [intent.base,...intent.branches])await read(ref);
    const comparison=await compareP8ScenarioArtifacts(ctx,projectId,{base:{artifactId:intent.base.artifactId,version:intent.base.version,scenarioKind:"base"},branches:intent.branches.map(ref=>({artifactId:ref.artifactId,version:ref.version}))});
    const exact=[intent.base,...intent.branches];
    if([comparison.base,...comparison.branches].some((snapshot,index)=>snapshot.artifactId!==exact[index].artifactId||snapshot.artifactVersion!==exact[index].version||snapshot.contentHash!==exact[index].contentHash))
      throw new GovernedVisualAccessError("Scenario comparison does not match its selected immutable family.");
    projection={kind:"scenario_comparison",comparison};
  }else{
    const detail=await read(intent);
    projection={kind:"artifact",detail:detail as unknown as Extract<GovernedVisualProjection,{kind:"artifact"}>["detail"]};
  }
  projection=governedVisualProjectionSchema.parse(projection);
  const sourceRefs=[...refs].sort();
  const request=governedVisualAnswerRequestSchema.parse({projectId,chatId,intent,sourceRefs,projectionHash:hashLedgerValue(projection)});
  if(projection.kind==="artifact"&&resolveGovernedVisualAnswer(request,projection.detail).status!=="ready")
    throw new GovernedVisualAccessError("The selected saved content cannot be presented in this visual form.");
  if(expected&&(expected.projectId!==projectId||expected.chatId!==chatId||!sameRefs(expected.sourceRefs,sourceRefs)||expected.projectionHash!==request.projectionHash))
    throw new GovernedVisualAccessError("Saved projection or current source scope changed; restage the visual request.");
  for(const ref of admitted)await admitArtifactVisualSources(ctx,ref.artifactId,ref.version,ref.contentHash);
  if(intent.owner==="p7"){
    const current=await getAuthorizedProjectSnapshotProjection(ctx,projectId!,intent.snapshotId,intent.snapshotHash,intent.graphHash);
    if(!sameRefs(current.sourceRefs,sourceRefs))throw new GovernedVisualAccessError("Project source scope changed during visual admission.");
  }
  await getProjectChat(ctx,chatId);
  return {request,projection};
}

export const governedVisualToolResultSchema=z.object({output:z.object({visual:governedVisualAnswerRequestSchema}).strict(),summary:z.string().max(2000),deterministic:z.literal(true),sourceRefs:z.array(z.string()).max(500)}).strict();
export const governedVisualAnswerTool:ConversationToolDefinition={
  id:"lios.visual.present_saved",label:"Present exact saved evidence as chart, table, map, timeline, graph or comparison (references only)",
  kind:"retrieve",permissionClass:"safe_auto",access:"read",sideEffect:"none",replaySafe:true,
  inputSchema:governedVisualIntentSchema,outputSchema:governedVisualToolResultSchema,maxOutputBytes:256*1024,cancel:null,
  invoke:async(input,signal,call)=>{
    assertNotAborted(signal);
    if(!sourceScopeAllowsProjectData(call.sourceScope??"auto"))throw new GovernedVisualAccessError("Saved visuals require Auto or My Data source scope.");
    if(call.resourceTransmissionAllowed===false)throw new GovernedVisualAccessError("Current source transmission is disabled for this run.");
    const tenant=z.object({userId:z.number().int().positive(),organizationId:z.number().int().positive().nullable(),role:z.enum(["internal_admin","internal_analyst","internal_compliance","client_admin","client_user"])}).parse(call.tenant);
    if(call.userId!==tenant.userId||!call.chatId)throw new GovernedVisualAccessError("A server-owned persistent Chat is required.");
    const result=await resolveConversationVisual(tenantContext({id:tenant.userId,organizationId:tenant.organizationId,role:tenant.role}),call.chatId,input);
    if((call.projectId??null)!==result.request.projectId)throw new GovernedVisualAccessError("Visual Project differs from the current run.");
    if(call.allowedSourceRefs?.length&&result.request.sourceRefs.some(ref=>!call.allowedSourceRefs!.includes(ref)))throw new GovernedVisualAccessError("Visual includes sources outside the current allowed source scope.");
    assertNotAborted(signal);
    return {output:{visual:result.request},summary:`Prepared read-only ${result.request.intent.kind} from exact saved identities. No values were sent to the model and no calculation or write was performed.`,deterministic:true,sourceRefs:result.request.sourceRefs.slice(0,100)};
  },
};
