import { effectiveAssetCountAtRecordedDate } from "./skfolioEffectiveDiversification";

interface PortfolioPositionInput {
  symbol: string;
  shares: number;
  avgCost: number;
}

interface ClosePoint {
  date: string;
  close: number;
}

interface PortfolioValuePoint {
  date: string;
  value: number;
}

interface PortfolioAnalyticsInput {
  positions: PortfolioPositionInput[];
  histories: Record<string, ClosePoint[]>;
  benchmark: ClosePoint[];
}

export interface PortfolioAnalyticsResult {
  benchmarkSymbol: string;
  portfolioReturnPct: number | null;
  benchmarkReturnPct: number | null;
  activeReturnPct: number | null;
  beta: number | null;
  annualizedVolatilityPct: number | null;
  maxDrawdownPct: number | null;
  /** Skfolio effective diversification of complete long positions on one recorded date. */
  effectiveNumberOfAssets: number | null;
  /** This is a historical recorded close, NOT verified current pricing. */
  diversificationAsOf: string | null;
  chart: Array<{ date: string; portfolio: number; benchmark: number }>;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function computeDailyReturns(values: number[]) {
  const returns: number[] = [];
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1];
    if (previous === 0) continue;
    returns.push((values[index] - previous) / previous);
  }
  return returns;
}

function calculatePopulationStdDev(values: number[]) {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function calculateAnnualizedVolatilityPct(returns: number[]) {
  const stdDev = calculatePopulationStdDev(returns);
  if (stdDev === null) return null;
  return round(stdDev * Math.sqrt(252) * 100);
}

export function calculateMaxDrawdownPct(values: number[]) {
  if (!values.length) return null;
  let peak = values[0];
  let maxDrawdown = 0;

  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak === 0) continue;
    maxDrawdown = Math.min(maxDrawdown, (value - peak) / peak);
  }

  return round(maxDrawdown * 100);
}

export function calculateBeta(portfolioReturns: number[], benchmarkReturns: number[]) {
  const length = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (length < 2) return null;

  const portfolioSlice = portfolioReturns.slice(-length);
  const benchmarkSlice = benchmarkReturns.slice(-length);
  const benchmarkMean = benchmarkSlice.reduce((sum, value) => sum + value, 0) / length;
  const portfolioMean = portfolioSlice.reduce((sum, value) => sum + value, 0) / length;

  const covariance = benchmarkSlice.reduce((sum, benchmarkValue, index) => {
    return sum + ((benchmarkValue - benchmarkMean) * (portfolioSlice[index] - portfolioMean));
  }, 0) / length;

  const variance = benchmarkSlice.reduce((sum, value) => sum + ((value - benchmarkMean) ** 2), 0) / length;
  if (variance === 0) return null;
  return round(covariance / variance, 2);
}

export function buildNormalizedComparisonSeries(portfolio: PortfolioValuePoint[], benchmark: ClosePoint[]) {
  if (!portfolio.length || !benchmark.length) return [];
  const benchmarkMap = new Map(benchmark.map((point) => [point.date, point.close]));
  const portfolioBase = portfolio[0].value;
  const benchmarkBase = benchmarkMap.get(portfolio[0].date) ?? benchmark[0].close;
  if (!portfolioBase || !benchmarkBase) return [];

  return portfolio.flatMap((point) => {
    const benchmarkClose = benchmarkMap.get(point.date);
    if (!benchmarkClose) return [];
    return [{
      date: point.date,
      portfolio: round((point.value / portfolioBase) * 100),
      benchmark: round((benchmarkClose / benchmarkBase) * 100),
    }];
  });
}

function buildPortfolioValueSeries(positions: PortfolioPositionInput[], histories: Record<string, ClosePoint[]>, benchmark: ClosePoint[]) {
  const historyMaps = Object.fromEntries(
    positions.map((position) => [
      position.symbol,
      new Map((histories[position.symbol] ?? []).map((point) => [point.date, point.close])),
    ]),
  ) as Record<string, Map<string, number>>;

  const lastKnown = new Map<string, number>();
  const series: PortfolioValuePoint[] = [];

  for (const benchmarkPoint of benchmark) {
    let total = 0;
    let hasAllPositions = true;

    for (const position of positions) {
      const map = historyMaps[position.symbol];
      const close = map?.get(benchmarkPoint.date);
      if (typeof close === "number") {
        lastKnown.set(position.symbol, close);
      }

      const effectiveClose = lastKnown.get(position.symbol);
      if (effectiveClose === undefined) {
        hasAllPositions = false;
        break;
      }

      total += effectiveClose * position.shares;
    }

    if (hasAllPositions) {
      series.push({ date: benchmarkPoint.date, value: round(total) });
    }
  }

  return series;
}

export function calculatePortfolioAnalytics(input: PortfolioAnalyticsInput): PortfolioAnalyticsResult {
  const portfolioSeries = buildPortfolioValueSeries(input.positions, input.histories, input.benchmark);
  if (portfolioSeries.length < 2) {
    return {
      benchmarkSymbol: "SPY",
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
      activeReturnPct: null,
      beta: null,
      annualizedVolatilityPct: null,
      maxDrawdownPct: null,
      effectiveNumberOfAssets: null,
      diversificationAsOf: null,
      chart: [],
    };
  }

  const lastRecordedDate = portfolioSeries.at(-1)!.date;
  const effectiveNumberOfAssets = effectiveAssetCountAtRecordedDate({
    positions: input.positions,
    histories: input.histories,
    asOfDate: lastRecordedDate,
  });
  const benchmarkMap = new Map(input.benchmark.map((point) => [point.date, point.close]));
  const benchmarkSeries = portfolioSeries.flatMap((point) => {
    const close = benchmarkMap.get(point.date);
    return typeof close === "number" ? [{ date: point.date, close }] : [];
  });

  const portfolioValues = portfolioSeries.map((point) => point.value);
  const benchmarkValues = benchmarkSeries.map((point) => point.close);
  const portfolioReturnPct = round(((portfolioValues.at(-1)! / portfolioValues[0]) - 1) * 100);
  const benchmarkReturnPct = round(((benchmarkValues.at(-1)! / benchmarkValues[0]) - 1) * 100);
  const activeReturnPct = round(portfolioReturnPct - benchmarkReturnPct);
  const portfolioReturns = computeDailyReturns(portfolioValues);
  const benchmarkReturns = computeDailyReturns(benchmarkValues);

  return {
    benchmarkSymbol: "SPY",
    portfolioReturnPct,
    benchmarkReturnPct,
    activeReturnPct,
    beta: calculateBeta(portfolioReturns, benchmarkReturns),
    annualizedVolatilityPct: calculateAnnualizedVolatilityPct(portfolioReturns),
    maxDrawdownPct: calculateMaxDrawdownPct(portfolioValues),
    effectiveNumberOfAssets: effectiveNumberOfAssets === null ? null : round(effectiveNumberOfAssets),
    diversificationAsOf: effectiveNumberOfAssets === null ? null : lastRecordedDate,
    chart: buildNormalizedComparisonSeries(portfolioSeries.slice(-30), benchmarkSeries.slice(-30)),
  };
}
