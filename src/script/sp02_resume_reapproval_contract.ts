/**
 * Durable proof that an explicit restart-resume required a SECOND, fresh approval: the resumed call is a new call explicitly
 * linked (`resumesToolCallId`) to the cancelled call it continues, it re-paused for approval after it started, and its
 * release carries an approval reference different from the one that released the original call (no grant carry-over).
 */
export interface Sp02ResumeReapprovalProof {
  resumedToolCallId: string;
  originalToolCallId: string;
  originalApprovalRef: string;
  reapprovalRef: string;
}

type LedgerEvent = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const integer = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);

export function inspectResumeReapproval(events: readonly unknown[]): Sp02ResumeReapprovalProof | null {
  const parsed = events.filter((event): event is LedgerEvent => typeof event === "object" && event !== null && !Array.isArray(event));
  const bySeq = (kind: string, toolCallId: string) => parsed.filter((event) => event.kind === kind && event.toolCallId === toolCallId);
  for (const start of parsed) {
    if (start.kind !== "tool_call_started") continue;
    const resumedToolCallId = text(start.toolCallId);
    const originalToolCallId = text(start.resumesToolCallId);
    const startSeq = integer(start.seq);
    if (!resumedToolCallId || !originalToolCallId || startSeq === null) continue;
    const original = bySeq("tool_call_started", originalToolCallId)[0];
    if (!original || original.stepId !== start.stepId || original.toolId !== start.toolId || original.inputSha256 !== start.inputSha256) continue;
    const closed = bySeq("tool_call_finished", originalToolCallId);
    const closedSeq = integer(closed[0]?.seq);
    if (closed.length !== 1 || closed[0]?.status !== "cancelled" || closedSeq === null || closedSeq >= startSeq) continue;

    const originalRelease = bySeq("tool_call_resumed", originalToolCallId);
    const waiting = bySeq("tool_call_waiting_approval", resumedToolCallId);
    const release = bySeq("tool_call_resumed", resumedToolCallId);
    if (originalRelease.length !== 1 || waiting.length !== 1 || release.length !== 1) continue;
    const originalApprovalRef = text(originalRelease[0]?.approvalRef);
    const reapprovalRef = text(release[0]?.approvalRef);
    const waitingSeq = integer(waiting[0]?.seq);
    const releaseSeq = integer(release[0]?.seq);
    if (!originalApprovalRef || !reapprovalRef || originalApprovalRef === reapprovalRef) continue;
    if (waitingSeq === null || releaseSeq === null || waitingSeq <= startSeq || releaseSeq <= waitingSeq) continue;
    return { resumedToolCallId, originalToolCallId, originalApprovalRef, reapprovalRef };
  }
  return null;
}
