import crypto from "node:crypto";
import type { ConversationUser } from "./conversationRunService";
import {
  consumeExactConversationOperation,
  proposeExactConversationOperation,
  reviewExactConversationOperation,
  ConversationGrantError,
} from "./conversationGrantStore";
import { conversationRuns } from "./conversationRunRegistry";
import { prepareInternalExecIntent } from "./exec/authority/governed-command";
import { startJournaledGovernedInteractiveSession, executeJournaledGovernedCommand } from "./exec/authority/governed-command-journal";
import { bindConversationExecutionSignal, getConversationExecutionJournal, withConversationExecutionScope } from "./exec/execution-scope";
import { requireStrictSandboxRuntime } from "./exec/sandbox-runtime-profile";
import type { CurrentExecutionPolicy } from "./exec/execution-authorization";
import { ExecutionPlacementGrant, type ExecutionPlacementAuthority } from "./exec/placement-grant";

const PERMISSION_CLASS = "user_confirm" as const;
const OPERATION_LABEL = "Open restricted read-only sandbox console";
const READONLY_CONSOLE_INPUTS = ["help", "pwd", "id -u", "ls /tmp", "exit"] as const;

/** The server deployment policy, never a revision accepted from a browser request. */
function currentSandboxPolicy(): CurrentExecutionPolicy {
  const profile = requireStrictSandboxRuntime();
  const revision = crypto.createHash("sha256").update(JSON.stringify({
    version: 2,
    intent: "sandbox.terminal.readonly",
    engine: profile.engine,
    engineTarget: profile.engineTarget,
    image: profile.image,
    user: profile.user,
    shell: profile.tools.shell,
    interactiveInputPolicy: "sandbox-readonly-console",
    allowedInteractiveInputs: READONLY_CONSOLE_INPUTS,
    maxWallTimeMs: 5 * 60_000,
    maxCapturedOutputChars: 256 * 1024,
    maxMemoryBytes: process.env.LIOS_EXECUTION_SANDBOX_MAX_MEMORY_BYTES ?? null,
    maxProcesses: process.env.LIOS_EXECUTION_SANDBOX_MAX_PROCESSES ?? null,
    permissionClass: PERMISSION_CLASS,
  })).digest("hex");
  return { permissionClass: PERMISSION_CLASS, policyRevision: revision };
}

/** Closed LiOS intent only; the browser never supplies an executable, shell program, or arbitrary input. */
export async function proposeSandboxTerminalSession(user: ConversationUser, projectId: number, chatId: number) {
  const profile = requireStrictSandboxRuntime();
  const shell = profile.tools.shell;
  if (!shell) throw new ConversationGrantError(503, "The immutable sandbox shell is not available.");
  const requestId = crypto.randomUUID();
  const owner = { userId: user.id, projectId, chatId };
  const placementAuthority = (): ExecutionPlacementAuthority => {
    const current = requireStrictSandboxRuntime();
    const policy = currentSandboxPolicy();
    return {
      requestId, owner,
      target: {
        nodeId: `home-runtime:${process.pid}`,
        kind: "container", owner, generation: policy.policyRevision,
        available: true, revoked: false, backend: current.backend, endpoint: current.engineTarget,
      },
      policy: {
        revision: policy.policyRevision, allowedKinds: ["container"],
        dataLocality: "runtime-only", secretLocality: "none",
      },
    };
  };
  const authority = placementAuthority();
  // Use the exact selected backend; a missing/ineligible container must never choose the host.
  authority.target.backend = profile.backend;
  const placement = ExecutionPlacementGrant.select({
    authority,
    request: {
      argv: [], scopeKey: `conversation:${requestId}`,
      isolation: { filesystem: "sandbox", network: "deny", processes: "sandbox" },
      resources: {
        maxWallTimeMs: 5 * 60_000, maxCapturedOutputChars: 256 * 1024,
        maxMemoryBytes: 256 * 1024 * 1024, maxProcesses: 16,
      },
    },
    currentAuthority: placementAuthority,
    signal: new AbortController().signal,
  });
  const prepared = await prepareInternalExecIntent({
    backend: profile.backend,
    placement,
    intent: { intentId: "sandbox.terminal.readonly", executable: shell },
    isolation: { filesystem: "sandbox", network: "deny", processes: "sandbox" },
    scopeKey: `conversation:${requestId}`,
    hardLimits: { maxMemoryBytes: 256 * 1024 * 1024, maxProcesses: 16 },
  });
  if (prepared.facts.intent?.intentId !== "sandbox.terminal.readonly"
    || prepared.facts.intent.interactiveInputPolicy !== "sandbox-readonly-console"
    || READONLY_CONSOLE_INPUTS.some((item) => !prepared.facts.intent?.allowedInteractiveInputs?.includes(item))) {
    throw new ConversationGrantError(503, "The reviewed read-only sandbox terminal policy is unavailable.");
  }
  const journal = await getConversationExecutionJournal();
  if (await journal.read(requestId, { userId: user.id, projectId, chatId })) {
    throw new ConversationGrantError(409, "Execution session id was already used.");
  }
  const proposal = await proposeExactConversationOperation({
    user, projectId, chatId, requestId, prepared, policy: currentSandboxPolicy(),
  });
  return {
    ...proposal,
    interactiveInputPolicy: prepared.facts.intent?.interactiveInputPolicy ?? null,
    allowedInteractiveInputs: [...READONLY_CONSOLE_INPUTS],
    isolation: prepared.facts.isolation,
    resources: prepared.facts.resources,
    placement: prepared.facts.placement,
  };
}

