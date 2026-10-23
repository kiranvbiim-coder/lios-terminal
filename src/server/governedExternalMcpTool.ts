import { z } from "zod";
import type { SourceConnection } from "@shared/schema";
import {
  callExternalMcpTool,
  externalMcpConfigForSourceConnection,
  type ExternalMcpServerConfig,
} from "./externalMcpClient";
import { listSourceConnections } from "./sourceConnectionService";
import { captureMcpAgentEvidence, type McpAgentEvidenceCapture } from "./mcpAgentEvidence";

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
 * Non-effecting live source-policy admission. This checks locally persisted
 * authority, never contacts the MCP server, never creates a durable L5 intent,
 * and does NOT consume or replace the canonical owner approval. Run it inside
 * the registry's beforeExternalDispatch hook (after grant consumption).
 *
 * Re-run it again when the transport is entered. A revocation race *after*
 * the durable intent is still outcome-unknown unless transport can prove
 * that no remote effect occurred; never misclassify that race as no effect.
 */
async function resolveGovernedExternalMcpDispatch(
  rawInput: unknown,
  context: GovernedExternalMcpContext,
  signal: AbortSignal,
  dependencies: GovernedExternalMcpDependencies,
): Promise<{ input: GovernedExternalMcpInput; connection: SourceConnection; config: ExternalMcpServerConfig }> {
  const input = governedExternalMcpInputSchema.parse(rawInput);
  assertNotCancelled(signal);
  const connection = (await dependencies.listConnections(context.userId))
    .find((candidate) => candidate.id === input.connectionId);
  if (
    !connection
    || connection.userId !== context.userId
    || connection.sourceType !== "mcp"
    || connection.organizationId !== context.organizationId
  ) throw new Error("External MCP connection is unavailable in this tenant.");
  if (connection.status === "invalid") {
    throw new Error("External MCP connection is invalid or no longer authorized.");
  }
  const config = dependencies.configForConnection(connection);
  if (config.policy.projectId !== context.projectId) {
    throw new Error("External MCP connection is unavailable in this Project.");
  }
  // Source policy has to be admitted *before* a durable dispatch intent.
  // Do not rely solely on the later SDK/transport deny for wrong tool ids.
  if (!config.policy.allowedToolIds.includes(input.toolId)) {
    throw new Error("External MCP tool is outside Project policy.");
  }
  assertNotCancelled(signal);
  return { input, connection, config };
}

/**
 * Call only after the canonical L4 approval is consumed by GovernedToolRegistry.
 * On refusal, the tool hasn't started and there is no external effect to
 * reconcile or mark committed. The actual invoke revalidates separately.
 */
export async function preflightGovernedExternalMcpTool(
  rawInput: unknown,
  context: GovernedExternalMcpContext,
  signal: AbortSignal,
  dependencies: GovernedExternalMcpDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  await resolveGovernedExternalMcpDispatch(rawInput, context, signal, dependencies);
}

/** L10 authenticated Project-owned source dispatch through the governed SDK. */
export async function invokeGovernedExternalMcpTool(
  rawInput: unknown,
  context: GovernedExternalMcpContext,
  signal: AbortSignal,
  dependencies: GovernedExternalMcpDependencies = DEFAULT_DEPENDENCIES,
  onEvidence?: (capture: McpAgentEvidenceCapture) => void,
): Promise<GovernedExternalMcpResult> {
  const { input, connection, config } = await resolveGovernedExternalMcpDispatch(
    rawInput, context, signal, dependencies,
  );
  // Any unknown transport exception after L5 intent remains outcome-unknown.
  const output = await dependencies.callTool(config, input.toolId, input.arguments, signal);
  assertNotCancelled(signal);
  if (onEvidence) {
    const capture = captureMcpAgentEvidence(connection, context.projectId, input.toolId, output);
    if (capture) onEvidence(capture);
  }

  return {
    output,
    summary: `External MCP tool ${input.toolId} completed through the governed Project connection.`,
    deterministic: false,
    sourceRefs: [`mcp-server:${config.policy.serverId}`, `mcp-tool:${input.toolId}`],
  };
}
