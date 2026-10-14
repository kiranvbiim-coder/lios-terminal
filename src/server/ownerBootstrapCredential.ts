import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./dataRoot";
import { safeEqualSecret } from "./safeEqualSecret";

const SETUP_TOKEN_FILE = "owner-setup.token";
const TOKEN_VALIDITY_MS = 24 * 60 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export class OwnerBootstrapCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerBootstrapCredentialError";
  }
}

function tokenPath(root?: string): string {
  return path.join(root ?? dataPath(), SETUP_TOKEN_FILE);
}

function regularPrivateFile(file: string): fs.Stats {
  const info = fs.lstatSync(file);
  if (!info.isFile() || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) {
    throw new OwnerBootstrapCredentialError(`${file} must be a regular file accessible only to its owner (mode 0600 or stricter).`);
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new OwnerBootstrapCredentialError(`${file} must be owned by the LiOS process user.`);
  }
  return info;
}

interface TokenRecord {
  version: 1;
  token: string;
  createdAt: string;
}

function readToken(root?: string): TokenRecord | null {
  const file = tokenPath(root);
  let stat: fs.Stats;
  try {
    // lstat, not exists(): a dangling symlink must be refused rather than treated as "no token" and written through.
    stat = regularPrivateFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (stat.size > 512 || stat.size === 0) throw new OwnerBootstrapCredentialError("The owner setup token file is invalid.");
  try {
    const record: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!record || typeof record !== "object") throw new Error("Invalid token record");
    const { version, token, createdAt } = record as Partial<TokenRecord>;
    if (version !== 1 || typeof token !== "string" || !TOKEN_FORMAT.test(token)
      || typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid token record");
    return { version, token, createdAt };
  } catch {
    throw new OwnerBootstrapCredentialError("The owner setup token file is invalid. Restore it or remove it manually from the user-owned data root after confirming there are no users.");
  }
}

/** Only startup calls this, after verifying the database has no users. No HTTP request can mint a token. */
export function prepareOwnerSetupToken(root?: string, now = new Date()): { token: string; created: boolean; expiresAt: Date } {
  const file = tokenPath(root);
  const previous = readToken(root);
  const issuedAt = previous ? Date.parse(previous.createdAt) : NaN;
  if (previous && issuedAt <= now.getTime() && now.getTime() - issuedAt < TOKEN_VALIDITY_MS) {
    return { token: previous.token, created: false, expiresAt: new Date(issuedAt + TOKEN_VALIDITY_MS) };
  }
  if (previous) fs.unlinkSync(file); // expired token cannot authorize another attempt
  const token = crypto.randomBytes(32).toString("base64url");
  const record: TokenRecord = { version: 1, token, createdAt: now.toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // A second Home process won the exclusive create. Use its credential, never a second token.
    const concurrent = readToken(root);
    if (!concurrent) throw new OwnerBootstrapCredentialError("A concurrent owner setup token could not be read.");
    return { token: concurrent.token, created: false, expiresAt: new Date(Date.parse(concurrent.createdAt) + TOKEN_VALIDITY_MS) };
  }
  return { token, created: true, expiresAt: new Date(now.getTime() + TOKEN_VALIDITY_MS) };
}

export function verifyOwnerSetupToken(provided: unknown, root?: string, now = new Date()): boolean {
  const record = readToken(root);
  if (!record || typeof provided !== "string") return false;
  const issuedAt = Date.parse(record.createdAt);
  return issuedAt <= now.getTime() && now.getTime() - issuedAt < TOKEN_VALIDITY_MS && safeEqualSecret(provided, record.token);
}

export function removeOwnerSetupToken(root?: string): void {
  const file = tokenPath(root);
  if (fs.existsSync(file)) {
    regularPrivateFile(file);
    fs.unlinkSync(file);
  }
}

/**
 * Operator automation uses a mounted file, never a password environment variable. A file on another
 * filesystem may be read-only (0400); the operator retains custody and deletes it after setup.
 */
