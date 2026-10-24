import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

/** #117 projection, fenced to the selected request and its latest plan/attempt. */
export function observedResearchProgress(events: readonly ConversationRuntimeEvent[], requestId: string | null) {
  if (!requestId) return null;
  let planAt = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].requestId === requestId && events[i].type === "plan") { planAt = i; break; }
  }
  const plan = events[planAt];
  if (!plan || plan.type !== "plan" || !plan.plan.steps.length) return null;
  const labels = new Map(plan.plan.steps.map(step => [step.id, step.label]));
  const states = new Map<string, string>();
  const results = new Map<string, { stepId: string; label: string; summary: string }>();
  for (let i = planAt + 1; i < events.length; i++) {
    const event = events[i];
    if (event.requestId !== requestId || !("stepId" in event) || !event.stepId || !labels.has(event.stepId)) continue;
    if (event.type === "tool_start" || event.type === "status") {
      const state = event.type === "tool_start" ? "running" : event.state;
      states.set(event.stepId, state);
      if (state !== "completed") results.delete(event.stepId);
    } else if (event.type === "tool_result") {
      states.set(event.stepId, "completed");
      results.delete(event.stepId);
      results.set(event.stepId, { stepId: event.stepId, label: labels.get(event.stepId)!, summary: event.summary });
    }
  }
  return {
    total: labels.size,
    completed: [...states.values()].filter(state => state === "completed").length,
    activeLabels: [...labels].filter(([id]) => states.get(id) === "running").map(([, label]) => label),
    results: [...results.values()].slice(-3).reverse(),
  };
}
