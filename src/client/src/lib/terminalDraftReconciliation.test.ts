import assert from "node:assert/strict";
import test from "node:test";
import { stableSerialize } from "./analyticalCore";
import { reconcileTerminalDraft } from "./terminalDraftReconciliation";

test("JSONB key order cannot turn an acknowledged terminal review into an external conflict", () => {
  const submitted = { state: { extraction: { symbol: "SYNREV", reports: [{ year: 2025, value: 100 }] }, edits: { cash: 777 } }, view: "financials" };
  const canonical = { view: "financials", state: { edits: { cash: 777 }, extraction: { reports: [{ value: 100, year: 2025 }], symbol: "SYNREV" } } };
  assert.deepEqual(reconcileTerminalDraft(canonical, submitted, stableSerialize({ view: "financials" }), stableSerialize(submitted)), {
    baseline: stableSerialize(canonical), replaceDraft: true, acknowledged: true, conflict: false,
  });
});

test("own terminal save acknowledges its submitted snapshot without erasing later analyst corrections", () => {
  const submitted = { cash: 100, reports: [1, 2] };
  const edited = { cash: 777, reports: [1, 2] };
  const transition = reconcileTerminalDraft(submitted, edited, stableSerialize({ cash: 50 }), stableSerialize(submitted));
  assert.equal(transition.replaceDraft, false);
  assert.equal(transition.conflict, false);
  assert.equal(transition.acknowledged, true);
  assert.notEqual(stableSerialize(edited), transition.baseline, "The newer correction remains dirty against the acknowledged save.");
});

test("a different incoming revision cannot masquerade as the acknowledged save", () => {
  const submitted = { cash: 100, reports: [1, 2] };
  assert.deepEqual(reconcileTerminalDraft({ cash: 999, reports: [1, 2] }, submitted, stableSerialize({ cash: 50 }), stableSerialize(submitted)), {
    baseline: stableSerialize({ cash: 50 }), replaceDraft: false, acknowledged: false, conflict: true,
  });
  assert.equal(reconcileTerminalDraft({ cash: 100, reports: [2, 1] }, submitted, stableSerialize({ cash: 50 }), stableSerialize(submitted)).conflict, true, "Source/report array order is material.");
});
