import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema } from "@shared/artifactContracts";
import { matchesNativeArtifactDraft, nativeDraftRecoveryKey } from "./nativeArtifactDraftRecovery";

const context = {
  owner: "Owner@Example.com",
  artifactId: "artifact:12345678-1234-1234-1234-123456789abc",
  baseVersion: 3,
  contentHash: "b".repeat(64),
};
const content = artifactContentSchema.parse({ kind: "report", blocks: [] });
const snapshot = { baseVersion: 3, contentHash: context.contentHash, content };

test("native draft recovery only accepts a schema-valid exact immutable Artifact revision", () => {
  assert.equal(matchesNativeArtifactDraft(snapshot, context, "report"), true);
  assert.equal(matchesNativeArtifactDraft(snapshot, { ...context, baseVersion: 4 }, "report"), false);
  assert.equal(matchesNativeArtifactDraft(snapshot, { ...context, contentHash: "c".repeat(64) }, "report"), false);
  assert.equal(matchesNativeArtifactDraft(snapshot, context, "spreadsheet"), false);
  assert.equal(matchesNativeArtifactDraft({ ...snapshot, content: { kind: "report", blocks: [{ id: "", type: "bad", text: "" }] } }, context, "report"), false);
});

test("native draft mutation ordering partitions by canonical Artifact and signed-in owner", () => {
  const own = nativeDraftRecoveryKey(context);
  assert.equal(own, nativeDraftRecoveryKey({ ...context, owner: "owner@example.COM" }));
  assert.notEqual(own, nativeDraftRecoveryKey({ ...context, owner: "other@example.com" }));
  assert.notEqual(own, nativeDraftRecoveryKey({ ...context, artifactId: "artifact:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }));
});
