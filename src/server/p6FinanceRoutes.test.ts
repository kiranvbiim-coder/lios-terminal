import test from "node:test";
import assert from "node:assert/strict";
import { createP6FinanceRouteHandlers, marketBarsToP6Bars, p6BacktestRunRequestSchema, runP6MarketBacktest } from "./p6FinanceRoutes";

const bars = Array.from({ length: 80 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
  const open = 100 + index * 0.3;
  const close = open + Math.sin(index / 4);
  return { date, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1_000_000 };
});

test("P6 market route request validates strategy and bounded assumptions", () => {
  const parsed = p6BacktestRunRequestSchema.parse({
    symbol: "aapl",
    range: "5Y",
    strategy: { schemaVersion: "1", id: "bh", name: "Buy and Hold", kind: "buy_and_hold", parameters: {}, sourceLanguage: "rules", source: "" },
    assumptions: { startingCapital: 250000, feesBps: 8, slippageBps: 4, maxParticipationRate: 0.1, seed: 7 },
  });
  assert.equal(parsed.symbol, "aapl");
  assert.equal(parsed.assumptions.feesBps, 8);
});

test("P6 market bars never invent publication availability clocks", () => {
  const converted = marketBarsToP6Bars(bars);
  assert.equal(converted[0].availableAt, null);
  assert.equal(converted[0].at, "2025-01-01T00:00:00.000Z");
});

test("P6 market route delegates to canonical next-bar backtest and labels PIT limitation", async () => {
  const response = await runP6MarketBacktest({
    symbol: "TEST",
    range: "5Y",
    strategy: { schemaVersion: "1", id: "bh", name: "Buy and Hold", kind: "buy_and_hold", parameters: {}, sourceLanguage: "rules", source: "" },
    assumptions: { startingCapital: 100000, feesBps: 5, slippageBps: 5, riskFreeRateAnnual: 0, maxParticipationRate: 0.05, seed: 42 },
  }, async () => bars);

  assert.equal(response.result.engineId, "lios.backtest.core-v1");
  assert.equal(response.result.pointInTimeVerified, false);
  assert.equal(response.result.trades[0].signalAt, response.result.equityCurve[0].at);
  assert.equal(response.result.trades[0].executedAt, response.result.equityCurve[1].at);
  assert.ok(response.result.warnings.some((warning) => /not point-in-time verified/i.test(warning)));
});


test("P6 market route refuses optional strategy languages until their governed runtime is active", async () => {
  await assert.rejects(
    () => runP6MarketBacktest({
      symbol: "TEST",
      range: "5Y",
      strategy: { schemaVersion: "1", id: "brue-1", name: "Brue draft", kind: "buy_and_hold", parameters: {}, sourceLanguage: "brue", source: "strategy Demo {}" },
      assumptions: { startingCapital: 100000, feesBps: 5, slippageBps: 5, riskFreeRateAnnual: 0, maxParticipationRate: 0.05, seed: 42 },
    }, async () => bars),
    /governed adapter/i,
  );
});

test("P6 personal-finance route validates and returns the deterministic snapshot", async () => {
  const handlers = createP6FinanceRouteHandlers();
  let statusCode = 200;
  let body: unknown;
  await handlers.runPersonalFinance(
    { body: {
      schemaVersion: "1", asOf: "2026-09-22",
      accounts: [
        { id: "bank", kind: "bank", balance: 200000, currency: "USD" },
        { id: "loan", kind: "loan", balance: -50000, currency: "USD" },
      ],
      transactions: [], debts: [], goals: [],
    } } as never,
    { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; return this; } } as never,
  );
  assert.equal(statusCode, 200);
  assert.equal((body as { engineId: string }).engineId, "lios.personal-finance.core-v1");
  assert.equal((body as { netWorth: number }).netWorth, 150000);
});

