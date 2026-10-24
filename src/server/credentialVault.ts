/**
 * Encrypted-at-rest credential vault for provider API keys and secrets.
 *
 * Credentials are AES-256-GCM encrypted with a key derived from a
 * secret that is never guessable from the machine: the OS-protected secret the
 * desktop hands over at startup (or LIMURIA_VAULT_SECRET), otherwise a random
 * key generated once and stored 0600 beside the vault (GM-03). The old
 * HOME:hostname-derived key is read-only legacy: it can still open entries
 * written by earlier releases, which are re-encrypted on first use. The vault file stores only encrypted blobs —
 * raw values never touch disk in plaintext (unless the user opts into
 * the legacy config.json path, which this module reads as a migration
 * fallback but never writes to).
 *
 * For desktop/operator requests, env vars take precedence over the
 * machine-local vault (env vars in development, vault in packaged desktop).
 * In explicitly enabled hosted-organization mode, an authenticated tenant
 * request MUST use only its organization-scoped credential namespace; it
 * never inherits operator environment variables or the machine-local vault.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "node:os";
import { dataPath, dataRoot } from "./dataRoot";
import { getRequestIdentity } from "./requestContext";
import { assertOrganizationCredentialSnapshotCurrent, organizationCredentialStoreEnabled } from "./organizationCredentialVault";
import { parseSecretRef, type SecretRef } from "@shared/secretRef";
import { PrivateSecretFileError, readPrivateSecretFile } from "./privateSecretFile";
import { invalidateAIChatCredential } from "./connectorVerification";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT = "limuria-vault-v1";
const VAULT_MIGRATION_FORMAT = "lios-vault-migration/1" as const;
const VAULT_MIGRATION_KEY_BYTES = 32;
const VAULT_MIGRATION_SALT_BYTES = 16;

interface VaultEntry {
  /** base64-encoded IV + ciphertext + authTag */
  encrypted: string;
  label: string;
  updatedAt: string;
}

type VaultStore = Record<string, VaultEntry>;

let cachedStore: VaultStore | null = null;
let cachedStorePath: string | null = null;

function vaultDir(): string {
  return dataRoot();
}

function vaultFilePath(): string {
  return path.join(vaultDir(), "credential-vault.enc.json");
}

/** Where the desktop's OS-protected secret is held in memory after server/vaultSecretBootstrap.ts reads it. */
export const VAULT_SECRET_HANDOFF = Symbol.for("lios.vaultSecret");

/**
 * The pre-GM-03 fallback key (HOME + hostname, constant salt). Guessable by anyone who knows the user and
 * machine name, so it is never used to WRITE; it only opens entries saved by earlier releases.
 */
function legacyMachineMaterial(): string {
  return `${process.env.HOME || process.env.USERPROFILE || "limuria"}:${os.hostname()}`;
}

function configuredVaultSecret(): string | null {
  const handedOff = (globalThis as Record<symbol, unknown>)[VAULT_SECRET_HANDOFF];
  const secret = (typeof handedOff === "string" ? handedOff : process.env.LIMURIA_VAULT_SECRET)?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

function generatedKeyFile(): string {
  return dataPath("vault.key");
}

/** Reads the generated key if it exists; never creates it. */
function readGeneratedKey(): string | null {
  try {
    const value = fs.readFileSync(generatedKeyFile(), "utf8").trim();
    return /^[a-f0-9]{64}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Creates the key exactly once (exclusive create), so two processes cannot disagree about it. */
function readOrCreateGeneratedKey(): string {
  const existing = readGeneratedKey();
  if (existing) return existing;
  const file = generatedKeyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs are managed by the OS/user profile. */ }
  const created = readGeneratedKey();
  if (!created) throw new Error("The LiOS vault key file could not be created or read.");
  return created;
}

/**
 * How the vault key is protected, without exposing any key material.
 * `configured_secret`: supplied by the desktop (OS-protected) or by the operator.
 * `generated_key_file`: random key stored 0600 in the data root.
 */
export function getVaultProtection(): "configured_secret" | "generated_key_file" {
  return configuredVaultSecret() ? "configured_secret" : "generated_key_file";
}

function deriveKeyFromMaterial(material: string): Buffer {
  return crypto.scryptSync(material, SALT, KEY_LENGTH);
}

function deriveKey(): Buffer {
  return deriveKeyFromMaterial(configuredVaultSecret() ?? readOrCreateGeneratedKey());
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]).toString("base64");
}

