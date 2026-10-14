import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-vault-portability-"));
const rootA = path.join(base, "source-home");
const rootB = path.join(base, "destination-home");
const rootC = path.join(base, "wrong-passphrase-home");
process.env.LIOS_DATA_ROOT = rootA;
fs.mkdirSync(rootA, { recursive: true });

const {
  VAULT_SECRET_HANDOFF,
  createVaultMigrationEnvelope,
  getVaultCredential,
  invalidateVaultCache,
  restoreVaultMigrationEnvelope,
  setVaultCredential,
} = await import("./credentialVault");

const globalSecrets = globalThis as Record<symbol, unknown>;
const SOURCE_SECRET = "source-os-protected-vault-secret-abcdefghijklmnopqrstuvwxyz";
const DEST_SECRET = "destination-os-protected-vault-secret-abcdefghijklmnopqrstuvwxyz";
const PASS = "backup-passphrase-for-portable-vault";
const VALUE = "provider-secret-value-should-never-appear-on-disk";

test.after(() => {
  delete globalSecrets[VAULT_SECRET_HANDOFF];
  fs.rmSync(base, { recursive: true, force: true });
});

test("portable encrypted vault envelope rekeys source secret A to destination secret B", () => {
  process.env.LIOS_DATA_ROOT = rootA;
  globalSecrets[VAULT_SECRET_HANDOFF] = SOURCE_SECRET;
  invalidateVaultCache();
  setVaultCredential("providerApiKey", VALUE, "Provider API key");
  assert.equal(getVaultCredential("providerApiKey"), VALUE);

  const envelope = createVaultMigrationEnvelope(PASS);
  const serializedEnvelope = envelope.toString("utf8");
  assert.equal(serializedEnvelope.includes(VALUE), false);
  assert.equal(serializedEnvelope.includes(SOURCE_SECRET), false);
  assert.equal(serializedEnvelope.includes(DEST_SECRET), false);

  process.env.LIOS_DATA_ROOT = rootB;
  fs.mkdirSync(rootB, { recursive: true });
  globalSecrets[VAULT_SECRET_HANDOFF] = DEST_SECRET;
  invalidateVaultCache();

  const migrated = restoreVaultMigrationEnvelope(envelope, PASS);
  assert.equal(migrated, 1);
  assert.equal(getVaultCredential("providerApiKey"), VALUE);
  assert.equal(fs.existsSync(path.join(rootB, "vault.key")), false, "source/generated fallback is retired under destination custody");

  const persisted = fs.readFileSync(path.join(rootB, "credential-vault.enc.json"), "utf8");
  assert.equal(persisted.includes(VALUE), false);
  assert.equal(persisted.includes(SOURCE_SECRET), false);
  assert.equal(persisted.includes(DEST_SECRET), false);

  globalSecrets[VAULT_SECRET_HANDOFF] = SOURCE_SECRET;
  invalidateVaultCache();
  assert.equal(getVaultCredential("providerApiKey"), null, "source OS secret can no longer open the destination vault");

  globalSecrets[VAULT_SECRET_HANDOFF] = DEST_SECRET;
  invalidateVaultCache();
  assert.equal(getVaultCredential("providerApiKey"), VALUE);
});

test("wrong backup passphrase cannot replace an existing destination vault", () => {
  process.env.LIOS_DATA_ROOT = rootA;
  globalSecrets[VAULT_SECRET_HANDOFF] = SOURCE_SECRET;
  invalidateVaultCache();
  const envelope = createVaultMigrationEnvelope(PASS);

  process.env.LIOS_DATA_ROOT = rootC;
  fs.mkdirSync(rootC, { recursive: true });
  globalSecrets[VAULT_SECRET_HANDOFF] = DEST_SECRET;
  invalidateVaultCache();
  setVaultCredential("existing", "keep-me", "Existing");

  assert.throws(
    () => restoreVaultMigrationEnvelope(envelope, "definitely-wrong-passphrase"),
    /could not be opened/,
  );
  invalidateVaultCache();
  assert.equal(getVaultCredential("existing"), "keep-me");
  assert.equal(getVaultCredential("providerApiKey"), null);
});
