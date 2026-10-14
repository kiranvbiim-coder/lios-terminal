import test from "node:test";
import assert from "node:assert/strict";
import {
  backtestLifecycle,
  p6WilderRsiSeries,
  runP6Backtest,
  runP6MonteCarlo,
  runP6ParameterSweep,
  runP6WalkForward,
} from "./p6BacktestEngine";
import type { P6BacktestBar, P6BacktestRequest } from "@shared/p6FinanceContracts";

function bars(count = 90): P6BacktestBar[] {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(start + index * 86_400_000).toISOString();
    const base = 100 + index * 0.4 + Math.sin(index / 4) * 3;
    const open = base;
    const close = base + Math.sin(index / 3);
    return {
      at,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1_000_000,
      availableAt: at,
    };
  });
}

function request(overrides: Partial<P6BacktestRequest> = {}): P6BacktestRequest {
  return {
    schemaVersion: "1",
    strategy: {
      schemaVersion: "1",
      id: "buy-hold",
      name: "Buy and hold",
      kind: "buy_and_hold",
      parameters: {},
      sourceLanguage: "rules",
      source: "enter once",
    },
    instrumentRef: "TEST",
    bars: bars(),
    benchmarkBars: null,
    assumptions: {
      startingCapital: 100_000,
      feesBps: 0,
      slippageBps: 0,
      riskFreeRateAnnual: 0,
      execution: "next_bar_open",
      maxParticipationRate: null,
      pointInTimeRequired: true,
      seed: 7,
    },
    sourceRefs: ["test:bars"],
    ...overrides,
  };
}

test("P6 backtest executes a signal no earlier than the next bar", () => {
  const input = request();
  const result = runP6Backtest(input);
  assert.equal(result.trades[0].side, "buy");
  assert.equal(result.trades[0].signalAt, input.bars[0].at);
  assert.equal(result.trades[0].executedAt, input.bars[1].at);
  assert.equal(result.pointInTimeVerified, true);
  assert.equal(result.status, "completed");
  assert.equal(result.engineId, "lios.backtest.core-v1");
});

test("P6 point-in-time required mode rejects latest-only bars", () => {
  const latestOnly = bars().map((bar) => ({ ...bar, availableAt: null }));
  assert.throws(
    () => runP6Backtest(request({ bars: latestOnly })),
    /point-in-time verified bars/i,
  );
  const allowed = runP6Backtest(request({
    bars: latestOnly,
    assumptions: { ...request().assumptions, pointInTimeRequired: false },
  }));
  assert.equal(allowed.pointInTimeVerified, false);
  assert.ok(allowed.warnings.some((warning) => /Point-in-time/.test(warning)));
});

test("fees and slippage reduce deterministic ending equity", () => {
  const free = runP6Backtest(request());
  const costly = runP6Backtest(request({
    assumptions: {
      ...request().assumptions,
      feesBps: 25,
      slippageBps: 25,
    },
  }));
  assert.ok(costly.equityCurve.at(-1)!.value < free.equityCurve.at(-1)!.value);
  assert.ok(costly.metrics.costImpact > 0);
});

test("same strategy, data and assumptions produce the same reproducibility identity", () => {
  const a = runP6Backtest(request());
  const b = runP6Backtest(request());
  assert.equal(a.reproducibilityHash, b.reproducibilityHash);
  assert.equal(a.reproducibilityId, b.reproducibilityId);
  assert.equal(a.inputHash, b.inputHash);
});

test("backtest lifecycle exposes edited, completed and stale states", () => {
  const result = runP6Backtest(request());
  assert.equal(backtestLifecycle(result.inputHash, result).state, "completed");
  assert.equal(backtestLifecycle("0".repeat(64), result).state, "stale");
  assert.equal(backtestLifecycle(result.inputHash, null).state, "edited_not_run");
  assert.equal(backtestLifecycle(result.inputHash, result, true).state, "running");
  assert.equal(backtestLifecycle(result.inputHash, result, false, "boom").state, "failed");
});

test("parameter sweep and seeded Monte Carlo are deterministic", () => {
  const base = request({
    strategy: {
      schemaVersion: "1",
      id: "rsi",
      name: "RSI",
      kind: "rsi_mean_reversion",
      parameters: { rsiPeriod: 8, oversold: 45, overbought: 55 },
      sourceLanguage: "rules",
      source: "rsi",
    },
  });
  const sweep = runP6ParameterSweep({ request: base, parameter: "rsiPeriod", values: [6, 8, 10] });
  assert.equal(sweep.length, 3);
  assert.equal(new Set(sweep.map((item) => item.reproducibilityHash)).size, 3);

  const result = runP6Backtest(base);
  const a = runP6MonteCarlo({ result, paths: 100, seed: 42 });
  const b = runP6MonteCarlo({ result, paths: 100, seed: 42 });
  assert.deepEqual(a, b);
  assert.equal(a.paths, 100);
});

test("walk-forward evaluation reports only the out-of-sample test window", () => {
  const result = runP6WalkForward({ request: request(), trainBars: 30, testBars: 15 });
  assert.ok(result.length >= 3);
  for (const window of result) {
    assert.equal(window.result.status, "completed");
    assert.ok(window.startAt <= window.endAt);
    assert.equal(window.result.equityCurve[0].at, window.startAt);
    assert.equal(window.result.benchmark[0].at, window.startAt);
    assert.ok(window.result.trades.every((trade) => trade.executedAt >= window.startAt));
    assert.ok(window.result.sourceRefs.some((ref) => ref.startsWith("walk-forward:")));
  }
});

test("liquidity participation caps position size when volume is supplied", () => {
  const lowVolume = bars().map((bar) => ({ ...bar, volume: 10 }));
  const result = runP6Backtest(request({
    bars: lowVolume,
    assumptions: { ...request().assumptions, maxParticipationRate: 0.1 },
  }));
  assert.ok(result.trades[0].quantity <= 1 + 1e-10);
});


test("P6 backtest RSI matches the Wilder indicator parity contract", () => {
  const closes = [44.0,44.15,43.9,44.35,44.8,44.6,45.1,45.4,45.0,45.3,45.7,45.5,45.9,46.2,46.0,46.4,46.8,46.5,46.9,47.2,47.0,47.5];
  const expected = [
    72.22222222222223,
    74.64898595943836,
    76.82900076779642,
    71.83932530196526,
    74.24143177757068,
    75.90171178819294,
    72.54465665529345,
    75.46610431305275,
  ];
  const values = p6WilderRsiSeries(closes, 14);
  assert.equal(values.slice(0, 14).every((value) => value === null), true);
  expected.forEach((value, index) => {
    assert.ok(Math.abs((values[index + 14] as number) - value) < 1e-10);
  });
});
