import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMandatePreTrade,
  type MandatePreTradeInput,
  type MandatePreTradeSourceMetadata,
} from "./mandatePreTradeEngine";

const SOURCE: MandatePreTradeSourceMetadata = {
  source: "Manual client mandate entry",
  status: "manual",
  asOf: "2026-08-30",
  period: "current",
  unit: "decimal weight",
};

const GENEROUS_LIQUIDITY = {
  A: { maxTradeWeight: 1 },
  B: { maxTradeWeight: 1 },
};

test("evaluateMandatePreTrade: fully evidenced rebalance is feasible with exact cost known-answer", () => {
  const input: MandatePreTradeInput = {
    currentWeights: { A: 0.6, B: 0.4 },
    targetWeights: { A: 0.5, B: 0.5 },
    maxTurnover: 0.2,
    liquidity: GENEROUS_LIQUIDITY,
    transactionCost: { rate: 0.001 },
    taxCost: { rate: 0.002 },
    sourceMetadata: SOURCE,
  };
  const result = evaluateMandatePreTrade(input);
  assert.equal(result.status, "feasible");
  assert.equal(result.feasible, true);
  assert.equal(result.approvalRequired, true);
  assert.deepEqual(result.requiredEvidence, []);
  assert.deepEqual(result.violations, []);
  assert.equal(result.turnover, 0.1);
  // A is sold (0.6 -> 0.5), B is bought (0.4 -> 0.5); both notional weights 0.1.
  assert.equal(result.estimatedTransactionCost, 0.0002);
  // Only the sell leg (A) incurs tax cost: 0.1 * 0.002.
  assert.equal(result.estimatedTaxCost, 0.0002);
  assert.equal(result.totalEstimatedCost, 0.0004);
  assert.equal(result.provenance.sourceMode, "manual");
  assert.equal(result.provenance.status, "complete");
  assert.equal(result.proposalId, `mandate-pre-trade:${result.inputSnapshotHash}`);
});

test("evaluateMandatePreTrade: turnover above the mandate limit is rejected with an exact violation", () => {
  const input: MandatePreTradeInput = {
    currentWeights: { A: 1, B: 0 },
    targetWeights: { A: 0.5, B: 0.5 },
    maxTurnover: 0.1,
    liquidity: GENEROUS_LIQUIDITY,
    transactionCost: { rate: 0 },
    taxCost: { rate: 0 },
    sourceMetadata: SOURCE,
  };
  const result = evaluateMandatePreTrade(input);
  assert.equal(result.status, "rejected");
  assert.equal(result.feasible, false);
  assert.deepEqual(result.requiredEvidence, []);
  assert.equal(result.turnover, 0.5);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].code, "max_turnover");
  assert.equal(result.violations[0].observed, 0.5);
  assert.equal(result.violations[0].limit, 0.1);
});

test("evaluateMandatePreTrade: exceeding max/min weight bounds is rejected for both assets", () => {
  const input: MandatePreTradeInput = {
    currentWeights: { A: 0.5, B: 0.5 },
    targetWeights: { A: 0.7, B: 0.3 },
    maxTurnover: 0.5,
    maxWeights: { A: 0.6 },
    minWeights: { B: 0.35 },
    liquidity: GENEROUS_LIQUIDITY,
    transactionCost: { rate: 0 },
    taxCost: { rate: 0 },
    sourceMetadata: SOURCE,
  };
  const result = evaluateMandatePreTrade(input);
  assert.equal(result.status, "rejected");
  const maxViolation = result.violations.find((v) => v.code === "max_weight");
  const minViolation = result.violations.find((v) => v.code === "min_weight");
  assert.ok(maxViolation, "expected a max_weight violation");
  assert.equal(maxViolation!.asset, "A");
  assert.equal(maxViolation!.observed, 0.7);
  assert.equal(maxViolation!.limit, 0.6);
  assert.ok(minViolation, "expected a min_weight violation");
  assert.equal(minViolation!.asset, "B");
  assert.equal(minViolation!.observed, 0.3);
  assert.equal(minViolation!.limit, 0.35);
});

test("evaluateMandatePreTrade: a trade on a restricted asset is flagged, not silently dropped", () => {
  const input: MandatePreTradeInput = {
    currentWeights: { A: 0.5, B: 0.5 },
    targetWeights: { A: 0.6, B: 0.4 },
    maxTurnover: 0.5,
    restrictedAssets: ["A"],
    liquidity: GENEROUS_LIQUIDITY,
    transactionCost: { rate: 0 },
    taxCost: { rate: 0 },
    sourceMetadata: SOURCE,
  };
  const result = evaluateMandatePreTrade(input);
  assert.equal(result.restrictedAssetViolations.length, 1);
  assert.equal(result.restrictedAssetViolations[0].asset, "A");
  assert.equal(result.restrictedAssetViolations[0].code, "restricted_asset");
  assert.ok(result.violations.some((v) => v.code === "restricted_asset" && v.asset === "A"));
});

