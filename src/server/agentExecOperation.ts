import crypto from "node:crypto";
import type { RuntimePermissionClass } from "@shared/runtimeContracts";
import {
  ConversationGrantError,
  consumeExactConversationOperation,
  proposeExactConversationOperation,
  type ConversationGrantUser,
} from "./conversationGrantStore";
import type { CurrentExecutionPolicy } from "./exec/execution-authorization";
import { executePreparedGovernedCommand } from "./exec/authority/governed-command";
import type { ProcessSupervisor } from "./exec/types";
import type { AgentEventInput } from "./exec/agent-run-events";
import { requireStrictSandboxRuntime } from "./exec/sandbox-runtime-profile";
import { buildInternalExecIntent } from "./exec/authority/exec-intents";
import {
  prepareStrictAgentExecIntent,
  type AgentExecIntentInput,
} from "./exec/authority/agent-exec-intents";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PERMISSION_CLASS: RuntimePermissionClass = "user_confirm";

export type AgentExecKind = AgentExecIntentInput["kind"];

function assertRequestId(value: string): string {
  if (!UUID.test(value)) {
    throw new ConversationGrantError(400, "Agent execution requires the canonical lowercase UUID requestId.");
  }
  return value;
}

function assertToolCallId(value: string): string {
  if (!OPAQUE_ID.test(value)) {
    throw new ConversationGrantError(400, "Agent execution requires a bounded opaque toolCallId.");
  }
  return value;
}

function policyInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim();
  return raw ? Number(raw) : fallback;
}

function staticIntentFacts(kind: AgentExecKind, env: NodeJS.ProcessEnv) {
  const profile = requireStrictSandboxRuntime(env);
  if (kind === "python") {
    if (!profile.tools.python) throw new ConversationGrantError(503, "Strict sandbox Python is unavailable.");
    return {
      profile,
      intent: buildInternalExecIntent({
        intentId: "agent.python.data",
        executable: profile.tools.python,
        code: "pass",
      }),
    };
  }
  if (!profile.tools.shell) throw new ConversationGrantError(503, "Strict sandbox shell is unavailable.");
  return {
    profile,
    intent: buildInternalExecIntent({
      intentId: "agent.shell.command",
      executable: profile.tools.shell,
      command: ":",
    }),
  };
}

/**
 * Server deployment policy for L9. It deliberately excludes model/user code:
 * exact code/command identity belongs to the prepared operation digest.
 */
export function currentAgentExecPolicy(
  kind: AgentExecKind,
  env: NodeJS.ProcessEnv = process.env,
): CurrentExecutionPolicy {
  const { profile, intent } = staticIntentFacts(kind, env);
  const policyRevision = crypto.createHash("sha256").update(JSON.stringify({
    version: 1,
    capability: "agent-exec",
    kind,
    permissionClass: PERMISSION_CLASS,
    engine: profile.engine,
    engineTarget: profile.engineTarget,
    image: profile.image,
    user: profile.user,
    executable: kind === "python" ? profile.tools.python : profile.tools.shell,
    isolation: { filesystem: "sandbox", network: "deny", processes: "sandbox" },
    intent: {
      intentId: intent.intentId,
      envProfile: intent.envProfile,
      environmentKeys: intent.environmentKeys,
      timeoutMs: intent.timeoutMs,
      maxOutputChars: intent.maxOutputChars,
      stdinMode: intent.stdinMode ?? null,
    },
    backendLimits: {
      maxMemoryBytes: policyInteger(env, "LIOS_EXECUTION_SANDBOX_MAX_MEMORY_BYTES", 2 * 1024 * 1024 * 1024),
      maxProcesses: policyInteger(env, "LIOS_EXECUTION_SANDBOX_MAX_PROCESSES", 64),
      workspaceBytes: policyInteger(env, "LIOS_EXECUTION_SANDBOX_WORKSPACE_BYTES", 128 * 1024 * 1024),
    },
  })).digest("hex");
  return { permissionClass: "user_confirm", policyRevision };
}

function expectedIntentId(kind: AgentExecKind): "agent.python.data" | "agent.shell.command" {
  return kind === "python" ? "agent.python.data" : "agent.shell.command";
}

