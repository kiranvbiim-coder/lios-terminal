import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateOptionsFlow,
  buildFixedIncomeLadder,
  calculateLiquidityStress,
  calculateRiskContribution,
  runPortfolioScenarioStress,
} from "./p6RiskFixedDerivatives";

test("risk contribution reconciles component risk to portfolio volatility", () => {
  const result = calculateRiskContribution({
    positions: [
      { id: "A", weight: 0.6, marketValue: 60000, sector: "Tech", currency: "USD", averageDailyVolumeValue: 1000000 },
      { id: "B", weight: 0.4, marketValue: 40000, sector: "Health", currency: "EUR", averageDailyVolumeValue: 500000 },
    ],
    covariance: [[0.04, 0.01], [0.01, 0.0225]],
  });
  const component = result.positions.reduce((sum, row) => sum + row.componentRisk, 0);
  assert.ok(Math.abs(component - result.portfolioVolatility) < 1e-10);
  const pct = result.positions.reduce((sum, row) => sum + row.percentContribution, 0);
  assert.ok(Math.abs(pct - 1) < 1e-10);
});

test("sector/currency scenario and liquidity stress stay explicit", () => {
  const positions = [
    { id: "A", weight: 0.5, marketValue: 50000, sector: "Tech", currency: "USD", averageDailyVolumeValue: 100000 },
    { id: "B", weight: 0.5, marketValue: 50000, sector: "Bank", currency: "EUR", averageDailyVolumeValue: null },
  ];
  const stress = runPortfolioScenarioStress({ positions, marketShock: -0.05, sectorShocks: { Tech: -0.1 }, currencyShocks: { EUR: -0.03 } });
  assert.ok(stress.totalPnl < 0);
  const liquidity = calculateLiquidityStress({ positions, participationRate: 0.1, volumeHaircut: 0.5 });
  assert.ok((liquidity.positions[0].daysToLiquidate ?? 0) > 0);
  assert.equal(liquidity.positions[1].daysToLiquidate, null);
  assert.ok(liquidity.warnings.length > 0);
});

test("fixed-income ladder buckets cash flows and preserves duration", () => {
  const result = buildFixedIncomeLadder({
    asOf: "2026-01-01",
    bucketMonths: 12,
    instruments: [
      { id: "B1", marketValue: 1000, maturityDate: "2027-06-01", couponCashflows: [{ date: "2026-06-01", amount: 25 }, { date: "2027-06-01", amount: 50 }], principalCashflow: 1000, duration: 1.3 },
      { id: "B2", marketValue: 2000, maturityDate: "2029-06-01", couponCashflows: [{ date: "2029-06-01", amount: 100 }], principalCashflow: 2000, duration: 3.1 },
    ],
  });
  assert.equal(result.totalMarketValue, 3000);
  assert.equal(result.buckets.length, 3);
  assert.equal(result.buckets[0].cashflow, 25);
  assert.ok((result.weightedDuration ?? 0) > 2);
  assert.equal(result.buckets.reduce((sum, row) => sum + row.cashflow, 0), 3175);
});

test("options flow aggregates premium and open-interest concentration", () => {
  const result = aggregateOptionsFlow([
    { expiry: "2026-12-18", strike: 100, optionType: "call", side: "buy", premium: 5000, openInterest: 100, volume: 20 },
    { expiry: "2026-12-18", strike: 100, optionType: "put", side: "sell", premium: 2000, openInterest: 50, volume: 10 },
    { expiry: "2026-12-18", strike: 110, optionType: "put", side: "buy", premium: 3000, openInterest: 150, volume: 30 },
  ]);
  assert.equal(result.callNetPremium, 5000);
  assert.equal(result.putNetPremium, 1000);
  assert.equal(result.putCallOpenInterestRatio, 2);
  assert.equal(result.strikes[0].strike, 100);
});
