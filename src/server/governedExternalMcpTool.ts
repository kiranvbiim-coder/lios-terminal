import { z } from "zod";
import type { SourceConnection } from "@shared/schema";
import {
  callExternalMcpTool,
  externalMcpConfigForSourceConnection,
  type ExternalMcpServerConfig,
} from "./externalMcpClient";
import { listSourceConnections } from "./sourceConnectionService";

const MAX_ARGUMENT_BYTES = 64 * 1024;

export const governedExternalMcpInputSchema = z.object({
  connectionId: z.number().int().positive(),
  toolId: z.string().trim().min(1).max(200).refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "MCP tool id must not contain control characters.",
  ),
  arguments: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, ctx) => {
  let encoded: string;
  try {
    encoded = JSON.stringify(value.arguments);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["arguments"], message: "MCP arguments must be JSON serializable." });
    return;
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_ARGUMENT_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["arguments"], message: "MCP arguments exceed the governed input bound." });
  }
});

export type GovernedExternalMcpInput = z.infer<typeof governedExternalMcpInputSchema>;

export interface GovernedExternalMcpContext {
  userId: number;
  organizationId: number | null;
  projectId: number;
}

export interface GovernedExternalMcpResult {
  output: unknown;
  summary: string;
  deterministic: boolean;
  sourceRefs: string[];
}

interface GovernedExternalMcpDependencies {
  listConnections: (userId: number) => Promise<SourceConnection[]>;
  configForConnection: (
    connection: Pick<SourceConnection, "id" | "sourceType" | "config" | "credentialRef">,
  ) => ExternalMcpServerConfig;
  callTool: (
    config: ExternalMcpServerConfig,
    toolId: string,
    argumentsValue: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

const DEFAULT_DEPENDENCIES: GovernedExternalMcpDependencies = {
  listConnections: listSourceConnections,
  configForConnection: externalMcpConfigForSourceConnection,
  callTool: (config, toolId, argumentsValue, signal) =>
    callExternalMcpTool(config, toolId, argumentsValue, undefined, signal),
};

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Conversation execution cancelled.", "AbortError");
}

/**
 * L10 external MCP activation. Permission/approval/idempotency are owned by
 * GovernedToolRegistry and the agent run ledger. This adapter only resolves
 * the authenticated Project-owned source connection and performs the bounded
 * MCP transport call.
 */
export async function invokeGovernedExternalMcpTool(
  rawInput: unknown,
  context: GovernedExternalMcpContext,
  signal: AbortSignal,
  dependencies: GovernedExternalMcpDependencies = DEFAULT_DEPENDENCIES,
): Promise<GovernedExternalMcpResult> {
  const input = governedExternalMcpInputSchema.parse(rawInput);
  assertNotCancelled(signal);

  const connection = (await dependencies.listConnections(context.userId))
    .find((candidate) => candidate.id === input.connectionId);
  if (
    !connection
    || connection.userId !== context.userId
    || connection.sourceType !== "mcp"
    || connection.organizationId !== context.organizationId
  ) {
    throw new Error("External MCP connection is unavailable in this tenant.");
  }
  // The recorded source may have become invalid after the model planned or
  // the owner granted a one-time tool call. Read the current record again at
  // dispatch instead of trusting a stale capability or approval snapshot.
  // Degraded/unreachable are connection-health states, not an authorization
  // bypass; the guarded transport reports their actual failure.
  if (connection.status === "invalid") {
    throw new Error("External MCP connection is invalid or no longer authorized.");
  }

  const config = dependencies.configForConnection(connection);
  if (config.policy.projectId !== context.projectId) {
    throw new Error("External MCP connection is unavailable in this Project.");
  }

  assertNotCancelled(signal);
  const output = await dependencies.callTool(config, input.toolId, input.arguments, signal);
  assertNotCancelled(signal);

  return {
    output,
    summary: `External MCP tool ${input.toolId} completed through the governed Project connection.`,
    deterministic: false,
    sourceRefs: [`mcp-server:${config.policy.serverId}`, `mcp-tool:${input.toolId}`],
  };
}
