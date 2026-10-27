import { matchScenarioAssumptionsToBindings, type ImpactBindingMatch } from "./terminalImpactMap";
import type { AssumptionBinding } from "./terminalAssumptionRegistry";
import type { ScenarioAssumption, TerminalScenario } from "./terminalScenarioUniverse";

export type ComparedAssumptionStatus = "changed" | "unchanged" | "active_only" | "reference_only";
export interface ComparedScenarioAssumption {
  key: string;
  label: string;
  reference: ScenarioAssumption | null;
  active: ScenarioAssumption | null;
  status: ComparedAssumptionStatus;
  absoluteDelta: number | null;
  percentDelta: number | null;
  comparableNumeric: boolean;
  liveMatches: ImpactBindingMatch[];
}
export interface ScenarioInputComparison {
  referenceId: string;
  activeId: string;
  rows: ComparedScenarioAssumption[];
  changedCount: number;
  activeOnlyCount: number;
  referenceOnlyCount: number;
  liveMatchedCount: number;
  liveInputCount: number;
  nonNumericCount: number;
}

/**
 * Compare only explicit, same-key scenario assumptions.
 * A missing assumption means "not specified", NOT a zero or a model baseline.
 * Deltas are input-value arithmetic, NOT model-output projections.
 * Live matches use the canonical Apply/Impact Map matching rubric, without invoking apply.
 */
export function buildScenarioInputComparison(
  reference: TerminalScenario,
  active: TerminalScenario,
  mountedBindings: readonly AssumptionBinding[],
): ScenarioInputComparison {
  const referenceByKey = new Map(reference.assumptions.map(item => [item.key, item]));
  const activeByKey = new Map(active.assumptions.map(item => [item.key, item]));
  const keys = Array.from(new Set([...referenceByKey.keys(), ...activeByKey.keys()]));
  const activeLiveMatches = matchScenarioAssumptionsToBindings(active, mountedBindings);
  const rows: ComparedScenarioAssumption[] = keys.map(key => {
    const a = referenceByKey.get(key) ?? null;
    const b = activeByKey.get(key) ?? null;
    const comparableNumeric = Boolean(a && b
      && typeof a.value === "number" && Number.isFinite(a.value)
      && typeof b.value === "number" && Number.isFinite(b.value)
      && (a.unit ?? "") === (b.unit ?? ""));
    const delta = comparableNumeric ? (b!.value as number) - (a!.value as number) : null;
    const referenceNumber = comparableNumeric ? a!.value as number : null;
    const percentDelta = delta !== null && referenceNumber !== null && referenceNumber !== 0
      ? (delta / Math.abs(referenceNumber)) * 100 : null;
    const status: ComparedAssumptionStatus =
      !a ? "active_only" : !b ? "reference_only"
      : a.value === b.value && (a.unit ?? "") === (b.unit ?? "") ? "unchanged" : "changed";
    return {
      key,
      label: b?.label || a?.label || key,
      reference: a,
      active: b,
      status,
      absoluteDelta: delta,
      percentDelta,
      comparableNumeric,
      liveMatches: activeLiveMatches.filter(match => match.assumptionKey === key),
    };
  });
  const liveMatchedCount = rows.filter(row => row.liveMatches.length > 0).length;
  return {
    referenceId: reference.id,
    activeId: active.id,
    rows,
    changedCount: rows.filter(row => row.status === "changed").length,
    activeOnlyCount: rows.filter(row => row.status === "active_only").length,
    referenceOnlyCount: rows.filter(row => row.status === "reference_only").length,
    liveMatchedCount,
    liveInputCount: new Set(rows.flatMap(row => row.liveMatches.map(match => match.bindingId))).size,
    nonNumericCount: rows.filter(row => row.active && (typeof row.active.value !== "number"
      || !Number.isFinite(row.active.value))).length,
  };
}

export function scenarioInputText(item: ScenarioAssumption | null): string {
  if (!item) return "Not specified";
  if (item.value === null) return "Unset";
  if (typeof item.value === "boolean") return item.value ? "True" : "False";
  if (typeof item.value === "number" && !Number.isFinite(item.value)) return "Invalid numeric input";
  return `${String(item.value)}${item.unit ? ` ${item.unit}` : ""}`;
}
