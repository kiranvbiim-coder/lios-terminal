import crypto from "node:crypto";
import { z } from "zod";
import type {
  CurrentExecutionPolicy,
  ExecutionPolicySnapshot,
} from "./execution-authorization";
import { ExecutionAuthorizationLease } from "./execution-authorization";

/**
 * SI-02 L4 approval continuation binding.
 *
 * This is deliberately not a grant store, run registry, checkpoint store, or
 * execution authority. It binds an already-approved GM-11 authorization lease
 * to the exact agent run + plan that paused for approval so a continuation
 * cannot silently re-plan or switch policy while reusing the approval.
 *
 * Durability belongs to the canonical execution journal (L2 integration).
 * Approval issuance/consumption remains owned by conversationGrantStore.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STEP_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const TOOL_ID = /^[a-z0-9][a-z0-9._:-]{0,299}$/;
const TOOL_CALL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const liveLeaseBindingIds = new WeakMap<ExecutionAuthorizationLease, string>();

export type RunApprovalResumeMismatchReason =
  | "run-changed"
  | "plan-changed"
  | "lease-mismatch";

export class RunApprovalResumeMismatchError extends Error {
  constructor(readonly reason: RunApprovalResumeMismatchReason) {
    super(
      reason === "run-changed"
        ? "Approval continuation belongs to a different run."
        : reason === "plan-changed"
          ? "Approval continuation plan changed."
          : "Approval continuation does not match its authorization lease.",
    );
    this.name = "RunApprovalResumeMismatchError";
  }
}

export const runApprovalResumeBindingSchema = z.object({
  version: z.literal(1),
  /** Canonical requestId + exact owner scope for the live conversation run. */
  requestId: z.string().regex(UUID),
  ownerUserId: z.number().int().positive().safe(),
  projectId: z.number().int().positive().safe().nullable(),
  chatId: z.number().int().positive().safe().nullable(),
  /** SHA-256 over the validated workflow plan, produced by the canonical agent-loop owner. */
  planHash: z.string().regex(SHA256),
  /** SHA-256 over the exact parsed input of the paused governed tool. Raw arguments are never persisted. */
  inputSha256: z.string().regex(SHA256),
  /** Exact agent step, canonical tool and durable call identity that paused. No raw arguments are persisted. */
  stepId: z.string().regex(STEP_ID),
  toolId: z.string().regex(TOOL_ID),
  toolCallId: z.string().regex(TOOL_CALL_ID),
  /** Opaque process-local lease identity. Possession is not authority; the live WeakMap association is also required. */
  leaseBindingId: z.string().uuid(),
  permissionClass: z.enum(["user_confirm", "admin_confirm"]),
  /** Opaque SHA-256 revision produced by the canonical policy owner. */
  policyRevision: z.string().regex(SHA256),
  issuedAtMs: z.number().int().nonnegative().safe(),
  expiresAtMs: z.number().int().positive().safe(),
}).strict().superRefine((value, ctx) => {
  if (value.expiresAtMs <= value.issuedAtMs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAtMs"], message: "Approval continuation must expire after it is issued." });
  }
});
export type RunApprovalResumeBinding = z.infer<typeof runApprovalResumeBindingSchema>;

function assertRunId(requestId: string): void {
  if (!UUID.test(requestId)) throw new Error("Approval continuation requires a lowercase UUID requestId.");
}

