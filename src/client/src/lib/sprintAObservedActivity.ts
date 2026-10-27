/**
 * Display only. A planned step is not observed execution, and a generic tool
 * result is not proof of success. Count distinct step IDs with real runtime
 * events without fabricating a progress percentage or an outcome.
 */
export function observedRunActivity(
  events: readonly { type: string; stepId?: string }[],
  plannedSteps: number,
  working: boolean,
  awaitingApproval: boolean,
): { label: string | null; observedSteps: number; resultEvents: number } {
  if (!working) return { label: null, observedSteps: 0, resultEvents: 0 };
  const observed = new Set<string>();
  let results = 0;
  for (const event of events) {
    if (event.type === "tool_start" || event.type === "tool_result" || event.type === "status") {
      if (typeof event.stepId === "string" && event.stepId) observed.add(event.stepId);
      if (event.type === "tool_result") results++;
    }
  }
  const count = observed.size;
  return {
    observedSteps: count,
    resultEvents: results,
    label: awaitingApproval
      ? "Approval required before this run can continue"
      : count
        ? `${count} observed step${count === 1 ? "" : "s"}${plannedSteps > 0 ? ` of ${plannedSteps} planned` : ""} · ${results} tool result${results === 1 ? "" : "s"} recorded`
        : "Preparing execution · no tool activity observed yet",
  };
}
