import crypto from "crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import {
  extractConversationEntityQuery,
  isMarketCapabilityBundle,
  resolveConversationCapabilities,
} from "./conversationCapabilityResolver";

function request(message: string, context?: { symbol?: string }) {
  return conversationRequestSchema.parse({
    requestId: crypto.randomUUID(),
    message,
    ...(context ? { context } : {}),
  });
}

test("Legacy company-research phrasing resolves to the active P5 professional research capability", () => {
  const parsed = request("Research Apple");
  const entity = extractConversationEntityQuery(parsed);
  assert.deepEqual(entity, { symbol: null, entityQuery: "Apple" });
  const capabilities = resolveConversationCapabilities(parsed);
  assert.deepEqual(capabilities.map((item) => item.id), ["company.research"]);
  assert.equal(capabilities[0].availability, "ready");
  assert.deepEqual(capabilities[0].missingInputs, []);
  assert.equal(capabilities[0].requiresDeterministicCompute, true);
});

test("entity extraction stops at the topic list instead of swallowing it into the company name", () => {
  for (const message of [
    "Analyze Apple: key fundamentals, technicals and a valuation",
    "Analyze Apple - key fundamentals and risks",
    "Research Apple key fundamentals",
    "Review Apple: latest earnings",
  ]) {
    assert.deepEqual(extractConversationEntityQuery(request(message)), { symbol: null, entityQuery: "Apple" }, message);
  }
  assert.equal(extractConversationEntityQuery(request("Research Nvidia and show technicals")).entityQuery, "Nvidia");
  assert.equal(extractConversationEntityQuery(request("Research Bank of America")).entityQuery, "Bank of America");
});

test("'chart/price/technicals of|for|on X' phrasing yields the company as the entity", () => {
  for (const [message, expected] of [
    ["give me chart of apple", "apple"],
    ["show the price of Microsoft", "Microsoft"],
    ["technicals for Nvidia and a backtest", "Nvidia"],
    ["rsi on Tesla", "Tesla"],
  ] as const) {
    assert.equal(extractConversationEntityQuery(request(message)).entityQuery, expected, message);
  }
  const chart = resolveConversationCapabilities(request("give me chart of apple"));
  const technical = chart.find((item) => item.id === "market.technical");
  assert.equal(technical?.availability, "ready");
  assert.equal(technical?.entityQuery, "apple");
  // Phrases without a subject must still ask for one instead of guessing.
  assert.equal(extractConversationEntityQuery(request("Run technical analysis and show momentum")).entityQuery, null);
});

test("unfilled template placeholders are never resolved as a company or security", () => {
  assert.equal(extractConversationEntityQuery(request("Research [company or ticker] using available, cited sources.")).entityQuery, null);
  assert.equal(extractConversationEntityQuery(request("Review [my portfolio file or connected source] for concentration")).entityQuery, null);
});

test("a portfolio-risk starter prompt is not turned into a security overview", () => {
  const capabilities = resolveConversationCapabilities(request(
    "Review [my portfolio file or connected source] for concentration, exposures, and downside risks. Ask me to select the file or source before using private data.",
  ));
  assert.equal(capabilities.some((item) => item.id === "security.overview"), false);
  assert.equal(capabilities.some((item) => item.entityQuery?.includes("[")), false);
  assert.deepEqual(capabilities.map((item) => item.id), ["ai.answer"]);
});

test("a valuation request keeps its independent company research bundle", () => {
  const capabilities = resolveConversationCapabilities(request("Analyze Apple: key fundamentals, technicals and a valuation"));
  const byId = new Map(capabilities.map((item) => [item.id, item]));
  assert.equal(byId.get("company.research")?.availability, "ready");
  assert.equal(byId.get("company.research")?.entityQuery, "Apple");
  assert.equal(byId.get("company.valuation")?.availability, "needs_input");
  assert.deepEqual(byId.get("company.valuation")?.missingInputs, ["professional_model"]);
});

test("P2 active resolver composes overview, technical analysis and backtest in one request", () => {
  const capabilities = resolveConversationCapabilities(
    request("Analyze AAPL, show technicals with RSI and MACD, and backtest RSI strategy"),
  );
  assert.deepEqual(
    capabilities.map((item) => item.id),
    ["strategy.backtest", "market.technical", "security.overview"],
  );
  assert.equal(isMarketCapabilityBundle(capabilities), true);
  assert.equal(capabilities.find((item) => item.id === "strategy.backtest")?.permissionClass, "user_confirm");
});

test("P2 active resolver uses workspace symbol without forcing module selection", () => {
  const capabilities = resolveConversationCapabilities(request("Show technicals and momentum", { symbol: "MSFT" }));
  assert.deepEqual(capabilities.map((item) => item.id), ["market.technical"]);
  assert.equal(capabilities[0].symbol, "MSFT");
});

