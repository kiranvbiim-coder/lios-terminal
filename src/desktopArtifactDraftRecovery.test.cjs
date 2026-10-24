"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { protectedDraftsAvailable, storeProtectedArtifactDraft, readProtectedArtifactDraft, removeProtectedArtifactDraft } = require("./desktopArtifactDraftRecovery.cjs");
function encryptionFixture() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString(text) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString(bytes) { const decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"); },
  };
}
const input = { owner: "owner@example.invalid", artifactId: "artifact:11111111-1111-4111-8111-111111111111", baseVersion: 3, contentHash: "a".repeat(64), content: { kind: "report", blocks: [{ id: "p", type: "paragraph", text: "private-draft-marker" }], sections: [] } };
test("encrypted checkpoint survives independent read and explicit discard without plaintext or cross-owner projection", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-draft-encryption-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const safeStorage = encryptionFixture();
  const written = storeProtectedArtifactDraft({ root, safeStorage, input });
  assert.equal(written.protected, true);
  assert.match(written.checkpointId, /^[0-9a-f-]{36}$/);
  const files = fs.readdirSync(path.join(root, "artifact-draft-recovery"));
  assert.equal(files.length, 1);
  const filename = path.join(root, "artifact-draft-recovery", files[0]);
  assert.equal(fs.readFileSync(filename).includes(Buffer.from("private-draft-marker")), false);
  const recovered = readProtectedArtifactDraft({ root, safeStorage, input });
  assert.deepEqual(recovered, { baseVersion: 3, contentHash: input.contentHash, checkpointId: written.checkpointId, content: input.content });
  assert.equal(readProtectedArtifactDraft({ root, safeStorage, input: { ...input, owner: "other@example.invalid" } }), null);
  assert.throws(() => readProtectedArtifactDraft({ root, safeStorage: encryptionFixture(), input }));
  assert.deepEqual(removeProtectedArtifactDraft({ root, safeStorage, input }), { removed: false },
    "a baseline-only clear cannot erase an encrypted generation written by another editor");
  assert.deepEqual(removeProtectedArtifactDraft({ root, safeStorage, input: {
    ...input, expectedCheckpoint: { baseVersion: input.baseVersion, contentHash: input.contentHash, checkpointId: recovered.checkpointId },
  } }), { removed: true });
  assert.equal(readProtectedArtifactDraft({ root, safeStorage, input }), null);
});
test("retiring an older checkpoint cannot delete newer unsaved work, while explicit discard targets its exact recorded baseline", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-draft-retirement-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const safeStorage = encryptionFixture();
  const newer = { ...input, baseVersion: 4, contentHash: "b".repeat(64), content: { ...input.content, blocks: [{ id: "new", type: "paragraph", text: "replacement-session-unsaved-work" }] } };
  storeProtectedArtifactDraft({ root, safeStorage, input: newer });
  assert.deepEqual(removeProtectedArtifactDraft({ root, safeStorage, input }), { removed: false });
  const readNewer = readProtectedArtifactDraft({ root, safeStorage, input });
  assert.equal(readNewer.baseVersion, 4);
  assert.equal(readNewer.contentHash, newer.contentHash);
  assert.deepEqual(readNewer.content, newer.content);
  assert.deepEqual(removeProtectedArtifactDraft({ root, safeStorage, input: { ...input, expectedCheckpoint: { baseVersion: 4, contentHash: input.contentHash } } }), { removed: false });
  assert.deepEqual(removeProtectedArtifactDraft({ root, safeStorage, input: { ...input, expectedCheckpoint: { baseVersion: 4, contentHash: newer.contentHash } } }), { removed: false },
    "new-format checkpoints require their actual generation ID even if base matches");
  assert.deepEqual(removeProtectedArtifactDraft({ root, safeStorage, input: {
    ...input, expectedCheckpoint: { baseVersion: 4, contentHash: newer.contentHash, checkpointId: readNewer.checkpointId },
  } }), { removed: true });
  assert.equal(readProtectedArtifactDraft({ root, safeStorage, input }), null);
});
test("concurrent windows on the SAME saved P4 version cannot discard each other's encrypted draft", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-draft-same-version-race-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const safeStorage = encryptionFixture();
  const first = storeProtectedArtifactDraft({ root, safeStorage, input });
  const firstRead = readProtectedArtifactDraft({ root, safeStorage, input });
  assert.equal(firstRead.checkpointId, first.checkpointId);
  const replaced = { ...input, content: {
    ...input.content, blocks: [{ id: "newer", type: "paragraph", text: "another-window-sensitive-edit" }],
  } };
  const second = storeProtectedArtifactDraft({ root, safeStorage, input: replaced });
  assert.notEqual(first.checkpointId, second.checkpointId, "same version/hash does not imply same unsaved editor generation");
  assert.deepEqual(removeProtectedArtifactDraft({ root, safeStorage, input: {
    ...input, expectedCheckpoint: { baseVersion: input.baseVersion, contentHash: input.contentHash, checkpointId: firstRead.checkpointId },
  } }), { removed: false }, "stale explicit Discard or save cleanup cannot erase the newer window's work");
  assert.equal(readProtectedArtifactDraft({ root, safeStorage, input }).content.blocks[0].text, "another-window-sensitive-edit");
  assert.deepEqual(removeProtectedArtifactDraft({ root, safeStorage, input: {
    ...input, expectedCheckpoint: { baseVersion: input.baseVersion, contentHash: input.contentHash, checkpointId: second.checkpointId },
  } }), { removed: true });
  assert.equal(readProtectedArtifactDraft({ root, safeStorage, input }), null);
});

test("unavailable OS protection and Linux plaintext backends never write a checkpoint", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-draft-denial-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const safeStorage of [{ isEncryptionAvailable: () => false }, { ...encryptionFixture(), getSelectedStorageBackend: () => "basic_text" }, { ...encryptionFixture(), getSelectedStorageBackend: () => "unknown" }]) {
    assert.equal(protectedDraftsAvailable(safeStorage, "linux"), false);
    assert.throws(() => storeProtectedArtifactDraft({ root, safeStorage, input, platform: "linux" }), /unavailable/);
  }
  assert.deepEqual(fs.readdirSync(root), []);
  assert.throws(() => storeProtectedArtifactDraft({ root, safeStorage: { ...encryptionFixture(), encryptString() { throw Error("OS locked"); } }, input }), /OS locked/);
  assert.deepEqual(fs.readdirSync(root), []);
});
