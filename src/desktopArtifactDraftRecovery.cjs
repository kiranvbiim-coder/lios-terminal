"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const DRAFT_MAX_BYTES = 2 * 1024 * 1024;
const ENCRYPTED_MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_KINDS = new Set(["research", "report", "spreadsheet"]);
function protectedDraftsAvailable(safeStorage, platform = process.platform) {
  if (!safeStorage?.isEncryptionAvailable?.() || typeof safeStorage.encryptString !== "function" || typeof safeStorage.decryptString !== "function") return false;
  if (platform === "linux") {
    const backend = safeStorage.getSelectedStorageBackend?.();
    if (!backend || backend === "basic_text" || backend === "unknown") return false;
  }
  return true;
}
function normalizeIdentity(input) {
  const owner = typeof input?.owner === "string" ? input.owner.trim().toLowerCase() : "";
  const artifactId = input?.artifactId;
  if (!owner || owner.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) throw new Error("Invalid signed-in draft owner.");
  if (typeof artifactId !== "string" || !/^(?:artifact:)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(artifactId)) throw new Error("Invalid Artifact draft identity.");
  return { owner, artifactId };
}
function draftFile(root, input) {
  const { owner, artifactId } = normalizeIdentity(input);
  const name = crypto.createHash("sha256").update(owner + "\0" + artifactId).digest("hex") + ".safe";
  return path.join(root, "artifact-draft-recovery", name);
}
function requireEncryption(safeStorage, platform) {
  if (!protectedDraftsAvailable(safeStorage, platform)) throw new Error("OS-protected Artifact recovery is unavailable. No plaintext copy was written.");
}
function storeProtectedArtifactDraft({ root, safeStorage, input, fileSystem = fs, platform = process.platform }) {
  requireEncryption(safeStorage, platform);
  const { owner, artifactId } = normalizeIdentity(input);
  if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 1 || typeof input.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(input.contentHash)
    || !input.content || typeof input.content !== "object" || Array.isArray(input.content) || !ALLOWED_KINDS.has(input.content.kind)) throw new Error("Invalid Artifact draft revision.");
  // A distinct server-authorized editor may replace a checkpoint for the
  // SAME saved revision. Bind explicit discard to the actual encrypted file
  // generation, not only to the shared P4 baseline version and content hash.
  const current = readProtectedArtifactDraft({ root, safeStorage, input, fileSystem, platform });
  if (current && (!input.expectedCheckpointId || current.checkpointId !== input.expectedCheckpointId)) {
    throw new Error("Protected Artifact checkpoint was changed by another editor. Recover or discard it explicitly before writing.");
  }
  const checkpointId = crypto.randomUUID();
  const payload = JSON.stringify({ schemaVersion: 1, owner, artifactId, baseVersion: input.baseVersion, contentHash: input.contentHash, checkpointId, content: input.content });
  if (Buffer.byteLength(payload, "utf8") > DRAFT_MAX_BYTES) throw new Error("Artifact draft exceeds the protected-recovery size budget.");
  const ciphertext = safeStorage.encryptString(payload);
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0 || ciphertext.length > ENCRYPTED_MAX_BYTES) throw new Error("Native draft encryption failed.");
  const filename = draftFile(root, input);
  fileSystem.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + "." + crypto.randomUUID() + ".tmp";
  try {
    fileSystem.writeFileSync(temporary, ciphertext, { mode: 0o600, flag: "wx" });
    fileSystem.renameSync(temporary, filename);
  } finally { try { fileSystem.rmSync(temporary, { force: true }); } catch {} }
  try { fileSystem.chmodSync(filename, 0o600); } catch { /* Windows uses ACLs. */ }
  return { protected: true, checkpointId };
}
function readProtectedArtifactDraft({ root, safeStorage, input, fileSystem = fs, platform = process.platform }) {
  requireEncryption(safeStorage, platform);
  const { owner, artifactId } = normalizeIdentity(input);
  const filename = draftFile(root, input);
  if (!fileSystem.existsSync(filename)) return null;
  const stat = fileSystem.statSync(filename);
  if (!stat.isFile() || stat.size < 1 || stat.size > ENCRYPTED_MAX_BYTES) throw new Error("Protected draft size is invalid.");
  const decoded = safeStorage.decryptString(fileSystem.readFileSync(filename));
  if (Buffer.byteLength(decoded, "utf8") > DRAFT_MAX_BYTES) throw new Error("Protected draft is oversized.");
  const record = JSON.parse(decoded);
  if (record?.schemaVersion !== 1 || record.owner !== owner || record.artifactId !== artifactId || !Number.isSafeInteger(record.baseVersion) || record.baseVersion < 1
    || typeof record.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(record.contentHash) || !record.content || !ALLOWED_KINDS.has(record.content.kind)
    || (record.checkpointId !== undefined && (typeof record.checkpointId !== "string" || !/^[0-9a-f-]{36}$/i.test(record.checkpointId)))) throw new Error("Protected draft identity or contents do not match.");
  return { baseVersion: record.baseVersion, contentHash: record.contentHash, ...(record.checkpointId ? { checkpointId: record.checkpointId } : {}), content: record.content };
}
function removeProtectedArtifactDraft({ root, safeStorage, input, fileSystem = fs, platform = process.platform }) {
  requireEncryption(safeStorage, platform);
  const expected = input.expectedCheckpoint ?? input;
  if (!Number.isSafeInteger(expected.baseVersion) || expected.baseVersion < 1 || typeof expected.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(expected.contentHash)) throw new Error("Invalid checkpoint retirement identity.");
  const current = readProtectedArtifactDraft({ root, safeStorage, input, fileSystem, platform });
  if (!current || current.baseVersion !== expected.baseVersion || current.contentHash !== expected.contentHash
    || (current.checkpointId !== undefined && current.checkpointId !== expected.checkpointId)) return { removed: false };
  fileSystem.rmSync(draftFile(root, input), { force: true });
  return { removed: true };
}
module.exports = { protectedDraftsAvailable, storeProtectedArtifactDraft, readProtectedArtifactDraft, removeProtectedArtifactDraft, DRAFT_MAX_BYTES };
