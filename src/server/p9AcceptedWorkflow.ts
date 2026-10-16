import { randomUUID } from "node:crypto";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import { artifactContentSchema, artifactRefreshSpecSchema } from "@shared/artifactContracts";
import { p6PersonalFinanceRequestSchema } from "@shared/p6FinanceContracts";
import { listProjectResources } from "./projectResourceStore";
import type { P9WorkflowAction } from "@shared/p9AutomationContracts";
import type { TenantContext } from "./tenantContext";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { getConversationExecutionJournal } from "./exec/execution-scope";
import { getConversationRequestLedgerEvent, getLedgerEventByReceiptId, hashLedgerValue, sanitizeLedgerPayload } from "./ledgerStore";

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
  if (request.attachments.length) throw new Error("Attachment-based monitor replay requires recorded attachment custody; save a source-linked financial workflow first.");
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
