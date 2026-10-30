import assert from "node:assert/strict";
import test from "node:test";
import { newestResumableRunId } from "./useInterruptedAgentRun";

const A = "a1111111-1111-4111-8111-111111111111";
const B = "b2222222-2222-4222-8222-222222222222";

test("only an interrupted record the Home flagged resumable is offered; every other state stays hidden", () => {
  assert.equal(newestResumableRunId([{ id: A, status: "interrupted", resumable: true }]), A);
  assert.equal(newestResumableRunId([
    { id: A, status: "cancelled", resumable: true },
    { id: B, status: "interrupted", resumable: false },
  ]), null, "terminal cancelled and non-resumable interrupted (no checkpoint, outcome unknown, drift-less unknown) are hidden");
  for (const status of ["completed", "failed", "denied", "running", "waiting_approval", "cancelled"]) {
    assert.equal(newestResumableRunId([{ id: A, status, resumable: true }]), null, status);
  }
  assert.equal(newestResumableRunId([{ id: "not-a-uuid", status: "interrupted", resumable: true }]), null);
  assert.equal(newestResumableRunId([{ id: A, status: "interrupted" }]), null);
  assert.equal(newestResumableRunId({ id: A }), null);
  assert.equal(newestResumableRunId(null), null);
  assert.equal(newestResumableRunId([{ id: B, status: "completed" }, { id: A, status: "interrupted", resumable: true }]), A, "newest-first list: the first resumable wins");
});

