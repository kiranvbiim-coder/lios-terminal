import crypto from "node:crypto";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface AgentToolIdempotencyInput {
  requestId: string;
  stepId: string;
  toolId: string;
  inputSha256: string;
}

export type AgentToolAttemptOutcome =
  | "not_dispatched"
  | "failed_before_dispatch"
  | "dispatched_proven_no_effect"
  | "dispatched_outcome_unknown"
  | "committed";

export type AgentToolRecoveryAction =
  | "retry"
  | "reuse_committed"
  | "reconcile"
  | "fail";

export interface AgentToolRecoveryDecision {
  action: AgentToolRecoveryAction;
  reason:
    | "pre_dispatch_retry"
    | "replay_safe_retry"
    | "already_committed"
    | "ambiguous_post_dispatch"
    | "not_replay_safe"
    | "attempt_budget_exhausted";
}

function assertRequestId(value: unknown): string {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new Error("Agent idempotency requestId must be a lowercase UUID.");
  }
  return value;
}

function assertOpaqueId(value: unknown, field: string): string {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) {
    throw new Error(`Agent idempotency ${field} is invalid.`);
  }
  return value;
}

function assertSha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error("Agent idempotency inputSha256 must be a lowercase SHA-256 digest.");
  }
  return value;
}

/**
 * Stable per-call key. A retry of the same tool within the same request/step and
 * with the same canonical input hash receives the same key.
 *
 * toolId is part of the binding so two different tools cannot collide merely
 * because they share a step and input payload.
 */
export function deriveAgentToolIdempotencyKey(input: AgentToolIdempotencyInput): string {
  const requestId = assertRequestId(input.requestId);
  const stepId = assertOpaqueId(input.stepId, "stepId");
  const toolId = assertOpaqueId(input.toolId, "toolId");
  const inputSha256 = assertSha256(input.inputSha256);

  const digest = crypto.createHash("sha256").update(JSON.stringify({
    version: 1,
    requestId,
    stepId,
    toolId,
    inputSha256,
  })).digest("hex");

  return `agent-tool:v1:${digest}`;
}

function assertAttemptBudget(attempt: number, maxAttempts: number): void {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error("Agent retry attempt must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("Agent retry maxAttempts must be between 1 and 10.");
  }
  if (attempt > maxAttempts) {
    throw new Error("Agent retry attempt cannot exceed maxAttempts.");
  }
}

/**
 * Decide whether LiOS may automatically retry a tool call.
 *
 * This is intentionally stricter than generic retry helpers:
 * - committed calls are reused, never re-executed;
 * - an ambiguous post-dispatch outcome always requires reconciliation;
 * - a post-dispatch known-no-effect failure retries only when the tool is
 *   explicitly replay-safe;
 * - failures before dispatch can retry because no tool side effect occurred;
 * - all retry paths are bounded.
 *
 * externalSideEffect is carried for the later L1/L2 integration contract; the
 * conservative ambiguous-outcome rule applies regardless of its value.
 */
export function decideAgentToolRecovery(input: {
  outcome: AgentToolAttemptOutcome;
  replaySafe: boolean;
  externalSideEffect: boolean;
  attempt: number;
  maxAttempts: number;
}): AgentToolRecoveryDecision {
  assertAttemptBudget(input.attempt, input.maxAttempts);

  if (input.outcome === "committed") {
    return Object.freeze({ action: "reuse_committed", reason: "already_committed" });
  }

  if (input.outcome === "dispatched_outcome_unknown") {
    return Object.freeze({ action: "reconcile", reason: "ambiguous_post_dispatch" });
  }

  if (input.attempt >= input.maxAttempts) {
    return Object.freeze({ action: "fail", reason: "attempt_budget_exhausted" });
  }

  if (input.outcome === "not_dispatched" || input.outcome === "failed_before_dispatch") {
    return Object.freeze({ action: "retry", reason: "pre_dispatch_retry" });
  }

  if (input.outcome === "dispatched_proven_no_effect") {
    if (!input.replaySafe) {
      return Object.freeze({ action: "fail", reason: "not_replay_safe" });
    }
    return Object.freeze({ action: "retry", reason: "replay_safe_retry" });
  }

  const neverOutcome: never = input.outcome;
  throw new Error(`Unsupported agent tool outcome: ${neverOutcome}`);
}
