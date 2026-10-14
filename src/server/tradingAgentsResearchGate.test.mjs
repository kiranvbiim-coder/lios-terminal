import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADINGAGENTS_RESEARCH_SOURCE,
  RESEARCH_RATINGS,
  RESEARCH_REVIEW,
  parseTradingAgentsResearchRating,
  planTradingAgentsDebateTurn,
  planTradingAgentsRiskTurn,
  donorOpponentOrOpening,
  donorReportOrAbsent,
} from "./tradingAgentsResearchGate.mjs";

test("TradingAgents exact upstream source provenance and five-tier vocabulary", () => {
  assert.equal(TRADINGAGENTS_RESEARCH_SOURCE.repository, "TauricResearch/TradingAgents");
  assert.equal(TRADINGAGENTS_RESEARCH_SOURCE.commit, "2d17df8da1536c121e4d7395ac5a5dcec9e96d6f");
  assert.equal(TRADINGAGENTS_RESEARCH_SOURCE.license, "Apache-2.0");
  assert.equal(RESEARCH_RATINGS.length, 5);
  assert.ok(!RESEARCH_RATINGS.includes(RESEARCH_REVIEW));
});

test("recognizes labelled markdown and NFKC fullwidth decisions without broker status", () => {
  for (const [input, expected] of [
    ["**Rating**: **Buy**", "Buy"],
    ["Rating：Overweight", "Overweight"],
    ["Recommendation — Underweight", "Underweight"],
    ["Rating - Sell", "Sell"],
    ["- **Recommendation**: Hold", "Hold"],
  ]) {
    const result = parseTradingAgentsResearchRating(input);
    assert.equal(result.rating, expected, input);
    assert.equal(result.outputTruth, "unverified_model_output");
    assert.equal(result.requiresHumanReview, true, "Even an explicit rating has no verified source or trade grant");
    assert.equal(result.executable, false);
  }
});

test("never converts missing, invalid, contradictory or quoted arguments into Hold or Buy", () => {
  for (const output of [
    "", "I considered Buy but also Sell", "Buy", "Seller thesis", 
    "Rating Scale: Buy, Overweight, Hold, Underweight, Sell",
    "**Rating**: Buy\n**Rating**: Sell",
    "This is not a rating; Buy at your own risk",
    "No further analysis available",
  ]) {
    const result = parseTradingAgentsResearchRating(output);
    assert.equal(result.rating, RESEARCH_REVIEW, output);
    assert.equal(result.requiresHumanReview, true);
    assert.equal(result.executable, false);
  }
});

test("standalone fallbacks are allowed only by explicit caller opt-in", () => {
  assert.equal(parseTradingAgentsResearchRating("Buy", { allowSingleWordFallback: true }).rating, "Buy");
  assert.equal(parseTradingAgentsResearchRating("Buy then Sell", { allowSingleWordFallback: true }).rating, RESEARCH_REVIEW);
  assert.equal(parseTradingAgentsResearchRating("No finding", { allowSingleWordFallback: true }).rating, RESEARCH_REVIEW);
  assert.equal(parseTradingAgentsResearchRating(null).rating, RESEARCH_REVIEW);
  assert.equal(parseTradingAgentsResearchRating("a".repeat(20001)).rating, RESEARCH_REVIEW);
});

test("bull/bear turns alternate with a fixed budget and never dispatch trades", () => {
  let turns = [];
  const expect = ["bull", "bear", "bull", "bear", "human_review"];
  for (let i = 0; i < expect.length; i++) {
    const step = planTradingAgentsDebateTurn({ turns, maxRounds: 2 });
    assert.equal(step.next, expect[i]);
    assert.equal(step.usedTurns, i);
    assert.equal(step.maximumTurns, 4);
    assert.equal(step.executable, false);
    if (i < 4) turns.push({ speaker: expect[i], argument: "Claim anchored to caller-supplied research." });
  }
  assert.equal(planTradingAgentsDebateTurn({ turns, maxRounds: 2 }).complete, true);
});

test("wrong speaker, empty turns, duplicate actors, unbounded debate fail closed", () => {
  for (const value of [0, 4, NaN, 1.5, "2"]) {
    assert.throws(() => planTradingAgentsDebateTurn({ turns: [], maxRounds: value }));
  }
  for (const turns of [
    [{ speaker: "bear", argument: "wrong first" }],
    [{ speaker: "bull", argument: "" }],
    [{ speaker: "bull", argument: "fine" }, { speaker: "bull", argument: "duplicate" }],
    [{ speaker: "bull", argument: "x".repeat(5001) }],
    Array(3).fill({ speaker: "bull", argument: "too many" }),
  ]) {
    assert.throws(() => planTradingAgentsDebateTurn({ turns, maxRounds: 1 }));
  }
});

test("complete three-role TradingAgents risk round is bounded and non-executable", () => {
  const turns = [];
  for (let i = 0; i < 6; i++) {
    const step = planTradingAgentsRiskTurn({ turns, maxRounds: 2 });
    assert.equal(step.next, ["aggressive", "conservative", "neutral"][i % 3]);
    assert.equal(step.usedTurns, i);
    assert.equal(step.maximumTurns, 6);
    assert.equal(step.executable, false);
    turns.push({ speaker: step.next, argument: "Scenario uncertainty, unverified." });
  }
  const review = planTradingAgentsRiskTurn({ turns, maxRounds: 2 });
  assert.equal(review.next, "human_review");
  assert.equal(review.complete, true);
  assert.equal(review.sourceStatus, "unverified_model_risk_debate");
});

test("risk debate rejects out-of-order speakers, missing arguments and excessive rounds", () => {
  for (const n of [0, 4, "2", Infinity]) {
    assert.throws(() => planTradingAgentsRiskTurn({ turns: [], maxRounds: n }));
  }
  for (const turns of [
    [{ speaker: "neutral", argument: "missing start" }],
    [{ speaker: "aggressive", argument: "  " }],
    [{ speaker: "aggressive", argument: "one" }, { speaker: "aggressive", argument: "wrong next" }],
    [{ speaker: "aggressive", argument: "x".repeat(5001) }],
    Array(4).fill({ speaker: "neutral", argument: "excess" }),
  ]) assert.throws(() => planTradingAgentsRiskTurn({ turns, maxRounds: 1 }));
});

test("donor opening helpers never manufacture a missing opponent or empty report", () => {
  assert.match(donorOpponentOrOpening("", "bear analyst"), /has not spoken yet/);
  assert.equal(donorOpponentOrOpening(" real claim ", "bear analyst"), "real claim");
  assert.match(donorReportOrAbsent("  ", "market"), /No market report available/);
  assert.equal(donorReportOrAbsent(" dated report ", "market"), "dated report");
  for (const label of ["", "../untrusted", "a".repeat(64)]) {
    assert.throws(() => donorOpponentOrOpening("", label));
    assert.throws(() => donorReportOrAbsent("", label));
  }
  assert.throws(() => donorReportOrAbsent("x".repeat(8001), "market"));
});