function normalizeDigest(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function digestEqual(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function leaseMatchesBinding(binding: RunApprovalResumeBinding, lease: ExecutionAuthorizationLease, snapshot: ExecutionPolicySnapshot): boolean {
  return liveLeaseBindingIds.get(lease) === binding.leaseBindingId
    && binding.permissionClass === snapshot.permissionClass
    && digestEqual(binding.policyRevision, snapshot.policyRevision)
    && binding.issuedAtMs === snapshot.issuedAtMs
    && binding.expiresAtMs === snapshot.expiresAtMs;
}

/**
 * Capture the minimum secret-safe facts needed to resume the same approved run.
 * The lease itself remains the live GM-11 authority; this binding never grants.
 */
export function createRunApprovalResumeBinding(input: {
  requestId: string;
  owner: { userId: number; projectId: number | null; chatId: number | null };
  planHash: string;
  inputSha256: string;
  stepId: string;
  toolId: string;
  toolCallId: string;
  lease: ExecutionAuthorizationLease;
}): RunApprovalResumeBinding {
  assertRunId(input.requestId);
  const planHash = normalizeDigest(input.planHash, "planHash");
  const inputSha256 = normalizeDigest(input.inputSha256, "inputSha256");
  const snapshot = input.lease.snapshot;
  let leaseBindingId = liveLeaseBindingIds.get(input.lease);
  if (!leaseBindingId) {
    leaseBindingId = crypto.randomUUID();
    liveLeaseBindingIds.set(input.lease, leaseBindingId);
  }

  const parsed = runApprovalResumeBindingSchema.parse({
    version: 1,
    requestId: input.requestId,
    ownerUserId: input.owner.userId,
    projectId: input.owner.projectId,
    chatId: input.owner.chatId,
    planHash,
    inputSha256,
    stepId: input.stepId,
    toolId: input.toolId,
    toolCallId: input.toolCallId,
    leaseBindingId,
    permissionClass: snapshot.permissionClass,
    policyRevision: snapshot.policyRevision,
    issuedAtMs: snapshot.issuedAtMs,
    expiresAtMs: snapshot.expiresAtMs,
  });
  return Object.freeze(parsed);
}

/** Parse a persisted secret-safe binding without turning it into approval authority. */
export function parseRunApprovalResumeBinding(value: unknown): RunApprovalResumeBinding {
  const parsed = runApprovalResumeBindingSchema.parse(value);
  return Object.freeze({ ...parsed });
}

/**
 * Secret-safe audit reference for L2's durable tool_call_resumed event.
 * It is only evidence that identifies this exact continuation binding; it is
 * never accepted as approval authority.
 */
function runApprovalResumeRef(binding: RunApprovalResumeBinding): string {
  const parsed = runApprovalResumeBindingSchema.parse(binding);
  const payload = [
    parsed.version,
    parsed.requestId,
    parsed.ownerUserId,
    parsed.projectId ?? "",
    parsed.chatId ?? "",
    parsed.planHash,
    parsed.inputSha256,
    parsed.stepId,
    parsed.toolId,
    parsed.toolCallId,
    parsed.leaseBindingId,
    parsed.permissionClass,
    parsed.policyRevision,
    parsed.issuedAtMs,
    parsed.expiresAtMs,
  ].join("\0");
  return `approval:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

/**
 * Re-check a paused approval immediately before continuing the same run.
 *
 * Order matters:
 * 1. same run;
 * 2. same validated plan;
 * 3. same live lease that was bound when approval paused;
 * 4. current GM-11 policy/permission/expiry/cancellation checks.
 *
 * Policy drift, expiry, cancellation and close are permanently fail-closed via
 * ExecutionAuthorizationLease.assertCurrent().
 */
export function assertRunApprovalResumeCurrent(input: {
  binding: RunApprovalResumeBinding;
  requestId: string;
  owner: { userId: number; projectId: number | null; chatId: number | null };
  planHash: string;
  inputSha256: string;
  stepId: string;
  toolId: string;
  toolCallId: string;
  lease: ExecutionAuthorizationLease;
  currentPolicy: CurrentExecutionPolicy;
  nowMs?: number;
}): ExecutionPolicySnapshot {
  assertRunId(input.requestId);
  const planHash = normalizeDigest(input.planHash, "planHash");
  const inputSha256 = normalizeDigest(input.inputSha256, "inputSha256");

  if (
    input.binding.requestId !== input.requestId
    || input.binding.ownerUserId !== input.owner.userId
    || input.binding.projectId !== input.owner.projectId
    || input.binding.chatId !== input.owner.chatId
  ) {
    throw new RunApprovalResumeMismatchError("run-changed");
  }
  if (!digestEqual(input.binding.planHash, planHash) || !digestEqual(input.binding.inputSha256, inputSha256)) {
    throw new RunApprovalResumeMismatchError("plan-changed");
  }
  if (
    input.binding.stepId !== input.stepId
    || input.binding.toolId !== input.toolId
    || input.binding.toolCallId !== input.toolCallId
  ) {
    throw new RunApprovalResumeMismatchError("plan-changed");
  }
  if (!leaseMatchesBinding(input.binding, input.lease, input.lease.snapshot)) {
    throw new RunApprovalResumeMismatchError("lease-mismatch");
  }

  return input.lease.assertCurrent(input.currentPolicy, input.nowMs);
}


/**
 * Minimal L2 seam consumed by L4. Keeping this structural avoids making the
 * approval contract another journal owner while still forcing one atomic
 * durable release transition.
 */
export interface ApprovalResumeJournal {
  resumeAfterApproval(
    requestId: string,
    owner: { userId: number; projectId: number | null; chatId: number | null },
    toolCallId: string,
    approvalRef: string,
  ): Promise<unknown>;
}

/**
 * Release a paused run after the canonical grant authority has produced a live
 * GM-11 authorization lease.
 *
 * This function does not mint/consume grants and does not execute the tool. It
 * only proves the approval still belongs to the exact paused action and asks
 * L2 to durably append the release event + flip waiting -> running atomically.
 * L3/L7 may continue only after this promise resolves.
 */
export async function releaseRunApproval(input: {
  journal: ApprovalResumeJournal;
  binding: RunApprovalResumeBinding;
  requestId: string;
  owner: { userId: number; projectId: number | null; chatId: number | null };
  planHash: string;
  inputSha256: string;
  stepId: string;
  toolId: string;
  toolCallId: string;
  lease: ExecutionAuthorizationLease;
  currentPolicy: CurrentExecutionPolicy;
  nowMs?: number;
}): Promise<{ approvalRef: string; snapshot: ExecutionPolicySnapshot }> {
  const snapshot = assertRunApprovalResumeCurrent({
    binding: input.binding,
    requestId: input.requestId,
    owner: input.owner,
    planHash: input.planHash,
    inputSha256: input.inputSha256,
    stepId: input.stepId,
    toolId: input.toolId,
    toolCallId: input.toolCallId,
    lease: input.lease,
    currentPolicy: input.currentPolicy,
    nowMs: input.nowMs,
  });
  const approvalRef = runApprovalResumeRef(input.binding);
  await input.journal.resumeAfterApproval(input.requestId, input.owner, input.toolCallId, approvalRef);
  return Object.freeze({ approvalRef, snapshot });
}

/**
 * Full L4 ordering guard for the integration layer. The same-run continuation
 * callback is unreachable until live authorization succeeds and L2 has durably
 * committed the exact tool-call release.
 */
export async function releaseRunApprovalAndContinue<T>(
  input: Omit<Parameters<typeof releaseRunApproval>[0], "currentPolicy"> & {
    /** Read from the canonical policy owner at each authorization boundary. */
    getCurrentPolicy: () => CurrentExecutionPolicy;
    /**
     * Optional asynchronous canonical-authority check (GM-11a). Used for facts
     * that cannot be proven by the local lease alone, e.g. live Project-grant
     * revocation in SQL. Called before and after L2's durable release.
     */
    assertExternalCurrent?: () => Promise<void>;
    /**
     * Best-effort terminalization hook for the narrow case where external/live
     * authority becomes invalid after L2 has already committed the release.
     * The continuation is never entered in that case.
     */
    onReleasedInvalid?: (error: unknown) => Promise<void>;
    continueRun: () => Promise<T>;
  },
): Promise<T> {
  if (input.assertExternalCurrent) await input.assertExternalCurrent();

  await releaseRunApproval({
    ...input,
    currentPolicy: input.getCurrentPolicy(),
  });

  try {
    // Close the async TOCTOU window created by the durable journal write.
    // Revalidate both canonical external authority (which may consult durable
    // Project grants) and the live lease/current policy before L3 continuation.
    if (input.assertExternalCurrent) await input.assertExternalCurrent();
    assertRunApprovalResumeCurrent({
      binding: input.binding,
      requestId: input.requestId,
      owner: input.owner,
      planHash: input.planHash,
      inputSha256: input.inputSha256,
      stepId: input.stepId,
      toolId: input.toolId,
      toolCallId: input.toolCallId,
      lease: input.lease,
      currentPolicy: input.getCurrentPolicy(),
      nowMs: input.nowMs,
    });
  } catch (error) {
    if (input.onReleasedInvalid) await input.onReleasedInvalid(error);
    throw error;
  }

  return input.continueRun();
}