function decryptWithKey(blob: string, key: Buffer): string | null {
  try {
    const buf = Buffer.from(blob, "base64");
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return null;
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch {
    return null;
  }
}

type Decrypted = { value: string; needsReencrypt: boolean };

/**
 * Candidate keys in order: the current key, a previously generated key (when a configured secret has since
 * been supplied), then the legacy machine key. Entries opened by anything but the current key are
 * re-encrypted under it by the caller.
 */
function decrypt(blob: string): Decrypted | null {
  const current = decryptWithKey(blob, deriveKey());
  if (current !== null) return { value: current, needsReencrypt: false };

  const generated = configuredVaultSecret() ? readGeneratedKey() : null;
  if (generated) {
    const value = decryptWithKey(blob, deriveKeyFromMaterial(generated));
    if (value !== null) return { value, needsReencrypt: true };
  }
  const legacy = decryptWithKey(blob, deriveKeyFromMaterial(legacyMachineMaterial()));
  return legacy !== null ? { value: legacy, needsReencrypt: true } : null;
}

function readVaultStore(): VaultStore {
  const filePath = vaultFilePath();
  if (cachedStore && cachedStorePath === filePath) return cachedStore;
  cachedStorePath = filePath;
  try {
    if (!fs.existsSync(filePath)) { cachedStore = {}; return cachedStore; }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      cachedStore = raw as VaultStore;
    } else {
      cachedStore = {};
    }
  } catch {
    cachedStore = {};
  }
  return cachedStore;
}

function writeVaultStore(store: VaultStore): void {
  const dir = vaultDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = vaultFilePath();
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
  cachedStore = store;
  cachedStorePath = filePath;
}

interface PortableVaultEntry {
  name: string;
  value: string;
  label: string;
  updatedAt: string;
}

interface PortableVaultEnvelope {
  format: typeof VAULT_MIGRATION_FORMAT;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function deriveVaultMigrationKey(passphrase: string, salt: Buffer): Buffer {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new Error("The backup passphrase must be at least 12 characters.");
  }
  if (passphrase.length > 512 || passphrase.includes("\0")) {
    throw new Error("The backup passphrase is invalid.");
  }
  return crypto.scryptSync(
    passphrase,
    Buffer.concat([Buffer.from("lios-vault-migration-v1\0", "utf8"), salt]),
    VAULT_MIGRATION_KEY_BYTES,
  );
}

/**
 * Creates a portable credential envelope only for an already encrypted backup.
 * Raw credential values exist only in process memory and are immediately sealed
 * with a key derived from the backup passphrase. The OS-protected vault master
 * secret itself is never exported.
 */
