import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import type { RuntimeExecutionReceipt } from "@shared/runtimeContracts";

export interface AgentReceiptActivity {
  requestId: string | null;
  receipts: RuntimeExecutionReceipt[];
  completed: number;
  failed: number;
  cancelled: number;
  mismatched: number;
  /** A status/tool event is progress reporting, NOT an execution receipt. */
  observedSteps: number;
  lastStepLabel: string | null;
  hasReceiptProblems: boolean;
}

/** Client-only projection of P2 event-stream evidence. This NEVER creates an
 * execution record or an approval; it only describes existing receipt events.
 * Event IDs, receipt IDs and the receipt's request ID must all match the
 * current run to avoid exposing another Chat's execution state. */
export function inspectAgentReceiptActivity(
  events: readonly ConversationRuntimeEvent[],
  activeRequestId: string | null,
): AgentReceiptActivity {
  const requestId = activeRequestId ?? events.at(-1)?.requestId ?? null;
  const receipts: RuntimeExecutionReceipt[] = [];
  const seen = new Set<string>();
  const observed = new Set<string>();
  let mismatched = 0;
  let lastStepLabel: string | null = null;
  for (const event of events) {
    if (!requestId || event.requestId !== requestId) continue;
    if (event.type === "tool_start" || event.type === "tool_result") {
      if (event.stepId) observed.add(event.stepId);
      lastStepLabel = event.label;
    } else if (event.type === "status" && event.stepId) {
      observed.add(event.stepId);
      // Do not surface arbitrary status.message as a trusted action outcome.
    } else if (event.type === "receipt") {
      const receipt = event.receipt;
      if (receipt.requestId !== requestId || seen.has(receipt.id)) {
        if (receipt.requestId !== requestId) mismatched++;
        continue;
      }
      seen.add(receipt.id);
      receipts.push(receipt);
    }
  }
  const completed = receipts.filter(item => item.status === "completed").length;
  const failed = receipts.filter(item => item.status === "failed").length;
  const cancelled = receipts.filter(item => item.status === "cancelled").length;
  return {
    requestId, receipts, completed, failed, cancelled, mismatched,
    observedSteps: observed.size, lastStepLabel,
    hasReceiptProblems: failed > 0 || cancelled > 0 || mismatched > 0,
  };
}

/** Receipt labels are descriptive, not permissions. Avoid exposing the raw
 * input/outputEvidence payload, source URIs, tokens or other sensitive state. */
export function receiptPresentation(receipt: RuntimeExecutionReceipt) {
  return {
    operation: receipt.operation.replaceAll("_", " "),
    component: receipt.componentId.replaceAll("_", " "),
    status: receipt.status,
    kind: receipt.aiDerived ? "AI-derived" : receipt.deterministic ? "Deterministic" : "Unclassified",
    sourceCount: receipt.sourceRefs.length,
    hasInputHash: receipt.inputHash !== null,
    hasOutputHash: receipt.outputHash !== null,
    warnings: receipt.warnings.length,
  };
}
