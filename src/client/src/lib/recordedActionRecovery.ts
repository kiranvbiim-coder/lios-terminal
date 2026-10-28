import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

export interface RecordedActionRecovery {
  failedToolReports: number;
  deniedToolReports: number;
  skippedToolReports: number;
  unconfirmedToolReports: number;
  unfinishedToolStarts: number;
  failedReceipts: number;
  cancelledReceipts: number;
  ignoredForeignReceipts: number;
  /** This is an evidence warning, not a determination of an external effect. */
  needsReconciliation: boolean;
}

/**
 * C08: a read-only view of recorded action outcomes for ONE exact Chat run.
 * A run-level "completed" cannot override missing, denied or failed tool
 * reports. An event or nested receipt belonging to another request never
 * contributes to the current run. This projector executes no action.
 */
export function inspectRecordedActionRecovery(
  events: readonly ConversationRuntimeEvent[],
  requestId: string | null,
): RecordedActionRecovery {
  const empty: RecordedActionRecovery = {
    failedToolReports: 0,
    deniedToolReports: 0,
    skippedToolReports: 0,
    unconfirmedToolReports: 0,
    unfinishedToolStarts: 0,
    failedReceipts: 0,
    cancelledReceipts: 0,
    ignoredForeignReceipts: 0,
    needsReconciliation: false,
  };
  if (!requestId) return empty;

  const latest = new Map<string, { type: "start" | "result"; outcome?: string }>();
  const receiptIds = new Set<string>();
  let failedReceipts = 0;
  let cancelledReceipts = 0;
  let ignoredForeignReceipts = 0;

  for (const event of events) {
    if (event.requestId !== requestId) continue;
    if (event.type === "tool_start" && event.stepId) {
      latest.set(event.stepId, { type: "start" });
    } else if (event.type === "tool_result" && event.stepId) {
      latest.set(event.stepId, { type: "result", outcome: event.outcome });
    } else if (event.type === "receipt") {
      const receipt = event.receipt;
      if (receipt.requestId !== requestId) {
        ignoredForeignReceipts++;
        continue;
      }
      if (receiptIds.has(receipt.id)) continue;
      receiptIds.add(receipt.id);
      if (receipt.status === "failed") failedReceipts++;
      else if (receipt.status === "cancelled") cancelledReceipts++;
    }
  }

  let failedToolReports = 0;
  let deniedToolReports = 0;
  let skippedToolReports = 0;
  let unconfirmedToolReports = 0;
  let unfinishedToolStarts = 0;
  for (const last of latest.values()) {
    if (last.type === "start") {
      unfinishedToolStarts++;
    } else if (last.outcome === "failed") {
      failedToolReports++;
    } else if (last.outcome === "denied") {
      deniedToolReports++;
    } else if (last.outcome === "skipped") {
      skippedToolReports++;
    } else if (last.outcome !== "completed") {
      // Legacy/unknown outcome is not proof of completion.
      unconfirmedToolReports++;
    }
  }

  return {
    failedToolReports,
    deniedToolReports,
    skippedToolReports,
    unconfirmedToolReports,
    unfinishedToolStarts,
    failedReceipts,
    cancelledReceipts,
    ignoredForeignReceipts,
    needsReconciliation: [
      failedToolReports, deniedToolReports, skippedToolReports,
      unconfirmedToolReports, unfinishedToolStarts, failedReceipts,
      cancelledReceipts, ignoredForeignReceipts,
    ].some(count => count > 0),
  };
}
