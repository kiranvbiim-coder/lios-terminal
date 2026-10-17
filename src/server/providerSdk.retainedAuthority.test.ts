import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

const directory = await mkdtemp(path.join(tmpdir(), "lios-retained-authority-"));
process.env.LIMURIA_DATA_DIR = directory;
// This test intentionally loads DB modules only after its isolated data path is set.
const { initDb, closeDb, getDb } = await import("./db");
const { users, datasetSnapshots, dataEntitlementPolicies } = await import("@shared/schema");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { captureAlternativeDataset, getRetainedAlternativeMetadata, readPermittedAlternativeDataset } = await import("./alternativeDatasetStore");
const { createNativeProviderAdapters, createCanonicalDataRequest, ProviderSdkRegistry, executeCanonicalDataRequest } = await import("./providerSdk");

test("retained native P5 sources use current owner and reviewed permitted-use policy before reading payload", async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); await rm(directory, { recursive: true, force: true }); });
  const [owner, other] = await getDb().insert(users).values([
    { email: `${randomUUID()}@example.test`, passwordHash: "fixture", name: "Source owner", role: "internal_analyst" as const },
    { email: `${randomUUID()}@example.test`, passwordHash: "fixture", name: "Other owner", role: "internal_analyst" as const },
  ]).returning();
  const context = { userId: owner.id, role: owner.role, organizationId: null };
  const provider = `retained-${randomUUID()}`;
  const { policy } = await createEntitlementPolicy({ provider, dataClass: "estimates", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["internal_research"], attribution: "Owner-provided estimate", termsUrl: null, effectiveFrom: "2020-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: "2020-01-01T00:00:00.000Z", notes: null }, owner.id);
  const { snapshot } = await captureAlternativeDataset({ dataClass: "estimates", entityKey: "AUTHORITY", source: "owner-import", provider, frequency: "annual", currency: "USD", timezone: "UTC", effectiveAt: null, publishedAt: null, retrievedAt: "2020-01-01T00:00:00.000Z", availableAt: "2020-01-01T00:00:00.000Z", organizationId: null, lineage: { source: "owner-fixture" }, payload: { symbol: "AUTHORITY", observations: [{ symbol: "AUTHORITY", metric: "eps", fiscalPeriod: "FY2020", periodEnd: "2020-12-31", contributor: "explicit-fixture", value: 1, currency: "USD", unit: "USD/share", publishedAt: "2020-01-01T00:00:00.000Z", availableAt: "2020-01-01T00:00:00.000Z" }], actuals: [] } }, owner.id);
  const native = createNativeProviderAdapters().find(adapter => adapter.capabilities.includes("estimates"));
  assert.ok(native);
  const request = createCanonicalDataRequest({ capability: "estimates", entity: { ref: "AUTHORITY", symbol: "AUTHORITY", identifiers: {} }, projectId: null, fields: [], parameters: {}, pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false }, providerAllow: [], providerDeny: [] });
  const registry = new ProviderSdkRegistry(); registry.register(native);
  const execute = () => executeCanonicalDataRequest(request, context, registry);
  const permitted = await execute();
  assert.equal(permitted.observation?.entitlement.policyId, policy.id);
  assert.deepEqual(permitted.observation?.entitlement.permittedUses, ["internal_research"]);

  await t.test("organization-null snapshots are not other-owner public data", async () => {
    const result = await executeCanonicalDataRequest(request, { ...context, userId: other.id }, registry);
    assert.equal(result.observation, null);
    assert.equal(result.attempts[0].status, "empty");
  });
  await t.test("a stale reference cannot override current revocation and next candidate remains eligible", async () => {
    const { policy: revoked } = await createEntitlementPolicy({ provider, dataClass: "estimates", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display"], attribution: null, termsUrl: null, effectiveFrom: "2021-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: "2021-01-01T00:00:00.000Z", notes: "Revoked research" }, owner.id);
    const denied = await execute();
    assert.equal(denied.observation, null);
    assert.equal(denied.gap?.reason, "entitlement_required");
    const next = new ProviderSdkRegistry(); next.register(native);
    let fetched = 0;
    next.register({ id: "eligible-next", label: "Explicit eligible next candidate", priority: native.priority + 1, capabilities: ["estimates"], pointInTimeModes: ["latest"], async fetch() { fetched++; return { data: { observations: [] }, sourceRefs: ["owner-supplied:eligible-next"], entitlement: { decision: "allowed", policyId: null, permittedUses: ["internal_research"], reasons: ["Independent eligible candidate"] }, normalized: true }; } });
    const result = await executeCanonicalDataRequest(request, context, next);
    assert.equal(result.attempts[0].status, "entitlement_denied");
    assert.equal(result.observation?.providerId, "eligible-next"); assert.equal(fetched, 1);
    await getDb().delete(dataEntitlementPolicies).where(eq(dataEntitlementPolicies.id, revoked.id));
  });
  await t.test("revocation between metadata admission and payload read is denied", async () => {
    const metadata = await getRetainedAlternativeMetadata("estimates", "AUTHORITY", context); assert.ok(metadata);
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: [] }).where(eq(dataEntitlementPolicies.id, policy.id));
    await assert.rejects(readPermittedAlternativeDataset(metadata, context), /current owner/);
    await getDb().update(dataEntitlementPolicies).set({ permittedUses: ["internal_research"] }).where(eq(dataEntitlementPolicies.id, policy.id));
  });
  await t.test("expired snapshots and current policies cannot authorize payload", async () => {
    await getDb().update(datasetSnapshots).set({ expiresAt: new Date("2020-01-02") }).where(eq(datasetSnapshots.id, snapshot.id));
    assert.equal((await execute()).attempts[0].status, "entitlement_denied");
    await getDb().update(datasetSnapshots).set({ expiresAt: null }).where(eq(datasetSnapshots.id, snapshot.id));
    await getDb().update(dataEntitlementPolicies).set({ effectiveTo: new Date("2020-01-02") }).where(eq(dataEntitlementPolicies.id, policy.id));
    assert.equal((await execute()).attempts[0].status, "entitlement_denied");
    await getDb().update(dataEntitlementPolicies).set({ effectiveTo: null }).where(eq(dataEntitlementPolicies.id, policy.id));
  });
  await t.test("metadata ownership changes invalidate a previously admitted source before payload parsing", async () => {
    const metadata = await getRetainedAlternativeMetadata("estimates", "AUTHORITY", context); assert.ok(metadata);
    await getDb().update(datasetSnapshots).set({ createdByUserId: other.id, payload: { invalid: "must not parse or disclose" } }).where(eq(datasetSnapshots.id, snapshot.id));
    await assert.rejects(readPermittedAlternativeDataset(metadata, context), /current owner/);
    const hidden = await execute();
    assert.equal(hidden.observation, null);
    assert.doesNotMatch(JSON.stringify(hidden), /must not parse or disclose/);
    await getDb().update(datasetSnapshots).set({ createdByUserId: owner.id, payload: snapshot.payload }).where(eq(datasetSnapshots.id, snapshot.id));
  });
  await t.test("unreviewed rights, current disabled owner, future data and changed hash are explicit denials", async () => {
    await getDb().update(dataEntitlementPolicies).set({ reviewedAt: null }).where(eq(dataEntitlementPolicies.id, policy.id));
    assert.equal((await execute()).observation, null);
    await getDb().update(dataEntitlementPolicies).set({ reviewedAt: new Date("2020-01-01") }).where(eq(dataEntitlementPolicies.id, policy.id));
    await getDb().update(users).set({ active: false }).where(eq(users.id, owner.id));
    assert.equal((await execute()).attempts[0].status, "entitlement_denied");
    await getDb().update(users).set({ active: true }).where(eq(users.id, owner.id));
    await getDb().update(datasetSnapshots).set({ availableAt: new Date("2099-01-01") }).where(eq(datasetSnapshots.id, snapshot.id));
    assert.equal((await execute()).observation, null);
    await getDb().update(datasetSnapshots).set({ availableAt: new Date("2020-01-01"), contentHash: "0".repeat(64) }).where(eq(datasetSnapshots.id, snapshot.id));
    assert.equal((await execute()).attempts[0].status, "entitlement_denied");
  });
});
