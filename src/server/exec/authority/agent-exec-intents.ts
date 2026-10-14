import type { ExecutionBackend, ExecutionIsolationRequirements } from "../backends/types";
import { requireStrictSandboxRuntime } from "../sandbox-runtime-profile";
import {
  prepareInternalExecIntent,
  type PreparedGovernedCommand,
} from "./governed-command";
import {
  buildInternalExecIntent,
  type InternalExecIntentDescriptor,
  type InternalExecIntentRequest,
} from "./exec-intents";

export type AgentExecIntentInput =
  | { kind: "python"; code: string }
  | { kind: "shell"; command: string };

export interface ResolvedAgentExecIntent {
  backend: ExecutionBackend;
  isolation: Readonly<ExecutionIsolationRequirements>;
  request: Readonly<InternalExecIntentRequest>;
  intent: InternalExecIntentDescriptor;
}

const STRICT_AGENT_ISOLATION: Readonly<ExecutionIsolationRequirements> = Object.freeze({
  filesystem: "sandbox",
  network: "deny",
  processes: "sandbox",
});

function requestFor(
  input: AgentExecIntentInput,
  tools: { python: string | null; shell: string | null },
): InternalExecIntentRequest {
  if (input.kind === "python") {
    if (!tools.python) throw new Error("Strict sandbox Python executable is unavailable.");
    return Object.freeze({
      intentId: "agent.python.data" as const,
      executable: tools.python,
      code: input.code,
    });
  }
  if (!tools.shell) throw new Error("Strict sandbox shell executable is unavailable.");
  return Object.freeze({
    intentId: "agent.shell.command" as const,
    executable: tools.shell,
    command: input.command,
  });
}

/**
 * Resolve an agent code/shell request onto the existing SI-01 strict sandbox profile.
 *
 * This function deliberately stops before approval and launch. L1/L4 remain the
 * permission/approval owners and governed-command remains the only launch authority.
 * If the strict runtime is not configured, this fails closed instead of selecting a
 * host executable.
 */
export function resolveStrictAgentExecIntent(
  input: AgentExecIntentInput,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAgentExecIntent {
  const profile = requireStrictSandboxRuntime(env);
  const request = requestFor(input, profile.tools);
  return Object.freeze({
    backend: profile.backend,
    isolation: STRICT_AGENT_ISOLATION,
    request,
    intent: buildInternalExecIntent(request),
  });
}

/**
 * Bind an L9 request to the existing GM-11 backend + exact-operation preparation
 * path. The backend can only come from the canonical strict sandbox profile.
 *
 * This produces approval material only. It does not mint an approval lease and
 * cannot launch a process.
 */
export async function prepareStrictAgentExecIntent(input: {
  requestId: string;
  execution: AgentExecIntentInput;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}): Promise<PreparedGovernedCommand> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.requestId)) {
    throw new Error("Agent execution preparation requires the canonical lowercase UUID requestId.");
  }
  if (input.signal?.aborted) throw new Error("Agent execution preparation was cancelled.");
  const resolved = resolveStrictAgentExecIntent(input.execution, input.env ?? process.env);
  // Always user_confirm: the prepared command outlives this run's scope while waiting for review, and the resumed run
  // supplies its own cancellation signal at launch.
  return prepareInternalExecIntent({
    backend: resolved.backend,
    intent: resolved.request as InternalExecIntentRequest,
    isolation: { ...resolved.isolation },
    scopeKey: `conversation:${input.requestId}`,
    retainAcrossApproval: true,
  });
}
