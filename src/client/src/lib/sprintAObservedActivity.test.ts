import assert from "node:assert/strict";
import test from "node:test";
import { observedRunActivity } from "./sprintAObservedActivity";

test("a plan alone is not observed tool execution", () => {
  const result = observedRunActivity([{ type: "plan" }], 4, true, false);
  assert.equal(result.observedSteps, 0);
  assert.equal(result.resultEvents, 0);
  assert.match(result.label ?? "", /no tool activity observed yet/);
});

test("real step IDs are counted distinctly; tool results are not called successes", () => {
  const observed = observedRunActivity([
    { type: "tool_start", stepId: "first" },
    { type: "status", stepId: "first" },
    { type: "tool_result", stepId: "first" },
    { type: "tool_start", stepId: "second" },
    { type: "tool_result", stepId: "" },
  ], 5, true, false);
  assert.equal(observed.observedSteps, 2);
  assert.equal(observed.resultEvents, 2);
  assert.match(observed.label ?? "", /2 observed steps of 5 planned/);
  assert.match(observed.label ?? "", /2 tool results recorded/);
  assert.doesNotMatch(observed.label ?? "", /completed|successful|100%/i);
});

test("approval wait outranks tool status, never implies that approval was granted", () => {
  const observed = observedRunActivity([{ type: "tool_start", stepId: "s1" }], 1, true, true);
  assert.equal(observed.label, "Approval required before this run can continue");
  assert.doesNotMatch(observed.label, /approved/i);
});

test("finished/inactive trace has no invented live progress", () => {
  const state = observedRunActivity([{ type: "tool_result", stepId: "a" }], 1, false, false);
  assert.equal(state.label, null);
  assert.equal(state.observedSteps, 0);
});

test("nullable status step IDs from the real conversation contract do not fabricate a step", () => {
  const activity = observedRunActivity([
    { type: "status", stepId: null },
    { type: "tool_start", stepId: "observed-1" },
    { type: "status", stepId: undefined },
    { type: "tool_result", stepId: null },
  ], 2, true, false);
  assert.equal(activity.observedSteps, 1);
  assert.equal(activity.resultEvents, 1);
  assert.match(activity.label ?? "", /1 observed step of 2 planned/);
});
