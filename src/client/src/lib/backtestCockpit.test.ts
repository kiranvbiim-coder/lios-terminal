import test from "node:test";
import assert from "node:assert/strict";
import { buildBacktestCockpitModel, p6BacktestStateLabel, strategyStudioState } from "./backtestCockpit";
import type { P6BacktestResult } from "@shared/p6FinanceContracts";

const result: P6BacktestResult = {
  schemaVersion: "1",
  engineId: "lios.backtest.core-v1",
  engineVersion: "1.0.0",
  status: "completed",
  reproducibilityHash: "a".repeat(64),
  reproducibilityId: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
  strategyHash: "b".repeat(64),
  inputHash: "c".repeat(64),
  pointInTimeVerified: true,
  equityCurve: [{ at: "2026-01-01T00:00:00.000Z", value: 100 }],
  drawdown: [{ at: "2026-01-01T00:00:00.000Z", value: 0 }],
  benchmark: [{ at: "2026-01-01T00:00:00.000Z", value: 100 }],
  exposure: [{ at: "2026-01-01T00:00:00.000Z", value: 0 }],
  trades: [],
  metrics: {
    totalReturn: 0,
    annualizedReturn: 0,
    annualizedVolatility: 0,
    sharpe: 0,
    sortino: 0,
    maxDrawdown: 0,
    winRate: 0,
    turnover: 0,
    tradeCount: 0,
    costImpact: 0,
    benchmarkReturn: 0,
    excessReturn: 0,
  },
  assumptions: {
    startingCapital: 100,
    feesBps: 5,
    slippageBps: 10,
    riskFreeRateAnnual: 0,
    execution: "next_bar_open",
    maxParticipationRate: null,
    pointInTimeRequired: true,
    seed: 1,
  },
  warnings: [],
  sourceRefs: [],
};

test("backtest cockpit never labels historical simulation as live performance", () => {
  const model = buildBacktestCockpitModel(result, {
    state: "completed",
    lastSuccessfulHash: result.inputHash,
    currentInputHash: result.inputHash,
    message: null,
  });
  assert.equal(model.isHistoricalSimulation, true);
  assert.equal(model.livePerformance, false);
  assert.match(model.stateLabel, /historical simulation/i);
  assert.ok(model.headline.some((item) => item.label === "Sortino"));
  assert.equal(model.costs.slippageBps, 10);
});

test("backtest state labels distinguish edited, running, completed, failed and stale", () => {
  assert.match(p6BacktestStateLabel("edited_not_run"), /not run/i);
  assert.equal(p6BacktestStateLabel("running"), "Running");
  assert.match(p6BacktestStateLabel("completed"), /historical/i);
  assert.equal(p6BacktestStateLabel("failed"), "Failed");
  assert.match(p6BacktestStateLabel("stale"), /Stale/);
});

test("Strategy Studio falls back to builtin editor and keeps execution sandboxed", () => {
  const fallback = strategyStudioState({ preferMonaco: true, monacoAvailable: false, language: "brue" });
  assert.equal(fallback.editor, "builtin");
  assert.equal(fallback.sandboxed, true);
  assert.equal(fallback.brokerAccess, false);
  assert.equal(fallback.credentialAccess, false);

  const optional = strategyStudioState({ preferMonaco: true, monacoAvailable: true });
  assert.equal(optional.editor, "monaco_optional");
});
