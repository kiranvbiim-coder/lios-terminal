import { getRecentAnalyticalContextChanges, type AnalyticalContextChange, type ComparableValue } from "./terminalChangeIntelligence";
import { evaluateReversalCondition } from "./terminalDecisionMonitor";
import { decisionEvidenceBalance, loadDecisionObjects, type DecisionObject } from "./terminalDecisionObjects";
import { loadIntelligenceObjects, type IntelligenceObject } from "./terminalIntelligenceObjects";
import { getActiveScenario, loadScenarios, type TerminalScenario } from "./terminalScenarioUniverse";
import { loadTerminalTimeContext, type TerminalTimeContext } from "./terminalTimeTravel";
import type { ViewMode } from "./terminalTypes";

export type PulsePriority = "critical" | "high" | "medium" | "low";
export type PulseItemKind = "change" | "decision-risk" | "reversal" | "monitor" | "scenario" | "time-context";

export interface IntelligencePulseItem {
  id: string;
  kind: PulseItemKind;
  priority: PulsePriority;
  score: number;
  title: string;
  detail: string;
  symbol?: string;
  view?: ViewMode;
  objectId?: string;
  decisionId?: string;
  createdAt: number;
  metadata: Record<string, string | number | boolean | null>;
}

export interface IntelligencePulseSnapshot {
  generatedAt: number;
  activeScenario: TerminalScenario | null;
  timeContext: TerminalTimeContext;
  counts: Record<PulsePriority, number>;
  items: IntelligencePulseItem[];
}

export interface ScenarioMatrixRow {
  key: string;
  label: string;
  unit?: string;
  values: Record<string, ComparableValue | undefined>;
  spread?: number;
}

export interface ScenarioMatrix {
  scenarios: Array<Pick<TerminalScenario, "id" | "name" | "kind" | "probability">>;
  rows: ScenarioMatrixRow[];
}

function priorityRank(priority: PulsePriority): number {
  return priority === "critical" ? 4 : priority === "high" ? 3 : priority === "medium" ? 2 : 1;
}

function describeValue(value: ComparableValue | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
  return String(value);
}

function changeItem(change: AnalyticalContextChange): IntelligencePulseItem {
  const headline = change.changes[0];
  const priority: PulsePriority = change.criticalCount > 0 ? "critical" : change.materialCount >= 3 ? "high" : change.materialCount > 0 ? "medium" : "low";
  const score = 30 + change.criticalCount * 40 + change.materialCount * 12 + Math.min(change.changes.length, 10);
  const firstDetail = headline
    ? `${headline.key}: ${describeValue(headline.before)} → ${describeValue(headline.after)}${typeof headline.percentDelta === "number" ? ` (${headline.percentDelta >= 0 ? "+" : ""}${headline.percentDelta.toFixed(1)}%)` : ""}`
    : `${change.changes.length} changed fields`;
  return {
    id: `change:${change.contextKey}:${change.capturedAt}`,
    kind: "change",
    priority,
    score,
    title: `${change.symbol ? `${change.symbol} · ` : ""}${change.label}`,
    detail: `${firstDetail}${change.changes.length > 1 ? ` · ${change.changes.length - 1} more changes` : ""}`,
    symbol: change.symbol || undefined,
    view: change.view,
    createdAt: change.capturedAt,
    metadata: {
      criticalCount: change.criticalCount,
      materialCount: change.materialCount,
      changeCount: change.changes.length,
      previousCapturedAt: change.previousCapturedAt,
    },
  };
}

function decisionItems(decisions: readonly DecisionObject[], objects: readonly IntelligenceObject[]): IntelligencePulseItem[] {
  return decisions.filter((decision) => decision.status === "active" || decision.status === "draft").flatMap((decision) => {
    const balance = decisionEvidenceBalance(decision);
    const items: IntelligencePulseItem[] = [];
    if (balance.contradiction > balance.support || decision.confidence <= 35) {
      const priority: PulsePriority = balance.contradiction >= balance.support + 2 || decision.confidence <= 20 ? "critical" : "high";
      items.push({
        id: `decision-risk:${decision.id}:${decision.updatedAt}`,
        kind: "decision-risk",
        priority,
        score: priority === "critical" ? 95 : 78,
        title: decision.title,
        detail: `Confidence ${decision.confidence}% · support ${balance.support.toFixed(1)} · contradiction ${balance.contradiction.toFixed(1)}.`,
        symbol: decision.symbol,
        decisionId: decision.id,
        createdAt: decision.updatedAt,
        metadata: { confidence: decision.confidence, support: balance.support, contradiction: balance.contradiction },
      });
    }
    for (const condition of decision.reversalConditions) {
      const evaluation = evaluateReversalCondition(condition, objects);
      if (!evaluation.triggered) continue;
      items.push({
        id: `reversal:${decision.id}:${condition.id}`,
        kind: "reversal",
        priority: "critical",
        score: 100,
        title: `REVERSAL · ${decision.title}`,
        detail: `${condition.label}: ${evaluation.reason}`,
        symbol: decision.symbol,
        objectId: condition.objectId,
        decisionId: decision.id,
        createdAt: Date.now(),
        metadata: { conditionId: condition.id, comparator: condition.comparator ?? null, threshold: condition.threshold ?? null },
      });
    }
    return items;
  });
}

