import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-organization-snapshot-"));
const previous = { root: process.env.LIMURIA_DATA_DIR, store: process.env.LIMURIA_CREDENTIAL_STORE, secret: process.env.LIMURIA_HOSTED_VAULT_SECRET };
process.env.LIMURIA_DATA_DIR = root;
process.env.LIMURIA_CREDENTIAL_STORE = "organization";
process.env.LIMURIA_HOSTED_VAULT_SECRET = "isolated-snapshot-fixture-secret-not-production";
const [{ initDb, closeDb, getDb }, { organizations }, vault] = await Promise.all([import("./db"), import("@shared/schema"), import("./organizationCredentialVault")]);

test("organization snapshots fail closed after replacement, same-value save, A-B-A and delete without affecting another organization", async t => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
    for (const [name, value] of [["LIMURIA_DATA_DIR", previous.root], ["LIMURIA_CREDENTIAL_STORE", previous.store], ["LIMURIA_HOSTED_VAULT_SECRET", previous.secret]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const [a, b] = await getDb().insert(organizations).values([{ name: "Snapshot A", slug: "snapshot-a" }, { name: "Snapshot B", slug: "snapshot-b" }]).returning();
  await vault.setOrganizationCredential(a.id, "ollamaBaseUrl", "http://127.0.0.1:11434");
  await vault.setOrganizationCredential(b.id, "ollamaBaseUrl", "http://127.0.0.1:11435");
  const stableB = await vault.loadOrganizationCredentials(b.id);
  const oldA = await vault.loadOrganizationCredentials(a.id);
  const assertOldA = await vault.assertOrganizationCredentialSnapshotCurrent(a.id, oldA, "ollamaBaseUrl");
  await vault.setOrganizationCredential(a.id, "ollamaBaseUrl", "http://127.0.0.1:11434");
  assert.throws(assertOldA, /changed/);
  await assert.rejects(vault.assertOrganizationCredentialSnapshotCurrent(a.id, oldA, "ollamaBaseUrl"), /changed|revoked/);
  (await vault.assertOrganizationCredentialSnapshotCurrent(b.id, stableB, "ollamaBaseUrl"))();
  const sameValueSnapshot = await vault.loadOrganizationCredentials(a.id);
  await vault.setOrganizationCredential(a.id, "ollamaBaseUrl", "http://127.0.0.1:11436");
  await vault.setOrganizationCredential(a.id, "ollamaBaseUrl", "http://127.0.0.1:11434");
  await assert.rejects(vault.assertOrganizationCredentialSnapshotCurrent(a.id, sameValueSnapshot, "ollamaBaseUrl"), /changed|revoked/);
  const currentA = await vault.loadOrganizationCredentials(a.id);
  (await vault.assertOrganizationCredentialSnapshotCurrent(a.id, currentA, "ollamaBaseUrl"))();
  assert.equal(await vault.deleteOrganizationCredential(a.id, "ollamaBaseUrl"), true);
  await assert.rejects(vault.assertOrganizationCredentialSnapshotCurrent(a.id, currentA, "ollamaBaseUrl"), /changed|revoked/);
  await assert.rejects(vault.assertOrganizationCredentialSnapshotCurrent(a.id, { ollamaBaseUrl: "http://127.0.0.1:11434" }, "ollamaBaseUrl"), /snapshot/);
  (await vault.assertOrganizationCredentialSnapshotCurrent(b.id, stableB, "ollamaBaseUrl"))();
});
