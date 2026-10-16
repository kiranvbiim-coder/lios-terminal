import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { projectChatMessages } from "@shared/schema";
import { getDb } from "./db";
import { resolveProjectConversationAttachments } from "./projectAttachmentService";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import type { ConversationRequest } from "@shared/conversationRuntime";
import { artifactContentSchema, artifactRefreshSpecSchema } from "@shared/artifactContracts";
import { p6PersonalFinanceRequestSchema } from "@shared/p6FinanceContracts";
import { listProjectResources } from "./projectResourceStore";
import type { P9WorkflowAction } from "@shared/p9AutomationContracts";
import type { TenantContext } from "./tenantContext";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { getConversationExecutionJournal } from "./exec/execution-scope";
import { getConversationRequestLedgerEvent, getLedgerEventByReceiptId, hashLedgerValue, sanitizeLedgerPayload } from "./ledgerStore";


/** Save/replay only the successful request whose canonical owner-scoped journal and Ledger agree. */
export async function requireSuccessfulP9Recipe(
  ctx: TenantContext,
  projectId: number,
  action: Extract<P9WorkflowAction, { kind: "conversation_rerun" }>,
): Promise<Omit<ConversationRequest, "requestId" | "continuationOf">> {
  if (!action.sourceRequestId) throw new Error("Saving a successful recipe requires its exact source run.");
  const journal = await getConversationExecutionJournal();
  const source = await journal.read(action.sourceRequestId, { userId: ctx.userId, projectId, chatId: action.chatId });
  if (!source || source.status !== "completed") throw new Error("Only a completed owner-scoped conversation can become a saved recipe.");
  const recorded = await getConversationRequestLedgerEvent(ctx, projectId, action.chatId, action.sourceRequestId);
  const request = conversationRequestSchema.parse({ ...action.request, requestId: action.sourceRequestId, continuationOf: null });
  const payload = recorded.payload;
  const resolvedMode = payload.executionMode;
  const safeMode = request.executionMode === resolvedMode
    || (request.executionMode === "ai_assisted" && resolvedMode === "deterministic_first");
  if (!safeMode || payload.messageHash !== hashLedgerValue(request.message)
    || payload.sourceScope !== request.sourceScope
    || hashLedgerValue(payload.context ?? {}) !== hashLedgerValue(request.context ?? {})
    || payload.transmissionPolicyHash !== hashLedgerValue(request.transmissionPolicy)
    || hashLedgerValue(payload.approvals ?? []) !== hashLedgerValue(request.approvals)) {
    throw new Error("Saved recipe inputs, source scope or authority differ from the completed conversation.");
  }
  if (request.attachments.length) {
    const messages = await getDb().select({ metadata: projectChatMessages.metadata }).from(projectChatMessages).where(and(
      eq(projectChatMessages.chatId, action.chatId),
      eq(projectChatMessages.role, "user"),
      sql`${projectChatMessages.metadata}->>'runtimeRequestId' = ${action.sourceRequestId}`,
    )).limit(2);
    const recordedAttachments = messages.length === 1 ? messages[0].metadata.attachments : null;
    const references = request.attachments.map(({ textPreview: _preview, ...reference }) => reference);
    if (!Array.isArray(recordedAttachments) || hashLedgerValue(references) !== hashLedgerValue(recordedAttachments)) {
      throw new Error("Recipe attachment identities differ from the completed conversation.");
    }
    const resources = await listProjectResources(ctx, projectId);
    const resolved = await resolveProjectConversationAttachments(ctx, projectId, resources, request.attachments, false);
    request.attachments = resolved.map(attachment => attachment.reference);
  }
  const { requestId: _requestId, continuationOf: _continuationOf, ...recipe } = conversationRequestSchema.parse({
    ...request, executionMode: resolvedMode,
  });
  return recipe;
}
/** A monitor is an explicit acceptance of this retained version, not a financial Decision/execution approval. */
export async function requireAcceptedP9Workflow(
  ctx: TenantContext,
  projectId: number,
  action: Extract<P9WorkflowAction, { kind: "conversation_rerun" }>,
): Promise<void> {
  const binding = action.acceptedArtifact;
  if (!binding) throw new Error("A retained financial Artifact version must be explicitly accepted before creating this monitor.");
  const artifact = await getArtifact(ctx, binding.artifactId);
  if (artifact.projectId !== projectId || artifact.status !== "active") throw new Error("Accepted monitor Artifact is not active in this Project.");
  if (artifact.headVersion !== binding.version) throw new Error("Accepted monitor Artifact head changed; inspect and accept its current version.");
  const version = await getArtifactVersion(ctx, artifact.id, binding.version);
  if (version.contentHash !== binding.contentHash || hashLedgerValue(version.content) !== binding.contentHash) throw new Error("Accepted monitor Artifact content hash changed.");
  const content = artifactContentSchema.parse(version.content);
  if (!["valuation", "portfolio", "research", "decision", "thesis", "report"].includes(content.kind)) throw new Error("This Artifact is not a retained financial/research work product.");
  const spec = version.refreshSpec ? artifactRefreshSpecSchema.parse(version.refreshSpec) : null;
  if (!spec || spec.kind !== "conversation" || !spec.message || !version.executionReceiptIds.length) throw new Error("This Artifact has no completed conversation recipe and execution receipt to monitor.");
  const request = conversationRequestSchema.parse({ ...action.request, requestId: randomUUID(), continuationOf: null });
  if (request.attachments.length) {
    await requireSuccessfulP9Recipe(ctx, projectId, action);
  }
  if (request.message !== spec.message || request.sourceScope !== spec.sourceScope || request.executionMode !== spec.executionMode) throw new Error("Monitor request differs from the accepted Artifact's recorded recipe.");
  if (action.currentPersonalFinanceResourceId) {
    if (request.executionMode !== "deterministic_first" || !spec.capabilityIds.includes("personal_finance.snapshot") || !request.context?.personalFinance) {
      throw new Error("Current personal-finance inputs require an accepted deterministic personal-finance workflow.");
    }
    const resources = await listProjectResources(ctx, projectId);
    const resource = resources.find(item => item.id === action.currentPersonalFinanceResourceId && item.kind === "personal_finance_profile");
    if (!resource) throw new Error("The explicitly selected personal-finance source is unavailable in this Project.");
    p6PersonalFinanceRequestSchema.parse(resource.metadata.profile);
  }
  const context = request.context ?? {};
  if (hashLedgerValue(context) !== hashLedgerValue(sanitizeLedgerPayload(context))) throw new Error("Monitor context contains redacted fields that cannot be accepted as replay authority.");
  for (const receiptId of version.executionReceiptIds) {
    const receipt = await getLedgerEventByReceiptId(ctx, receiptId);
    if (!receipt.requestId || receipt.projectId !== projectId || receipt.chatId !== action.chatId) throw new Error("Accepted Artifact receipt belongs to another Project or Chat.");
    const recorded = await getConversationRequestLedgerEvent(ctx, projectId, action.chatId, receipt.requestId);
    const payload = recorded.payload;
    if (payload.messageHash !== hashLedgerValue(request.message)
      || payload.executionMode !== request.executionMode || payload.sourceScope !== request.sourceScope
      || hashLedgerValue(payload.context ?? {}) !== hashLedgerValue(context)
      || payload.transmissionPolicyHash !== hashLedgerValue(request.transmissionPolicy)
      || hashLedgerValue(payload.approvals ?? []) !== hashLedgerValue(request.approvals)) {
      throw new Error("Monitor inputs, authority or transmission policy differ from the accepted successful workflow.");
    }
    const journal = await getConversationExecutionJournal();
    const run = await journal.read(receipt.requestId, { userId: ctx.userId, projectId, chatId: action.chatId });
    if (!run || run.status !== "completed") throw new Error("Accepted workflow has no completed canonical execution record.");
  }
}