function monitorItems(objects: readonly IntelligenceObject[]): IntelligencePulseItem[] {
  return objects.filter((object) => object.kind === "monitor").map((object) => {
    const priority: PulsePriority = object.status === "critical" ? "critical" : object.status === "warning" ? "high" : "medium";
    return {
      id: `monitor:${object.id}:${object.updatedAt}`,
      kind: "monitor" as const,
      priority,
      score: priority === "critical" ? 92 : priority === "high" ? 72 : 45,
      title: object.label,
      detail: object.description ?? "Active monitoring object.",
      symbol: object.symbol,
      view: object.view,
      objectId: object.id,
      createdAt: object.updatedAt,
      metadata: { status: object.status, sourceObjectId: object.metadata.sourceObjectId ?? null },
    };
  });
}

function scenarioItem(activeScenario: TerminalScenario | null): IntelligencePulseItem[] {
  if (!activeScenario || activeScenario.kind === "base") return [];
  return [{
    id: `scenario:${activeScenario.id}:${activeScenario.updatedAt}`,
    kind: "scenario",
    priority: activeScenario.kind === "stress" || activeScenario.kind === "bear" ? "high" : "medium",
    score: activeScenario.kind === "stress" ? 75 : 55,
    title: `ACTIVE SCENARIO · ${activeScenario.name}`,
    detail: `${activeScenario.kind.toUpperCase()} · ${activeScenario.assumptions.length} assumptions · ${activeScenario.probability ?? 0}% probability.`,
    symbol: activeScenario.symbol,
    createdAt: activeScenario.updatedAt,
    metadata: { scenarioId: activeScenario.id, kind: activeScenario.kind, assumptionCount: activeScenario.assumptions.length },
  }];
}

function timeItem(timeContext: TerminalTimeContext): IntelligencePulseItem[] {
  if (!timeContext.enabled || !timeContext.asOfDate) return [];
  return [{
    id: `time:${timeContext.asOfDate}`,
    kind: "time-context",
    priority: "low",
    score: 20,
    title: `TIME MACHINE · ${timeContext.asOfDate}`,
    detail: "Terminal is operating in as-known-on mode; future-published records should be excluded where vintage metadata is available.",
    createdAt: Date.now(),
    metadata: { asOfDate: timeContext.asOfDate },
  }];
}

export function buildIntelligencePulseFromState(input: {
  changes: readonly AnalyticalContextChange[];
  decisions: readonly DecisionObject[];
  objects: readonly IntelligenceObject[];
  activeScenario: TerminalScenario | null;
  timeContext: TerminalTimeContext;
}): IntelligencePulseSnapshot {
  const items = [
    ...input.changes.map(changeItem),
    ...decisionItems(input.decisions, input.objects),
    ...monitorItems(input.objects),
    ...scenarioItem(input.activeScenario),
    ...timeItem(input.timeContext),
  ].sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.score - a.score || b.createdAt - a.createdAt);
  const counts: Record<PulsePriority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of items) counts[item.priority] += 1;
  return { generatedAt: Date.now(), activeScenario: input.activeScenario, timeContext: input.timeContext, counts, items };
}

export function buildIntelligencePulse(limit = 80): IntelligencePulseSnapshot {
  const snapshot = buildIntelligencePulseFromState({
    changes: getRecentAnalyticalContextChanges(limit),
    decisions: loadDecisionObjects(),
    objects: loadIntelligenceObjects(),
    activeScenario: getActiveScenario(),
    timeContext: loadTerminalTimeContext(),
  });
  return { ...snapshot, items: snapshot.items.slice(0, Math.max(1, limit)) };
}

export function buildScenarioMatrix(scenarios: readonly TerminalScenario[] = loadScenarios()): ScenarioMatrix {
  const columns = scenarios.slice().sort((a, b) => {
    const order = { base: 0, bull: 1, bear: 2, stress: 3, custom: 4 } as const;
    return order[a.kind] - order[b.kind] || b.updatedAt - a.updatedAt;
  });
  const keys = Array.from(new Set(columns.flatMap((scenario) => scenario.assumptions.map((assumption) => assumption.key))));
  const rows = keys.map((key) => {
    const assumptions = columns.map((scenario) => scenario.assumptions.find((assumption) => assumption.key === key));
    const values = Object.fromEntries(columns.map((scenario, index) => [scenario.id, assumptions[index]?.value]));
    const numeric = assumptions.map((assumption) => assumption?.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return {
      key,
      label: assumptions.find(Boolean)?.label ?? key,
      unit: assumptions.find(Boolean)?.unit,
      values,
      spread: numeric.length >= 2 ? Math.max(...numeric) - Math.min(...numeric) : undefined,
    };
  });
  return {
    scenarios: columns.map(({ id, name, kind, probability }) => ({ id, name, kind, probability })),
    rows: rows.sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1) || a.label.localeCompare(b.label)),
  };
}
