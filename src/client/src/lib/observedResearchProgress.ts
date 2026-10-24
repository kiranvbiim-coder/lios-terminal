import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

/** Read-only projection: never interprets a queued step as underway or a tool summary as verified evidence. */
export interface ObservedResearchResult {
  stepId: string;
  label: string;
  summary: string;
  referenceCount: number;
}

export interface ObservedResearchProgress {
  total: number;
  completed: number;
  activeLabel: string | null;
  results: ObservedResearchResult[];
  /** Only present when a matching runtime done event has actually been observed. */
  runOutcome?: "completed" | "cancelled" | "failed" | "waiting_approval";
}

/**
 * Project only events belonging to the latest valid workflow plan for a single request.
 * Source/tool summaries are reports, not proof that the underlying claims are verified.
 */
export function observedResearchProgress(
  events: readonly ConversationRuntimeEvent[],
  requestId?: string | null,
): ObservedResearchProgress | null {
  let planAt = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "plan" && (!requestId || events[i].requestId === requestId)) {
      planAt = i;
      break;
    }
  }
  if (planAt < 0) return null;
  const plan = events[planAt];
  if (plan.type !== "plan" || !plan.plan.steps.length) return null;

  const steps = plan.plan.steps;
  const known = new Map(steps.map((step) => [step.id, step.label]));
  // A malformed plan with duplicate step IDs cannot support an honest denominator.
  if (known.size !== steps.length) return null;
  const lastState = new Map<string, "queued" | "running" | "completed" | "cancelled">();
  const latestResults = new Map<string, ObservedResearchResult>();
  const activeOrder = new Map<string, number>();
  let runOutcome: ObservedResearchProgress["runOutcome"];
  let terminal = false;

  for (let i = planAt + 1; i < events.length; i++) {
    const event = events[i];
    if (event.requestId !== plan.requestId || terminal) continue;
    if (event.type === "done") {
      runOutcome = event.status;
      if (event.status !== "waiting_approval") terminal = true;
      continue;
    }
    if (event.type === "tool_start" && known.has(event.stepId)) {
      lastState.set(event.stepId, "running");
      latestResults.delete(event.stepId); // a restarted attempt invalidates the old report
      activeOrder.set(event.stepId, i);
      runOutcome = undefined;
    } else if (event.type === "status" && event.stepId && known.has(event.stepId)) {
      const previous = lastState.get(event.stepId);
      lastState.set(event.stepId, event.state);
      if (event.state !== "completed" && event.state !== previous) latestResults.delete(event.stepId);
      if (event.state === "running") {
        activeOrder.set(event.stepId, i);
        runOutcome = undefined;
      }
    } else if (event.type === "tool_result" && known.has(event.stepId)) {
      // A late result arriving after cancellation must not be counted as successful.
      if (lastState.get(event.stepId) === "cancelled") continue;
      lastState.set(event.stepId, "completed");
      latestResults.delete(event.stepId);
      latestResults.set(event.stepId, {
        stepId: event.stepId,
        label: known.get(event.stepId) ?? event.label,
        summary: event.summary,
        referenceCount: new Set(event.sourceRefs ?? []).size,
      });
    }
  }

  const completed = steps.filter((step) => lastState.get(step.id) === "completed").length;
  const active = [...activeOrder.entries()]
    .filter(([id]) => lastState.get(id) === "running")
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const activeLabel = runOutcome ? null : active ? known.get(active) ?? null : null;
  const currentResults = [...latestResults.values()]
    .filter((result) => lastState.get(result.stepId) === "completed")
    .slice(-3).reverse();
  return {
    total: steps.length,
    completed,
    activeLabel,
    results: currentResults,
    ...(runOutcome ? { runOutcome } : {}),
  };
}
