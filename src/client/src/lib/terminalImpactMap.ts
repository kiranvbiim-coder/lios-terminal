import type { AssumptionBinding } from "./terminalAssumptionRegistry";
import type { IntelligenceObject } from "./terminalIntelligenceObjects";
import type { TerminalScenario } from "./terminalScenarioUniverse";
import type { ViewMode } from "./terminalTypes";

export interface ImpactBindingMatch {
  assumptionKey: string;
  assumptionLabel: string;
  assumptionValue: string | number | boolean | null;
  bindingId: string;
  view: ViewMode;
  symbol?: string;
  bindingKey: string;
  bindingLabel: string;
  currentValue: number;
  targetValue: number;
  absoluteDelta: number;
  percentDelta?: number;
  unit?: string;
}

export interface ImpactViewSummary {
  view: ViewMode;
  symbol?: string;
  matchedAssumptions: string[];
  bindingCount: number;
  maxAbsolutePercentDelta?: number;
}

export interface ImpactObjectLink {
  sourceObjectId: string;
  sourceLabel: string;
  targetObjectId: string;
  targetLabel: string;
  relation: string;
}

export interface ScenarioImpactMap {
  scenarioId: string;
  scenarioName: string;
  assumptionCount: number;
  matchedAssumptionCount: number;
  coveragePct: number;
  bindingMatches: ImpactBindingMatch[];
  impactedViews: ImpactViewSummary[];
  unmatchedAssumptions: string[];
  skippedAssumptions: string[];
  explicitObjectLinks: ImpactObjectLink[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function matchScenarioAssumptionsToBindings(scenario: TerminalScenario, bindings: readonly AssumptionBinding[]): ImpactBindingMatch[] {
  return scenario.assumptions.flatMap((assumption) => {
    const targetValue = assumption.value;
    if (typeof targetValue !== "number" || !Number.isFinite(targetValue)) return [];
    const tokens = new Set([normalize(assumption.key), normalize(assumption.label)].filter(Boolean));
    if (!tokens.size) return [];
    return bindings.filter(binding =>
      [normalize(binding.key), normalize(binding.label)].some(token => !!token && tokens.has(token)) &&
      (assumption.unit?.trim().toLocaleLowerCase() ?? "") === (binding.unit?.trim().toLocaleLowerCase() ?? "")
    ).map((binding) => {
      const absoluteDelta = targetValue - binding.value;
      const percentDelta = binding.value !== 0 ? (absoluteDelta / Math.abs(binding.value)) * 100 : undefined;
      return {
        assumptionKey: assumption.key,
        assumptionLabel: assumption.label,
        assumptionValue: targetValue,
        bindingId: binding.id,
        view: binding.view,
        symbol: binding.symbol,
        bindingKey: binding.key,
        bindingLabel: binding.label,
        currentValue: binding.value,
        targetValue,
        absoluteDelta,
        percentDelta,
        unit: binding.unit ?? assumption.unit,
      };
    });
  });
}

export function buildScenarioImpactMap(scenario: TerminalScenario, bindings: readonly AssumptionBinding[], objects: readonly IntelligenceObject[]): ScenarioImpactMap {
  const bindingMatches = matchScenarioAssumptionsToBindings(scenario, bindings);
  const matchedKeys = new Set(bindingMatches.map((match) => match.assumptionKey));
  const skippedAssumptions = scenario.assumptions.filter((assumption) => typeof assumption.value !== "number" || !Number.isFinite(assumption.value)).map((assumption) => assumption.key);
  const unmatchedAssumptions = scenario.assumptions.filter((assumption) => !matchedKeys.has(assumption.key) && !skippedAssumptions.includes(assumption.key)).map((assumption) => assumption.key);
  const viewKeys = Array.from(new Set(bindingMatches.map((match) => `${match.view}|${match.symbol ?? ""}`)));
  const impactedViews = viewKeys.map((key) => {
    const [view, symbol = ""] = key.split("|") as [ViewMode, string];
    const matches = bindingMatches.filter((match) => match.view === view && (match.symbol ?? "") === symbol);
    const percentageChanges = matches.map((match) => Math.abs(match.percentDelta ?? 0)).filter((value) => Number.isFinite(value));
    return {
      view,
      symbol: symbol || undefined,
      matchedAssumptions: Array.from(new Set(matches.map((match) => match.assumptionKey))),
      bindingCount: matches.length,
      maxAbsolutePercentDelta: percentageChanges.length ? Math.max(...percentageChanges) : undefined,
    };
  }).sort((a, b) => b.bindingCount - a.bindingCount || (b.maxAbsolutePercentDelta ?? 0) - (a.maxAbsolutePercentDelta ?? 0));

  const ids = new Set(objects.map((object) => object.id));
  const explicitObjectLinks = objects.flatMap((source) => source.relations
    .filter((relation) => ids.has(relation.targetId) && (relation.kind === "affects" || relation.kind === "depends-on" || relation.kind === "derived-from"))
    .map((relation) => {
      const target = objects.find((object) => object.id === relation.targetId)!;
      return {
        sourceObjectId: source.id,
        sourceLabel: source.label,
        targetObjectId: target.id,
        targetLabel: target.label,
        relation: relation.kind,
      };
    }));

  const numericAssumptions = scenario.assumptions.length - skippedAssumptions.length;
  const coveragePct = numericAssumptions > 0 ? (matchedKeys.size / numericAssumptions) * 100 : 0;
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    assumptionCount: scenario.assumptions.length,
    matchedAssumptionCount: matchedKeys.size,
    coveragePct,
    bindingMatches,
    impactedViews,
    unmatchedAssumptions,
    skippedAssumptions,
    explicitObjectLinks,
  };
}
