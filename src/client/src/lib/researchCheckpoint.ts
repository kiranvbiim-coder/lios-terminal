/**
 * Read-only presentation of the authenticated Home's execution history.
 * Checkpoint eligibility is a SERVER decision. These counts are not replay
 * authorization, proof of source quality, or a second checkpoint store.
 */
export interface ResumableCheckpointView {
  requestId: string;
  /** null means the Home did not expose a structurally valid checkpoint summary. */
  totalSteps: number | null;
  completedSteps: number | null;
  awaitingReviewSteps: number | null;
  recordedReferenceCount: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECKPOINT_STATES = new Set([
  "pending", "waiting_approval", "running", "completed", "failed", "cancelled", "skipped",
]);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Only a record for the exact requestId with status=interrupted and server
 * resumable=true can produce a view. Malformed checkpoint metadata yields
 * unknown counts rather than guessed or forged progress.
 */
export function resumableCheckpointView(history: unknown, requestId: string | null): ResumableCheckpointView | null {
  if (!Array.isArray(history) || !requestId || !UUID.test(requestId)) return null;
  const record = history.map(object).find(row => row?.id === requestId && row.status === "interrupted" && row.resumable === true);
  if (!record) return null;
  const fallback: ResumableCheckpointView = {
    requestId, totalSteps: null, completedSteps: null,
    awaitingReviewSteps: null, recordedReferenceCount: null,
  };
  const checkpoint = object(record.checkpoint);
  if (!checkpoint || checkpoint.version !== 2 || checkpoint.requestId !== requestId || checkpoint.toolOutcome === "outcome_unknown") return fallback;
  const steps = checkpoint.steps;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 64 || !steps.every(value => {
    const row = object(value);
    return row && typeof row.stepId === "string" && row.stepId.length > 0 && CHECKPOINT_STATES.has(row.status as string);
  })) return fallback;
  const unique = new Set(steps.map(row => (row as { stepId: string }).stepId));
  if (unique.size !== steps.length) return fallback;
  const refs = checkpoint.evidenceRefs;
  return {
    requestId,
    totalSteps: steps.length,
    completedSteps: steps.filter(row => (row as { status: string }).status === "completed").length,
    awaitingReviewSteps: steps.filter(row => (row as { status: string }).status === "waiting_approval").length,
    recordedReferenceCount: Array.isArray(refs) && refs.length <= 128 && refs.every(ref => typeof ref === "string")
      ? new Set(refs).size : null,
  };
}
