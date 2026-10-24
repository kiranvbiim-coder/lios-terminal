import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { savedChatArtifactAnswer } from "./savedChatArtifactAnswer";

const defaultTurn = { text: "", persistedArtifactCount: 1, cancelled: false, awaitingApproval: false, failed: false };

test("WS-35: successful confirmed Artifact writes with no narrative still create a truthful saved Chat carrier", () => {
  assert.equal(savedChatArtifactAnswer(defaultTurn),
    "An Artifact was saved to this conversation. Open its saved Artifact card to review the recorded version.");
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, persistedArtifactCount: 2 }),
    "2 Artifacts were saved to this conversation. Open their saved Artifact cards to review each recorded version.");
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, text: "   ", persistedArtifactCount: 1 }),
    savedChatArtifactAnswer(defaultTurn), "whitespace is not a real assistant answer");
});

test("WS-35: meaningful deterministic/model answer is preserved byte-for-byte", () => {
  const original = "  Analysis based on recorded inputs.\n";
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, text: original }), original);
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, text: original, persistedArtifactCount: 0 }), original);
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, text: original, persistedArtifactCount: 4 }), original);
});

test("WS-35: pending drafts and empty runs never get a fabricated persisted Artifact card", () => {
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, persistedArtifactCount: 0 }), null);
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, persistedArtifactCount: -1 }), null);
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, persistedArtifactCount: Number.NaN }), null);
  assert.equal(savedChatArtifactAnswer({ ...defaultTurn, persistedArtifactCount: 0.5 }), null);
  for (const flag of ["cancelled", "awaitingApproval", "failed"] as const) {
    assert.equal(savedChatArtifactAnswer({ ...defaultTurn, [flag]: true }), null, `${flag} cannot claim work is complete`);
    assert.equal(savedChatArtifactAnswer({ ...defaultTurn, text: "Partial findings", [flag]: true }), null,
      `${flag} cannot create a saved assistant answer from a partial result`);
  }
});

test("WS-35: runtime message retention is bound to real P4 writes, exact refs and successful terminal outcomes", () => {
  const runtime = readFileSync(new URL("./conversationRunService.ts", import.meta.url), "utf8");
  assert.match(runtime, /const savedAnswer = savedChatArtifactAnswer\(/);
  assert.match(runtime, /persistedArtifactCount: persistedArtifacts\.length/);
  assert.match(runtime, /failed: held\.errored \|\| held\.done\?\.status !== "completed"/);
  assert.match(runtime, /await transcript\.recordText\(savedAnswer \?\? result\.text\)/);
  assert.match(runtime, /const saved = savedAnswer !== null/);
  assert.match(runtime, /content: savedAnswer!/);
  assert.match(runtime, /persistedArtifacts\.push\(retainedArtifactMessageRef\(savedArtifact\)\)/);
  assert.match(runtime, /persistedArtifacts\.push\(retainedArtifactMessageRef\(\{ artifact, version \}\)\)/);
  assert.match(runtime, /if \(!result\.cancelled && !result\.awaitingApproval && !held\.errored && held\.done\?\.status === "completed"\)/);
  assert.match(runtime, /scope: "temporary"/);
  const temporaryEntry = runtime.slice(runtime.indexOf("export async function startTemporaryRun("));
  assert.ok(temporaryEntry.length > 100);
  assert.doesNotMatch(temporaryEntry, /persistConversationDraft\(/);
  assert.doesNotMatch(temporaryEntry, /addProjectChatMessage\(/);
});
