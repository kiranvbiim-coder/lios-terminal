import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdaptiveCompanySections,
  buildComparisonPlan,
  buildDynamicAnalyticsCatalog,
  buildQuantSeries,
  buildMasterAiFallback,
  filterPrimaryListings,
  findMarketPack,
  formatMarketValue,
  getMarketClock,
  MARKET_PACKS,
  normalizeExperienceShellPreferences,
  requiresMasterAiConfirmation,
  searchDynamicAnalyticsCatalog,
  validateDynamicFilter,
  validateMasterAiToolRequest,
  validateMasterAiPlan,
  normalizeMasterAiSessionState,
  validateExperienceObjectAction,
  formatMarketDate,
} from "@shared/waveCContracts";

test("Wave C dynamic analytics catalog is canonical and searchable", () => {
  const catalog = buildDynamicAnalyticsCatalog();
  assert.ok(catalog.some((field) => field.id === "company.ticker"));
  assert.ok(catalog.some((field) => field.id === "metric.roic" && field.numeric));
  assert.equal(searchDynamicAnalyticsCatalog("free cash flow", 10).some((field) => field.id === "metric.fcf" || field.id === "metric.fcfDerived"), true);
});

test("Wave C adapts company sections to available data", () => {
  const sections = buildAdaptiveCompanySections(["company.ticker", "company.name", "metric.roic"]);
  assert.deepEqual(sections.map((section) => section.id), ["identity", "quality"]);
  assert.equal(sections[0].state, "partial");
});

test("Wave C filters reject unknown fields and invalid operators", () => {
  assert.equal(validateDynamicFilter({ fieldId: "metric.roic", operator: "gt", value: 0.1 }).ok, true);
  assert.equal(validateDynamicFilter({ fieldId: "company.name", operator: "gt", value: 0.1 }).ok, false);
  assert.equal(validateDynamicFilter({ fieldId: "missing.field", operator: "eq", value: "x" }).ok, false);
});

test("Wave C screener universe can enforce primary listings without dropping legacy rows", () => {
  const rows = [{ id: "primary", isPrimaryListing: true }, { id: "secondary", isPrimaryListing: false }, { id: "legacy" }];
  assert.deepEqual(filterPrimaryListings(rows, true).map((row) => row.id), ["primary", "legacy"]);
  assert.equal(filterPrimaryListings(rows, false).length, 3);
});

test("Wave C comparison and Quant plans stay numeric and canonical", () => {
  const comparison = buildComparisonPlan(["pe", "metric.roic", "pe", "missing"]);
  assert.deepEqual(comparison.normalizedMetricIds, ["pe", "roic"]);
  assert.equal(comparison.warnings.length, 1);
  assert.equal(buildQuantSeries("metric.roic")?.fieldId, "metric.roic");
  assert.equal(buildQuantSeries("company.name"), null);
});

test("Master AI requires deterministic engine authority and protects tools", () => {
  assert.equal(validateMasterAiToolRequest({ toolId: "data_fabric.query", fieldIds: ["metric.roic"] }).ok, true);
  assert.equal(validateMasterAiToolRequest({ toolId: "data_fabric.query", fieldIds: ["hallucinated.field"] }).ok, false);
  assert.equal(validateMasterAiToolRequest({ toolId: "deterministic.compute", engineId: "valuation.dcf" }).ok, true);
  assert.equal(validateMasterAiToolRequest({ toolId: "deterministic.compute", engineId: "llm.guess" }).ok, false);
  assert.equal(requiresMasterAiConfirmation("share"), true);
  assert.equal(requiresMasterAiConfirmation("compute"), false);
});

test("Master AI plans are ordered, attributed by contract and fail closed", () => {
  assert.equal(validateMasterAiPlan([
    { id: "query", tool: { toolId: "data_fabric.query", fieldIds: ["metric.roic"] }, dependsOn: [] },
    { id: "compute", tool: { toolId: "deterministic.compute", engineId: "valuation.dcf" }, dependsOn: ["query"] },
  ]).ok, true);
  assert.equal(validateMasterAiPlan([{ id: "bad", tool: { toolId: "context.explain" }, dependsOn: ["later"] }]).ok, false);
  assert.equal(buildMasterAiFallback("provider-unavailable").deterministicAlternative, "manual");
});

test("Master AI session state defaults off and normalizes unknown modes", () => {
  assert.deepEqual(normalizeMasterAiSessionState(), { state: "off", mode: "manual", updatedAt: null });
  assert.deepEqual(normalizeMasterAiSessionState({ state: "on", mode: "ai_build", updatedAt: "2026-09-17T00:00:00.000Z" }), {
    state: "on", mode: "ai_build", updatedAt: "2026-09-17T00:00:00.000Z",
  });
  assert.equal(normalizeMasterAiSessionState({ state: "on", mode: "unknown" as never }).mode, "manual");
});

test("Experience shell preferences are safe and predictable", () => {
  assert.deepEqual(normalizeExperienceShellPreferences({ surface: "signals", persona: "researcher" }), {
    surface: "signals", focusMode: false, progressiveDisclosure: true, reducedMotion: false, persona: "researcher",
  });
  assert.equal(normalizeExperienceShellPreferences({ surface: "unknown" as never }).surface, "projects");
  assert.equal(validateExperienceObjectAction("share").requiresConfirmation, true);
  assert.equal(validateExperienceObjectAction("unknown").ok, false);
});

test("Market packs resolve aliases, locale formatting and market clocks", () => {
  assert.equal(MARKET_PACKS.length, 6);
  assert.equal(findMarketPack("NSE")?.id, "india");
  assert.equal(findMarketPack("gulf")?.id, "middle-east");
  assert.match(formatMarketValue(1234.5, "india"), /₹|INR/);
  assert.match(formatMarketDate(new Date("2026-09-17T00:00:00.000Z"), "india"), /2026/);
  const clock = getMarketClock(findMarketPack("US")!, new Date("2026-09-17T15:00:00.000Z"));
  assert.equal(clock.timezone, "America/New_York");
  assert.ok(["open", "closed"].includes(clock.status));
});
