import { z } from "zod";
import { terminalArtifactUpdateSchema, applyTerminalArtifactOperations } from "@shared/terminalArtifactOperations";
import { readTerminalScreenState } from "@shared/terminalArtifact";
import { artifactContentSchema } from "@shared/artifactContracts";
import { getArtifact, getArtifactVersion, createArtifactVersion } from "./artifactStore";
import { getProjectChat } from "./projectChatStore";
import { tenantContext, type TenantContext } from "./tenantContext";
import { hashLedgerValue } from "./ledgerStore";
import { assertNotAborted } from "./conversationRuntimeCore";
import type { ConversationToolDefinition } from "./conversationRuntime";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { and, eq } from "drizzle-orm";
import { portfolios } from "@shared/schema";
import { getDb } from "./db";

/** A terminal Artifact alone never supplies cross-client portfolio-selection authority. */
export function requireTerminalPortfolioOrganization(ctx: TenantContext): number {
  if (!ctx.role.startsWith("internal_") || ctx.organizationId === null) throw new Error("Portfolio selection needs an explicitly authorized organization context.");
  return ctx.organizationId;
}

export async function validateTerminalArtifactTarget(ctx: TenantContext, chatId: number, binding: { artifactId: string; version: number; contentHash: string }, signal: AbortSignal) {
  assertNotAborted(signal);
  const chat = await getProjectChat(ctx, chatId);
  const artifact = await getArtifact(ctx, binding.artifactId);
  if (artifact.ownerUserId !== ctx.userId || artifact.status !== "active" || artifact.projectId !== chat.projectId || (artifact.projectId === null && artifact.owningChatId !== chatId)) throw new Error("Select a terminal Artifact owned by this Chat or Project.");
  if (artifact.headVersion !== binding.version) throw new Error("Selected terminal Artifact changed; reload before model planning.");
  const version = await getArtifactVersion(ctx, binding.artifactId, binding.version);
  const content = artifactContentSchema.parse(version.content);
  if (version.contentHash !== binding.contentHash || hashLedgerValue(content) !== binding.contentHash || content.kind !== "screen" || !readTerminalScreenState(content.state)) throw new Error("Selected terminal Artifact revision binding is invalid.");
  assertNotAborted(signal);
  return { artifact, version };
}
export async function updateTerminalArtifact(ctx: TenantContext, chatId: number, raw: unknown, signal: AbortSignal) {
  const input = terminalArtifactUpdateSchema.parse(raw);
  assertNotAborted(signal);
  const chat = await getProjectChat(ctx, chatId);
  const artifact = await getArtifact(ctx, input.artifactId);
  if (artifact.ownerUserId !== ctx.userId || artifact.status !== "active" || artifact.projectId !== chat.projectId || (artifact.projectId === null && artifact.owningChatId !== chatId)) throw new Error("Select a terminal Artifact owned by this Chat or Project.");
  if (artifact.headVersion !== input.baseVersion) throw new Error("Terminal Artifact changed. Reload its current revision before applying an operation.");
  const version = await getArtifactVersion(ctx, artifact.id, input.baseVersion);
  const content = artifactContentSchema.parse(version.content);
  if (version.contentHash !== input.baseHash || hashLedgerValue(content) !== version.contentHash) throw new Error("Terminal Artifact base hash does not match the selected immutable revision.");
  if (content.kind !== "screen") throw new Error("This operation requires the selected interactive terminal Artifact.");
  const terminal = readTerminalScreenState(content.state);
  if (!terminal) throw new Error("This screen has no retained analytical terminal state.");
  for (const ref of [...version.sourceRefs, ...(version.dependencyRefs ?? [])]) {
    if (!ref.startsWith("entitlement-policy:")) continue;
    const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length));
    const now = new Date();
    if (!policy || policy.effectiveFrom > now || policy.effectiveTo !== null && policy.effectiveTo <= now || !policy.permittedUses.includes("display")) throw new Error("Current source rights no longer permit this terminal view.");
  }
  const nextState = applyTerminalArtifactOperations(content.view, terminal, input.operations);
  for (const operation of input.operations) if (operation.type === "portfolio.select" && operation.portfolioId !== null) {
    const organizationId = requireTerminalPortfolioOrganization(ctx);
    const [portfolio] = await getDb().select({ organizationId: portfolios.organizationId }).from(portfolios)
      .where(and(eq(portfolios.id, operation.portfolioId), eq(portfolios.organizationId, organizationId))).limit(1);
    if (!portfolio) throw new Error("Selected portfolio is not available in the authorized organization.");
    nextState.panelState["PortfolioStressPanel.orgId"] = portfolio.organizationId;
  }
  const next = { ...content, state: { ...content.state, terminal: nextState } };
  if (hashLedgerValue(next) === version.contentHash) return { status: "unchanged" as const, artifactId: artifact.id, version: version.version, contentHash: version.contentHash };
  assertNotAborted(signal);
  const saved = await createArtifactVersion(ctx, { artifactId: artifact.id, baseVersion: input.baseVersion, content: next, actorType: "conversation", note: "Applied typed terminal presentation/input operation. No market observations or numerical outputs were fabricated." });
  return { status: "applied" as const, artifactId: artifact.id, version: saved.version, contentHash: saved.contentHash };
}
const tenantSchema = z.object({ userId: z.number().int().positive(), organizationId: z.number().int().positive().nullable(), role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]) });
export const terminalArtifactTool: ConversationToolDefinition = {
  id: "lios.artifact.terminal_update", label: "Operate selected existing financial terminal Artifact",
  kind: "calculate", permissionClass: "safe_auto", access: "write", sideEffect: "internal_write", replaySafe: false,
  planningHint: "Apply typed chart/screener settings or selections to the SELECTED retained terminal screen. Supply exact artifactId,baseVersion,baseHash and operations. No financial result calculation, source snapshot creation or arbitrary state patches. Current immutable base and Chat ownership are required.",
  inputSchema: terminalArtifactUpdateSchema,
  outputSchema: z.object({ output: z.object({ status: z.enum(["applied", "unchanged"]), artifactId: z.string(), version: z.number(), contentHash: z.string() }), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }),
  maxOutputBytes: 4096, cancel: null,
  invoke: async (raw, signal, call) => {
    const parsed = terminalArtifactUpdateSchema.parse(raw);
    if (parsed.operations.some(operation => operation.type === "valuation.assumptions")) throw new Error("Material valuation assumptions require an explicit user instruction through the reviewed Chat input path, not an autonomous presentation operation.");
    const tenant = tenantSchema.parse(call.tenant);
    if (call.source !== "agent" || call.userId !== tenant.userId || !call.chatId || !call.requestId || !call.activeArtifactRefs?.includes(parsed.artifactId)) throw new Error("Terminal operations require a trusted active Chat and selected Artifact target.");
    const binding = call.terminalArtifact;
    if (call.resourceTransmissionAllowed !== true || !binding || binding.artifactId !== parsed.artifactId || binding.version !== parsed.baseVersion || binding.contentHash !== parsed.baseHash) throw new Error("Terminal operation must match the user's exact selected immutable revision and transmission policy.");
    const result = await updateTerminalArtifact(tenantContext({ id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role }), call.chatId, parsed, signal);
    return { output: result, summary: `Terminal state ${result.status} on the same Artifact at v${result.version}. No numerical calculation was claimed.`, deterministic: true, sourceRefs: [] };
  },
};
