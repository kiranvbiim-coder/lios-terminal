import { eq } from "drizzle-orm";
import { datasetSnapshots, users } from "@shared/schema";
import { quantDatasetInputBindingsSchema, type QuantDatasetInputBinding } from "@shared/quantLab";
import { canAccessDatasetSnapshot, flattenSnapshotForColumnar } from "./columnarArtifactStore";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { getDb, type DrizzleDb } from "./db";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

/** Reuse canonical snapshot flattening; no gap filling, implicit scaling or opaque hash-only attachment. */
export async function resolveQuantDatasetInputs(ownerUserId: number, organizationId: number | null, snapshotIds: readonly string[], rawBindings: readonly QuantDatasetInputBinding[], parameters: Record<string, unknown>, expectedHashes?: Record<string, string>, db: Pick<DrizzleDb, "select"> = getDb(), lock = false, purpose: "execute" | "read" = "execute") {
  const bindings = quantDatasetInputBindingsSchema.parse(rawBindings);
  const actorQuery = db.select({ id: users.id, role: users.role, organizationId: users.organizationId, active: users.active }).from(users).where(eq(users.id, ownerUserId));
  const [actor] = await (lock ? actorQuery.for("share") : actorQuery).limit(1);
  if (!actor?.active || !(purpose === "execute" ? ["internal_admin", "internal_analyst"] : ["internal_admin", "internal_analyst", "internal_compliance"]).includes(actor.role) || organizationId !== null && actor.organizationId !== organizationId) throw new Error("Current Quant author or organization access changed.");
  const ids = new Set(snapshotIds);
  if (ids.size !== snapshotIds.length || bindings.some(binding => !ids.has(binding.snapshotId)) || purpose === "execute" && [...ids].some(id => !bindings.some(binding => binding.snapshotId === id))) throw new Error("Every attached dataset must have an explicit source field to engine parameter binding; hash-only attachments cannot run.");
  const output = { ...parameters };
  const hashes: Record<string, string> = {};
  const sourceRefs: string[] = [];
  for (const id of ids) {
    const metadataQuery = db.select({ id: datasetSnapshots.id, organizationId: datasetSnapshots.organizationId, createdByUserId: datasetSnapshots.createdByUserId,
      entitlementPolicyId: datasetSnapshots.entitlementPolicyId, provider: datasetSnapshots.provider, dataClass: datasetSnapshots.dataClass,
      contentHash: datasetSnapshots.contentHash, availableAt: datasetSnapshots.availableAt, expiresAt: datasetSnapshots.expiresAt }).from(datasetSnapshots).where(eq(datasetSnapshots.id, id));
    const [metadata] = await (lock ? metadataQuery.for("share") : metadataQuery).limit(1);
    const now = new Date();
    if (!metadata || !canAccessDatasetSnapshot(metadata, { userId: actor.id, organizationId: actor.organizationId }) || metadata.availableAt > now || metadata.expiresAt !== null && metadata.expiresAt <= now) throw new Error("Quant dataset is unavailable in the current tenant.");
    if (expectedHashes && expectedHashes[id] !== metadata.contentHash) throw new Error("Quant dataset changed after run admission.");
    const policy = metadata.entitlementPolicyId ? await getEntitlementPolicyById(metadata.entitlementPolicyId, db, lock) : null;
    if (!policy || policy.provider !== metadata.provider || policy.dataClass !== metadata.dataClass || policy.effectiveFrom > now || policy.effectiveTo !== null && policy.effectiveTo <= now || !(purpose === "execute" ? ["display", "model_input", "derived_output"] : ["display", "derived_output"]).every(use => policy.permittedUses.includes(use))) throw new Error("Current linked rights do not permit Quant source input and derived output.");
    if (policy.accessScope === "internal_only" && !actor.role.startsWith("internal_")) throw new Error("Quant source requires internal access.");
    const [snapshot] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, id)).limit(1);
    if (!snapshot || stableSnapshotHash({ payload: snapshot.payload, provider: snapshot.provider, lineage: snapshot.lineage }) !== metadata.contentHash) throw new Error("Quant source content does not match its immutable snapshot hash.");
    const { records, numericColumns } = flattenSnapshotForColumnar(snapshot);
    if (!records.length) throw new Error("Quant source has no admitted observations.");
    if (records.some(row => ["available_at", "published_at", "quote_at", "observation_at", "as_of", "date"].some(key => typeof row[key] === "string" && Number.isFinite(Date.parse(row[key] as string)) && Date.parse(row[key] as string) > now.getTime()))) throw new Error("Quant source includes observations not yet available; no future values were selected.");
    for (const binding of bindings.filter(binding => binding.snapshotId === id)) {
      if (!numericColumns.includes(binding.field)) throw new Error(`Quant source field ${binding.field} is not a canonical numeric field.`);
      const rows = binding.selection === "last" ? [records[records.length - 1]] : records;
      const values = rows.map(row => row[binding.field]);
      if (values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error(`Quant source field ${binding.field} has missing/non-finite observations; no values were dropped or filled.`);
      const scaled = (values as number[]).map(value => value * binding.scale);
      if (scaled.some(value => !Number.isFinite(value))) throw new Error("Quant source scale produced a non-finite value.");
      output[binding.parameter] = binding.selection === "last" ? scaled[0] : scaled;
    }
    hashes[id] = metadata.contentHash;
    sourceRefs.push(`dataset-snapshot:${id}`, `dataset-content-sha256:${metadata.contentHash}`, `entitlement-policy:${policy.id}`);
  }
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > 1_000_000) throw new Error("Resolved Quant parameters exceed the 1 MB input limit.");
  return { parameters: output, hashes, sourceRefs: [...new Set(sourceRefs)], bindings };
}
