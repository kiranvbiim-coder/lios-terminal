import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  deleteVaultCredential,
  getVaultCredential,
  hasVaultCredential,
  invalidateVaultCache,
  isUserScopedCredentialAvailable,
  listVaultCredentials,
  resolveCredential,
  setVaultCredential,
} from "./credentialVault";
import { runWithRequestIdentity } from "./requestContext";

// Use a temp dir so tests never touch the real vault
const TEST_DIR = path.join(os.tmpdir(), `lios-vault-test-${process.pid}`);

test.before(() => {
  process.env.LIMURIA_DATA_DIR = TEST_DIR;
  process.env.LIMURIA_VAULT_SECRET = "test-vault-secret-at-least-32-characters-long!";
  fs.mkdirSync(TEST_DIR, { recursive: true });
  invalidateVaultCache();
});

test.after(() => {
  delete process.env.LIMURIA_DATA_DIR;
  delete process.env.LIMURIA_VAULT_SECRET;
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test("set, get, has, list, delete round-trip for vault credentials", () => {
  invalidateVaultCache();
  setVaultCredential("testKey", "secret-value-123", "Test API Key");

  assert.equal(hasVaultCredential("testKey"), true);
  assert.equal(getVaultCredential("testKey"), "secret-value-123");
  assert.equal(hasVaultCredential("nonexistent"), false);
  assert.equal(getVaultCredential("nonexistent"), null);

  const list = listVaultCredentials();
  assert.ok(list.some((entry) => entry.name === "testKey" && entry.label === "Test API Key"));

  // Value never appears in list
  for (const entry of list) {
    assert.ok(!("value" in entry));
    assert.ok(!("encrypted" in entry));
  }

  assert.equal(deleteVaultCredential("testKey"), true);
  assert.equal(hasVaultCredential("testKey"), false);
  assert.equal(getVaultCredential("testKey"), null);
  assert.equal(deleteVaultCredential("testKey"), false);
});

test("vault credentials survive cache invalidation (persisted to disk)", () => {
  invalidateVaultCache();
  setVaultCredential("persistKey", "persist-value");

  // Invalidate the in-memory cache and re-read from disk
  invalidateVaultCache();
  assert.equal(getVaultCredential("persistKey"), "persist-value");

  // Cleanup
  deleteVaultCredential("persistKey");
});

test("vault file has restricted permissions (0o600) on unix", () => {
  if (process.platform === "win32") return; // chmod semantics differ
  invalidateVaultCache();
  setVaultCredential("permKey", "perm-value");
  const filePath = path.join(TEST_DIR, "credential-vault.enc.json");
  const stats = fs.statSync(filePath);
  assert.equal(stats.mode & 0o777, 0o600);
  deleteVaultCredential("permKey");
});

test("resolveCredential prefers env var over vault", () => {
  invalidateVaultCache();
  setVaultCredential("testResolveKey", "from-vault");
  process.env.TEST_RESOLVE_ENV = "from-env";
  try {
    assert.equal(resolveCredential("TEST_RESOLVE_ENV", "testResolveKey"), "from-env");
    delete process.env.TEST_RESOLVE_ENV;
    assert.equal(resolveCredential("TEST_RESOLVE_ENV", "testResolveKey"), "from-vault");
  } finally {
    delete process.env.TEST_RESOLVE_ENV;
    deleteVaultCredential("testResolveKey");
  }
});

test("resolveCredential returns null for missing credential", () => {
  invalidateVaultCache();
  assert.equal(resolveCredential("NONEXISTENT_ENV_VAR_XYZ", "nonexistentVaultKey"), null);
});

test("GM12 hosted organization credential cannot inherit operator env or local machine vault", () => {
  const previousStore = process.env.LIMURIA_CREDENTIAL_STORE;
  const previousEnv = process.env.GM12_TENANT_PROVIDER_API_KEY;
  process.env.LIMURIA_CREDENTIAL_STORE = "organization";
  process.env.GM12_TENANT_PROVIDER_API_KEY = "operator-funded-secret";
  setVaultCredential("gm12TenantProviderKey", "local-machine-secret");
  try {
    const tenantA = runWithRequestIdentity({
      userId: 1001, organizationId: 44,
      credentials: { gm12TenantProviderKey: "tenant-a-secret" },
    }, () => resolveCredential("GM12_TENANT_PROVIDER_API_KEY", "gm12TenantProviderKey"));
    const tenantWithoutKey = runWithRequestIdentity({
      userId: 2002, organizationId: 55, credentials: {},
    }, () => resolveCredential("GM12_TENANT_PROVIDER_API_KEY", "gm12TenantProviderKey"));
    assert.equal(tenantA, "tenant-a-secret", "organization-owned secret must outrank operator env");
    assert.equal(tenantWithoutKey, null, "missing organization credential must fail closed");
    assert.equal(resolveCredential("GM12_TENANT_PROVIDER_API_KEY", "gm12TenantProviderKey"), "operator-funded-secret",
      "desktop/operator requests retain their established environment precedence");
    delete process.env.GM12_TENANT_PROVIDER_API_KEY;
    assert.equal(resolveCredential("GM12_TENANT_PROVIDER_API_KEY", "gm12TenantProviderKey"), "local-machine-secret",
      "desktop/operator requests retain their existing encrypted-vault fallback");
  } finally {
    deleteVaultCredential("gm12TenantProviderKey");
    if (previousStore === undefined) delete process.env.LIMURIA_CREDENTIAL_STORE;
    else process.env.LIMURIA_CREDENTIAL_STORE = previousStore;
    if (previousEnv === undefined) delete process.env.GM12_TENANT_PROVIDER_API_KEY;
    else process.env.GM12_TENANT_PROVIDER_API_KEY = previousEnv;
  }
});

test("user-scoped credential checks exclude operator environment and legacy fallbacks", () => {
  const previousStore = process.env.LIMURIA_CREDENTIAL_STORE;
  const previousEnvCredential = process.env.TEST_USER_SCOPED_ENV;
  process.env.LIMURIA_CREDENTIAL_STORE = "organization";
  process.env.TEST_USER_SCOPED_ENV = "operator-secret";
  setVaultCredential("testUserScopedKey", "local-secret");

  try {
    const organizationHasCredential = runWithRequestIdentity({
      userId: 42,
      organizationId: 7,
      credentials: { testUserScopedKey: "organization-secret" },
    }, () => isUserScopedCredentialAvailable("testUserScopedKey"));
    const organizationMissingCredential = runWithRequestIdentity({
      userId: 42,
      organizationId: 7,
      credentials: {},
    }, () => isUserScopedCredentialAvailable("testUserScopedKey"));

    assert.equal(organizationHasCredential, true);
    assert.equal(organizationMissingCredential, false);
  } finally {
    deleteVaultCredential("testUserScopedKey");
    if (previousStore === undefined) delete process.env.LIMURIA_CREDENTIAL_STORE;
    else process.env.LIMURIA_CREDENTIAL_STORE = previousStore;
    if (previousEnvCredential === undefined) delete process.env.TEST_USER_SCOPED_ENV;
    else process.env.TEST_USER_SCOPED_ENV = previousEnvCredential;
  }
});

test("migrates legacy machine-key ciphertext when an OS-protected vault secret becomes available", () => {
  const originalSecret = process.env.LIMURIA_VAULT_SECRET;
  const name = "legacyMigrationKey";
  try {
    delete process.env.LIMURIA_VAULT_SECRET;
    invalidateVaultCache();
    setVaultCredential(name, "legacy-secret-value");
    const filePath = path.join(TEST_DIR, "credential-vault.enc.json");
    const before = JSON.parse(fs.readFileSync(filePath, "utf8"))[name].encrypted;

    process.env.LIMURIA_VAULT_SECRET = "new-os-protected-vault-secret-that-is-long-enough";
    invalidateVaultCache();
    assert.equal(getVaultCredential(name), "legacy-secret-value");

    const after = JSON.parse(fs.readFileSync(filePath, "utf8"))[name].encrypted;
    assert.notEqual(after, before, "legacy ciphertext should be rewritten with the configured OS-protected key");

    invalidateVaultCache();
    assert.equal(getVaultCredential(name), "legacy-secret-value");
  } finally {
    deleteVaultCredential(name);
    if (originalSecret === undefined) delete process.env.LIMURIA_VAULT_SECRET;
    else process.env.LIMURIA_VAULT_SECRET = originalSecret;
    invalidateVaultCache();
  }
});
