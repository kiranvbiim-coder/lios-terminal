import { FINANCIAL_METRICS, type FinancialMetricObservation, type FinancialMetricStatus, type ResolvedFinancialMetric } from "./financialMetricRegistry";
import { resolveInstitutionalFinancialMetric } from "./institutionalFinancialResolver";

export interface FinancialCubeKey {
  symbol: string;
  metricId: string;
  period: string;
  scenarioId: string;
}

export interface FinancialCubeCell extends FinancialCubeKey {
  value: number | null;
  status: FinancialMetricStatus;
  source?: string;
  asOf?: string;
  currency?: string;
  formula?: string;
  missingDependencies: string[];
}

export interface FinancialDataCube {
  symbols: string[];
  metrics: string[];
  periods: string[];
  scenarios: string[];
  cells: FinancialCubeCell[];
}

const PERIOD_PRIORITY = ["CURRENT", "TTM", "LTM", "NTM", "FY1", "FY2", "FY3", "FQ1", "FQ2", "FQ3", "FQ4"];

function periodScore(period: string): number {
  const normalized = period.toUpperCase().replace(/\s+/g, "");
  const fixed = PERIOD_PRIORITY.indexOf(normalized);
  if (fixed >= 0) return 10_000 - fixed;
  const year = Number(normalized.match(/(19|20)\d{2}/)?.[0] ?? 0);
  const quarter = Number(normalized.match(/Q([1-4])/)?.[1] ?? 0);
  return year + quarter / 10;
}

export function sortFinancialPeriods(periods: readonly string[]): string[] {
  return [...new Set(periods)].sort((a, b) => periodScore(b) - periodScore(a) || b.localeCompare(a));
}

export function buildFinancialDataCube(input: {
  symbol: string;
  observations: readonly FinancialMetricObservation[];
  metricIds?: readonly string[];
  periods?: readonly string[];
  scenarioIds?: readonly string[];
}): FinancialDataCube {
  const symbol = input.symbol.trim().toUpperCase();
  const metricIds = input.metricIds?.length ? [...new Set(input.metricIds)] : FINANCIAL_METRICS.map(metric => metric.id);
  const discoveredPeriods = input.observations.map(item => item.period).filter((item): item is string => Boolean(item));
  const periods = sortFinancialPeriods(input.periods?.length ? input.periods : discoveredPeriods.length ? discoveredPeriods : ["CURRENT"]);
  const discoveredScenarios = input.observations.map(item => item.scenarioId).filter((item): item is string => Boolean(item));
  const scenarios = [...new Set(input.scenarioIds?.length ? input.scenarioIds : ["BASE", ...discoveredScenarios])];
  const cells: FinancialCubeCell[] = [];

  for (const scenarioId of scenarios) {
    for (const period of periods) {
      for (const metricId of metricIds) {
        const resolved = resolveInstitutionalFinancialMetric(metricId, input.observations, { period, scenarioId });
        if (!resolved) continue;
        cells.push({
          symbol,
          metricId,
          period,
          scenarioId,
          value: resolved.value,
          status: resolved.status,
          source: resolved.source,
          asOf: resolved.asOf,
          currency: resolved.currency,
          formula: resolved.formula,
          missingDependencies: resolved.missingDependencies,
        });
      }
    }
  }
  return { symbols: [symbol], metrics: metricIds, periods, scenarios, cells };
}

export function getFinancialCubeCell(cube: FinancialDataCube, key: Partial<FinancialCubeKey> & Pick<FinancialCubeKey, "metricId">): FinancialCubeCell | null {
  const symbol = key.symbol?.toUpperCase() ?? cube.symbols[0];
  const period = key.period ?? cube.periods[0];
  const scenarioId = key.scenarioId ?? cube.scenarios[0];
  return cube.cells.find(cell => cell.symbol === symbol && cell.metricId === key.metricId && cell.period === period && cell.scenarioId === scenarioId) ?? null;
}

export function financialCoverageMatrix(cube: FinancialDataCube) {
  return cube.metrics.map(metricId => ({
    metricId,
    periods: cube.periods.map(period => {
      const cells = cube.cells.filter(cell => cell.metricId === metricId && cell.period === period);
      const base = cells.find(cell => cell.scenarioId === "BASE") ?? cells[0];
      return { period, value: base?.value ?? null, status: base?.status ?? "missing" as FinancialMetricStatus, source: base?.source };
    }),
  }));
}

export function compareFinancialScenarios(cube: FinancialDataCube, metricId: string, period = cube.periods[0]) {
  const rows = cube.scenarios.map(scenarioId => getFinancialCubeCell(cube, { metricId, period, scenarioId })).filter((cell): cell is FinancialCubeCell => Boolean(cell));
  const base = rows.find(row => row.scenarioId === "BASE") ?? rows[0];
  return rows.map(row => ({
    ...row,
    delta: row.value !== null && base?.value !== null && base?.value !== undefined ? row.value - base.value : null,
    deltaPct: row.value !== null && base?.value !== null && base?.value !== undefined && base.value !== 0 ? (row.value - base.value) / Math.abs(base.value) : null,
  }));
}

export function resolvedMetricSeries(
  metricId: string,
  observations: readonly FinancialMetricObservation[],
  periods: readonly string[],
  scenarioId = "BASE",
): ResolvedFinancialMetric[] {
  return sortFinancialPeriods(periods)
    .map(period => resolveInstitutionalFinancialMetric(metricId, observations, { period, scenarioId }))
    .filter((item): item is ResolvedFinancialMetric => Boolean(item));
}
