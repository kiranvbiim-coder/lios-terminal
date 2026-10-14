import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-vault-keys-"));
process.env.LIOS_DATA_ROOT = root;
delete process.env.LIMURIA_VAULT_SECRET;

const vault = await import("./credentialVault");
const { readDesktopHandoff } = await import("./desktopHandoff");

const vaultFile = path.join(root, "credential-vault.enc.json");
const keyFile = path.join(root, "vault.key");
const reset = () => { fs.rmSync(vaultFile, { force: true }); fs.rmSync(keyFile, { force: true }); fs.rmSync(`${vaultFile}.pre-gm03.bak`, { force: true }); vault.invalidateVaultCache(); };
const blobOf = (name: string) => JSON.parse(fs.readFileSync(vaultFile, "utf8"))[name].encrypted as string;

/** The key earlier releases used when nothing was configured: guessable from the user and host name. */
function legacyEncrypt(plaintext: string): string {
  const key = crypto.scryptSync(`${process.env.HOME || process.env.USERPROFILE || "limuria"}:${os.hostname()}`, "limuria-vault-v1", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}
function opensWithLegacyKey(blob: string): boolean {
  const key = crypto.scryptSync(`${process.env.HOME || process.env.USERPROFILE || "limuria"}:${os.hostname()}`, "limuria-vault-v1", 32);
  const buf = Buffer.from(blob, "base64");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12), { authTagLength: 16 });
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    decipher.update(buf.subarray(12, buf.length - 16)); decipher.final();
    return true;
  } catch { return false; }
}

test.after(() => { fs.rmSync(root, { recursive: true, force: true }); });

test("with no configured secret the vault uses a random 0600 key file, not a guessable machine key", () => {
  reset();
  vault.setVaultCredential("fredApiKey", "abc-123");
  const key = fs.readFileSync(keyFile, "utf8").trim();
  assert.match(key, /^[a-f0-9]{64}$/);
  if (process.platform !== "win32") assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.equal(opensWithLegacyKey(blobOf("fredApiKey")), false, "ciphertext must not open with the old HOME:hostname key");
  vault.invalidateVaultCache();
  assert.equal(vault.getVaultCredential("fredApiKey"), "abc-123");
  assert.equal(vault.getVaultProtection(), "generated_key_file");
});

test("the generated key is created once and reused", () => {
  reset();
  vault.setVaultCredential("a", "1");
  const first = fs.readFileSync(keyFile, "utf8");
  vault.setVaultCredential("b", "2");
  assert.equal(fs.readFileSync(keyFile, "utf8"), first);
});

test("startup migration re-encrypts entries saved by earlier releases, keeps a one-time 0600 backup, and is idempotent", () => {
  reset();
  fs.writeFileSync(vaultFile, JSON.stringify({
    finnhubApiKey: { encrypted: legacyEncrypt("fh-key"), label: "Finnhub", updatedAt: "2026-01-01T00:00:00.000Z" },
    geminiApiKey: { encrypted: legacyEncrypt("gm-key"), label: "Gemini", updatedAt: "2026-01-01T00:00:00.000Z" },
  }), { mode: 0o600 });
  const original = fs.readFileSync(vaultFile, "utf8");
  assert.equal(vault.migrateVaultToCurrentKey(), 2);
  assert.equal(fs.readFileSync(`${vaultFile}.pre-gm03.bak`, "utf8"), original, "backup is the untouched original");
  if (process.platform !== "win32") assert.equal(fs.statSync(`${vaultFile}.pre-gm03.bak`).mode & 0o777, 0o600);
  assert.equal(opensWithLegacyKey(blobOf("finnhubApiKey")), false);
  vault.invalidateVaultCache();
  assert.equal(vault.getVaultCredential("finnhubApiKey"), "fh-key");
  assert.equal(vault.getVaultCredential("geminiApiKey"), "gm-key");
  assert.equal(vault.migrateVaultToCurrentKey(), 0);
});

test("an OS-protected secret handed over by the desktop supersedes the generated key and entries follow it", () => {
  reset();
  vault.setVaultCredential("polygon", "poly-key");
  const before = blobOf("polygon");
  (globalThis as Record<symbol, unknown>)[vault.VAULT_SECRET_HANDOFF] = "os-protected-secret-of-sufficient-length";
  try {
    assert.equal(vault.getVaultProtection(), "configured_secret");
    vault.invalidateVaultCache();
    assert.equal(vault.migrateVaultToCurrentKey(), 1);
    assert.notEqual(blobOf("polygon"), before);
    vault.invalidateVaultCache();
    assert.equal(vault.getVaultCredential("polygon"), "poly-key");
  } finally {
    delete (globalThis as Record<symbol, unknown>)[vault.VAULT_SECRET_HANDOFF];
  }
});

