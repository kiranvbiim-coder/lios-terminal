import assert from "node:assert/strict";
import test from "node:test";
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

