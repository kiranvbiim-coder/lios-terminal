import type { P9WorkflowAction } from "@shared/p9AutomationContracts";

/**
 * A saved P9 recipe is not an execution grant. Conversation approval
 * fields are retained for conversation/audit compatibility, never
 * delegated to a background scheduler or model-authored recipe.
 *
 * Gate writes and reads: historical/backup rows must fail the same way.
 * Fresh privileged operations still require the live GM-11/L4 review.
 */
export function assertP9HasNoReplayedGrant(action: P9WorkflowAction): void {
  if (action.kind !== "conversation_rerun") return;
  if (action.request.aiDirectApproved || action.request.approvals.length > 0) {
    throw new Error("Saved automation cannot reuse conversation approvals or AI-direct authorization. Start a fresh owner-reviewed run.");
  }
}
