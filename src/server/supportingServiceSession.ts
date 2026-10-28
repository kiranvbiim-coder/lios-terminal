import {
  SUPPORTING_SERVICE_MAX_FRAME_BYTES, supportingServiceBindingSchema,
  type SupportingServiceBinding, type SupportingServiceHomeFrame, type SupportingServiceWorkerFrame,
} from "@shared/supportingServiceContracts";
import { safeEqualSecret } from "./safeEqualSecret";
import { SupportingServiceTransport, SupportingServiceTransportClosedError } from "./supportingServiceTransport";
import { PreparedGovernedCommand, GovernedCommandAdmissionError } from "./exec/authority/governed-command";
import { ExecutionAuthorizationLease, type CurrentExecutionPolicy } from "./exec/execution-authorization";
import { currentConversationExecutionScope } from "./exec/execution-scope";
import { startPreparedSpawn, CommandExecutionError, type PreparedSpawnSession, type CommandResult } from "./exec/run-command";
import type { ProcessSupervisor } from "./exec/types";

export interface SupportingServiceSession {
  send(frame: SupportingServiceHomeFrame): Promise<void>;
  close(): Promise<void>;
  wait(): Promise<CommandResult>;
}

/**
 * Internal consumer of existing GM-11 exact approval and GM-10 process custody. This does not
 * install/register a service, authorize channel invocations or create account/receipt state.
 * Home must separately admit the current account/tenant and validate each operation/event.
 */