test("evaluateMandatePreTrade: ADV participation above the mandate rate is a liquidity violation", () => {
  const input: MandatePreTradeInput = {
    currentWeights: { A: 0.5, B: 0.5 },
    targetWeights: { A: 0.6, B: 0.4 },
    maxTurnover: 0.5,
    portfolioValue: 10_000_000,
    liquidity: {
      A: { advValue: 1_000_000, maxParticipationRate: 0.05 },
      B: { maxTradeWeight: 1 },
    },
    transactionCost: { rate: 0 },
    taxCost: { rate: 0 },
    sourceMetadata: SOURCE,
  };
  const result = evaluateMandatePreTrade(input);
  assert.equal(result.liquidityViolations.length, 1);
  const violation = result.liquidityViolations[0];
  assert.equal(violation.asset, "A");
  // trade notional weight 0.1 * portfolioValue 10,000,000 / ADV 1,000,000 = 1.0 (100% participation).
  assert.ok(Math.abs(violation.observed! - 1) < 1e-6);
  assert.equal(violation.limit, 0.05);
});

test("evaluateMandatePreTrade: missing source metadata, liquidity and cost evidence is incomplete, not fabricated", () => {
  const input = {
    currentWeights: { A: 0.5, B: 0.5 },
    targetWeights: { A: 0.6, B: 0.4 },
    maxTurnover: 0.5,
  } as unknown as MandatePreTradeInput;
  const result = evaluateMandatePreTrade(input);
  assert.equal(result.status, "incomplete");
  assert.equal(result.feasible, false);
  assert.equal(result.estimatedTransactionCost, null);
  assert.equal(result.estimatedTaxCost, null);
  assert.equal(result.totalEstimatedCost, null);
  assert.ok(result.requiredEvidence.includes("sourceMetadata.source/status/asOf/period/unit"));
  assert.ok(result.requiredEvidence.includes("liquidity/ADV for A (or explicit missing reason)"));
  assert.ok(result.requiredEvidence.includes("liquidity/ADV for B (or explicit missing reason)"));
  assert.ok(result.requiredEvidence.includes("transaction cost rate/bps"));
  assert.ok(result.requiredEvidence.includes("tax cost rate/lots (or explicit tax cost missing reason)"));
  assert.equal(result.provenance.status, "missing_evidence");
});

test("evaluateMandatePreTrade: a proposed risk budget above its limit is rejected with an exact delta", () => {
  const input: MandatePreTradeInput = {
    currentWeights: { A: 1 },
    targetWeights: { A: 1 },
    maxTurnover: 0,
    riskBudget: { current: 0.1, proposed: 0.2, limit: 0.15 },
    sourceMetadata: SOURCE,
  };
  const result = evaluateMandatePreTrade(input);
  assert.equal(result.turnover, 0);
  assert.equal(result.riskBudgetDelta, 0.1);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].code, "risk_budget");
  assert.equal(result.violations[0].observed, 0.2);
  assert.equal(result.violations[0].limit, 0.15);
  // No trades means cost evidence is never requested.
  assert.equal(result.estimatedTransactionCost, 0);
  assert.equal(result.totalEstimatedCost, 0);
});

test("evaluateMandatePreTrade: benchmark tracking error is an exact quadratic-form known-answer", () => {
  const input: MandatePreTradeInput = {
    currentWeights: { A: 0.6, B: 0.4 },
    targetWeights: { A: 0.6, B: 0.4 },
    maxTurnover: 0,
    trackingError: {
      benchmarkWeights: { A: 0.5, B: 0.5 },
      covarianceMatrix: [
        [0.04, 0],
        [0, 0.04],
      ],
      maxTrackingError: 0.02,
    },
    sourceMetadata: SOURCE,
  };
  const result = evaluateMandatePreTrade(input);
  // active = [0.1, -0.1]; variance = 0.1*0.04*0.1 + (-0.1)*0.04*(-0.1) = 0.0008.
  const expected = Math.sqrt(0.0008);
  assert.ok(result.trackingError !== null);
  assert.ok(Math.abs(result.trackingError! - expected) < 1e-9);
  assert.ok(result.violations.some((v) => v.code === "tracking_error"));
});

test("evaluateMandatePreTrade: identical inputs hash deterministically, different inputs diverge", () => {
  const base: MandatePreTradeInput = {
    currentWeights: { A: 0.6, B: 0.4 },
    targetWeights: { A: 0.5, B: 0.5 },
    maxTurnover: 0.2,
    liquidity: GENEROUS_LIQUIDITY,
    transactionCost: { rate: 0.001 },
    taxCost: { rate: 0.002 },
    sourceMetadata: SOURCE,
  };
  const r1 = evaluateMandatePreTrade({ ...base });
  const r2 = evaluateMandatePreTrade({ ...base, currentWeights: { B: 0.4, A: 0.6 } });
  assert.equal(r1.inputSnapshotHash, r2.inputSnapshotHash);
  assert.equal(r1.proposalId, r2.proposalId);

  const r3 = evaluateMandatePreTrade({ ...base, targetWeights: { A: 0.55, B: 0.45 } });
  assert.notEqual(r1.inputSnapshotHash, r3.inputSnapshotHash);
});
