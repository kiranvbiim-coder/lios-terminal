import type { DecisionObject, ReversalCondition } from "./terminalDecisionObjects";
import type { IntelligenceObject } from "./terminalIntelligenceObjects";

export interface ReversalEvaluation {
  conditionId: string;
  triggered: boolean;
  reason: string;
  observed?: string | number | boolean | null;
}

function comparableValue(object: IntelligenceObject | undefined): string | number | boolean | null | undefined {
  return object?.value?.raw;
}

function evaluateComparator(condition: ReversalCondition, observed: string | number | boolean | null | undefined): ReversalEvaluation {
  if (!condition.comparator) return { conditionId: condition.id, triggered: false, reason: "No comparator configured", observed };
  if (condition.comparator === "changed") {
    const baseline = condition.threshold;
    const triggered = observed !== undefined && observed !== baseline;
    return { conditionId: condition.id, triggered, reason: triggered ? "Observed value changed from reversal baseline" : "Observed value matches reversal baseline", observed };
  }
  const observedNumber = typeof observed === "number" ? observed : Number(observed);
  const thresholdNumber = typeof condition.threshold === "number" ? condition.threshold : Number(condition.threshold);
  if (!Number.isFinite(observedNumber) || !Number.isFinite(thresholdNumber)) {
    return { conditionId: condition.id, triggered: false, reason: "Numeric comparison unavailable", observed };
  }
  const triggered = condition.comparator === "gt" ? observedNumber > thresholdNumber
    : condition.comparator === "gte" ? observedNumber >= thresholdNumber
    : condition.comparator === "lt" ? observedNumber < thresholdNumber
    : condition.comparator === "lte" ? observedNumber <= thresholdNumber
    : observedNumber === thresholdNumber;
  return { conditionId: condition.id, triggered, reason: triggered ? `Reversal threshold ${condition.comparator} ${thresholdNumber} met` : `Reversal threshold ${condition.comparator} ${thresholdNumber} not met`, observed };
}

export function evaluateReversalCondition(condition: ReversalCondition, objects: readonly IntelligenceObject[]): ReversalEvaluation {
  if (!condition.objectId) return { conditionId: condition.id, triggered: false, reason: "No intelligence object linked" };
  const object = objects.find((item) => item.id === condition.objectId);
  if (!object) return { conditionId: condition.id, triggered: false, reason: "Linked intelligence object unavailable" };
  return evaluateComparator(condition, comparableValue(object));
}

export function evaluateDecisionReversals(decision: DecisionObject, objects: readonly IntelligenceObject[]): ReversalEvaluation[] {
  return decision.reversalConditions.map((condition) => evaluateReversalCondition(condition, objects));
}

export function decisionMonitorSummary(decision: DecisionObject, objects: readonly IntelligenceObject[]): { triggered: number; configured: number; evaluations: ReversalEvaluation[] } {
  const evaluations = evaluateDecisionReversals(decision, objects);
  return { triggered: evaluations.filter((item) => item.triggered).length, configured: evaluations.length, evaluations };
}
