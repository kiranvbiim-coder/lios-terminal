import { getFinancialMetricDefinition, resolveFinancialMetric, type FinancialMetricObservation } from "./financialMetricRegistry";
import { buildFinancialDataCube, compareFinancialScenarios, type FinancialCubeCell } from "./financialDataCube";

export interface FinancialScenarioAssumption {
  key: string;
  label?: string;
  value: number | null;
  unit?: string;
  source?: string;
}

export interface FinancialScenarioInput {
  id: string;
  name: string;
  assumptions: readonly FinancialScenarioAssumption[];
  period?: string;
}

export interface FinancialScenarioMetricImpact {
  metricId: string;
  base: FinancialCubeCell | null;
  scenario: FinancialCubeCell | null;
  delta: number | null;
  percentDelta: number | null;
}

export function materializeFinancialScenarioObservations(
  scenario: FinancialScenarioInput,
  period = scenario.period ?? "CURRENT",
): FinancialMetricObservation[] {
  return scenario.assumptions.flatMap(assumption => {
    if (typeof assumption.value !== "number" || !Number.isFinite(assumption.value)) return [];
    const definition = getFinancialMetricDefinition(assumption.key);
    if (!definition) return [];
    return [{
      metricId: definition.id,
      value: assumption.value,
      status: "derived" as const,
      period,
      scenarioId: scenario.id,
      source: `Scenario assumption: ${scenario.name}`,
      note: assumption.source ?? assumption.label ?? "Explicit scenario input",
    }];
  });
}

export function propagateFinancialScenario(input: {
  baseObservations: readonly FinancialMetricObservation[];
  scenario: FinancialScenarioInput;
  metricIds: readonly string[];
  period?: string;
}): FinancialScenarioMetricImpact[] {
  const scenarioObservations = materializeFinancialScenarioObservations(input.scenario, input.period);
  const cube = buildFinancialDataCube({
    symbol: "SCENARIO",
    observations: [...input.baseObservations, ...scenarioObservations],
    metricIds: input.metricIds,
    periods: [input.period ?? input.scenario.period ?? "CURRENT"],
    scenarioIds: ["BASE", input.scenario.id],
  });
  return input.metricIds.map(metricId => {
    const comparison = compareFinancialScenarios(cube, metricId, cube.periods[0]);
    const base = comparison.find(row => row.scenarioId === "BASE") ?? null;
    const scenario = comparison.find(row => row.scenarioId === input.scenario.id) ?? null;
    const delta = typeof base?.value === "number" && typeof scenario?.value === "number" ? scenario.value - base.value : null;
    const percentDelta = delta !== null && base?.value !== null && base?.value !== undefined && base.value !== 0 ? delta / Math.abs(base.value) : null;
    return { metricId, base, scenario, delta, percentDelta };
  });
}

export function resolveScenarioMetric(
  metricId: string,
  baseObservations: readonly FinancialMetricObservation[],
  scenario: FinancialScenarioInput,
  period = scenario.period ?? "CURRENT",
) {
  const observations = [...baseObservations, ...materializeFinancialScenarioObservations(scenario, period)];
  return resolveFinancialMetric(metricId, observations, { period, scenarioId: scenario.id });
}