export function createVaultMigrationEnvelope(passphrase: string): Buffer {
  const store = readVaultStore();
  const entries: PortableVaultEntry[] = [];
  for (const [name, entry] of Object.entries(store)) {
    const decrypted = decrypt(entry.encrypted);
    if (!decrypted) {
      throw new Error("One or more saved credentials could not be prepared for portable encrypted backup.");
    }
    entries.push({
      name,
      value: decrypted.value,
      label: entry.label,
      updatedAt: entry.updatedAt,
    });
  }

  const salt = crypto.randomBytes(VAULT_MIGRATION_SALT_BYTES);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveVaultMigrationKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const plaintext = Buffer.from(JSON.stringify({
    format: VAULT_MIGRATION_FORMAT,
    entries,
  }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: PortableVaultEnvelope = {
    format: VAULT_MIGRATION_FORMAT,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  plaintext.fill(0);
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

/**
 * Re-keys a restored credential vault under the destination process's current
 * canonical vault key (normally Electron safeStorage handoff). The migration
 * envelope is not persisted as Home state.
 */
export function restoreVaultMigrationEnvelope(envelopeBytes: Buffer, passphrase: string): number {
  let envelope: PortableVaultEnvelope;
  try {
    const raw = JSON.parse(envelopeBytes.toString("utf8")) as Partial<PortableVaultEnvelope>;
    if (
      raw.format !== VAULT_MIGRATION_FORMAT ||
      typeof raw.salt !== "string" ||
      typeof raw.iv !== "string" ||
      typeof raw.authTag !== "string" ||
      typeof raw.ciphertext !== "string"
    ) {
      throw new Error("invalid envelope");
    }
    envelope = raw as PortableVaultEnvelope;
  } catch {
    throw new Error("Portable credential migration envelope is invalid.");
  }

  let plaintext: Buffer | null = null;
  try {
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    if (salt.length !== VAULT_MIGRATION_SALT_BYTES || iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error("invalid envelope");
    }
    const key = deriveVaultMigrationKey(passphrase, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as {
      format?: unknown;
      entries?: unknown;
    };
    if (parsed.format !== VAULT_MIGRATION_FORMAT || !Array.isArray(parsed.entries)) {
      throw new Error("invalid payload");
    }

    const migrated = Object.create(null) as VaultStore;
    const seenNames = new Set<string>();
    for (const rawEntry of parsed.entries) {
      if (!rawEntry || typeof rawEntry !== "object") throw new Error("invalid payload");
      const entry = rawEntry as Partial<PortableVaultEntry>;
      if (
        typeof entry.name !== "string" ||
        entry.name.length === 0 ||
        entry.name.length > 256 ||
        /[\0\r\n]/u.test(entry.name) ||
        seenNames.has(entry.name) ||
        typeof entry.value !== "string" ||
        typeof entry.label !== "string" ||
        typeof entry.updatedAt !== "string"
      ) {
        throw new Error("invalid payload");
      }
      seenNames.add(entry.name);
      migrated[entry.name] = {
        encrypted: encrypt(entry.value),
        label: entry.label,
        updatedAt: entry.updatedAt,
      };
    }
    writeVaultStore(migrated);

    // Once every entry is protected by the destination configured secret, an
    // old generated vault key restored from the source Home is unnecessary.
    if (configuredVaultSecret()) {
      try { fs.rmSync(generatedKeyFile(), { force: true }); } catch { /* best effort after successful re-key */ }
    }
    return Object.keys(migrated).length;
  } catch {
    throw new Error("Portable credential migration envelope could not be opened with this backup passphrase.");
  } finally {
    plaintext?.fill(0);
  }
}

/** Invalidate cache so next read picks up external changes. */
export function invalidateVaultCache(): void {
  cachedStore = null;
  cachedStorePath = null;
}

/**
 * Store a credential in the vault. The value is encrypted at rest.
 * `name` is the canonical key (e.g. "fredApiKey", "geminiApiKey").
 * `label` is a human-readable description shown in admin UIs.
 */
export function setVaultCredential(name: string, value: string, label?: string): void {
  invalidateAIChatCredential(name, organizationCredentialStoreEnabled() ? null : undefined);
  const store = { ...readVaultStore() };
  store[name] = { encrypted: encrypt(value), label: label ?? name, updatedAt: new Date().toISOString() };
  writeVaultStore(store);
}

/**
 * Read a credential from the vault. Returns null if not found or
 * decryption fails (wrong machine, corrupted file).
 */
export function getVaultCredential(name: string): string | null {
  const store = readVaultStore();
  const entry = store[name];
  if (!entry) return null;
  const decrypted = decrypt(entry.encrypted);
  if (!decrypted) return null;
  if (decrypted.needsReencrypt) {
    const migrated = { ...store, [name]: { ...entry, encrypted: encrypt(decrypted.value), updatedAt: new Date().toISOString() } };
    writeVaultStore(migrated);
  }
  return decrypted.value;
}

/** Delete a credential from the vault. */
export function deleteVaultCredential(name: string): boolean {
  invalidateAIChatCredential(name, organizationCredentialStoreEnabled() ? null : undefined);
  const store = { ...readVaultStore() };
  if (!(name in store)) return false;
  delete store[name];
  writeVaultStore(store);
  return true;
}

/**
 * Re-encrypts every entry that is still protected by a legacy or superseded key, once, at startup.
 * The original file is kept as `credential-vault.enc.json.pre-gm03.bak` (0600) before the first rewrite.
 * Returns how many entries were migrated; entries that cannot be decrypted are left untouched.
 */
export function migrateVaultToCurrentKey(): number {
  const store = readVaultStore();
  const migrated: VaultStore = { ...store };
  let count = 0;
  for (const [name, entry] of Object.entries(store)) {
    const decrypted = decrypt(entry.encrypted);
    if (!decrypted?.needsReencrypt) continue;
    migrated[name] = { ...entry, encrypted: encrypt(decrypted.value), updatedAt: new Date().toISOString() };
    count += 1;
  }
  if (count === 0) return 0;
  const backup = `${vaultFilePath()}.pre-gm03.bak`;
  if (!fs.existsSync(backup)) fs.copyFileSync(vaultFilePath(), backup);
  try { fs.chmodSync(backup, 0o600); } catch { /* Windows ACLs are managed by the OS/user profile. */ }
  writeVaultStore(migrated);
  return count;
}

/** Check if a credential exists in the vault (does not decrypt). */
export function hasVaultCredential(name: string): boolean {
  return name in readVaultStore();
}

/**
 * List credential names and metadata. Never returns values.
 */
export function listVaultCredentials(): Array<{ name: string; label: string; updatedAt: string }> {
  const store = readVaultStore();
  return Object.entries(store).map(([name, entry]) => ({
    name,
    label: entry.label,
    updatedAt: entry.updatedAt,
  }));
}
/**
 * Directories a `file:` SecretRef may read from: the data root's `secrets/` folder, the container-secrets mount, and
 * any directories the operator lists in LIOS_SECRET_FILE_DIRS. A reference typed into the product can therefore
 * only reach files an operator staged for this purpose, never an arbitrary file the process user happens to own.
 */
function secretFileDirectories(): string[] {
  const configured = (process.env.LIOS_SECRET_FILE_DIRS ?? "").split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
  return [dataPath("secrets"), ...(process.platform === "win32" ? [] : ["/run/secrets"]), ...configured.filter((entry) => path.isAbsolute(entry))];
}

/** Resolves an `env:` or `file:` reference; null when it is absent, not permitted or unreadable (never throws a path). */
export function resolveExternalSecretRef(ref: SecretRef): string | null {
  if (ref.source === "env") {
    const value = process.env[ref.id]?.trim();
    return value ? value : null;
  }
  if (ref.source !== "file") return null;
  try {
    const real = fs.realpathSync(ref.id);
    const inside = secretFileDirectories().some((dir) => {
      try {
        const relative = path.relative(fs.realpathSync(dir), real);
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
      } catch {
        return false;
      }
    });
    return inside ? readPrivateSecretFile(real, "secret file") : null;
  } catch (error) {
    if (error instanceof PrivateSecretFileError || (error as NodeJS.ErrnoException).code) return null;
    throw error;
  }
}

const LEGACY_CREDENTIAL_KEY = /(?:key|token|secret|password|credential)/i;

/**
 * One-time move of credentials that older releases kept as plaintext in `config.json` into the encrypted vault.
 * Every string entry whose name looks like a credential (all provider names do: finnhubApiKey, fredApiKey, ...) is
 * stored in the vault unless the vault already has that name, then removed from the file. The original is kept once
 * as `config.json.pre-gm07.bak` (0600) so nothing can be lost; other settings in the file are left alone.
 */
export function migrateLegacyConfigCredentials(): number {
  const configPath = dataPath("config.json");
  if (!fs.existsSync(configPath)) return 0;
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    config = parsed as Record<string, unknown>;
  } catch {
    return 0;
  }
  const moving = Object.entries(config).filter(([name, value]) => LEGACY_CREDENTIAL_KEY.test(name) && typeof value === "string" && value.trim().length > 0);
  if (moving.length === 0) return 0;
  const backup = `${configPath}.pre-gm07.bak`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(configPath), { mode: 0o600 });
  for (const [name, value] of moving) {
    if (!hasVaultCredential(name)) setVaultCredential(name, (value as string).trim(), name);
    delete config[name];
  }
  const temporary = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, configPath);
  invalidateVaultCache();
  return moving.length;
}

/**
 * Canonical credential resolver. A `vaultName` may also be a SecretRef (`env:LIOS_SECRET_X`, `file:/run/secrets/x`,
 * `vault:name`). Priority:
 * 1. Organization request in explicitly enabled hosted mode: ONLY the
 *    request-scoped organization credential, never operator env or local vault
 * 2. Desktop/operator request: environment variable if present
 * 3. Otherwise encrypted machine-local vault (legacy credentials migrate on startup)
 *
 * A hosted organization request never falls back to the machine-local vault.
 * That boundary prevents one customer's provider credential from being used
 * for another customer's request.
 */
export function resolveCredential(envName: string, vaultName: string): string | null {
  // A hosted organization's credentials are the ONLY permissible credential
  // source for that request. Checking process.env first would silently grant
  // a tenant access to the operator's provider API key, even when the tenant
  // has not connected that provider. Desktop/operator requests still use
  // their established env-over-local-vault precedence below.
  const identity = getRequestIdentity();
  if (organizationCredentialStoreEnabled() && identity?.organizationId != null) {
    const organizationValue = identity.credentials?.[vaultName];
    return organizationValue && organizationValue.trim().length > 0 ? organizationValue : null;
  }

  const envValue = process.env[envName];
  if (typeof envValue === "string" && envValue.trim().length > 0) return envValue.trim();

  const ref = parseSecretRef(vaultName);
  if (ref && ref.source !== "vault") return resolveExternalSecretRef(ref);
  return getVaultCredential(ref?.id ?? vaultName);
}

/** Revalidate an organization request snapshot against the current encrypted vault version. */
export async function assertCurrentCredentialSnapshot(envName: string, vaultName: string): Promise<() => void> {
  const identity = getRequestIdentity();
  if (!process.env[envName]?.trim() && organizationCredentialStoreEnabled() && identity?.organizationId != null) {
    return assertOrganizationCredentialSnapshotCurrent(identity.organizationId, identity.credentials, vaultName);
  }
  const credential = resolveCredential(envName, vaultName);
  return () => {
    if (resolveCredential(envName, vaultName) !== credential) throw new Error("The provider credential changed before dispatch.");
  };
}

/** Check if a credential is available from any source. */
export function isCredentialAvailable(envName: string, vaultName: string): boolean {
  return resolveCredential(envName, vaultName) !== null;
}

/**
 * Check the credential namespace visible to the current user.
 *
 * Organization requests must never inherit operator environment variables,
 * the process-local vault, or legacy config credentials.
 */
export function isUserScopedCredentialAvailable(vaultName: string): boolean {
  const identity = getRequestIdentity();
  if (organizationCredentialStoreEnabled() && identity?.organizationId != null) {
    return Boolean(identity.credentials?.[vaultName]?.trim());
  }
  return hasVaultCredential(vaultName);
}
