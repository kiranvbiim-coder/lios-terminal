import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { hasObservedCompletion, stageSafeRunRetry } from "./observedRunPolicy";
const event = (status: "completed" | "cancelled" | "failed", requestId = "current"): ConversationRuntimeEvent => ({type:"done",requestId,status,at:"2026-10-23T00:00:00Z"});

test("only latest exact-run terminal observation establishes successful completion", () => {
  assert.equal(hasObservedCompletion([event("completed", "other")], "current"), false);
  assert.equal(hasObservedCompletion([event("completed"), event("cancelled")], "current"), false);
  assert.equal(hasObservedCompletion([event("failed"), event("completed")], "current"), true);
  assert.equal(hasObservedCompletion([event("completed")], null), false);
  const resumed: ConversationRuntimeEvent = {type:"status",requestId:"current",at:"2026-10-23T00:00:01Z",state:"running",message:"Resuming"};
  assert.equal(hasObservedCompletion([event("completed"),resumed],"current"),false);
});

test("retry only stages an empty editor and never overwrites newer work", () => {
  assert.equal(stageSafeRunRetry("New draft","Old request"),"New draft");
  assert.equal(stageSafeRunRetry("","Old request"),"Old request");
  assert.equal(stageSafeRunRetry(" ","")," ");
});
