import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { eventsForRun, hasObservedCompletion, hasUncertainSideEffects, stageSafeRunRetry } from "./observedRunPolicy";
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const at = "2026-10-23T08:00:00.000Z";
const done = (requestId: string, status: "completed"|"failed"|"cancelled"|"waiting_approval"): ConversationRuntimeEvent =>
  ({ type:"done", requestId, at, status });
const event = (type: "status"|"tool_start"|"tool_result"|"receipt"|"mutation_review"|"approval_required"|"governed_tool_approval_required"): ConversationRuntimeEvent =>
  ({ type, requestId:ID, at }) as ConversationRuntimeEvent;

test("WS-22 only server done(completed) for exact run verifies completion", () => {
  assert.equal(hasObservedCompletion([done(ID,"completed")],ID),true);
  assert.equal(hasObservedCompletion([done(ID,"cancelled")],ID),false);
  assert.equal(hasObservedCompletion([done(ID,"failed")],ID),false);
  assert.equal(hasObservedCompletion([done(ID,"waiting_approval")],ID),false);
});

test("WS-22 another run's completion cannot certify current request", () => {
  assert.equal(hasObservedCompletion([done(OTHER,"completed")],ID),false);
  assert.equal(hasObservedCompletion([done(OTHER,"completed")],null),false);
});

test("WS-22 no terminal events means no completion regardless of partial text or plan", () => {
  const e = { type:"text", text:"partial", label:"ai_derived", requestId:ID, at } as ConversationRuntimeEvent;
  assert.equal(hasObservedCompletion([e],ID),false);
});

test("WS-22 errors and prior status observations never synthesize a completion", () => {
  assert.equal(hasObservedCompletion([event("status"), done(ID,"failed")],ID),false);
});

test("WS-22 a retry is an editable draft and preserves newer unsent typing", () => {
  assert.equal(stageSafeRunRetry("", "Original question"),"Original question");
  assert.equal(stageSafeRunRetry("  ", "Original question"),"Original question");
  assert.equal(stageSafeRunRetry("Unsent different text", "Original question"),"Unsent different text");
  assert.equal(stageSafeRunRetry("", "  "),"");
});

test("WS-22 mixed run events cannot contaminate another run's trace or receipt", () => {
  const events=[done(OTHER,"completed"),event("status"),done(ID,"failed")];
  assert.deepEqual(eventsForRun(events,ID),events.slice(1));
  assert.deepEqual(eventsForRun(events,OTHER),events.slice(0,1));
  assert.deepEqual(eventsForRun(events,null),[]);
});

test("WS-22 unknown possible side effects forbid assuming retry is safe", () => {
  assert.equal(hasUncertainSideEffects([]),false);
  assert.equal(hasUncertainSideEffects([event("status")]),false);
  for(const type of ["tool_start","tool_result","receipt","mutation_review","approval_required","governed_tool_approval_required"] as const)
    assert.equal(hasUncertainSideEffects([event(type)]),true);
});

test("WS-22 completed run with receipt is not evidence that separate unrelated run completed", () => {
  const events=[done(OTHER,"completed"),event("receipt")];
  assert.equal(hasObservedCompletion(events,ID),false);
  assert.equal(hasUncertainSideEffects(events),true);
});
