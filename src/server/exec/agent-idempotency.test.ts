import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAgentToolRecovery,
  deriveAgentToolIdempotencyKey,
} from "./agent-idempotency";

const REQUEST_A = "11111111-1111-4111-8111-111111111111";
const REQUEST_B = "22222222-2222-4222-8222-222222222222";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("idempotency key is stable for the same request, step, tool and input", () => {
  const first = deriveAgentToolIdempotencyKey({
    requestId: REQUEST_A,
    stepId: "step-2",
    toolId: "tool.write",
    inputSha256: HASH_A,
  });
  const second = deriveAgentToolIdempotencyKey({
    requestId: REQUEST_A,
    stepId: "step-2",
    toolId: "tool.write",
    inputSha256: HASH_A,
  });

  assert.equal(first, second);
  assert.match(first, /^agent-tool:v1:[a-f0-9]{64}$/);
});

test("idempotency binding changes when request, step, tool or canonical input changes", () => {
  const base = deriveAgentToolIdempotencyKey({
    requestId: REQUEST_A,
    stepId: "step-1",
    toolId: "tool.write",
    inputSha256: HASH_A,
  });
  const variants = [
    deriveAgentToolIdempotencyKey({ requestId: REQUEST_B, stepId: "step-1", toolId: "tool.write", inputSha256: HASH_A }),
    deriveAgentToolIdempotencyKey({ requestId: REQUEST_A, stepId: "step-2", toolId: "tool.write", inputSha256: HASH_A }),
    deriveAgentToolIdempotencyKey({ requestId: REQUEST_A, stepId: "step-1", toolId: "tool.other", inputSha256: HASH_A }),
    deriveAgentToolIdempotencyKey({ requestId: REQUEST_A, stepId: "step-1", toolId: "tool.write", inputSha256: HASH_B }),
  ];
  for (const value of variants) assert.notEqual(value, base);
});

test("idempotency input rejects ambiguous ids and noncanonical hashes", () => {
  assert.throws(() => deriveAgentToolIdempotencyKey({
    requestId: "request alias",
    stepId: "step-1",
    toolId: "tool.write",
    inputSha256: HASH_A,
  }), /requestId/);
  assert.throws(() => deriveAgentToolIdempotencyKey({
    requestId: REQUEST_A,
    stepId: "step-1",
    toolId: "tool.write",
    inputSha256: "A".repeat(64),
  }), /lowercase SHA-256/);
});

test("a committed tool call is reused instead of executed again", () => {
  assert.deepEqual(decideAgentToolRecovery({
    outcome: "committed",
    replaySafe: false,
    externalSideEffect: true,
    attempt: 1,
    maxAttempts: 3,
  }), {
    action: "reuse_committed",
    reason: "already_committed",
  });
});

test("ambiguous post-dispatch outcome never auto-retries", () => {
  for (const replaySafe of [false, true]) {
    for (const externalSideEffect of [false, true]) {
      assert.deepEqual(decideAgentToolRecovery({
        outcome: "dispatched_outcome_unknown",
        replaySafe,
        externalSideEffect,
        attempt: 1,
        maxAttempts: 3,
      }), {
        action: "reconcile",
        reason: "ambiguous_post_dispatch",
      });
    }
  }
});

test("known pre-dispatch failure may retry within the bounded attempt budget", () => {
  assert.deepEqual(decideAgentToolRecovery({
    outcome: "failed_before_dispatch",
    replaySafe: false,
    externalSideEffect: true,
    attempt: 1,
    maxAttempts: 2,
  }), {
    action: "retry",
    reason: "pre_dispatch_retry",
  });
});

test("post-dispatch known-no-effect retry requires replaySafe", () => {
  assert.deepEqual(decideAgentToolRecovery({
    outcome: "dispatched_proven_no_effect",
    replaySafe: false,
    externalSideEffect: true,
    attempt: 1,
    maxAttempts: 2,
  }), {
    action: "fail",
    reason: "not_replay_safe",
  });

  assert.deepEqual(decideAgentToolRecovery({
    outcome: "dispatched_proven_no_effect",
    replaySafe: true,
    externalSideEffect: true,
    attempt: 1,
    maxAttempts: 2,
  }), {
    action: "retry",
    reason: "replay_safe_retry",
  });
});

test("retry budget exhaustion stops every retryable path", () => {
  for (const outcome of ["not_dispatched", "failed_before_dispatch", "dispatched_proven_no_effect"] as const) {
    assert.deepEqual(decideAgentToolRecovery({
      outcome,
      replaySafe: true,
      externalSideEffect: false,
      attempt: 2,
      maxAttempts: 2,
    }), {
      action: "fail",
      reason: "attempt_budget_exhausted",
    });
  }
});

test("invalid retry budgets fail closed", () => {
  assert.throws(() => decideAgentToolRecovery({
    outcome: "failed_before_dispatch",
    replaySafe: true,
    externalSideEffect: false,
    attempt: 0,
    maxAttempts: 3,
  }), /positive safe integer/);

  assert.throws(() => decideAgentToolRecovery({
    outcome: "failed_before_dispatch",
    replaySafe: true,
    externalSideEffect: false,
    attempt: 1,
    maxAttempts: 11,
  }), /between 1 and 10/);
});

test("crash-after-dispatch cannot produce a duplicate effect through automatic recovery", () => {
  let effects = 1; // the provider may already have performed the external effect.
  const decision = decideAgentToolRecovery({
    outcome: "dispatched_outcome_unknown",
    replaySafe: true,
    externalSideEffect: true,
    attempt: 1,
    maxAttempts: 3,
  });

  if (decision.action === "retry") effects += 1;
  assert.equal(decision.action, "reconcile");
  assert.equal(effects, 1);
});


test("idempotency request identity rejects non-UUID aliases", () => {
  assert.throws(() => deriveAgentToolIdempotencyKey({
    requestId: "conversation:" + REQUEST_A,
    stepId: "step-1",
    toolId: "tool.write",
    inputSha256: HASH_A,
  }), /requestId/);
});
