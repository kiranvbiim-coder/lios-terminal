import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-source-cache-"));
const oldRoot = process.env.LIMURIA_DATA_DIR;
process.env.LIMURIA_DATA_DIR = root;

const [
  { initDb, closeDb, getDb },
  { users },
  { upsertSourceConnection, deleteSourceConnection, testSourceConnection },
  { ProviderSdkRegistry, createCanonicalDataRequest },
  { executeCanonicalDataRequestCached, clearProviderExecutionCache },
] = await Promise.all([
  import("./db"),
  import("@shared/schema"),
  import("./sourceConnectionService"),
  import("./providerSdk"),
  import("./providerExecutionCache"),
]);

test("P5 source save, update, verification and deletion invalidate the same provider cache key", async (t) => {
  await initDb();
  t.after(async () => {
    clearProviderExecutionCache();
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
    if (oldRoot === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = oldRoot;
  });
  const [user] = await getDb().insert(users).values({
    email: "source-cache-test@example.test",
    passwordHash: "test-hash",
    role: "internal_admin",
    name: "Source Cache Test",
  }).returning();
  const owner = { id: user.id, email: user.email };
  const tenant = { userId: user.id, organizationId: null, role: user.role };
  const input = {
    connectorId: "file_upload",
    sourceType: "file" as const,
    name: "Local JSON Data",
    credentialRef: null,
    config: { path: path.join(root, "one.json") },
  };
  const registry = new ProviderSdkRegistry();
  let executions = 0;
  registry.register({
    id: "source:stable",
    label: "Same Provider",
    priority: 1,
    capabilities: ["provider_extension"],
    pointInTimeModes: ["latest"],
    async fetch() {
      executions += 1;
      return {
        data: { generation: executions },
        normalized: true,
        entitlement: { decision: "allowed" as const, policyId: null, permittedUses: ["internal_research"], reasons: [] },
      };
    },
  });
  const request = createCanonicalDataRequest({
    projectId: null,
    capability: "provider_extension",
    entity: { ref: "example-json", symbol: null, identifiers: {} },
    fields: [],
    parameters: {},
    providerAllow: [],
    providerDeny: [],
  });
  clearProviderExecutionCache();

  async function expectCache(expected: "hit" | "miss") {
    const executed = await executeCanonicalDataRequestCached(request, tenant, registry);
    assert.equal(executed.cache, expected);
    assert.ok(executed.response.observation);
  }

  await expectCache("miss");
  await expectCache("hit");
  const saved = await upsertSourceConnection(user.id, null, input, owner);
  await expectCache("miss");
  await expectCache("hit");
  await upsertSourceConnection(user.id, null, {
    ...input, id: saved.id, config: { path: path.join(root, "two.json") },
  }, owner);
  await expectCache("miss");
  await expectCache("hit");

  // The missing file fails live verification, which must also invalidate
  // the observation cached under the source's previously configured state.
  const verified = await testSourceConnection(user.id, saved.id, owner);
  assert.ok(verified);
  assert.notEqual(verified.status, "healthy");
  await expectCache("miss");
  await expectCache("hit");

  assert.equal(await deleteSourceConnection(user.id, saved.id, owner), true);
  await expectCache("miss");
  assert.equal(executions, 5);
});
