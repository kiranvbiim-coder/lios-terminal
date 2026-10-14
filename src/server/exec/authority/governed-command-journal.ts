import crypto from "node:crypto";
import type { ExecutionOwner, ExecutionJournal, ExecutionTrustDenialReason, ExecutionTrustFacts } from "../execution-journal";
import { CommandExecutionError, type CommandResult } from "../run-command";
import type { ProcessSupervisor } from "../types";
import { ExecutionAuthorizationInvalidError, type CurrentExecutionPolicy, type ExecutionAuthorizationLease } from "../execution-authorization";
import {
  executePreparedGovernedCommand,
  startPreparedGovernedCommand,
  GovernedCommandAdmissionError,
  type PreparedGovernedCommand,
} from "./governed-command";
import { ExecutionPlacementError } from "../placement-grant";

/** The approval decision must come from an independent policy owner, not from the proposed command. */
export type GovernedCommandDecision =
  | { decision: "denied"; reason: ExecutionTrustDenialReason; policy: CurrentExecutionPolicy }
  | {
      decision: "approved";
      approvedOperationDigest: string;
      approvedDigest: string;
      lease: ExecutionAuthorizationLease;
      currentPolicy: () => CurrentExecutionPolicy;
      /** Only link an actual runtime receipt issued by the owning capability. */
      runtimeReceiptId?: string;
    };

function digestEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function denialReason(error: ExecutionAuthorizationInvalidError): ExecutionTrustDenialReason {
  switch (error.reason) {
    case "expired": return "expired";
    case "policy-changed":
    case "permission-changed": return "stale-policy";
    case "cancelled":
    case "closed": return "cancelled-before-launch";
  }
}

function assertPlacementOwner(prepared: PreparedGovernedCommand, requestId: string, owner: ExecutionOwner): void {
  const placement = prepared.facts.placement;
  if (!placement) return;
  if (placement.requestId !== requestId) throw new ExecutionPlacementError("scope-mismatch");
  if (placement.owner.userId !== owner.userId || placement.owner.projectId !== owner.projectId || placement.owner.chatId !== owner.chatId) {
    throw new ExecutionPlacementError("wrong-owner");
  }
}

/** Persist only hashes and backend facts. Raw argv, stdin and environment never enter the trust receipt. */
function trustFacts(
  requestId: string,
  prepared: PreparedGovernedCommand,
  policy: CurrentExecutionPolicy,
  decision: "approved" | "denied",
  reason: ExecutionTrustDenialReason | null,
): ExecutionTrustFacts {
  return {
    version: 1,
    requestId,
    operationDigest: prepared.operation.digest,
    approvalDigest: decision === "approved" ? prepared.approvalDigest : null,
    permissionClass: policy.permissionClass,
    policyRevision: policy.policyRevision,
    decision,
    denialReason: reason,
    backendId: prepared.facts.backendId,
    deviceId: null,
    backendGenerationId: prepared.facts.runtimeGenerationId ?? null,
    runtimeReceiptId: null,
  };
}

/**
 * GM-11d receipt boundary for an independently approved, prepared GM-11 command.
 * This is not an approval issuer or an interactive input API. Its id is the canonical
 * requestId; a run cannot be launched twice under one encrypted execution session.
 * The journal admission is durable before any side effect, and completion follows
 * GM-10 native extinction and backend finalization.
 */
