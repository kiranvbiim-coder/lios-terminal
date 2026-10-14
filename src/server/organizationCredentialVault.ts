import crypto from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { organizationCredentials } from "@shared/schema";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION = "v1";

function hostedVaultSecret(): string | null {
  const secret = process.env.LIMURIA_HOSTED_VAULT_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * The database-backed per-organization credential store is an optional secret provider for a Home whose owner runs
 * several organizations on their own PostgreSQL. It is never implied by DATABASE_URL: pointing LiOS at your own
 * database keeps credentials in the local vault unless you choose this store explicitly.
 */
export function organizationCredentialStoreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LIMURIA_CREDENTIAL_STORE === "organization";
}

export function organizationCredentialStoreConfigured(): boolean {
  return organizationCredentialStoreEnabled() && hostedVaultSecret() !== null;
}

function keyForOrganization(organizationId: number): Buffer {
  const secret = hostedVaultSecret();
  if (!secret) {
    throw new Error("Hosted credential vault is not configured.");
  }
  return crypto.scryptSync(secret, `limuria-org-vault:${organizationId}`, KEY_LENGTH);
}

function associatedData(organizationId: number, name: string): Buffer {
  return Buffer.from(`${VERSION}:${organizationId}:${name}`, "utf8");
}

export function encryptOrganizationCredential(organizationId: number, name: string, value: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyForOrganization(organizationId), iv);
  cipher.setAAD(associatedData(organizationId, name));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), authTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptOrganizationCredential(organizationId: number, name: string, encrypted: string): string | null {
  try {
    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = encrypted.split(".");
    if (version !== VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded) return null;
    const iv = Buffer.from(ivEncoded, "base64url");
    const authTag = Buffer.from(tagEncoded, "base64url");
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) return null;
    const decipher = crypto.createDecipheriv(ALGORITHM, keyForOrganization(organizationId), iv);
    decipher.setAAD(associatedData(organizationId, name));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function setOrganizationCredential(
  organizationId: number,
  name: string,
  value: string,
  label = "",
  actorUserId: number | null = null,
): Promise<void> {
  if (!organizationCredentialStoreConfigured()) {
    throw new Error("Hosted credential vault is not configured.");
  }
  const db = getDb();
  const encryptedValue = encryptOrganizationCredential(organizationId, name, value);
  await db.insert(organizationCredentials).values({
    organizationId,
    name,
    encryptedValue,
    label,
    createdByUserId: actorUserId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [organizationCredentials.organizationId, organizationCredentials.name],
    set: { encryptedValue, label, updatedAt: new Date(), disabledAt: null },
  });
}

export async function getOrganizationCredential(organizationId: number, name: string): Promise<string | null> {
  if (!organizationCredentialStoreConfigured()) return null;
  const [entry] = await getDb().select({ encryptedValue: organizationCredentials.encryptedValue })
    .from(organizationCredentials)
    .where(and(
      eq(organizationCredentials.organizationId, organizationId),
      eq(organizationCredentials.name, name),
      isNull(organizationCredentials.disabledAt),
    ))
    .limit(1);
  return entry ? decryptOrganizationCredential(organizationId, name, entry.encryptedValue) : null;
}

export async function loadOrganizationCredentials(organizationId: number): Promise<Record<string, string>> {
  if (!organizationCredentialStoreConfigured()) return {};
  const rows = await getDb().select({
    name: organizationCredentials.name,
    encryptedValue: organizationCredentials.encryptedValue,
  }).from(organizationCredentials).where(and(
    eq(organizationCredentials.organizationId, organizationId),
    isNull(organizationCredentials.disabledAt),
  )).orderBy(asc(organizationCredentials.name));
  const values: Record<string, string> = {};
  for (const row of rows) {
    const value = decryptOrganizationCredential(organizationId, row.name, row.encryptedValue);
    if (value !== null) values[row.name] = value;
  }
  return values;
}

export async function deleteOrganizationCredential(organizationId: number, name: string): Promise<boolean> {
  if (!organizationCredentialStoreConfigured()) return false;
  const predicate = and(
    eq(organizationCredentials.organizationId, organizationId),
    eq(organizationCredentials.name, name),
    isNull(organizationCredentials.disabledAt),
  );
  const [entry] = await getDb().select({ id: organizationCredentials.id })
    .from(organizationCredentials)
    .where(predicate)
    .limit(1);
  if (!entry) return false;
  await getDb().update(organizationCredentials)
    .set({ disabledAt: new Date(), updatedAt: new Date() })
    .where(eq(organizationCredentials.id, entry.id));
  return true;
}

export async function listOrganizationCredentials(organizationId: number): Promise<Array<{ name: string; label: string; updatedAt: string }>> {
  if (!organizationCredentialStoreConfigured()) return [];
  const rows = await getDb().select({
    name: organizationCredentials.name,
    label: organizationCredentials.label,
    updatedAt: organizationCredentials.updatedAt,
  }).from(organizationCredentials).where(and(
    eq(organizationCredentials.organizationId, organizationId),
    isNull(organizationCredentials.disabledAt),
  )).orderBy(asc(organizationCredentials.name));
  return rows.map((row) => ({ name: row.name, label: row.label, updatedAt: row.updatedAt.toISOString() }));
}
