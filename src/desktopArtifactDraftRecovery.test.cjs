"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  protectedDraftsAvailable, storeProtectedArtifactDraft, readProtectedArtifactDraft, removeProtectedArtifactDraft,
} = require("./desktopArtifactDraftRecovery.cjs");

const input = {
  owner: "OWNER@example.com", artifactId: "artifact:12345678-1234-1234-1234-123456789abc",
  baseVersion: 3, contentHash: "a".repeat(64),
  content: { kind: "report", blocks: [{ id: "secret", type: "paragraph", text: "private case study evidence" }] },
};
const protectedMock = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (text) => Buffer.from("encrypted:" + Buffer.from(text).toString("base64"), "utf8"),
  decryptString: (bytes) => Buffer.from(bytes.toString("utf8").slice("encrypted:".length), "base64").toString("utf8"),
};
function inTemporaryFolder(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-recovery-"));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("only trusted OS secret backends may write Artifact recovery (never Linux basic_text)", () => {
  const weak = { ...protectedMock, getSelectedStorageBackend: () => "basic_text" };
  assert.equal(protectedDraftsAvailable(weak, "linux"), false);
  assert.equal(protectedDraftsAvailable({ ...protectedMock, isEncryptionAvailable: () => false }, "win32"), false);
  assert.equal(protectedDraftsAvailable(protectedMock, "linux"), true);
  inTemporaryFolder((root) => {
    assert.throws(() => storeProtectedArtifactDraft({ root, safeStorage: weak, platform: "linux", input }), /unavailable/);
    assert.equal(fs.existsSync(path.join(root, "artifact-draft-recovery")), false);
  });
});

test("encrypted native recovery survives process reopen and protects plaintext content", () => {
  inTemporaryFolder((root) => {
    storeProtectedArtifactDraft({ root, safeStorage: protectedMock, platform: "linux", input });
    const directory = path.join(root, "artifact-draft-recovery");
    const files = fs.readdirSync(directory);
    assert.equal(files.length, 1);
    assert.equal(files[0].endsWith(".safe"), true);
    const bytes = fs.readFileSync(path.join(directory, files[0]));
    assert.equal(bytes.includes(Buffer.from("private case study evidence")), false);
    assert.deepEqual(readProtectedArtifactDraft({
      root, safeStorage: protectedMock, platform: "linux",
      input: { owner: "owner@EXAMPLE.com", artifactId: input.artifactId },
    }), { baseVersion: 3, contentHash: "a".repeat(64), content: input.content });
    assert.equal(readProtectedArtifactDraft({
      root, safeStorage: protectedMock, platform: "linux",
      input: { owner: "other@example.com", artifactId: input.artifactId },
    }), null);
    removeProtectedArtifactDraft({ root, safeStorage: protectedMock, platform: "linux", input });
    assert.equal(fs.readdirSync(directory).length, 0);
  });
});

test("strict Artifact owner/id/revision/kind/size rejection prevents arbitrary path writes", () => {
  inTemporaryFolder((root) => {
    for (const illegal of [
      { ...input, owner: "../secret" }, { ...input, artifactId: "../../unsafe" },
      { ...input, baseVersion: 0 }, { ...input, contentHash: "bad" },
      { ...input, content: { kind: "unsupported" } },
      { ...input, content: { kind: "report", text: "x".repeat(2_200_000) } },
    ]) {
      assert.throws(() => storeProtectedArtifactDraft({ root, safeStorage: protectedMock, input: illegal, platform: "linux" }));
    }
    assert.equal(fs.existsSync(path.join(root, "artifact-draft-recovery")), false);
  });
});

test("corrupted encrypted recovery is never returned as a trusted draft", () => {
  inTemporaryFolder((root) => {
    storeProtectedArtifactDraft({ root, safeStorage: protectedMock, platform: "linux", input });
    const directory = path.join(root, "artifact-draft-recovery");
    fs.writeFileSync(path.join(directory, fs.readdirSync(directory)[0]), Buffer.from("not-encrypted"));
    assert.throws(() => readProtectedArtifactDraft({ root, safeStorage: protectedMock, platform: "linux", input }));
  });
});
