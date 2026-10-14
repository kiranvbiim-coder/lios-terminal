import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreOpportunity,
  scoreRisk,
  OPPORTUNITY_FACTORS,
  RISK_FACTORS,
  type RadarSignalInputs,
} from "./radarScoring";

function baseInputs(symbol: string): RadarSignalInputs {
  return {
    symbol,
    trailingPE: null,
    price: null,
    high52: null,
    low52: null,
    changePercent: null,
    newsSentimentScore: null,
    newsArticleCount: 0,
    insiderNetValue: null,
    revenueGrowth: null,
    returnOnEquity: null,
    beta: null,
  };
}

// Every sub-signal below is set to its saturating value (+1 or -1 tilt), so
// each factor contributes exactly its full weight. Weights sum to 50 for
// both scoreOpportunity's 5 factors and scoreRisk's 5 shared factors, giving
// exact, hand-computable scores of 100 / 50 / 0.
const BULLISH: RadarSignalInputs = {
  symbol: "BULL",
  trailingPE: 10, // (25-10)/15 = 1
  price: 100,
  high52: 100,
  low52: 50, // range position = 1 -> tilt (1-0.5)*2 = 1
  changePercent: 5, // 5/5 = 1
  newsSentimentScore: 1,
  newsArticleCount: 5,
  insiderNetValue: 2_000_000, // clamp(2, -1, 1) = 1
  revenueGrowth: 0.30, // clamp(1.5,-1,1) = 1
  returnOnEquity: 0.30, // clamp(1.2,-1,1) = 1
  beta: null,
};

const BEARISH: RadarSignalInputs = {
  symbol: "BEAR",
  trailingPE: 40, // (25-40)/15 = -1
  price: 50,
  high52: 100,
  low52: 50, // range position = 0 -> tilt (0-0.5)*2 = -1
  changePercent: -5,
  newsSentimentScore: -1,
  newsArticleCount: 5,
  insiderNetValue: -2_000_000,
  revenueGrowth: -0.30,
  returnOnEquity: -0.30,
  beta: null,
};

test("weights sum to 50 for both radars (documented, exact 0-100 span)", () => {
  assert.equal(OPPORTUNITY_FACTORS.reduce((s, f) => s + f.weight, 0), 50);
  assert.equal(RISK_FACTORS.reduce((s, f) => s + f.weight, 0), 50);
});

test("scoreOpportunity: known-answer top pick is unambiguous among bull/neutral/bear", () => {
  const bull = scoreOpportunity(BULLISH);
  const neutral = scoreOpportunity(baseInputs("NEUTRAL"));
  const bear = scoreOpportunity(BEARISH);

  assert.equal(bull.score, 100);
  assert.equal(neutral.score, 50);
  assert.equal(bear.score, 0);

  const ranked = [bull, neutral, bear].sort((a, b) => b.score - a.score);
  assert.deepEqual(ranked.map((r) => r.symbol), ["BULL", "NEUTRAL", "BEAR"]);

  // Transparency: every factor for the bullish symbol contributed positively
  // and at full weight; none is a black-box number.
  for (const factor of bull.factors) {
    assert.equal(factor.tilt, 1);
    assert.equal(factor.contribution, factor.weight);
    assert.notEqual(factor.rawValue, null);
  }
});

test("scoreRisk: known-answer top pick is unambiguous among bull/neutral/bear", () => {
  const bull = scoreRisk(BULLISH);
  const neutral = scoreRisk(baseInputs("NEUTRAL"));
  const bear = scoreRisk(BEARISH);

  // 5 shared factors (valuation 10, momentum 10, sentiment 8, insider 8,
  // fundamentals 8 = 44) apply the *negated* tilt; beta is null for both so
  // volatility contributes 0.
  assert.equal(bull.score, 50 - 44);
  assert.equal(neutral.score, 50);
  assert.equal(bear.score, 50 + 44);

  const ranked = [bull, neutral, bear].sort((a, b) => b.score - a.score);
  assert.deepEqual(ranked.map((r) => r.symbol), ["BEAR", "NEUTRAL", "BULL"]);
});

test("scoreRisk: beta is an independent risk-only factor (not mirrored in scoreOpportunity)", () => {
  const highBeta = scoreRisk({ ...baseInputs("HIGHBETA"), beta: 2.5 }); // (2.5-1)/1.5 = 1 -> +6
  const lowBeta = scoreRisk({ ...baseInputs("LOWBETA"), beta: -0.5 }); // (-0.5-1)/1.5 = -1 -> -6

  assert.equal(highBeta.score, 56);
  assert.equal(lowBeta.score, 44);

  const betaFactor = highBeta.factors.find((f) => f.key === "volatility")!;
  assert.equal(betaFactor.rawValue, 2.5);
  assert.equal(betaFactor.contribution, 6);

  // scoreOpportunity has no volatility factor at all.
  assert.equal(OPPORTUNITY_FACTORS.some((f) => f.key === "volatility"), false);
});

test("boundary/tie case: identical inputs produce identical scores and stable rank", () => {
  const a = scoreOpportunity({ ...baseInputs("TIE_A"), trailingPE: 18 });
  const b = scoreOpportunity({ ...baseInputs("TIE_B"), trailingPE: 18 });
  assert.equal(a.score, b.score);
  assert.deepEqual(a.factors.map((f) => f.contribution), b.factors.map((f) => f.contribution));
});

test("boundary: neutral trailingPE (25) contributes exactly zero to valuation factor", () => {
  const result = scoreOpportunity({ ...baseInputs("FAIRPE"), trailingPE: 25 });
  const valuation = result.factors.find((f) => f.key === "valuation")!;
  assert.equal(valuation.tilt, 0);
  assert.equal(valuation.contribution, 0);
  assert.equal(result.score, 50);
});

test("boundary: non-positive or missing trailingPE yields null tilt, not a fabricated score", () => {
  const zeroPe = scoreOpportunity({ ...baseInputs("ZEROPE"), trailingPE: 0 });
  const missingPe = scoreOpportunity({ ...baseInputs("NOPE"), trailingPE: null });
  for (const result of [zeroPe, missingPe]) {
    const valuation = result.factors.find((f) => f.key === "valuation")!;
    assert.equal(valuation.tilt, null);
    assert.equal(valuation.contribution, 0);
  }
  // Missing data is reported as missing (null), never silently coerced.
  const missingValuation = missingPe.factors.find((f) => f.key === "valuation")!;
  assert.equal(missingValuation.rawValue, null);
});

test("sentiment factor requires at least one real article; zero articles is neutral, not bearish", () => {
  const noArticles = scoreOpportunity({ ...baseInputs("NONEWS"), newsSentimentScore: -1, newsArticleCount: 0 });
  const sentiment = noArticles.factors.find((f) => f.key === "sentiment")!;
  assert.equal(sentiment.tilt, null);
  assert.equal(sentiment.contribution, 0);
});

test("insider factor saturates at +-$1M net open-market value and is linear below that", () => {
  const halfMillionBuy = scoreOpportunity({ ...baseInputs("HALFM"), insiderNetValue: 500_000 });
  const insider = halfMillionBuy.factors.find((f) => f.key === "insider")!;
  assert.equal(insider.tilt, 0.5);
  assert.equal(insider.contribution, 4); // weight 8 * 0.5
});