test("a named research subject is resolved by name rather than inheriting the Workbench ticker", () => {
  const capabilities = resolveConversationCapabilities(request("research nvidia", { symbol: "AAPL" }));
  assert.deepEqual(capabilities.map((item) => item.id), ["company.research"]);
  assert.equal(capabilities[0].symbol, null);
  assert.equal(capabilities[0].entityQuery, "nvidia");
  assert.equal(capabilities[0].availability, "ready");
  assert.deepEqual(capabilities[0].missingInputs, []);
});

test("P2 active resolver preserves Project-scoped intelligence capabilities", () => {
  const search = resolveConversationCapabilities(request("Search this project for refinancing risk"));
  assert.equal(search[0].id, "project.search");
  assert.equal(search[0].parameters.query, "refinancing risk");

  const changes = resolveConversationCapabilities(request("What changed in this project?"));
  assert.equal(changes.some((item) => item.id === "project.changes"), true);
});

test("P2 active resolver falls back to BYOAI only when LiOS has no deterministic/retrieval capability match", () => {
  const capabilities = resolveConversationCapabilities(request("Explain why operating leverage matters"));
  assert.deepEqual(capabilities.map((item) => item.id), ["ai.answer"]);
  assert.equal(capabilities[0].requiresAI, true);
});


test("P2 active resolver preserves deterministic intent when company/security input is missing", () => {
  const technical = resolveConversationCapabilities(request("Run technical analysis and show momentum"));
  assert.deepEqual(technical.map((item) => item.id), ["market.technical"]);
  assert.equal(technical[0].availability, "needs_input");
  assert.deepEqual(technical[0].missingInputs, ["company_or_security"]);
  assert.equal(isMarketCapabilityBundle(technical), true);

  const backtest = resolveConversationCapabilities(request("Backtest RSI strategy"));
  assert.deepEqual(backtest.map((item) => item.id), ["strategy.backtest"]);
  assert.equal(backtest[0].availability, "needs_input");
  assert.deepEqual(backtest[0].missingInputs, ["company_or_security"]);
  assert.equal(isMarketCapabilityBundle(backtest), true);
});

test("P2 active resolver exposes approval and AI readiness explicitly", () => {
  const backtest = resolveConversationCapabilities(request("Backtest RSI strategy on AAPL"));
  assert.equal(backtest[0].availability, "needs_approval");

  const fallback = resolveConversationCapabilities(request("Explain why operating leverage matters"));
  assert.equal(fallback[0].availability, "requires_ai");
});

test("P2 personal-finance capability names the missing profile instead of falling into generic AI", () => {
  const missing = resolveConversationCapabilities(request("Analyze my personal finances"));
  assert.deepEqual(missing.map((item) => item.id), ["personal_finance.snapshot"]);
  assert.equal(missing[0].availability, "needs_input");
  assert.deepEqual(missing[0].missingInputs, ["personal_finance_profile"]);
});

test("P2 personal-finance requests only add a security overview when the user explicitly names a security", () => {
  const personalOnly = resolveConversationCapabilities(request("Analyze my personal finances and retirement plan"));
  assert.deepEqual(personalOnly.map((item) => item.id), ["personal_finance.snapshot"]);

  const combined = resolveConversationCapabilities(request("Analyze my personal finances and AAPL stock"));
  assert.equal(combined.some((item) => item.id === "personal_finance.snapshot"), true);
  assert.equal(combined.some((item) => item.id === "security.overview"), true);
});


test("P2 resolver exposes source-scope compatibility before execution", () => {
  const market = resolveConversationCapabilities(conversationRequestSchema.parse({
    requestId: crypto.randomUUID(),
    message: "Analyze AAPL",
    sourceScope: "my_data",
  }));
  assert.equal(market[0].id, "company.research");
  assert.equal(market[0].sourceScopeCompatible, false);
  assert.match(market[0].sourceScopeReason ?? "", /Auto or Web/);

  const project = resolveConversationCapabilities(conversationRequestSchema.parse({
    requestId: crypto.randomUUID(),
    message: "Search this project for refinancing risk",
    sourceScope: "web",
  }));
  assert.equal(project[0].id, "project.search");
  assert.equal(project[0].sourceScopeCompatible, false);
  assert.match(project[0].sourceScopeReason ?? "", /Auto or My Data/);
});


test("P5 resolver turns natural Research Apple into one ready professional company journey", () => {
  const parsed = request("Research Apple");
  assert.deepEqual(extractConversationEntityQuery(parsed), { symbol: null, entityQuery: "Apple" });
  const capabilities = resolveConversationCapabilities(parsed);
  assert.deepEqual(capabilities.map((item) => item.id), ["company.research"]);
  assert.equal(capabilities[0].availability, "ready");
  assert.equal(capabilities[0].requiresDeterministicCompute, true);
  assert.equal(capabilities[0].entityQuery, "Apple");
});

