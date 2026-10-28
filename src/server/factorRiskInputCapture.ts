import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { datasetSnapshots, users } from "@shared/schema";
import type { QuantInputSourceBinding } from "@shared/quantModelRegistry";
import { getDb } from "./db";
import { getRequestIdentity } from "./requestContext";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";
import { getApplicableEntitlementPolicy, getEntitlementPolicyById } from "./dataEntitlementStore";
import { factorRiskSnapshotContentHash, type FactorRiskSnapshot } from "./factorRiskModel";

export class FactorRiskAccessError extends Error {
  constructor(public readonly status:403|404|409,message:string) { super(message); }
}

export async function assertCurrentFactorActor() {
  const identity = getRequestIdentity();
  if (!identity) return;
  const [actor] = identity.userId === null ? [] : await getDb().select().from(users).where(eq(users.id, identity.userId)).limit(1);
  if (!actor?.active || actor.organizationId !== identity.organizationId || !["internal_admin","internal_analyst","internal_compliance"].includes(actor.role))
    throw new FactorRiskAccessError(403,"Current factor reader authority is unavailable.");
}

function requirePolicy(policy: Awaited<ReturnType<typeof getEntitlementPolicyById>>, provider: string, dataClass: string) {
  const now = new Date();
  if (!policy || policy.licenseType === "unknown" || policy.provider !== provider || policy.dataClass !== dataClass ||
      policy.effectiveFrom > now || policy.effectiveTo !== null && policy.effectiveTo <= now ||
      !["display","model_input","derived_output"].every(use=>policy.permittedUses.includes(use)))
    throw new FactorRiskAccessError(403,"Current reviewed factor source rights do not permit this model input and derived display.");
}

export async function assertFactorCaptureInputsCurrent(snapshot: FactorRiskSnapshot) {
  const identity = getRequestIdentity();
  if (!identity) return;
  await assertCurrentFactorActor();
  if (factorRiskSnapshotContentHash(snapshot)!==snapshot.contentHash ||
      snapshot.snapshotId!==`factor-risk-${snapshot.contentHash.slice(0,24)}`)
    throw new FactorRiskAccessError(409,"Factor capture does not match its immutable content identity.");
  const [root] = await getDb().select({id:datasetSnapshots.id,owner:datasetSnapshots.createdByUserId,organizationId:datasetSnapshots.organizationId,
    hash:datasetSnapshots.contentHash,policyId:datasetSnapshots.entitlementPolicyId,expiresAt:datasetSnapshots.expiresAt,availableAt:datasetSnapshots.availableAt})
    .from(datasetSnapshots).where(eq(datasetSnapshots.id,snapshot.snapshotId)).limit(1);
  const now=new Date();
  if (!root || root.owner !== identity.userId || root.organizationId !== identity.organizationId || root.hash !== snapshot.contentHash ||
      root.availableAt > now || root.expiresAt !== null && root.expiresAt <= now) throw new FactorRiskAccessError(404,"Factor capture is no longer available to this owner.");
  requirePolicy(root.policyId?await getEntitlementPolicyById(root.policyId):null,"factor_risk_model","factor_risk");
  const dependencies=[snapshot.sources.benchmark,...snapshot.securities.map(item=>snapshot.sources.securities[item.securityId])];
  for (const metadata of dependencies) {
    if (!metadata?.sourceBindings?.length) throw new FactorRiskAccessError(403,"Factor capture lacks immutable provider input bindings.");
    for (const binding of metadata.sourceBindings) {
      const [row]=await getDb().select({owner:datasetSnapshots.createdByUserId,organizationId:datasetSnapshots.organizationId,
        hash:datasetSnapshots.contentHash,provider:datasetSnapshots.provider,dataClass:datasetSnapshots.dataClass,policyId:datasetSnapshots.entitlementPolicyId,
        availableAt:datasetSnapshots.availableAt,expiresAt:datasetSnapshots.expiresAt})
        .from(datasetSnapshots).where(eq(datasetSnapshots.id,binding.snapshot.id)).limit(1);
      if (!row || row.owner!==identity.userId || row.organizationId!==identity.organizationId || row.hash!==binding.snapshot.contentHash ||
          row.provider!==binding.provider || row.availableAt>now || row.expiresAt!==null && row.expiresAt<=now)
        throw new FactorRiskAccessError(404,"Factor input is no longer available in its exact owner/source scope.");
      requirePolicy(row.policyId?await getEntitlementPolicyById(row.policyId):null,row.provider,row.dataClass);
    }
  }
}

/** Persist exactly consumed provider values; a binding records custody, never grants rights. */
export async function captureFactorInput(input: {
  field:"ohlcv"|"fundamentals"; symbol:string; provider:string; payload:Record<string,unknown>;
  asOf:string; retrievedAt:string; sourceRefs:readonly string[];
}): Promise<QuantInputSourceBinding | null> {
  const actor=getRequestIdentity();
  if (!actor?.userId) return null;
  await assertCurrentFactorActor();
  const provider=input.provider.trim();
  if (!provider || provider === "unknown" || provider.length>80) throw new Error("Factor input provider identity is unavailable.");
  const lineage={field:input.field,symbol:input.symbol,asOf:input.asOf,retrievedAt:input.retrievedAt,
    sourceRefs:[...new Set(input.sourceRefs)],ownerUserId:actor.userId,organizationId:actor.organizationId};
  const contentHash=stableSnapshotHash({payload:input.payload,provider,lineage});
  const id=crypto.randomUUID();const capturedAt=new Date();
  const policy=await getApplicableEntitlementPolicy(provider,"factor_inputs",capturedAt);
  if (!policy || policy.licenseType === "unknown" || policy.effectiveFrom > capturedAt ||
      policy.effectiveTo !== null && policy.effectiveTo <= capturedAt ||
      !["display", "model_input", "derived_output"].every(use => policy.permittedUses.includes(use)))
    throw new FactorRiskAccessError(403,"A current reviewed factor-input policy permitting display, model input and derived output is required.");
  const [created] = await getDb().insert(datasetSnapshots).values({id,datasetKey:`factor-input:${input.field}:${input.symbol}:${contentHash}`,
    entityKey:input.symbol,dataClass:"factor_inputs",schemaVersion:"1",source:"factor_input_capture",provider,
    frequency:input.field==="ohlcv"?"daily":"snapshot",timezone:"UTC",retrievedAt:new Date(input.retrievedAt),availableAt:capturedAt,
    contentHash,lineage,payload:input.payload,quality:{},createdByUserId:actor.userId,organizationId:actor.organizationId,
    entitlementPolicyId:policy.id,
  }).onConflictDoNothing().returning();
  const [existing] = created ? [] : await getDb().select({id:datasetSnapshots.id,owner:datasetSnapshots.createdByUserId,organizationId:datasetSnapshots.organizationId})
    .from(datasetSnapshots).where(eq(datasetSnapshots.contentHash,contentHash)).limit(1);
  if (!created && (!existing || existing.owner !== actor.userId || existing.organizationId !== actor.organizationId))
    throw new Error("Factor input capture could not be retained in the current owner scope.");
  const retainedId=created?.id??existing!.id;
  return {field:input.field,contractFamily:"factor-risk-model",connectorId:provider,provider,priority:"primary",
    sourceReference:`dataset-snapshot:${retainedId}`,asOf:`${input.asOf}T00:00:00.000Z`,retrievedAt:new Date(input.retrievedAt).toISOString(),
    freshness:"recorded-provider-capture",snapshot:{id:retainedId,contentHash},transformations:[]};
}
