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
}

export function observedResearchProgress(events: readonly ConversationRuntimeEvent[]): ObservedResearchProgress | null {
  let planAt = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "plan") { planAt = i; break; }
  }
  if (planAt < 0) return null;
  const plan = events[planAt];
  if (plan.type !== "plan" || !plan.plan.steps.length) return null;

  const steps = plan.plan.steps;
  const known = new Map(steps.map((step) => [step.id, step.label]));
  const lastState = new Map<string, "queued" | "running" | "completed" | "cancelled">();
  const latestResults = new Map<string, ObservedResearchResult>();
  let activeStepId: string | null = null;
  // Only evidence after the latest plan matters; a replayed/replanned task must not inherit
  // previously completed counts or tool summaries from an older plan.
  for (const event of events.slice(planAt + 1)) {
    if (event.type === "tool_start" && known.has(event.stepId)) {
      lastState.set(event.stepId, "running");
      activeStepId = event.stepId;
    } else if (event.type === "status" && event.stepId && known.has(event.stepId)) {
      lastState.set(event.stepId, event.state);
      if (event.state === "running") activeStepId = event.stepId;
      else if (activeStepId === event.stepId) activeStepId = null;
    } else if (event.type === "tool_result" && known.has(event.stepId)) {
      lastState.set(event.stepId, "completed");
      if (activeStepId === event.stepId) activeStepId = null;
      latestResults.delete(event.stepId);
      latestResults.set(event.stepId, {
        stepId: event.stepId,
        label: known.get(event.stepId) ?? event.label,
        summary: event.summary,
        referenceCount: new Set(event.sourceRefs ?? []).size,
      });
    }
  }

  // Do not mark a resumed/cancelled step complete merely because an older attempt emitted a result.
  const completed = steps.filter((step) => lastState.get(step.id) === "completed").length;
  const activeLabel = activeStepId && lastState.get(activeStepId) === "running" ? known.get(activeStepId) ?? null : null;
  const currentResults = [...latestResults.values()]
    .filter((result) => lastState.get(result.stepId) === "completed")
    .slice(-3).reverse();
  return { total: steps.length, completed, activeLabel, results: currentResults };
}
