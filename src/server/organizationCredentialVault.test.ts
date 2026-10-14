import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decryptOrganizationCredential,
  encryptOrganizationCredential,
} from "./organizationCredentialVault";
import { resolveCredential, setVaultCredential, deleteVaultCredential, invalidateVaultCache } from "./credentialVault";
import { runWithRequestIdentity } from "./requestContext";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lios-org-vault-test-"));

function withHostedVault<T>(callback: () => T): T {
  const previousStore = process.env.LIMURIA_CREDENTIAL_STORE;
  const previousSecret = process.env.LIMURIA_HOSTED_VAULT_SECRET;
  process.env.LIMURIA_CREDENTIAL_STORE = "organization";
  process.env.LIMURIA_HOSTED_VAULT_SECRET = "test-hosted-vault-secret-at-least-32-characters";
  try {
    return callback();
  } finally {
    if (previousStore === undefined) delete process.env.LIMURIA_CREDENTIAL_STORE;
    else process.env.LIMURIA_CREDENTIAL_STORE = previousStore;
    if (previousSecret === undefined) delete process.env.LIMURIA_HOSTED_VAULT_SECRET;
    else process.env.LIMURIA_HOSTED_VAULT_SECRET = previousSecret;
  }
}

test.after(() => {
  delete process.env.LIMURIA_DATA_DIR;
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

test("organization credential encryption is bound to organization and name", () => {
  withHostedVault(() => {
    const encrypted = encryptOrganizationCredential(7, "providerKey", "tenant-secret");
    assert.equal(decryptOrganizationCredential(7, "providerKey", encrypted), "tenant-secret");
    assert.equal(decryptOrganizationCredential(8, "providerKey", encrypted), null);
    assert.equal(decryptOrganizationCredential(7, "otherKey", encrypted), null);
    assert.ok(!encrypted.includes("tenant-secret"));
  });
});

test("hosted organization requests never fall back to machine-local credentials", () => {
  const previousDataDir = process.env.LIMURIA_DATA_DIR;
  process.env.LIMURIA_DATA_DIR = TEST_DIR;
  invalidateVaultCache();
  setVaultCredential("providerKey", "machine-secret");
  try {
    withHostedVault(() => {
      runWithRequestIdentity({ userId: 10, organizationId: 7, credentials: {} }, () => {
        assert.equal(resolveCredential("MISSING_PROVIDER_ENV", "providerKey"), null);
      });
      runWithRequestIdentity({ userId: 10, organizationId: 7, credentials: { providerKey: "tenant-secret" } }, () => {
        assert.equal(resolveCredential("MISSING_PROVIDER_ENV", "providerKey"), "tenant-secret");
      });
    });
  } finally {
    deleteVaultCredential("providerKey");
    invalidateVaultCache();
    if (previousDataDir === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previousDataDir;
  }
});