test("P5 valuation readiness names the missing professional model instead of inventing assumptions", () => {
  const capabilities = resolveConversationCapabilities(request("Value AAPL"));
  assert.deepEqual(capabilities.map((item) => item.id), ["company.valuation"]);
  assert.equal(capabilities[0].availability, "needs_input");
  assert.deepEqual(capabilities[0].missingInputs, ["professional_model"]);
  assert.equal(capabilities[0].parameters.family, "valuation");
});

test("P5 explicit advanced model requests become executable with structured inputs", () => {
  const capabilities = resolveConversationCapabilities(request(
    'Run reverse DCF on AAPL {"shares":100,"currentPrice":25,"targetRevenue":5000}',
  ));
  assert.deepEqual(capabilities.map((item) => item.id), ["company.valuation"]);
  assert.equal(capabilities[0].availability, "ready");
  assert.equal(capabilities[0].parameters.modelPath, "valuation/reverse-dcf");
  assert.deepEqual(capabilities[0].parameters.modelParameters, {
    shares: 100,
    currentPrice: 25,
    targetRevenue: 5000,
  });
});

test("P5 cross-asset families expose explicit readiness instead of generic AI fallback", () => {
  const fixedIncome = resolveConversationCapabilities(request("Run bond analytics and duration analysis"));
  assert.deepEqual(fixedIncome.map((item) => item.id), ["fixed_income.analytics"]);
  assert.equal(fixedIncome[0].availability, "needs_input");
  assert.deepEqual(fixedIncome[0].missingInputs, ["professional_model"]);

  const derivatives = resolveConversationCapabilities(request(
    'Run Black-Scholes Greeks {"spot":100,"strike":105,"rate":0.05,"volatility":0.2,"maturity":1}',
  ));
  assert.deepEqual(derivatives.map((item) => item.id), ["derivatives.analytics"]);
  assert.equal(derivatives[0].availability, "ready");
  assert.equal(derivatives[0].parameters.modelPath, "derivatives/black-scholes-greeks");

  const macro = resolveConversationCapabilities(request(
    'Estimate recession probability {"spread":-0.5,"leadingIndex":-1.2}',
  ));
  assert.deepEqual(macro.map((item) => item.id), ["macro_fx.analytics"]);
  assert.equal(macro[0].availability, "ready");
  assert.equal(macro[0].parameters.modelPath, "macro/recession-probability");
});

test("P5 report assembly becomes ready only from governed company or active Artifact context", () => {
  const artifactId = "artifact:11111111-1111-4111-8111-111111111111";
  const active = conversationRequestSchema.parse({
    requestId: crypto.randomUUID(),
    message: "Create a risk report from this artifact",
    sourceScope: "my_data",
    context: { activeObjectRefs: [artifactId] },
  });
  const capabilities = resolveConversationCapabilities(active);
  assert.deepEqual(capabilities.map((item) => item.id), ["research.report"]);
  assert.equal(capabilities[0].availability, "ready");
  assert.equal(capabilities[0].sourceScopeCompatible, true);
  assert.equal(capabilities[0].parameters.activeArtifactRef, artifactId);
});

test("P5 keeps value-at-risk in portfolio/risk instead of misrouting it to valuation", () => {
  const capabilities = resolveConversationCapabilities(request("Calculate value at risk for my portfolio"));
  assert.equal(capabilities.some((item) => item.id === "company.valuation"), false);
  assert.deepEqual(capabilities.map((item) => item.id), ["portfolio.risk"]);
});

test("P5 resolver exposes explicit DCF sensitivity as a ready deterministic valuation capability", () => {
  const parsed = request(
    'Run DCF sensitivity for AAPL {"modelPath":"valuation/dcf-sensitivity","parameters":{"freeCashFlows":[100,110,120],"waccPct":10,"terminalMethod":"gordon_growth","terminalGrowthPct":3,"netDebt":50,"sharesOutstanding":10,"waccGridPct":[9,10,11],"terminalGrowthGridPct":[2,3,4],"bearCase":{"freeCashFlows":[90,95,100],"waccPct":11,"terminalMethod":"gordon_growth","terminalGrowthPct":2},"bullCase":{"freeCashFlows":[110,125,140],"waccPct":9,"terminalMethod":"gordon_growth","terminalGrowthPct":4}}}'
  );
  const capabilities = resolveConversationCapabilities(parsed);
  assert.deepEqual(capabilities.map((item) => item.id), ["company.valuation"]);
  assert.equal(capabilities[0].availability, "ready");
  assert.equal(capabilities[0].parameters.modelPath, "valuation/dcf-sensitivity");
  assert.equal((capabilities[0].parameters.modelParameters as Record<string, unknown>).waccPct, 10);
  assert.equal(capabilities[0].requiresDeterministicCompute, true);
});
