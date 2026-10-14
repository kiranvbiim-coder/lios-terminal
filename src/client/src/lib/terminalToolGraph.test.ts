import test from "node:test";
import assert from "node:assert/strict";
import { getJourneyForView, getRelatedToolActions } from "./terminalToolGraph";

test("DCF exposes peers, risk, and internal research from the tool graph", () => {
  const internal = getRelatedToolActions("valuation", true);
  assert.ok(internal.some((action) => action.view === "peercomp"));
  assert.ok(internal.some((action) => action.view === "advancedrisk"));
  assert.ok(internal.some((action) => action.view === "research"));

  const client = getRelatedToolActions("valuation", false);
  assert.equal(client.some((action) => action.view === "research"), false);
});

test("screeners can send selections into company analysis and peer comparison", () => {
  const actions = getRelatedToolActions("screener", false);
  assert.ok(actions.some((action) => action.view === "entity"));
  assert.ok(actions.some((action) => action.view === "peercomp"));
});

test("journey lookup identifies the active analytical stage", () => {
  const match = getJourneyForView("financialstatements");
  assert.equal(match?.journey.id, "equity-research");
  assert.equal(match?.journey.stages[match.stageIndex].label, "Understand");
});
