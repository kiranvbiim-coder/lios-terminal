/**
 * Personal API Key System.
 *
 * Keys are generated with cryptographic randomness and only their SHA-256
 * digests are persisted. The raw credential is returned exactly once at
 * creation time. Existing legacy plaintext entries are migrated to digests
 * on first read so upgrading does not silently invalidate already-issued
 * credentials.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { stateDir } from "./dataRoot";

type StoredKey = { hash: string; createdAt: string };

function keysFile(): string {
  return path.join(stateDir(), "api-keys.json");
}

function ensureDataDir(): void {
  if (!fs.existsSync(stateDir())) fs.mkdirSync(stateDir(), { recursive: true });
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

function readKeys(): StoredKey[] {
  ensureDataDir();
  try {
    if (!fs.existsSync(keysFile())) return [];
    const parsed: unknown = JSON.parse(fs.readFileSync(keysFile(), "utf8"));
    if (!Array.isArray(parsed)) return [];

    let migrated = false;
    const keys: StoredKey[] = [];
    for (const entry of parsed) {
      if (typeof entry === "string" && entry.length > 0) {
        keys.push({ hash: hashKey(entry), createdAt: new Date().toISOString() });
        migrated = true;
      } else if (entry && typeof entry === "object" && typeof (entry as StoredKey).hash === "string") {
        keys.push({ hash: (entry as StoredKey).hash, createdAt: typeof (entry as StoredKey).createdAt === "string" ? (entry as StoredKey).createdAt : new Date().toISOString() });
      }
    }
    if (migrated) writeKeys(keys);
    return keys;
  } catch {
    return [];
  }
}

function writeKeys(keys: StoredKey[]): void {
  ensureDataDir();
  const temp = `${keysFile()}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(keys, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, keysFile());
  try { fs.chmodSync(keysFile(), 0o600); } catch { /* Windows may not support chmod semantics */ }
}

/** Generates a random 32-character hex credential and persists only its digest. */
export function generateKey(): string {
  const key = crypto.randomBytes(16).toString("hex");
  const keys = readKeys();
  keys.push({ hash: hashKey(key), createdAt: new Date().toISOString() });
  writeKeys(keys);
  return key;
}

/** Returns true when the supplied credential matches a stored digest. */
export function validateKey(key: string): boolean {
  if (!key || key.length !== 32 || !/^[a-f0-9]+$/i.test(key)) return false;
  const candidate = Buffer.from(hashKey(key), "hex");
  return readKeys().some(({ hash }) => {
    try {
      const stored = Buffer.from(hash, "hex");
      return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
    } catch {
      return false;
    }
  });
}
