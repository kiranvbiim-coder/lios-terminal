import crypto from "node:crypto";
import type { GovernedToolDescriptor } from "./governedTools";
import { GovernedToolRegistry } from "./governedTools";

export type MCPGovernedToolDescriptor = Omit<GovernedToolDescriptor<"mcp", unknown>, "invoke">;

export interface MCPInvocationContext {
  requestId: string;
  userId: number;
  organizationId: number | null;
  role: string;
  projectId: number | null;
  /** Server-owned L5 identity when this adapter is later used for an external side effect. */
  idempotencyKey?: string;
  /** Canonical run-tree cancellation signal. Never replace it with adapter-local cancellation state. */
  signal?: AbortSignal;
}

export interface MCPToolHandler {
  descriptor: MCPGovernedToolDescriptor;
  invoke: (
    argumentsValue: Record<string, unknown>,
    context: MCPInvocationContext,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

export interface MCPAttribution {
  id: string;
  requestId: string;
  toolId: string;
  inputHash: string;
  outputHash: string;
  userId: number;
  organizationId: number | null;
  invokedAt: string;
}

export interface MCPInvocationResult {
  toolId: string;
  output: unknown;
  attribution: MCPAttribution;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function invocationSignal(context: MCPInvocationContext): AbortSignal {
  return context.signal ?? new AbortController().signal;
}

/**
 * MCP is an adapter onto the canonical L1 GovernedToolRegistry.
 *
 * The adapter owns no permission decision, approval list, schema-validation
 * path, result bound, or cancellation authority. Safe-auto tools may execute
 * through the registry. Confirm-class tools remain fail-closed until L4/L10
 * supplies the exact live GM-11a authorization on the canonical invocation.
 */
export async function invokeMCPTool(
  toolId: string,
  argumentsValue: Record<string, unknown>,
  context: MCPInvocationContext,
  handlers: MCPToolHandler[],
): Promise<MCPInvocationResult> {
  const handler = handlers.find((candidate) => candidate.descriptor.id === toolId);
  if (!handler) throw new Error("MCP governed tool handler is unavailable.");

  const tools = new GovernedToolRegistry<"mcp", unknown>();
  tools.register({
    ...handler.descriptor,
    invoke: (input, signal) => handler.invoke(input, context, signal),
  });

  const signal = invocationSignal(context);
  const output = await tools.invoke(toolId, argumentsValue, signal, {
    source: "agent",
    requestId: context.requestId,
    userId: context.userId,
    projectId: context.projectId,
    role: context.role,
    tenant: {
      userId: context.userId,
      organizationId: context.organizationId,
      role: context.role,
    },
    idempotencyKey: context.idempotencyKey,
  });

  const input = JSON.stringify({
    requestId: context.requestId,
    toolId,
    arguments: argumentsValue,
    userId: context.userId,
    organizationId: context.organizationId,
    projectId: context.projectId,
  });
  const outputText = JSON.stringify(output);
  const invokedAt = new Date().toISOString();
  return {
    toolId,
    output,
    attribution: {
      id: crypto.randomUUID(),
      requestId: context.requestId,
      toolId,
      inputHash: hash(input),
      outputHash: hash(outputText),
      userId: context.userId,
      organizationId: context.organizationId,
      invokedAt,
    },
  };
}
