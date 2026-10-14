import crypto from "node:crypto";
import {
  p6BacktestRequestSchema,
  p6BacktestResultSchema,
  p6MonteCarloRequestSchema,
  p6ParameterSweepRequestSchema,
  type P6BacktestBar,
  type P6BacktestLifecycle,
  type P6BacktestRequest,
  type P6BacktestResult,
  type P6BacktestTrade,
  type P6StrategyDefinition,
} from "@shared/p6FinanceContracts";

const ENGINE_ID = "lios.backtest.core-v1" as const;
const ENGINE_VERSION = "1.0.0" as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function p6Hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function stableUuidFromHash(hash: string): string {
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  const variant = parseInt(chars[16], 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const raw = chars.join("");
  return raw.slice(0, 8) + "-" + raw.slice(8, 12) + "-" + raw.slice(12, 16) + "-" + raw.slice(16, 20) + "-" + raw.slice(20);
}

function assertBars(bars: P6BacktestBar[]): void {
  let prior = Number.NEGATIVE_INFINITY;
  const seen = new Set<string>();
  for (const bar of bars) {
    const at = Date.parse(bar.at);
    if (!Number.isFinite(at)) throw new Error("Backtest bars require valid timestamps.");
    if (at <= prior) throw new Error("Backtest bars must be strictly increasing by timestamp.");
    if (seen.has(bar.at)) throw new Error("Backtest bars may not contain duplicate timestamps.");
    prior = at;
    seen.add(bar.at);
  }
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function sma(values: number[], period: number): number | null {
  if (period < 1 || values.length < period) return null;
  const slice = values.slice(-period);
  return average(slice);
}

export function p6WilderRsiSeries(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(values.length).fill(null);
  if (period < 1 || values.length < period + 1) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

interface StrategySignalContext {
  rsi: Array<number | null> | null;
}

function buildStrategySignalContext(strategy: P6StrategyDefinition, bars: P6BacktestBar[]): StrategySignalContext {
  if (strategy.kind !== "rsi_mean_reversion") return { rsi: null };
  const period = Math.max(2, Math.floor(strategy.parameters.rsiPeriod ?? 14));
  return { rsi: p6WilderRsiSeries(bars.map((bar) => bar.close), period) };
}

type Signal = "buy" | "sell" | null;

function signalFor(
  strategy: P6StrategyDefinition,
  bars: P6BacktestBar[],
  index: number,
  inPosition: boolean,
  context: StrategySignalContext,
): { signal: Signal; reason: string } {
  const closes = bars.slice(0, index + 1).map((bar) => bar.close);
  const p = strategy.parameters;
  if (strategy.kind === "buy_and_hold") {
    return !inPosition ? { signal: "buy", reason: "buy_and_hold_entry" } : { signal: null, reason: "hold" };
  }
  if (strategy.kind === "rsi_mean_reversion") {
    const value = context.rsi?.[index] ?? null;
    if (value === null) return { signal: null, reason: "rsi_warmup" };
    const oversold = p.oversold ?? 30;
    const overbought = p.overbought ?? 70;
    if (!inPosition && value < oversold) return { signal: "buy", reason: "rsi_below_" + oversold };
    if (inPosition && value > overbought) return { signal: "sell", reason: "rsi_above_" + overbought };
    return { signal: null, reason: "rsi_no_cross" };
  }
  if (strategy.kind === "moving_average_crossover") {
    const fast = Math.max(2, Math.floor(p.fastPeriod ?? 20));
    const slow = Math.max(fast + 1, Math.floor(p.slowPeriod ?? 50));
    if (closes.length < slow + 1) return { signal: null, reason: "ma_warmup" };
    const fastNow = sma(closes, fast);
    const slowNow = sma(closes, slow);
    const previous = closes.slice(0, -1);
    const fastPrev = sma(previous, fast);
    const slowPrev = sma(previous, slow);
    if (fastNow === null || slowNow === null || fastPrev === null || slowPrev === null) return { signal: null, reason: "ma_warmup" };
    if (!inPosition && fastNow > slowNow && fastPrev <= slowPrev) return { signal: "buy", reason: "bullish_ma_cross" };
    if (inPosition && fastNow < slowNow && fastPrev >= slowPrev) return { signal: "sell", reason: "bearish_ma_cross" };
    return { signal: null, reason: "ma_no_cross" };
  }
  if (strategy.kind === "breakout") {
    const lookback = Math.max(2, Math.floor(p.lookback ?? 252));
    if (index < lookback) return { signal: null, reason: "breakout_warmup" };
    const prior = bars.slice(index - lookback, index).map((bar) => bar.close);
    const high = Math.max(...prior);
    const low = Math.min(...prior);
    if (!inPosition && bars[index].close > high) return { signal: "buy", reason: "close_above_prior_high" };
    if (inPosition && bars[index].close < low) return { signal: "sell", reason: "close_below_prior_low" };
    return { signal: null, reason: "inside_breakout_band" };
  }
  const lookback = Math.max(2, Math.floor(p.lookback ?? 252));
  if (index < lookback) return { signal: null, reason: "momentum_warmup" };
  const momentum = bars[index].close / bars[index - lookback].close - 1;
  if (!inPosition && momentum > 0) return { signal: "buy", reason: "positive_momentum" };
  if (inPosition && momentum <= 0) return { signal: "sell", reason: "non_positive_momentum" };
  return { signal: null, reason: "momentum_hold" };
}

function pointInTimeState(request: P6BacktestRequest): { verified: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let verified = true;
  for (let i = 0; i < request.bars.length - 1; i += 1) {
    const bar = request.bars[i];
    const next = request.bars[i + 1];
    if (!bar.availableAt) {
      verified = false;
      break;
    }
    if (Date.parse(bar.availableAt) > Date.parse(next.at)) {
      verified = false;
      break;
    }
  }
  if (!verified) warnings.push("Point-in-time availability could not be verified for every signal bar.");
  if (request.assumptions.pointInTimeRequired && !verified) {
    throw new Error("Backtest requires point-in-time verified bars. Provide availableAt timestamps or explicitly disable pointInTimeRequired.");
  }
  return { verified, warnings };
}

function benchmarkCurve(bars: P6BacktestBar[], startingCapital: number): Array<{ at: string; value: number }> {
  if (!bars.length) return [];
  const base = bars[0].close;
  return bars.map((bar) => ({ at: bar.at, value: startingCapital * bar.close / base }));
}

function maxDrawdownCurve(equity: Array<{ at: string; value: number }>): Array<{ at: string; value: number }> {
  let peak = 0;
  return equity.map((point) => {
    peak = Math.max(peak, point.value);
    return { at: point.at, value: peak > 0 ? point.value / peak - 1 : 0 };
  });
}

function annualizedReturn(startingCapital: number, endingCapital: number, bars: P6BacktestBar[]): number {
  if (bars.length < 2 || startingCapital <= 0 || endingCapital <= 0) return 0;
  const elapsedMs = Date.parse(bars[bars.length - 1].at) - Date.parse(bars[0].at);
  const years = elapsedMs / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 1 / 365.25) return endingCapital / startingCapital - 1;
  return Math.pow(endingCapital / startingCapital, 1 / years) - 1;
}

function metricsFor(
  request: P6BacktestRequest,
  equity: Array<{ at: string; value: number }>,
  drawdown: Array<{ at: string; value: number }>,
  trades: P6BacktestTrade[],
  benchmark: Array<{ at: string; value: number }>,
  evaluationBars: P6BacktestBar[],
): P6BacktestResult["metrics"] {
  const start = request.assumptions.startingCapital;
  const end = equity.at(-1)?.value ?? start;
  const returns = equity.slice(1).map((point, index) => point.value / equity[index].value - 1);
  const mean = average(returns);
  const vol = sampleStd(returns) * Math.sqrt(252);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = Math.sqrt(average(downside.map((value) => value * value))) * Math.sqrt(252);
  const rfDaily = Math.pow(1 + request.assumptions.riskFreeRateAnnual, 1 / 252) - 1;
  const sharpe = returns.length && sampleStd(returns) > 0 ? (mean - rfDaily) / sampleStd(returns) * Math.sqrt(252) : 0;
  const sortino = returns.length && downsideDeviation > 0 ? (mean - rfDaily) * 252 / downsideDeviation : 0;
  const sells = trades.filter((trade) => trade.side === "sell");
  const completedPnls: number[] = [];
  let openCost: number | null = null;
  for (const trade of trades) {
    if (trade.side === "buy") openCost = trade.grossValue + trade.fees;
    else if (openCost !== null) {
      completedPnls.push(trade.grossValue - trade.fees - openCost);
      openCost = null;
    }
  }
  const wins = completedPnls.filter((value) => value > 0).length;
  const turnover = trades.reduce((sum, trade) => sum + trade.grossValue, 0) / start;
  const costs = trades.reduce((sum, trade) => sum + trade.fees + trade.slippageCost, 0) / start;
  const benchmarkEnd = benchmark.at(-1)?.value ?? start;
  const benchmarkReturn = benchmark.length ? benchmarkEnd / start - 1 : null;
  const totalReturn = end / start - 1;
  return {
    totalReturn,
    annualizedReturn: annualizedReturn(start, end, evaluationBars),
    annualizedVolatility: vol,
    sharpe,
    sortino,
    maxDrawdown: drawdown.reduce((minimum, point) => Math.min(minimum, point.value), 0),
    winRate: sells.length ? wins / sells.length : 0,
    turnover,
    tradeCount: trades.length,
    costImpact: costs,
    benchmarkReturn,
    excessReturn: benchmarkReturn === null ? null : totalReturn - benchmarkReturn,
  };
}

function runP6BacktestCore(input: P6BacktestRequest, evaluationStartIndex = 0): P6BacktestResult {
  const request = p6BacktestRequestSchema.parse(input);
  const boundedEvaluationStart = Math.max(0, Math.min(request.bars.length - 1, Math.floor(evaluationStartIndex)));
  assertBars(request.bars);
  if (request.benchmarkBars) assertBars(request.benchmarkBars);
  const pit = pointInTimeState(request);
  const warnings = [...pit.warnings];
  if (request.assumptions.maxParticipationRate !== null && request.bars.some((bar) => bar.volume === null)) {
    warnings.push("Liquidity participation cap could not be applied to bars without volume.");
  }

  const strategyHash = p6Hash(request.strategy);
  const inputHash = p6Hash({
    instrumentRef: request.instrumentRef,
    bars: request.bars,
    benchmarkBars: request.benchmarkBars,
    assumptions: request.assumptions,
    sourceRefs: request.sourceRefs,
    evaluationStartIndex: boundedEvaluationStart,
  });
  const reproducibilityHash = p6Hash({ engineId: ENGINE_ID, engineVersion: ENGINE_VERSION, strategyHash, inputHash });

  let cash = request.assumptions.startingCapital;
  let quantity = 0;
  let pending: { signal: Exclude<Signal, null>; signalAt: string; reason: string } | null = null;
  const trades: P6BacktestTrade[] = [];
  const equity: Array<{ at: string; value: number }> = [];
  const exposure: Array<{ at: string; value: number }> = [];
  const feeRate = request.assumptions.feesBps / 10_000;
  const slippageRate = request.assumptions.slippageBps / 10_000;
  const signalContext = buildStrategySignalContext(request.strategy, request.bars);

  for (let i = 0; i < request.bars.length; i += 1) {
    const bar = request.bars[i];
    if (pending) {
      const rawPrice = request.assumptions.execution === "next_bar_close" ? bar.close : bar.open;
      if (pending.signal === "buy" && quantity === 0 && cash > 0) {
        const price = rawPrice * (1 + slippageRate);
        let desiredQuantity = cash / (price * (1 + feeRate));
        if (request.assumptions.maxParticipationRate !== null && bar.volume !== null) {
          desiredQuantity = Math.min(desiredQuantity, bar.volume * request.assumptions.maxParticipationRate);
        }
        if (desiredQuantity > 0) {
          const grossValue = desiredQuantity * price;
          const fees = grossValue * feeRate;
          const slippageCost = desiredQuantity * Math.abs(price - rawPrice);
          cash -= grossValue + fees;
          quantity = desiredQuantity;
          trades.push({
            side: "buy",
            signalAt: pending.signalAt,
            executedAt: bar.at,
            price,
            rawPrice,
            quantity: desiredQuantity,
            grossValue,
            fees,
            slippageCost,
            reason: pending.reason,
          });
        }
      } else if (pending.signal === "sell" && quantity > 0) {
        const price = rawPrice * (1 - slippageRate);
        const grossValue = quantity * price;
        const fees = grossValue * feeRate;
        const slippageCost = quantity * Math.abs(price - rawPrice);
        trades.push({
          side: "sell",
          signalAt: pending.signalAt,
          executedAt: bar.at,
          price,
          rawPrice,
          quantity,
          grossValue,
          fees,
          slippageCost,
          reason: pending.reason,
        });
        cash += grossValue - fees;
        quantity = 0;
      }
      pending = null;
    }

    const marked = cash + quantity * bar.close;
    if (i >= boundedEvaluationStart) {
      equity.push({ at: bar.at, value: marked });
      exposure.push({ at: bar.at, value: marked > 0 ? quantity * bar.close / marked : 0 });
    }

    if (i < request.bars.length - 1 && i >= Math.max(0, boundedEvaluationStart - 1)) {
      const nextSignal = signalFor(request.strategy, request.bars, i, quantity > 0, signalContext);
      if (nextSignal.signal) pending = { signal: nextSignal.signal, signalAt: bar.at, reason: nextSignal.reason };
    }
  }

  const benchmarkSource = request.benchmarkBars && request.benchmarkBars.length ? request.benchmarkBars : request.bars;
  const benchmarkEvaluation = benchmarkSource.slice(boundedEvaluationStart);
  const benchmark = benchmarkCurve(benchmarkEvaluation, request.assumptions.startingCapital);
  const drawdown = maxDrawdownCurve(equity);
  const evaluationBars = request.bars.slice(boundedEvaluationStart);
  const result = {
    schemaVersion: "1" as const,
    engineId: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    status: "completed" as const,
    reproducibilityHash,
    reproducibilityId: stableUuidFromHash(reproducibilityHash),
    strategyHash,
    inputHash,
    pointInTimeVerified: pit.verified,
    equityCurve: equity,
    drawdown,
    benchmark,
    exposure,
    trades,
    metrics: metricsFor(request, equity, drawdown, trades, benchmark, evaluationBars),
    assumptions: request.assumptions,
    warnings,
    sourceRefs: request.sourceRefs,
  };
  return p6BacktestResultSchema.parse(result);
}

export function runP6Backtest(input: P6BacktestRequest): P6BacktestResult {
  return runP6BacktestCore(input, 0);
}

export function backtestLifecycle(currentInputHash: string | null, lastResult: P6BacktestResult | null, running = false, error: string | null = null): P6BacktestLifecycle {
  if (running) return { state: "running", lastSuccessfulHash: lastResult?.inputHash ?? null, currentInputHash, message: "Backtest is running." };
  if (error) return { state: "failed", lastSuccessfulHash: lastResult?.inputHash ?? null, currentInputHash, message: error };
  if (!lastResult) return { state: "edited_not_run", lastSuccessfulHash: null, currentInputHash, message: "Inputs have not been run." };
  if (currentInputHash && currentInputHash !== lastResult.inputHash) {
    return { state: "stale", lastSuccessfulHash: lastResult.inputHash, currentInputHash, message: "Inputs changed after the last completed run." };
  }
  return { state: "completed", lastSuccessfulHash: lastResult.inputHash, currentInputHash: currentInputHash ?? lastResult.inputHash, message: "Backtest result matches current inputs." };
}

export function runP6ParameterSweep(input: unknown): Array<{ value: number; metrics: P6BacktestResult["metrics"]; reproducibilityHash: string }> {
  const request = p6ParameterSweepRequestSchema.parse(input);
  return request.values.map((value) => {
    const strategy = {
      ...request.request.strategy,
      parameters: { ...request.request.strategy.parameters, [request.parameter]: value },
    };
    const result = runP6Backtest({ ...request.request, strategy });
    return { value, metrics: result.metrics, reproducibilityHash: result.reproducibilityHash };
  });
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let x = state;
    x = Math.imul(x ^ x >>> 15, x | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

export function runP6MonteCarlo(input: unknown): {
  paths: number;
  seed: number;
  endingEquity: { p05: number; p50: number; p95: number };
  maxDrawdown: { p05: number; p50: number; p95: number };
} {
  const request = p6MonteCarloRequestSchema.parse(input);
  const equity = request.result.equityCurve;
  if (equity.length < 3) throw new Error("Monte Carlo requires at least three equity observations.");
  const returns = equity.slice(1).map((point, index) => point.value / equity[index].value - 1);
  const start = equity[0].value;
  const random = seededRandom(request.seed);
  const endings: number[] = [];
  const drawdowns: number[] = [];
  for (let path = 0; path < request.paths; path += 1) {
    let value = start;
    let peak = start;
    let maxDd = 0;
    for (let i = 0; i < returns.length; i += 1) {
      const sampled = returns[Math.floor(random() * returns.length)];
      value *= 1 + sampled;
      peak = Math.max(peak, value);
      maxDd = Math.min(maxDd, peak > 0 ? value / peak - 1 : 0);
    }
    endings.push(value);
    drawdowns.push(maxDd);
  }
  return {
    paths: request.paths,
    seed: request.seed,
    endingEquity: { p05: quantile(endings, 0.05), p50: quantile(endings, 0.5), p95: quantile(endings, 0.95) },
    maxDrawdown: { p05: quantile(drawdowns, 0.05), p50: quantile(drawdowns, 0.5), p95: quantile(drawdowns, 0.95) },
  };
}

export function runP6WalkForward(input: {
  request: P6BacktestRequest;
  trainBars: number;
  testBars: number;
}): Array<{ startAt: string; endAt: string; result: P6BacktestResult }> {
  const request = p6BacktestRequestSchema.parse(input.request);
  const trainBars = Math.max(2, Math.floor(input.trainBars));
  const testBars = Math.max(2, Math.floor(input.testBars));
  if (trainBars + testBars > request.bars.length) throw new Error("Walk-forward window exceeds available history.");
  const results: Array<{ startAt: string; endAt: string; result: P6BacktestResult }> = [];
  for (let testStart = trainBars; testStart < request.bars.length - 1; testStart += testBars) {
    const testEndExclusive = Math.min(request.bars.length, testStart + testBars);
    const warmupStart = Math.max(0, testStart - trainBars);
    const bars = request.bars.slice(warmupStart, testEndExclusive);
    if (bars.length < 3) continue;
    const evaluationStartIndex = testStart - warmupStart;
    const result = runP6BacktestCore({
      ...request,
      bars,
      benchmarkBars: null,
      sourceRefs: [...request.sourceRefs, "walk-forward:" + testStart + "-" + (testEndExclusive - 1)],
    }, evaluationStartIndex);
    results.push({ startAt: request.bars[testStart].at, endAt: request.bars[testEndExclusive - 1].at, result });
  }
  return results;
}

export const P6_BACKTEST_ENGINE = {
  id: ENGINE_ID,
  version: ENGINE_VERSION,
  executionTiming: ["next_bar_open", "next_bar_close"] as const,
  lookAheadPolicy: "signal_on_bar_t_execute_on_bar_t_plus_1" as const,
  supports: ["fees", "slippage", "liquidity_participation", "point_in_time", "parameter_sweep", "walk_forward", "seeded_monte_carlo"] as const,
};
