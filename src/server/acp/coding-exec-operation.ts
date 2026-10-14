import crypto from "node:crypto";
import {
  consumeExactConversationOperation,
  proposeExactConversationOperation,
  ConversationGrantError,
  type ConversationGrantUser,
} from "../conversationGrantStore";
import type { AgentEventInput } from "../exec/agent-run-events";
import { prepareInternalExecIntent, executePreparedGovernedCommand } from "../exec/authority/governed-command";
import { localExecutionBackend } from "../exec/backends/local";
import type { CurrentExecutionPolicy } from "../exec/execution-authorization";
import { CommandExecutionError } from "../exec/run-command";
import type { ProcessSupervisor } from "../exec/types";
import {
  codingCheckArgv,
  resolveCodingWorkspaceRoot,
  snapshotCodingWorkspace,
  type CodingCheckKind,
  type CodingCheckResult,
} from "./coding-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function executableFor(check: CodingCheckKind): string {
  if (check === "node-test") return process.execPath;
  if (check === "git-diff-check") return process.platform === "win32" ? "git.exe" : "git";
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function assertIdentity(requestId: string, toolCallId: string): void {
  if (!UUID.test(requestId)) throw new ConversationGrantError(400, "Coding check requires the canonical lowercase UUID requestId.");
  if (!OPAQUE_ID.test(toolCallId)) throw new ConversationGrantError(400, "Coding check requires a bounded opaque toolCallId.");
}

export function currentCodingCheckPolicy(
  check: CodingCheckKind,
  env: NodeJS.ProcessEnv = process.env,
): CurrentExecutionPolicy {
  const configuredRoot = env.LIOS_CODING_WORKSPACE_ROOT?.trim();
  if (!configuredRoot) throw new ConversationGrantError(503, "Governed coding workspace is not configured.");
  return {
    permissionClass: "user_confirm",
    policyRevision: sha256(JSON.stringify({
      version: 1,
      capability: "coding-workspace-check",
      check,
      backend: localExecutionBackend.id,
      rootSha256: sha256(configuredRoot),
      executable: executableFor(check),
      isolation: { filesystem: "host", network: "inherit", processes: "host" },
      maxWallTimeMs: 2 * 60_000,
      maxOutputChars: 200_000,
    })),
  };
}