/** Review is a separate authenticated action; only this server-held proposal can be consumed for launch. */
export async function reviewSandboxTerminalSession(input: {
  user: ConversationUser;
  projectId: number;
  chatId: number;
  requestId: string;
  operationDigest: string;
  approvalDigest: string;
  allow: boolean;
}): Promise<{ sessionId: string; status: "denied" | "started" }> {
  const { user, projectId, chatId, requestId } = input;
  const journal = await getConversationExecutionJournal();
  const policy = currentSandboxPolicy();
  const reviewed = await reviewExactConversationOperation(input);
  const owner = { userId: user.id, projectId, chatId };
  if (!reviewed.allowed) {
    await executeJournaledGovernedCommand({
      requestId, owner, label: OPERATION_LABEL, prepared: reviewed.prepared,
      decision: { decision: "denied", reason: "user-denied", policy: reviewed.policy }, journal,
    });
    return { sessionId: requestId, status: "denied" };
  }

  const approval = await consumeExactConversationOperation({ user, projectId, chatId, requestId });
  if (approval.policy.policyRevision !== policy.policyRevision) {
    await executeJournaledGovernedCommand({
      requestId, owner, label: OPERATION_LABEL, prepared: approval.prepared, journal,
      decision: { decision: "denied", reason: "stale-policy", policy: approval.policy },
    });
    return { sessionId: requestId, status: "denied" };
  }
  conversationRuns.start({ requestId, userId: user.id, projectId, chatId }, async (emit, signal) => {
    const scopedOwner = { userId: user.id, projectId, chatId };
    const now = () => new Date().toISOString();
    let transcript = "";
    const appendOutput = (chunk: string) => {
      transcript = `${transcript}${chunk}`.slice(-200_000);
      emit({ type: "text", requestId, at: now(), text: transcript, label: "deterministic" });
    };
    try {
      await withConversationExecutionScope(requestId, async () => {
        bindConversationExecutionSignal(requestId, signal);
        const session = await startJournaledGovernedInteractiveSession({
          requestId,
          owner,
          label: OPERATION_LABEL,
          prepared: approval.prepared,
          journal,
          signal,
          decision: {
            decision: "approved",
            approvedOperationDigest: approval.approvedOperationDigest,
            approvedDigest: approval.approvedDigest,
            lease: approval.lease,
            currentPolicy: currentSandboxPolicy,
          },
          onStdout: appendOutput,
          onStderr: (chunk) => appendOutput(`\n[stderr]\n${chunk}`),
        });
        if (!conversationRuns.setInputHandlerScoped(requestId, scopedOwner, (value) => session.writeInput(value))) {
          session.cancel();
          await session.wait().catch(() => undefined);
          throw new ConversationGrantError(404, "That execution session is no longer available.");
        }
        emit({ type: "status", requestId, at: now(), stepId: null, state: "running", message: "Restricted terminal input ready." });
        try {
          await session.wait();
        } finally {
          conversationRuns.setInputHandlerScoped(requestId, scopedOwner, null);
        }
      });
      emit({ type: "done", requestId, at: now(), status: "completed" });
    } catch {
      conversationRuns.setInputHandlerScoped(requestId, scopedOwner, null);
      emit({
        type: "error",
        requestId,
        at: now(),
        code: "request_failed",
        message: "The reviewed sandbox terminal failed or was cancelled.",
      });
      emit({ type: "done", requestId, at: now(), status: signal.aborted ? "cancelled" : "failed" });
    }
  });
  // Only admission is acknowledged; completion is emitted after journal finalization and native extinction.
  return { sessionId: requestId, status: "started" };
}