export async function startSupportingServiceSession(input: {
  prepared: PreparedGovernedCommand;
  authorization: {
    approvedOperationDigest: string;
    approvedDigest: string;
    lease: ExecutionAuthorizationLease;
    currentPolicy(): CurrentExecutionPolicy;
  };
  binding: SupportingServiceBinding;
  buildSha256: string;
  operations: readonly string[];
  assertAccountCurrent(): void | Promise<void>;
  onFrame(frame: SupportingServiceWorkerFrame, signal: AbortSignal): Promise<void>;
  supervisor?: ProcessSupervisor;
  signal?: AbortSignal;
  maxFrameBytes?: number;
  maxQueuedBytes?: number;
  operationTimeoutMs?: number;
}): Promise<SupportingServiceSession> {
  const { prepared, authorization } = input;
  const binding = supportingServiceBindingSchema.parse(input.binding);
  if (!(prepared instanceof PreparedGovernedCommand) || currentConversationExecutionScope()) {
    throw new GovernedCommandAdmissionError("conversation-scope-mismatch");
  }
  const placement = prepared.facts.placement;
  if (!placement?.homeServiceId || placement.requestId !== binding.sessionId ||
      placement.kind !== "container" || placement.owner.projectId !== null || placement.owner.chatId !== null ||
      placement.trustPosture !== "isolated-container" ||
      prepared.facts.isolation.filesystem !== "sandbox" || prepared.facts.isolation.network !== "deny" || prepared.facts.isolation.processes !== "sandbox") {
    throw new GovernedCommandAdmissionError("launch-invalid");
  }
  if (!safeEqualSecret(prepared.operation.digest, authorization.approvedOperationDigest) ||
      !safeEqualSecret(prepared.approvalDigest, authorization.approvedDigest)) {
    throw new GovernedCommandAdmissionError("approval-digest-mismatch");
  }
  const spawn = prepared.launchSnapshot();
  if (spawn.stdinMode !== "pipe-open" || spawn.interactiveInputPolicy !== "sandbox-broker-rpc" ||
      spawn.scopeKey !== `home-service:${placement.homeServiceId}:${placement.requestId}` ||
      spawn.onStdoutRaw !== undefined || spawn.onStderrRaw !== undefined ||
      prepared.lifecycle()?.acceptExit !== undefined) {
    throw new GovernedCommandAdmissionError("launch-invalid");
  }

  const failed = new AbortController();
  const signal = authorization.lease.signal;
  const assertCurrent = () => {
    prepared.assertPlacementCurrent();
    authorization.lease.assertCurrent(authorization.currentPolicy());
  };

  let session: PreparedSpawnSession | undefined;
  let starting: Promise<PreparedSpawnSession> | undefined;
  let transportFailure = false;
  let closing = false;
  const pendingFrames = new Set<Promise<void>>();
  const fail = () => {
    transportFailure = true;
    failed.abort();
    session?.cancel("manual-cancel");
  };
  const transport = new SupportingServiceTransport({
    binding, buildSha256: input.buildSha256, operations: input.operations,
    maxFrameBytes: input.maxFrameBytes ?? SUPPORTING_SERVICE_MAX_FRAME_BYTES,
    maxQueuedBytes: input.maxQueuedBytes, operationTimeoutMs: input.operationTimeoutMs,
    assertCurrent: async () => { assertCurrent(); await input.assertAccountCurrent(); assertCurrent(); },
    write: async (bytes, requestSignal) => {
      if (requestSignal.aborted || !session) throw new Error("Service session not available.");
      assertCurrent();
      await session.writeInput(bytes.toString("utf8"));
      assertCurrent();
    },
    stop: async () => {
      failed.abort();
      const owned = session ?? await starting;
      if (!owned) return;
      owned.cancel("manual-cancel");
      try { await owned.wait(); } catch (error) {
        // The canonical waiter checks extinction/finalization before emitting this typed cancellation.
        if (!(error instanceof CommandExecutionError) || error.result.reason !== "manual-cancel" ||
            error.result.stdoutTruncated || error.result.stderrTruncated) throw error;
      }
    },
    onFrame: input.onFrame,
  });
  const closeOnRevocation = () => { closing = true; void transport.close().catch(() => undefined); };
  authorization.lease.attachCancellationSource(prepared.signal());
  authorization.lease.attachCancellationSource(input.signal);
  authorization.lease.attachCancellationSource(failed.signal);
  signal.addEventListener("abort", closeOnRevocation, { once: true });
  spawn.expectedOperationDigest = authorization.approvedOperationDigest;
  spawn.authorizationCheck = assertCurrent;
  // Raw bytes reach the strict parser before decoded text can replace malformed UTF-8.
  spawn.onStdoutRaw = bytes => {
    const work = transport.receive(bytes).catch(error => {
      if (closing && error instanceof SupportingServiceTransportClosedError) return;
      fail();
      throw error;
    });
    pendingFrames.add(work);
    void work.then(() => pendingFrames.delete(work), () => { pendingFrames.delete(work); });
  };
  spawn.onStdoutAsync = async () => { await Promise.all([...pendingFrames]); };
  // Service output belongs to the typed transport, not generic retained process output.
  spawn.captureOutput = false;
  let completion: Promise<CommandResult>;
  try {
    assertCurrent();
    let admissionTimer: ReturnType<typeof setTimeout> | undefined;
    const aborted = () => admissionReject(new Error("Supporting-service account admission cancelled."));
    let admissionReject!: (error: Error) => void;
    try {
      await Promise.race([
        Promise.resolve().then(() => input.assertAccountCurrent()),
        new Promise<never>((_, reject) => {
          admissionReject = reject;
          signal.addEventListener("abort", aborted, { once: true });
          admissionTimer = setTimeout(() => reject(new Error("Supporting-service account admission timed out.")), input.operationTimeoutMs ?? 15_000);
          if (signal.aborted) aborted();
        }),
      ]);
    } finally {
      if (admissionTimer) clearTimeout(admissionTimer);
      signal.removeEventListener("abort", aborted);
    }
    assertCurrent();
    starting = startPreparedSpawn(spawn, signal, input.supervisor, {
      scopeMode: "exact", lifecycle: prepared.lifecycle(),
    });
    session = await starting;
    completion = session.wait().then(async result => {
      // Validate EOF before close clears buffered bytes; the native waiter remains stop's cleanup owner.
      await transport.end();
      return result;
    });
    void completion.catch(() => { transportFailure = true; closeOnRevocation(); });
    if (signal.aborted) closeOnRevocation();
    await transport.open();
  } catch {
    try { await transport.close(); } finally {
      signal.removeEventListener("abort", closeOnRevocation);
      authorization.lease.close();
    }
    throw new Error("Supporting service could not start under its current approval.");
  }

  let waited: Promise<CommandResult> | undefined;
  const wait = () => waited ??= completion.finally(async () => {
    try { await transport.close(); } finally {
      signal.removeEventListener("abort", closeOnRevocation);
      authorization.lease.close();
    }
  }).then(result => {
    if (transportFailure) throw new Error("Supporting service closed or failed; external outcomes remain unconfirmed.");
    return result;
  });
  // Own completion even when the consumer only closes instead of calling wait().
  void wait().catch(() => undefined);
  return {
    send: frame => transport.send(frame),
    close: async () => {
      closing = true;
      try { await transport.close(); } finally {
        signal.removeEventListener("abort", closeOnRevocation);
        authorization.lease.close();
      }
    },
    wait,
  };
}