export async function executeJournaledGovernedCommand(input: {
  requestId: string;
  owner: ExecutionOwner;
  label: string;
  prepared: PreparedGovernedCommand;
  decision: GovernedCommandDecision;
  journal: ExecutionJournal;
  signal?: AbortSignal;
  /** Test/integration injection only; production omits this and uses the canonical process-wide GM-10 supervisor. */
  supervisor?: ProcessSupervisor;
}): Promise<CommandResult | null> {
  const { requestId, owner, label, prepared, decision, journal, signal, supervisor } = input;
  assertPlacementOwner(prepared, requestId, owner);
  // No success-shaped fallback when the encrypted journal is unavailable.
  const deny = async (reason: ExecutionTrustDenialReason, policy: CurrentExecutionPolicy) => {
    await journal.recordDenied({ id: requestId, owner, label, trust: trustFacts(requestId, prepared, policy, "denied", reason) });
  };
  if (decision.decision === "denied") {
    await deny(decision.reason, decision.policy);
    return null;
  }

  const policy = decision.lease.snapshot;
  if (!digestEqual(decision.approvedOperationDigest, prepared.operation.digest)
    || !digestEqual(decision.approvedDigest, prepared.approvalDigest)) {
    await deny("approval-mismatch", policy);
    throw new GovernedCommandAdmissionError("approval-digest-mismatch");
  }
  try {
    decision.lease.assertCurrent(decision.currentPolicy());
  } catch (error) {
    if (!(error instanceof ExecutionAuthorizationInvalidError)) throw error;
    await deny(denialReason(error), policy);
    throw error;
  }

  const cancel = () => decision.lease.close();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  let begun = false;
  try {
    await journal.begin({ id: requestId, owner, label, trust: trustFacts(requestId, prepared, policy, "approved", null) });
    begun = true;
    const result = await executePreparedGovernedCommand(prepared, decision, supervisor);
    await journal.append(requestId, "stdout", result.stdout);
    await journal.append(requestId, "stderr", result.stderr);
    await journal.finish(requestId, "completed", 0, { runtimeReceiptId: decision.runtimeReceiptId });
    return result;
  } catch (error) {
    if (begun) {
      if (error instanceof CommandExecutionError) {
        await journal.append(requestId, "stdout", error.result.stdout);
        await journal.append(requestId, "stderr", error.result.stderr);
      }
      const cancelled = signal?.aborted === true
        || (error instanceof CommandExecutionError && error.result.reason === "manual-cancel");
      await journal.finish(requestId, cancelled ? "cancelled" : "failed",
        error instanceof CommandExecutionError ? error.result.exitCode : null);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
export interface JournaledGovernedInteractiveSession {
  writeInput(input: string): Promise<void>;
  cancel(): void;
  wait(): Promise<CommandResult>;
}

/** One server-approved safe-console process; writes are policy-checked and journal only input hashes. */
export async function startJournaledGovernedInteractiveSession(input: {
  requestId: string;
  owner: ExecutionOwner;
  label: string;
  prepared: PreparedGovernedCommand;
  decision: Extract<GovernedCommandDecision, { decision: "approved" }>;
  journal: ExecutionJournal;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /** Test/integration injection only; production omits this and uses the canonical process-wide GM-10 supervisor. */
  supervisor?: ProcessSupervisor;
}): Promise<JournaledGovernedInteractiveSession> {
  const { requestId, owner, label, prepared, decision, journal } = input;
  assertPlacementOwner(prepared, requestId, owner);
  if (!digestEqual(decision.approvedOperationDigest, prepared.operation.digest)
    || !digestEqual(decision.approvedDigest, prepared.approvalDigest)) {
    await journal.recordDenied({
      id: requestId,
      owner,
      label,
      trust: trustFacts(requestId, prepared, decision.lease.snapshot, "denied", "approval-mismatch"),
    });
    throw new GovernedCommandAdmissionError("approval-digest-mismatch");
  }
  try {
    decision.lease.assertCurrent(decision.currentPolicy());
  } catch (error) {
    if (error instanceof ExecutionAuthorizationInvalidError) {
      await journal.recordDenied({
        id: requestId,
        owner,
        label,
        trust: trustFacts(requestId, prepared, decision.lease.snapshot, "denied", denialReason(error)),
      });
    }
    throw error;
  }
  await journal.begin({
    id: requestId,
    owner,
    label,
    trust: trustFacts(requestId, prepared, decision.lease.snapshot, "approved", null),
  });

  let session: Awaited<ReturnType<typeof startPreparedGovernedCommand>> | null = null;
  let journalFailure: unknown = null;
  let outputQueue = Promise.resolve();
  const persistOutput = (stream: "stdout" | "stderr", chunk: string): void => {
    outputQueue = outputQueue.then(async () => {
      if (journalFailure) return;
      await journal.append(requestId, stream, chunk);
      input[stream === "stdout" ? "onStdout" : "onStderr"]?.(chunk);
    }).catch((error: unknown) => {
      journalFailure ??= error;
      session?.cancel();
    });
  };
  try {
    session = await startPreparedGovernedCommand(
      prepared,
      decision,
      input.supervisor,
      {
        signal: input.signal,
        onStdout: (chunk) => persistOutput("stdout", chunk),
        onStderr: (chunk) => persistOutput("stderr", chunk),
      },
    );
    if (journalFailure) session.cancel();
  } catch (error) {
    await journal.finish(requestId, input.signal?.aborted ? "cancelled" : "failed", null);
    throw error;
  }

  let completion: Promise<CommandResult> | null = null;
  return {
    async writeInput(value) {
      decision.lease.assertCurrent(decision.currentPolicy());
      if (!prepared.facts.intent?.allowedInteractiveInputs?.includes(value)) {
        throw new GovernedCommandAdmissionError("launch-invalid");
      }
      try {
        await journal.appendInteractiveInputDigest(
          requestId,
          crypto.createHash("sha256").update(value, "utf8").digest("hex"),
        );
        await session!.writeInput(value);
      } catch (error) {
        session!.cancel();
        throw error;
      }
    },
    cancel() {
      session!.cancel();
    },
    wait() {
      if (!completion) {
        completion = (async () => {
          let result: CommandResult | null = null;
          let failure: unknown = null;
          try {
            result = await session!.wait();
          } catch (error) {
            failure = error;
          }
          await outputQueue;
          if (journalFailure) failure ??= journalFailure;
          const cancelled = input.signal?.aborted === true
            || (failure instanceof CommandExecutionError && failure.result.reason === "manual-cancel");
          await journal.finish(
            requestId,
            cancelled ? "cancelled" : failure ? "failed" : "completed",
            failure instanceof CommandExecutionError ? failure.result.exitCode : (failure ? null : 0),
            failure ? {} : { runtimeReceiptId: decision.runtimeReceiptId },
          );
          if (failure) throw failure;
          if (!result) throw new Error("Governed terminal session completed without a result.");
          return result;
        })();
      }
      return completion;
    },
  };
}
