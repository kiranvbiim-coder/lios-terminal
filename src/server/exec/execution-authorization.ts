import crypto from "node:crypto";
import type { RuntimePermissionClass } from "@shared/runtimeContracts";

/**
 * GM-11 approval freshness primitive.
 *
 * OpenClaw's pinned policy-snapshot and approval-lease mechanisms are reference
 * validators only. LiOS keeps its existing RuntimePermissionClass authority and
 * accepts only an opaque revision digest from the owning policy implementation.
 * Raw policy objects, command text, environment values and secrets do not belong
 * in this snapshot.
 */

const SHA256 = /^[a-f0-9]{64}$/i;

export type ExecutionApprovalPermissionClass = Extract<
  RuntimePermissionClass,
  "user_confirm" | "admin_confirm"
>;

export interface ExecutionPolicySnapshot {
  version: 1;
  permissionClass: ExecutionApprovalPermissionClass;
  /** SHA-256 revision produced by the canonical policy owner. */
  policyRevision: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export type ExecutionAuthorizationInvalidationReason =
  | "cancelled"
  | "expired"
  | "policy-changed"
  | "permission-changed"
  | "closed";

export class ExecutionAuthorizationInvalidError extends Error {
  constructor(readonly reason: ExecutionAuthorizationInvalidationReason) {
    super(
      reason === "expired"
        ? "Execution authorization expired."
        : reason === "cancelled"
          ? "Execution authorization was cancelled."
          : reason === "policy-changed"
            ? "Execution authorization policy is stale."
            : reason === "permission-changed"
              ? "Execution authorization permission class changed."
              : "Execution authorization is closed.",
    );
    this.name = "ExecutionAuthorizationInvalidError";
  }
}

function assertSafeTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer timestamp.`);
  }
}

function assertPolicyRevision(value: string): void {
  if (!SHA256.test(value)) {
    throw new Error("Execution policy revision must be a SHA-256 digest.");
  }
}

function constantTimeDigestEqual(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function createExecutionPolicySnapshot(input: {
  permissionClass: ExecutionApprovalPermissionClass;
  policyRevision: string;
  issuedAtMs: number;
  expiresAtMs: number;
}): ExecutionPolicySnapshot {
  if (input.permissionClass !== "user_confirm" && input.permissionClass !== "admin_confirm") {
    throw new Error("Execution approval requires a confirm permission class.");
  }
  assertPolicyRevision(input.policyRevision);
  assertSafeTimestamp(input.issuedAtMs, "issuedAtMs");
  assertSafeTimestamp(input.expiresAtMs, "expiresAtMs");
  if (input.expiresAtMs <= input.issuedAtMs) {
    throw new Error("Execution policy snapshot must expire after it is issued.");
  }
  return Object.freeze({
    version: 1 as const,
    permissionClass: input.permissionClass,
    policyRevision: input.policyRevision.toLowerCase(),
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
  });
}

export interface CurrentExecutionPolicy {
  permissionClass: ExecutionApprovalPermissionClass;
  policyRevision: string;
}

export class ExecutionAuthorizationLease {
  readonly snapshot: ExecutionPolicySnapshot;
  readonly signal: AbortSignal;

  private readonly controller = new AbortController();
  private readonly detachAbortListeners: Array<() => void> = [];
  private invalidationReason: ExecutionAuthorizationInvalidationReason | null = null;

  constructor(snapshot: ExecutionPolicySnapshot, sourceSignals: readonly AbortSignal[] = []) {
    this.snapshot = createExecutionPolicySnapshot(snapshot);
    this.signal = this.controller.signal;

    for (const source of new Set(sourceSignals)) this.attachCancellationSource(source);
  }

  /**
   * Cancellation of any attached source revokes the lease permanently (SI-02.07). Sources are attached by the launcher
   * once it knows the run's cancellation scope, so a cancelled run's approval cannot authorize another write or launch.
   */
  attachCancellationSource(source: AbortSignal | undefined): void {
    if (!source || this.invalidationReason !== null) return;
    if (source.aborted) {
      this.invalidate("cancelled");
      return;
    }
    const onAbort = () => this.invalidate("cancelled");
    source.addEventListener("abort", onAbort, { once: true });
    this.detachAbortListeners.push(() => source.removeEventListener("abort", onAbort));
  }

  get active(): boolean {
    return this.invalidationReason === null;
  }

  get reason(): ExecutionAuthorizationInvalidationReason | null {
    return this.invalidationReason;
  }

  private invalidate(reason: ExecutionAuthorizationInvalidationReason): never | void {
    if (this.invalidationReason !== null) return;
    this.invalidationReason = reason;
    for (const detach of this.detachAbortListeners.splice(0)) detach();
    this.controller.abort(new ExecutionAuthorizationInvalidError(reason));
  }

  /**
   * Fail closed and permanently on drift. A lease that observed stale policy,
   * expiry or cancellation never becomes valid again if inputs later revert.
   */
  assertCurrent(current: CurrentExecutionPolicy, nowMs: number = Date.now()): ExecutionPolicySnapshot {
    if (this.invalidationReason !== null) {
      throw new ExecutionAuthorizationInvalidError(this.invalidationReason);
    }
    assertSafeTimestamp(nowMs, "nowMs");
    if (nowMs >= this.snapshot.expiresAtMs) {
      this.invalidate("expired");
      throw new ExecutionAuthorizationInvalidError("expired");
    }
    if (current.permissionClass !== this.snapshot.permissionClass) {
      this.invalidate("permission-changed");
      throw new ExecutionAuthorizationInvalidError("permission-changed");
    }
    if (!constantTimeDigestEqual(current.policyRevision, this.snapshot.policyRevision)) {
      this.invalidate("policy-changed");
      throw new ExecutionAuthorizationInvalidError("policy-changed");
    }
    return this.snapshot;
  }

  close(): void {
    this.invalidate("closed");
  }
}
