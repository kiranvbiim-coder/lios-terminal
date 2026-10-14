import test from "node:test";
import assert from "node:assert/strict";
import { decisionApprovalMatchesVersion, decisionDraftArrival, decisionDraftSignature, editDecisionRecordText } from "./decisionArtifactEditorState";

test("decision text edits retain unknown authored records and exact decimal/formula strings", () => {
  const opaque = { nested: [null, true, { formula: "=SUM(A1:A9)", decimal: "00012.500000" }] };
  const original = { text: "old", decimal: "00012.500000", formula: "=SUM(A1:A9)", opaque, numeric: 12.5 };
  const edited = editDecisionRecordText(original, "text", "new");
  assert.deepEqual(edited, { ...original, text: "new" });
  assert.equal(edited.opaque, opaque);
  assert.equal(editDecisionRecordText(original, "numeric", "0"), original);
  assert.equal(editDecisionRecordText(original, "opaque", "{}"), original);
  assert.deepEqual(editDecisionRecordText(original, "newText", "0.00000"), { ...original, newText: "0.00000" });
});

test("decision revision arrival protects local drafts and pending saves", () => {
  const input = { baseVersion: 1, incomingVersion: 2, baseline: "old", draft: "local", incoming: "remote", submitted: null };
  assert.equal(decisionDraftArrival(input), "conflict");
  assert.equal(decisionDraftArrival({ ...input, draft: "old" }), "adopt");
  assert.equal(decisionDraftArrival({ ...input, submitted: "local", incoming: "local" }), "adopt");
  assert.equal(decisionDraftArrival({ ...input, submitted: "local" }), "conflict");
  assert.equal(decisionDraftArrival({ ...input, incomingVersion: 1, incoming: "old" }), "unchanged");
});

test("decision approval inspection cannot bind another identity, version or hash", () => {
  const identity = { artifactId: "decision-artifact", version: 2, contentHash: "exact-hash" };
  assert.equal(decisionApprovalMatchesVersion(identity, identity), true);
  assert.equal(decisionApprovalMatchesVersion(undefined, identity), false);
  assert.equal(decisionApprovalMatchesVersion({ ...identity, artifactId: "another" }, identity), false);
  assert.equal(decisionApprovalMatchesVersion({ ...identity, version: 1 }, identity), false);
  assert.equal(decisionApprovalMatchesVersion({ ...identity, contentHash: "stale-hash" }, identity), false);
});

test("database-reordered decision JSON settles a saved draft without dirty/conflict state", () => {
  const baselineBody = {
    kind: "decision",
    recommendation: "Keep reviewing",
    assumptions: { exactDecimal: "00012.500000", nested: { formula: "=SUM(A1:A9)", enabled: true, amount: 12.5 } },
    actions: [{ id: "first", description: "Review evidence" }, { id: "second", description: "Record dissent" }],
  };
  const submittedBody = { ...baselineBody, recommendation: "Wait for the next filing" };
  // JSONB round trips reorder root and nested object keys, but do not reorder arrays.
  const databaseBody: unknown = JSON.parse(JSON.stringify({
    actions: submittedBody.actions.map(action => ({ description: action.description, id: action.id })),
    assumptions: { nested: { amount: 12.5, enabled: true, formula: "=SUM(A1:A9)" }, exactDecimal: "00012.500000" },
    recommendation: submittedBody.recommendation,
    kind: submittedBody.kind,
  }));
  const submitted = decisionDraftSignature(submittedBody);
  const incoming = decisionDraftSignature(databaseBody);
  assert.notEqual(JSON.stringify(databaseBody), JSON.stringify(submittedBody));
  assert.equal(incoming, submitted);
  assert.equal(decisionDraftArrival({
    baseVersion: 1, incomingVersion: 2, baseline: decisionDraftSignature(baselineBody),
    draft: submitted, incoming, submitted,
  }), "adopt");
  assert.equal(decisionDraftArrival({
    baseVersion: 2, incomingVersion: 2, baseline: incoming, draft: submitted, incoming, submitted: null,
  }), "unchanged");
  assert.equal(decisionDraftSignature(submittedBody), submitted);

  const concurrentBody = { ...submittedBody, recommendation: "A genuinely different recommendation" };
  assert.equal(decisionDraftArrival({
    baseVersion: 1, incomingVersion: 2, baseline: decisionDraftSignature(baselineBody),
    draft: submitted, incoming: decisionDraftSignature(concurrentBody), submitted,
  }), "conflict");
  assert.notEqual(decisionDraftSignature({ ...submittedBody, actions: [...submittedBody.actions].reverse() }), submitted);
  assert.notEqual(decisionDraftSignature({ ...submittedBody, assumptions: { ...submittedBody.assumptions, exactDecimal: 12.5 } }), submitted);
  assert.notEqual(decisionDraftSignature(-0), decisionDraftSignature(0));
});
