import type { P6BacktestLifecycle, P6BacktestResult } from "@shared/p6FinanceContracts";

export interface BacktestCockpitModel {
  state: P6BacktestLifecycle["state"];
  stateLabel: string;
  isHistoricalSimulation: true;
  livePerformance: false;
  headline: Array<{ label: string; value: number | null; format: "percent" | "number" | "integer" }>;
  priceSignals: Array<{ at: string; side: "buy" | "sell"; price: number; reason: string }>;
  equity: P6BacktestResult["equityCurve"];
  drawdown: P6BacktestResult["drawdown"];
  benchmark: P6BacktestResult["benchmark"];
  exposure: P6BacktestResult["exposure"];
  trades: P6BacktestResult["trades"];
  costs: {
    feesBps: number;
    slippageBps: number;
    costImpact: number;
  };
  reproducibility: {
    engineId: string;
    engineVersion: string;
    reproducibilityHash: string;
    pointInTimeVerified: boolean;
    warnings: string[];
  };
}

export function p6BacktestStateLabel(state: P6BacktestLifecycle["state"]): string {
  switch (state) {
    case "edited_not_run": return "Edited · not run";
    case "running": return "Running";
    case "completed": return "Completed historical simulation";
    case "failed": return "Failed";
    case "stale": return "Stale · inputs changed";
  }
}

export function buildBacktestCockpitModel(result: P6BacktestResult, lifecycle: P6BacktestLifecycle): BacktestCockpitModel {
  return {
    state: lifecycle.state,
    stateLabel: p6BacktestStateLabel(lifecycle.state),
    isHistoricalSimulation: true,
    livePerformance: false,
    headline: [
      { label: "Total return", value: result.metrics.totalReturn, format: "percent" },
      { label: "Annualized return", value: result.metrics.annualizedReturn, format: "percent" },
      { label: "Sharpe", value: result.metrics.sharpe, format: "number" },
      { label: "Sortino", value: result.metrics.sortino, format: "number" },
      { label: "Max drawdown", value: result.metrics.maxDrawdown, format: "percent" },
      { label: "Win rate", value: result.metrics.winRate, format: "percent" },
      { label: "Trades", value: result.metrics.tradeCount, format: "integer" },
      { label: "Turnover", value: result.metrics.turnover, format: "percent" },
      { label: "Cost impact", value: result.metrics.costImpact, format: "percent" },
      { label: "Benchmark return", value: result.metrics.benchmarkReturn, format: "percent" },
      { label: "Excess return", value: result.metrics.excessReturn, format: "percent" },
    ],
    priceSignals: result.trades.map((trade) => ({
      at: trade.executedAt,
      side: trade.side,
      price: trade.price,
      reason: trade.reason,
    })),
    equity: result.equityCurve,
    drawdown: result.drawdown,
    benchmark: result.benchmark,
    exposure: result.exposure,
    trades: result.trades,
    costs: {
      feesBps: result.assumptions.feesBps,
      slippageBps: result.assumptions.slippageBps,
      costImpact: result.metrics.costImpact,
    },
    reproducibility: {
      engineId: result.engineId,
      engineVersion: result.engineVersion,
      reproducibilityHash: result.reproducibilityHash,
      pointInTimeVerified: result.pointInTimeVerified,
      warnings: result.warnings,
    },
  };
}

export interface StrategyStudioState {
  editor: "builtin" | "monaco_optional";
  language: "rules" | "json" | "brue";
  validation: "unvalidated" | "valid" | "invalid";
  sandboxed: true;
  externalSideEffects: false;
  brokerAccess: false;
  credentialAccess: false;
}

export function strategyStudioState(input: {
  preferMonaco?: boolean;
  monacoAvailable?: boolean;
  language?: "rules" | "json" | "brue";
  validation?: "unvalidated" | "valid" | "invalid";
} = {}): StrategyStudioState {
  return {
    editor: input.preferMonaco && input.monacoAvailable ? "monaco_optional" : "builtin",
    language: input.language ?? "rules",
    validation: input.validation ?? "unvalidated",
    sandboxed: true,
    externalSideEffects: false,
    brokerAccess: false,
    credentialAccess: false,
  };
}
