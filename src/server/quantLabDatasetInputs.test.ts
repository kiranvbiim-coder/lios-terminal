import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-quant-source-inputs-"));
process.env.LIOS_DATA_ROOT = root; process.env.LIMURIA_DATA_DIR = root; delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, datasetSnapshots } = await import("@shared/schema");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { stableSnapshotHash } = await import("./pointInTimeDatasetStore");
const { resolveQuantDatasetInputs } = await import("./quantLabDatasetInputs");
const { admitTerminalExecutionSources } = await import("./terminalArtifactTool");
const { resolveAdvancedQuantInputProvenance, canonicalSnapshotColumnTransform } = await import("@shared/quantModelRegistry");

test("admitted snapshot fields replace manual engine values with explicit scale and refuse missing/foreign/revoked inputs", async t => {
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  await initDb();
  const [owner, foreign] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Source owner", role: "internal_analyst" as const, organizationId: null },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Other owner", role: "internal_analyst" as const, organizationId: null },
  ]).returning();
  const { policy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "private_series", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input", "derived_output"], attribution: "Synthetic known source values", termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: "No provider observations claimed" }, owner.id);
  const payload = { seriesId: "synthetic", name: "Synthetic inputs", unit: "percent", frequency: "daily", dimensions: {}, observations: [
    { observationAt: "2024-01-01T00:00:00.000Z", availableAt: "2024-01-01T00:00:00.000Z", value: 10 },
    { observationAt: "2024-01-02T00:00:00.000Z", availableAt: "2024-01-02T00:00:00.000Z", value: 20 },
  ] };
  const lineage = { sourceRefs: ["user-supplied:synthetic"] };
  const hash = stableSnapshotHash({ payload, provider: "user_supplied", lineage });
  const [snapshot] = await getDb().insert(datasetSnapshots).values({ id: crypto.randomUUID(), datasetKey: `quant-synthetic:${crypto.randomUUID()}`, entityKey: "synthetic", dataClass: "private_series", schemaVersion: "1", source: "user_import", provider: "user_supplied", frequency: "daily", availableAt: new Date("2024-01-02T00:00:00.000Z"), retrievedAt: new Date(), contentHash: hash, quality: {}, lineage, payload, organizationId: null, createdByUserId: owner.id, entitlementPolicyId: policy.id }).returning();
  const binding = { snapshotId: snapshot.id, field: "value", parameter: "data", selection: "values" as const, scale: 0.01 };
  const resolved = await resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [binding], { data: [999], alpha: 0.05 });
  assert.deepEqual(resolved.parameters, { data: [0.1, 0.2], alpha: 0.05 });
  assert.equal(resolved.hashes[snapshot.id], hash);
  assert.ok(resolved.sourceRefs.includes(`entitlement-policy:${policy.id}`));
  assert.deepEqual((await resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [{ ...binding, parameter: "last", selection: "last" }], {})).parameters, { last: 0.2 });
  await assert.rejects(resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [], {}), /explicit source field/);
  await assert.rejects(resolveQuantDatasetInputs(foreign.id, null, [snapshot.id], [binding], {}), /current tenant/);
  await assert.rejects(resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [binding, binding], {}), /exactly one dataset binding/);
  await assert.rejects(resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [binding], {}, { [snapshot.id]: "0".repeat(64) }), /changed after run admission/);
  const transformed = resolveAdvancedQuantInputProvenance({ data: [0.1, 0.2] }, { dataClassification: "cached", sourceBindings: [{
    contractFamily: "statistics", field: "data", connectorId: "private-import", provider: "user_supplied", priority: "manual_override",
    sourceReference: "user-supplied:synthetic", asOf: "2024-01-02T00:00:00.000Z", retrievedAt: "2024-01-02T00:00:00.000Z", freshness: "cached",
    snapshot: { id: snapshot.id, contentHash: hash }, transformations: [canonicalSnapshotColumnTransform({ field: "value", selection: "values", scale: 0.01 })],
  }] });
  assert.equal(transformed.success, true);
  if (transformed.success) {
    const tenant = { userId: owner.id, organizationId: null, role: owner.role };
    assert.ok((await admitTerminalExecutionSources(tenant, transformed.data, { data: [0.1, 0.2] }, getDb(), true, undefined, "stats/normality")).includes(`dataset-snapshot:${snapshot.id}`));
    await assert.rejects(admitTerminalExecutionSources(tenant, transformed.data, { data: [999] }, getDb(), true, undefined, "stats/normality"), /do not match actual engine inputs/);
    await assert.rejects(admitTerminalExecutionSources({ ...tenant, role: "client_user" }, transformed.data, { data: [0.1, 0.2] }, getDb(), true, ["display", "derived_output"], "stats/normality"), /Current source rights/);
  }
  await getDb().update(datasetSnapshots).set({ entitlementPolicyId: null }).where(eq(datasetSnapshots.id, snapshot.id));
  await assert.rejects(resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [binding], {}), /Current linked rights/);
  await assert.rejects(resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [{ ...binding, parameter: "seed" }], {}), /reserved runtime control/);
  await getDb().update(datasetSnapshots).set({ entitlementPolicyId: policy.id, payload: { ...payload, observations: [payload.observations[0], { ...payload.observations[1], value: null }] } }).where(eq(datasetSnapshots.id, snapshot.id));
  await assert.rejects(resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [binding], {}), /immutable snapshot hash/);
  await getDb().update(datasetSnapshots).set({ payload }).where(eq(datasetSnapshots.id, snapshot.id));
  await getDb().update(users).set({ active: false }).where(eq(users.id, owner.id));
  await assert.rejects(resolveQuantDatasetInputs(owner.id, null, [snapshot.id], [binding], {}), /Current Quant author/);
});
