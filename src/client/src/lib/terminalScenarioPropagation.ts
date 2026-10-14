import { getHeroIntelligenceConfig } from "./terminalHeroIntelligence";
import { getActiveScenario, type ScenarioAssumption, type TerminalScenario } from "./terminalScenarioUniverse";
import type { ViewMode } from "./terminalTypes";

export interface ScenarioContextPayload {
  scenario: TerminalScenario | null;
  view: ViewMode;
  symbol?: string;
  applicable: boolean;
  assumptions: Record<string, string | number | boolean | null>;
  publishedAt: number;
}

const EVENT_NAME = "lios:scenario-context";

function normalizeSymbol(symbol?: string): string | undefined {
  return symbol?.trim().toUpperCase() || undefined;
}

export function scenarioAppliesTo(scenario: TerminalScenario | null, view: ViewMode, symbol?: string): boolean {
  if (!scenario) return false;
  const config = getHeroIntelligenceConfig(view);
  if (config && !config.scenarioAware) return false;
  if (scenario.scope === "global") return true;
  if (scenario.scope === "entity") return !scenario.symbol || scenario.symbol === normalizeSymbol(symbol);
  if (scenario.scope === "portfolio") return view === "portfolio" || view === "portfolioattribution" || view === "portfoliostress" || view === "advancedrisk";
  if (scenario.scope === "macro") return view === "macrodashboard" || view === "economics" || view === "indicatorworkbench" || view === "crossasset" || view === "macrostress" || view === "regime";
  if (scenario.scope === "policy") return view === "econpolicyquant" || view === "indicatorworkbench" || view === "research";
  if (scenario.scope === "operations") return view === "supplychaindashboard" || view === "supplychainquant";
  if (scenario.scope === "sustainability") return view === "environmentdashboard" || view === "environmentquant" || view === "carbonintensity";
  return false;
}

export function scenarioAssumptionRecord(assumptions: readonly ScenarioAssumption[]): Record<string, string | number | boolean | null> {
  return Object.fromEntries(assumptions.map((assumption) => [assumption.key, assumption.value]));
}

export function resolveScenarioContext(view: ViewMode, symbol?: string, scenario: TerminalScenario | null = getActiveScenario()): ScenarioContextPayload {
  const applicable = scenarioAppliesTo(scenario, view, symbol);
  return {
    scenario,
    view,
    symbol: normalizeSymbol(symbol),
    applicable,
    assumptions: applicable && scenario ? scenarioAssumptionRecord(scenario.assumptions) : {},
    publishedAt: Date.now(),
  };
}

export function publishScenarioContext(view: ViewMode, symbol?: string, scenario: TerminalScenario | null = getActiveScenario()): ScenarioContextPayload {
  const payload = resolveScenarioContext(view, symbol, scenario);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  return payload;
}

export function subscribeScenarioContext(listener: (payload: ScenarioContextPayload) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (event instanceof CustomEvent && event.detail) listener(event.detail as ScenarioContextPayload);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
