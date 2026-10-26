import type { P9NotificationRecord } from "./useP9Automation";

export type P9NotificationHistoryFilter = "all" | "delivered" | "suppressed";

export interface P9NotificationHistoryItem {
  id: string;
  runId: string;
  workflowId: string;
  reason: P9NotificationRecord["reason"];
  relevance: number | null;
  createdAt: string;
  status: P9NotificationRecord["status"];
  inAppLabel: string;
  reasonLabel: string;
  readLabel: string;
  /** A canonical in-app record says nothing about actual OS banner delivery. */
  osLabel: "Native OS delivery unverified";
  readAt: string | null;
}

export function p9NotificationReasonLabel(reason: P9NotificationRecord["reason"]): string {
  if (reason === "failure") return "Workflow failure · review run";
  if (reason === "condition_met") return "Condition met · inspect evidence";
  if (reason === "change_detected") return "Change detected · inspect materiality";
  return "Workflow success · no material change implied";
}

/** Exact-Project, read-only display of existing P9 history. Never turn
 * suppressed records into a delivered toast, native delivery claim, or read
 * receipt; suppressed is an explicit decision by canonical P9 policy. */
export function projectNotificationHistory(
  projectId: number,
  records: readonly P9NotificationRecord[],
  filter: P9NotificationHistoryFilter,
): {
  items: P9NotificationHistoryItem[];
  delivered: number;
  suppressed: number;
  unread: number;
  read: number;
} {
  const scoped = Number.isSafeInteger(projectId) && projectId > 0
    ? records.filter(item => item.projectId === projectId)
    : [];
  const delivered = scoped.filter(item => item.status === "delivered").length;
  const suppressed = scoped.filter(item => item.status === "suppressed").length;
  const unread = scoped.filter(item => item.status === "delivered" && item.readAt == null).length;
  const read = scoped.filter(item => item.status === "delivered" && item.readAt != null).length;
  return {
    delivered, suppressed, unread, read,
    items: scoped
      .filter(item => filter === "all" || item.status === filter)
      .map(item => ({
        id: item.id, workflowId: item.workflowId, runId: item.runId,
        reason: item.reason,
        relevance: Number.isFinite(item.relevanceScore) && item.relevanceScore >= 0 && item.relevanceScore <= 1
          ? item.relevanceScore : null,
        createdAt: item.createdAt, status: item.status, readAt: item.readAt,
        reasonLabel: p9NotificationReasonLabel(item.reason),
        inAppLabel: item.status === "suppressed"
          ? "Suppressed by P9 policy · no in-app alert was delivered"
          : "Recorded as delivered in-app",
        readLabel: item.status === "suppressed" ? "Not applicable"
          : item.readAt ? "Marked read on server" : "Unread on server",
        osLabel: "Native OS delivery unverified",
      })),
  };
}