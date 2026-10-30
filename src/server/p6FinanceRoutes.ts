import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  p6PersonalFinanceRequestSchema,
  p6StrategyDefinitionSchema,
  type P6BacktestBar,
  type P6PersonalFinanceRequest,
  type P6StrategyDefinition,
} from "@shared/p6FinanceContracts";
import { requireAuth } from "./auth";
import { getOHLCV, type OHLCVBar } from "./marketData";
import { runP6Backtest } from "./p6BacktestEngine";
import { calculatePersonalFinanceSnapshot, type PersonalFinanceSnapshot } from "./p6PersonalFinance";
import { normalizeP6PersonalFinanceFx } from "./p6PersonalFxNormalization";
import { resolvePersistedCurrency } from "./currencyMasterStore";
import { resolveFxRateEvidenceAsOf } from "./fxRateStore";
import { assertExecutionAllowed, respondReadOnly } from "./accessMode";

export const p6BacktestRunRequestSchema = z.object({
  symbol: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9.^_=-]+$/),
  range: z.enum(["1Y", "5Y", "25Y", "MAX"]).default("5Y"),
  strategy: p6StrategyDefinitionSchema,
  assumptions: z.object({
    startingCapital: z.number().finite().positive().default(100_000),
    feesBps: z.number().finite().min(0).max(10_000).default(5),
    slippageBps: z.number().finite().min(0).max(10_000).default(5),
    riskFreeRateAnnual: z.number().finite().min(-1).max(10).default(0),
    maxParticipationRate: z.number().finite().gt(0).max(1).nullable().default(0.05),
    seed: z.number().int().default(20260922),
  }).strict().default({}),
}).strict();
export type P6BacktestRunRequest = z.infer<typeof p6BacktestRunRequestSchema>;

function barTimestamp(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date + "T00:00:00.000Z";
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Historical data contains an invalid bar date.");
  return parsed.toISOString();
}

export function marketBarsToP6Bars(bars: OHLCVBar[]): P6BacktestBar[] {
  return bars.map((bar) => ({
    at: barTimestamp(bar.date),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume : null,
    // The legacy market-data API exposes observation time, not when each
    // value first became knowable. Never infer a point-in-time clock.
    availableAt: null,
  }));
}

export async function runP6MarketBacktest(
  input: P6BacktestRunRequest,
  loadBars: (symbol: string, range: string) => Promise<OHLCVBar[]> = (symbol, range) => getOHLCV(symbol, range, "1d"),
) {
  const request = p6BacktestRunRequestSchema.parse(input);
  if (request.strategy.sourceLanguage !== "rules") {
    throw new Error("The built-in LiOS backtest engine executes rule strategies only. Optional Brue/JSON runtimes must be activated behind their own governed adapter before execution.");
  }
  const symbol = request.symbol.toUpperCase();
  const marketBars = await loadBars(symbol, request.range);
  const bars = marketBarsToP6Bars(marketBars);
  if (bars.length < 3) throw new Error("At least three historical observations are required to run a backtest.");

  const result = runP6Backtest({
    schemaVersion: "1",
    strategy: request.strategy as P6StrategyDefinition,
    instrumentRef: symbol,
    bars,
    benchmarkBars: null,
    assumptions: {
      ...request.assumptions,
      execution: "next_bar_open",
      pointInTimeRequired: false,
    },
    sourceRefs: ["finance:ohlcv:" + symbol + ":" + request.range + ":1d"],
  });

  const warning = "This market-history route does not expose publication/availableAt clocks. The simulation is deterministic but not point-in-time verified.";
  if (!result.warnings.includes(warning)) result.warnings.push(warning);
  return { symbol, range: request.range, barsUsed: bars.length, result };
}

export function runP6PersonalFinance(input: P6PersonalFinanceRequest): PersonalFinanceSnapshot | Promise<PersonalFinanceSnapshot> {
  const request = p6PersonalFinanceRequestSchema.parse(input);
  const snapshot = calculatePersonalFinanceSnapshot(request);
  if (!request.fxNormalization) return snapshot; // original synchronous API, no DB requirement
  return (async () => {
    const currency = await resolvePersistedCurrency(request.fxNormalization!.reportingCurrency);
    if (!currency || !currency.active || currency.code !== request.fxNormalization!.reportingCurrency) {
      throw new Error("Requested FX reporting currency is not an active registered currency.");
    }
    const fxNormalized = await normalizeP6PersonalFinanceFx(
      request, { code: currency.code, minorUnit: currency.minorUnit }, resolveFxRateEvidenceAsOf,
    );
    return { ...snapshot, fxNormalized, warnings: [
      ...snapshot.warnings,
      "The legacy base snapshot amounts are unconverted. Read fxNormalized only when its status is complete; never sum mixed-currency raw values.",
    ] };
  })();
}

type P6PersonalFinanceRunner = (input: P6PersonalFinanceRequest) => PersonalFinanceSnapshot | Promise<PersonalFinanceSnapshot>;

export function createP6FinanceRouteHandlers(
  runner: typeof runP6MarketBacktest = runP6MarketBacktest,
  personalFinanceRunner: P6PersonalFinanceRunner = runP6PersonalFinance,
) {
  return {
    runBacktest: async (req: Request, res: Response): Promise<void> => {
      const parsed = p6BacktestRunRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        await assertExecutionAllowed("analysis");
        res.json(await runner(parsed.data));
      } catch (error) {
        if (respondReadOnly(res, error)) return;
        res.status(422).json({ error: error instanceof Error ? error.message : "Backtest failed." });
      }
    },
    runPersonalFinance: async (req: Request, res: Response): Promise<void> => {
      const parsed = p6PersonalFinanceRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        await assertExecutionAllowed("analysis");
        res.json(await personalFinanceRunner(parsed.data));
      } catch (error) {
        if (respondReadOnly(res, error)) return;
        res.status(422).json({ error: error instanceof Error ? error.message : "Personal-finance calculation failed." });
      }
    },
  };
}

export function registerP6FinanceRoutes(app: Express): void {
  const handlers = createP6FinanceRouteHandlers();
  app.post("/api/finance/p6-backtest", requireAuth, handlers.runBacktest);
  app.post("/api/finance/p6-personal-finance", requireAuth, handlers.runPersonalFinance);
}