export interface ProposeAgentExecOperationInput {
  user: ConversationGrantUser;
  projectId: number;
  chatId: number;
  /** Same canonical agent-run id. Never a child execution request id. */
  requestId: string;
  /** Existing L2 tool-call identity; not a second session id. */
  toolCallId: string;
  execution: AgentExecIntentInput;
  /**
   * Canonical L2 append callback for this run. The proposer cannot expose
   * approval material until the exact-operation trust facts are durable.
   */
  recordPreparedEvidence: (
    event: Extract<AgentEventInput, { kind: "tool_call_execution_prepared" }>,
  ) => Promise<unknown>;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

/**
 * Prepare and register one exact operation for the currently open agent call.
 *
 * This does not launch anything and does not create another journal/session id.
 * The exact-operation authority is still GM-11a and is keyed by the canonical
 * conversation requestId. L2 owns the nested toolCallId and must durably accept
 * the prepared trust evidence before the human-review proposal is registered.
 */
export async function proposeAgentExecOperation(input: ProposeAgentExecOperationInput) {
  const requestId = assertRequestId(input.requestId);
  const toolCallId = assertToolCallId(input.toolCallId);
  const env = input.env ?? process.env;
  const prepared = await prepareStrictAgentExecIntent({
    requestId,
    execution: input.execution,
    signal: input.signal,
    env,
  });
  const intentId = prepared.facts.intent?.intentId;
  if (intentId !== expectedIntentId(input.execution.kind)) {
    throw new ConversationGrantError(503, "Prepared agent execution intent does not match the requested governed tool.");
  }
  const policy = currentAgentExecPolicy(input.execution.kind, env);

  // L2 is the sole durable run ledger. Record only secret-safe prepared trust
  // facts before any review proposal can be exposed. A failed append stops here:
  // no exact-operation approval state exists and no side effect can launch.
  await input.recordPreparedEvidence({
    kind: "tool_call_execution_prepared",
    toolCallId,
    operationDigest: prepared.operation.digest,
    approvalDigest: prepared.approvalDigest,
    policyRevision: policy.policyRevision,
    backendId: prepared.facts.backendId,
    backendGenerationId: prepared.facts.runtimeGenerationId ?? null,
  });

  const proposal = await proposeExactConversationOperation({
    user: input.user,
    projectId: input.projectId,
    chatId: input.chatId,
    requestId,
    toolCallId,
    prepared,
    policy,
  });
  return Object.freeze({
    ...proposal,
    toolCallId,
    intentId,
    isolation: prepared.facts.isolation,
    resources: prepared.facts.resources,
  });
}

export interface ApprovedAgentExecOperation {
  requestId: string;
  kind: AgentExecKind;
  prepared: Awaited<ReturnType<typeof consumeExactConversationOperation>>["prepared"];
  approvedOperationDigest: string;
  approvedDigest: string;
  lease: Awaited<ReturnType<typeof consumeExactConversationOperation>>["lease"];
  currentPolicy: () => CurrentExecutionPolicy;
}

/**
 * Consume an explicitly approved exact operation and revalidate current strict
 * runtime policy. Still no launch: L2 must first own a nested GM-11 trust
 * receipt/reference inside the existing agent-run journal record.
 */
export async function consumeApprovedAgentExecOperation(input: {
  user: ConversationGrantUser;
  projectId: number;
  chatId: number;
  requestId: string;
  toolCallId: string;
  kind: AgentExecKind;
  env?: NodeJS.ProcessEnv;
}): Promise<ApprovedAgentExecOperation> {
  const requestId = assertRequestId(input.requestId);
  const toolCallId = assertToolCallId(input.toolCallId);
  const env = input.env ?? process.env;
  const approved = await consumeExactConversationOperation({
    user: input.user,
    projectId: input.projectId,
    chatId: input.chatId,
    requestId,
    toolCallId,
  });
  if (approved.prepared.facts.intent?.intentId !== expectedIntentId(input.kind)) {
    approved.lease.close();
    throw new ConversationGrantError(409, "The approved exact operation is not the expected agent execution intent.");
  }

  const currentPolicy = () => currentAgentExecPolicy(input.kind, env);
  const nowPolicy = currentPolicy();
  if (
    approved.policy.permissionClass !== nowPolicy.permissionClass ||
    approved.policy.policyRevision !== nowPolicy.policyRevision
  ) {
    approved.lease.close();
    throw new ConversationGrantError(409, "The governed agent execution policy changed after approval.");
  }

  return Object.freeze({
    requestId,
    kind: input.kind,
    prepared: approved.prepared,
    approvedOperationDigest: approved.approvedOperationDigest,
    approvedDigest: approved.approvedDigest,
    lease: approved.lease,
    currentPolicy,
  });
}


/**
 * Launch exactly the operation consumed from GM-11a after the L2 approval
 * release. This function cannot prepare, review or mint authority; replay is
 * fenced because consumeApprovedAgentExecOperation removes the pending exact
 * operation before this object can exist.
 */
export async function executeApprovedAgentExecOperation(
  approved: ApprovedAgentExecOperation,
  supervisor?: ProcessSupervisor,
  options?: { signal?: AbortSignal },
) {
  if (approved.prepared.facts.intent?.intentId !== expectedIntentId(approved.kind)) {
    approved.lease.close();
    throw new ConversationGrantError(409, "The approved agent execution intent changed before launch.");
  }
  return executePreparedGovernedCommand(
    approved.prepared,
    {
      approvedOperationDigest: approved.approvedOperationDigest,
      approvedDigest: approved.approvedDigest,
      lease: approved.lease,
      currentPolicy: approved.currentPolicy,
    },
    supervisor,
    options,
  );
}
