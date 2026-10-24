import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { artifactContentSchema } from "@shared/artifactContracts";
import {
  matchesNativeArtifactDraft, nativeDraftCheckpointScope, nativeDraftRecoveryKey,
} from "./nativeArtifactDraftRecovery";

const context = {
  owner: "Owner@Example.INVALID",
  artifactId: "artifact:12345678-1234-4234-8234-123456789abc",
  baseVersion: 5,
  contentHash: "a".repeat(64),
};
const report = artifactContentSchema.parse({
  kind: "report", templateId: null, sections: [],
  blocks: [{ id: "edited", type: "paragraph", text: "Unsaved document work", attrs: {} }],
});

test("WS-42 protected recovery partitions owner, Artifact and exact P4 baseline", () => {
  const same = { ...context, owner: "owner@example.invalid" };
  assert.equal(nativeDraftRecoveryKey(context), nativeDraftRecoveryKey(same));
  assert.equal(nativeDraftCheckpointScope(context), nativeDraftCheckpointScope(same));
  for (const changed of [
    { ...context, owner: "stranger@example.invalid" },
    { ...context, artifactId: "artifact:22345678-1234-4234-8234-123456789abc" },
    { ...context, baseVersion: 6 },
    { ...context, contentHash: "b".repeat(64) },
  ]) assert.notEqual(nativeDraftCheckpointScope(context), nativeDraftCheckpointScope(changed));
});

test("WS-42 decrypted draft is never authority to cross current saved revision or change schema kind", () => {
  const candidate = { baseVersion: context.baseVersion, contentHash: context.contentHash, checkpointId: "f0000000-0000-4000-8000-000000000001", content: report };
  assert.equal(matchesNativeArtifactDraft(candidate, context, "report"), true);
  assert.equal(matchesNativeArtifactDraft(candidate, { ...context, baseVersion: 6 }, "report"), false);
  assert.equal(matchesNativeArtifactDraft(candidate, { ...context, contentHash: "b".repeat(64) }, "report"), false);
  assert.equal(matchesNativeArtifactDraft(candidate, context, "spreadsheet"), false);
  assert.equal(matchesNativeArtifactDraft({ ...candidate, content: { kind: "report", blocks: [{ id: "", type: "unknown" }] } }, context, "report"), false);
});

test("WS-42 native generation is required for explicit Discard and save cleanup; failed clear remains blocked", () => {
  const client = readFileSync(new URL("./nativeArtifactDraftRecovery.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../../../desktopArtifactDraftRecovery.cjs", import.meta.url), "utf8");
  const notice = readFileSync(new URL("../components/terminal/NativeDraftRecoveryNotice.tsx", import.meta.url), "utf8");
  assert.match(client, /const ownedCheckpointIds = new Map<string, string>\(\)/);
  assert.match(client, /checkpointId: candidate\.checkpointId/);
  assert.match(client, /checkpointId: localGeneration/);
  assert.match(client, /written\.checkpointId/);
  assert.match(client, /expectedCheckpointId: ownedCheckpointIds\.get\(nativeDraftCheckpointScope\(context\)\)/);
  assert.match(store, /current\.checkpointId !== input\.expectedCheckpointId/);
  assert.match(client, /if \(!removed\) \{/);
  assert.match(client, /status: "error", candidate: null/);
  assert.match(client, /Retry protected recovery to inspect the current state/);
  assert.match(store, /const checkpointId = crypto\.randomUUID\(\)/);
  assert.match(store, /current\.checkpointId !== expected\.checkpointId/);
  assert.match(store, /return \{ protected: true, checkpointId \}/);
  assert.match(notice, /recovery\.status === "error"/);
  assert.match(notice, /Continue without crash recovery/);
});

test("WS-42 legacy checkpoint still remains a sealed local draft, never native saved work", () => {
  const native = readFileSync(new URL("../../../desktopArtifactDraftRecovery.cjs", import.meta.url), "utf8");
  assert.match(native, /requireEncryption\(safeStorage, platform\)/);
  assert.match(native, /fileSystem\.writeFileSync\(temporary, ciphertext/);
  assert.match(native, /if \(record\?\.schemaVersion !== 1/);
  assert.match(native, /expected\.checkpointId/);
  assert.doesNotMatch(native, /localStorage|JSON\.stringify\(record\).*writeFileSync/);
});