export interface ProposeCodingCheckOperationInput {
  user: ConversationGrantUser;
  projectId: number;
  chatId: number;
  requestId: string;
  toolCallId: string;
  workspaceSha256: string;
  check: CodingCheckKind;
  targets: readonly string[];
  recordPreparedEvidence: (
    event: Extract<AgentEventInput, { kind: "tool_call_execution_prepared" }>,
  ) => Promise<unknown>;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

/**
 * Builds the exact fixed coding-check process before L4 review. No command,
 * cwd, backend or limits are supplied by the client/model beyond the closed
 * check enum and bounded node-test target list.
 */
export async function proposeCodingCheckOperation(input: ProposeCodingCheckOperationInput) {
  assertIdentity(input.requestId, input.toolCallId);
  const env = input.env ?? process.env;
  const snapshot = await snapshotCodingWorkspace(env);
  if (snapshot.workspaceSha256 !== input.workspaceSha256) {
    throw new ConversationGrantError(409, "Coding workspace changed before check approval.");
  }
  // Validate the closed argv shape before preparing the intent.
  codingCheckArgv(input.check, input.targets);
  const root = await resolveCodingWorkspaceRoot(env);
  const prepared = await prepareInternalExecIntent({
    backend: localExecutionBackend,
    intent: {
      intentId: "coding.workspace.check",
      executable: executableFor(input.check),
      check: input.check,
      targets: [...input.targets],
    },
    cwd: root,
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
    signal: input.signal,
    scopeKey: `conversation:${input.requestId}`,
  });
  const policy = currentCodingCheckPolicy(input.check, env);
  await input.recordPreparedEvidence({
    kind: "tool_call_execution_prepared",
    toolCallId: input.toolCallId,
    operationDigest: prepared.operation.digest,
    approvalDigest: prepared.approvalDigest,
    policyRevision: policy.policyRevision,
    backendId: prepared.facts.backendId,
    backendGenerationId: prepared.facts.runtimeGenerationId ?? null,
  });
  return proposeExactConversationOperation({
    user: input.user,
    projectId: input.projectId,
    chatId: input.chatId,
    requestId: input.requestId,
    toolCallId: input.toolCallId,
    prepared,
    policy,
  });
}

export interface ApprovedCodingCheckOperation {
  prepared: Awaited<ReturnType<typeof consumeExactConversationOperation>>["prepared"];
  approvedOperationDigest: string;
  approvedDigest: string;
  lease: Awaited<ReturnType<typeof consumeExactConversationOperation>>["lease"];
  currentPolicy: () => CurrentExecutionPolicy;
  check: CodingCheckKind;
  targets: string[];
  workspaceSha256: string;
  env: NodeJS.ProcessEnv;
}

export async function consumeApprovedCodingCheckOperation(input: {
  user: ConversationGrantUser;
  projectId: number;
  chatId: number;
  requestId: string;
  toolCallId: string;
  workspaceSha256: string;
  check: CodingCheckKind;
  targets: readonly string[];
  env?: NodeJS.ProcessEnv;
}): Promise<ApprovedCodingCheckOperation> {
  assertIdentity(input.requestId, input.toolCallId);
  const env = input.env ?? process.env;
  const snapshot = await snapshotCodingWorkspace(env);
  if (snapshot.workspaceSha256 !== input.workspaceSha256) {
    throw new ConversationGrantError(409, "Coding workspace changed after approval; re-inspect before running checks.");
  }
  const approved = await consumeExactConversationOperation({
    user: input.user,
    projectId: input.projectId,
    chatId: input.chatId,
    requestId: input.requestId,
    toolCallId: input.toolCallId,
  });
  if (approved.prepared.facts.intent?.intentId !== "coding.workspace.check") {
    approved.lease.close();
    throw new ConversationGrantError(409, "Approved exact operation is not a coding workspace check.");
  }
  const nowPolicy = currentCodingCheckPolicy(input.check, env);
  if (
    approved.policy.permissionClass !== nowPolicy.permissionClass ||
    approved.policy.policyRevision !== nowPolicy.policyRevision
  ) {
    approved.lease.close();
    throw new ConversationGrantError(409, "Governed coding check policy changed after approval.");
  }
  return {
    prepared: approved.prepared,
    approvedOperationDigest: approved.approvedOperationDigest,
    approvedDigest: approved.approvedDigest,
    lease: approved.lease,
    currentPolicy: () => currentCodingCheckPolicy(input.check, env),
    check: input.check,
    targets: [...input.targets],
    workspaceSha256: input.workspaceSha256,
    env,
  };
}

export async function executeApprovedCodingCheckOperation(
  approved: ApprovedCodingCheckOperation,
  supervisor?: ProcessSupervisor,
): Promise<CodingCheckResult> {
  const started = Date.now();
  try {
    const result = await executePreparedGovernedCommand(
      approved.prepared,
      {
        approvedOperationDigest: approved.approvedOperationDigest,
        approvedDigest: approved.approvedDigest,
        lease: approved.lease,
        currentPolicy: approved.currentPolicy,
      },
      supervisor,
    );
    const after = await snapshotCodingWorkspace(approved.env);
    const combined = `${result.stdout}\n${result.stderr}`;
    return {
      check: approved.check,
      targets: approved.targets,
      commandDigest: approved.prepared.operation.digest,
      outcome: "passed",
      durationMs: result.wallDurationMs,
      stdout: result.stdout.slice(-50_000),
      stderr: result.stderr.slice(-50_000),
      outputSha256: sha256(combined),
      workspaceSha256After: after.workspaceSha256,
    };
  } catch (error) {
    if (!(error instanceof CommandExecutionError)) throw error;
    const result = error.result;
    const after = await snapshotCodingWorkspace(approved.env);
    const combined = `${result.stdout}\n${result.stderr}`;
    return {
      check: approved.check,
      targets: approved.targets,
      commandDigest: approved.prepared.operation.digest,
      outcome: "failed",
      durationMs: Math.max(1, Date.now() - started),
      stdout: result.stdout.slice(-50_000),
      stderr: result.stderr.slice(-50_000),
      outputSha256: sha256(combined),
      workspaceSha256After: after.workspaceSha256,
    };
  }
}
