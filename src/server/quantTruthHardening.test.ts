/**
 * Phase 22: Quant Truth Hardening — cross-module integration tests
 * that verify the full architecture pipeline works end-to-end.
 *
 * These tests exercise multiple phases together:
 * connector → contract → readiness → passport → engine → receipt
 */
import test from "node:test";
import assert from "node:assert/strict";

// Phase 3: Connector Registry
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";

// Phase 4: Data Contracts
import { CONTRACT_FAMILIES, ENGINE_CONTRACT_DECLARATIONS, resolveAllEngineReadiness, resolveEngineReadiness, getEngineDeclaration } from "@shared/dataContracts";

// Phase 5-7: Data Truth, Passport
import { buildDataPassport, buildPassportEntry, buildCalculatedPassport, assessDataQuality, resolveConflict, validateAccountingIdentity, computeSnapshotHash, type SourceBinding } from "@shared/dataTruth";

// Phase 9: DCF Passport Bridge
import { buildDcfPassportBundle } from "./dcfPassportBridge";

// Phase 10: Market Data Passport
import { buildQuotePassport, buildOhlcvPassport, passportResponseHeaders, type FundamentalsData } from "./marketDataPassport";

// Phase 11: Valuation Engines
import { computeResidualIncome, computeEva, computeImpliedWacc, buildValuationBridge } from "@/lib/valuationEngines";

// Phase 12: Portfolio Engines
import { computeBrinsonAttribution, computeConcentrationMetrics, computeRebalancingProposal } from "@/lib/portfolioEngines";

// Phase 13: Fixed Income Engines
import { bootstrapYieldCurve, computeSpreadAnalysis, computeExpectedLoss } from "@/lib/fixedIncomeEngines";

// Phase 14: Derivatives Engines
import { priceFutures, analyzeStrategy } from "@/lib/derivativesEngines";

// Phase 15: Macro Engines
import { computeMacroShock, DEFAULT_SECTOR_SENSITIVITIES, compareCountries } from "@/lib/macroEngines";

// Phase 16: Operations Engines
import { computeInventoryOptimization, assessSupplierRisk } from "@/lib/operationsEngines";

// Phase 17: Research Intelligence
import { detectChanges, challengeThesis, computeIntelligenceScore, scoreEvidence } from "./researchIntelligenceEngines";

// Phase 18: BYOAI
import { evaluateToolPermission, MCP_TOOL_REGISTRY, AI_PROVIDERS } from "./byoaiRouter";

// Phase 19: Decision Engine (live receipt-sealing hash; decisionReceiptEngine.ts
// is Forecast Accountability only -- see decisionReceiptEngine.test.ts)
import { decisionSnapshotHash } from "./decisionEngine";

// Phase 20: Report Engine
import { generateReportPack } from "./reportEngine";

// Phase 21: Governance
import { redactDiagnostics, hasPermission, grantSupportConsent, evaluateSupportAccess, clearAllConsents } from "./governanceEngine";

// Phase 1: Control Plane Policy
import { evaluateLicenseLifecycle, evaluateDeviceAuthorization, hasFeatureEntitlement } from "./controlPlanePolicy";

// ─── Cross-Module Pipeline Tests ──────────────────────────────────────────

test("PIPELINE: connector capabilities cover all engine-required contract families", () => {
  const connectorFamilies = new Set(BUILT_IN_CONNECTORS.flatMap((c) => c.capabilities.map((cap) => cap.contractFamily)));
  for (const engine of ENGINE_CONTRACT_DECLARATIONS) {
    for (const req of engine.required) {
      assert.ok(connectorFamilies.has(req), `Engine ${engine.engineId} requires ${req} but no connector provides it`);
    }
  }
});

test("PIPELINE: contract families have consistent field definitions", () => {
  for (const family of CONTRACT_FAMILIES) {
    const fieldNames = family.fields.map((f) => f.name);
    assert.equal(new Set(fieldNames).size, fieldNames.length, `Duplicate field in ${family.id}`);
    for (const field of family.fields) {
      assert.ok(field.name.length > 0, `Empty field name in ${family.id}`);
      assert.ok(field.description.length > 0, `Empty description for ${family.id}.${field.name}`);
    }
  }
});

test("PIPELINE: readiness resolver produces consistent states", () => {
  const allFamilies = new Set(CONTRACT_FAMILIES.map((f) => f.id));
  const noFamilies = new Set<string>();
  const fullReadiness = resolveAllEngineReadiness(allFamilies);
  const emptyReadiness = resolveAllEngineReadiness(noFamilies);

  assert.equal(fullReadiness.length, ENGINE_CONTRACT_DECLARATIONS.length);
  assert.equal(emptyReadiness.length, ENGINE_CONTRACT_DECLARATIONS.length);

  for (const r of fullReadiness) {
    assert.equal(r.missingRequired.length, 0, `${r.engineId} has missing required with all families`);
  }
  for (const r of emptyReadiness) {
    assert.equal(r.state, "blocked", `${r.engineId} should be blocked with no families`);
  }
});

test("PIPELINE: data passport → calculated passport → decision receipt chain", () => {
  const binding: SourceBinding = { contractFamily: "financial_statements", field: "revenue", connectorId: "sec_edgar", provider: "SEC", priority: "primary" };
  const entries = [
    buildPassportEntry("revenue", 100_000, binding, "2026-08-25T00:00:00Z"),
    buildPassportEntry("netIncome", 20_000, { ...binding, field: "netIncome" }, "2026-08-25T00:00:00Z"),
  ];
  const dataPassport = buildDataPassport("financial_statements", "TEST", entries, ["revenue", "netIncome"]);
  assert.equal(dataPassport.quality.completeness, 1);

  const calcPassport = buildCalculatedPassport("valuation.dcf", "1.0", [dataPassport], [{ key: "wacc", value: 0.10, source: "manual" }], "abc123" + "0".repeat(58), []);
  assert.equal(calcPassport.inputs.length, 1);
  assert.equal(calcPassport.inputs[0].passportId, dataPassport.id);

  // Sealing: decisionRoutes.ts's live receipt system hashes exactly this
  // shape (passport ids + assumptions + engine identity) with
  // decisionSnapshotHash to produce a deterministic, tamper-evident seal.
  const sealedPayload = {
    dataPassportIds: [dataPassport.id], calculatedPassportIds: [calcPassport.id],
    assumptions: [{ key: "wacc", value: 0.10, source: "manual" }],
    engineId: "valuation.dcf", engineVersion: "1.0",
  };
  const snapshotHash = decisionSnapshotHash(sealedPayload);
  assert.equal(snapshotHash.length, 64);
  assert.equal(snapshotHash, decisionSnapshotHash(sealedPayload));
});

test("PIPELINE: market quote → passport → headers chain", () => {
  const recentAsOf = new Date().toISOString().slice(0, 10);
  const quote = {
    symbol: "AAPL", name: "Apple", price: 227, change: 2, changePercent: 0.89,
    volume: 50_000_000, marketCap: 3_400_000_000_000, pe: 33, eps: 6.85,
    revenue: 391_000_000_000, high52: 260, low52: 164, open: 225,
    previousClose: 225, dayHigh: 228, dayLow: 224, avgVolume: 65_000_000,
    exchange: "NASDAQ", sector: "Technology", quoteSource: "yfinance",
    isLive: false, currency: "USD",
    status: { provider: "Limuria Intelligence", freshness: "delayed" as const, asOf: recentAsOf, delayLabel: "Delayed", isFallback: false },
  };
  const { passport } = buildQuotePassport(quote);
  assert.equal(passport.contractFamily, "market_data");
  const headers = passportResponseHeaders(passport);
  assert.ok(headers["X-Limuria-Passport-Id"].startsWith("ppt_"));
  assert.equal(headers["X-Limuria-Passport-Quality"], "high");
});

test("PIPELINE: valuation bridge aggregates multiple method passports", () => {
  const bridge = buildValuationBridge([
    { method: "dcf", label: "DCF", enterpriseValue: 10000, equityValue: 8000, valuePerShare: 80, confidence: "high", notes: "" },
    { method: "comps", label: "Comps", enterpriseValue: 12000, equityValue: 10000, valuePerShare: 100, confidence: "medium", notes: "" },
  ], 100);
  assert.ok(bridge.weightedEquityValue > 0);
  assert.equal(bridge.methods.length, 2);

  const report = generateReportPack({
    templateId: "investment_memo", title: "AAPL Investment Memo",
    symbol: "AAPL", engineId: "valuation.bridge", engineVersion: "1.0",
    sectionData: { summary: "Multi-method valuation", key_metrics: bridge },
  });
  assert.ok(report.id.startsWith("rpt_"));
  assert.equal(report.metadata.engineId, "valuation.bridge");
});

test("PIPELINE: macro shock → portfolio attribution → rebalancing chain", () => {
  const shock = computeMacroShock({ shockType: "rates", shockMagnitude: 0.01, sectorSensitivities: DEFAULT_SECTOR_SENSITIVITIES.rates });
  assert.ok(shock.impacts.length > 0);

  const concentration = computeConcentrationMetrics([
    { symbol: "AAPL", weight: 0.4, sector: "Technology" },
    { symbol: "JPM", weight: 0.3, sector: "Financials" },
    { symbol: "JNJ", weight: 0.3, sector: "Healthcare" },
  ]);
  assert.ok(concentration.herfindahlIndex > 0);

  const rebalance = computeRebalancingProposal([
    { symbol: "AAPL", targetWeight: 0.33, currentWeight: 0.40, currentShares: 40, currentPrice: 227 },
    { symbol: "JPM", targetWeight: 0.33, currentWeight: 0.30, currentShares: 30, currentPrice: 200 },
    { symbol: "JNJ", targetWeight: 0.34, currentWeight: 0.30, currentShares: 30, currentPrice: 160 },
  ], 100_000);
  assert.ok(rebalance.trades.length === 3);
});

test("PIPELINE: research → thesis challenge → intelligence score → receipt", () => {
  const changes = detectChanges({
    currentData: [{ field: "revenue", value: 110, source: "SEC", asOf: "2026-08" }],
    previousData: [{ field: "revenue", value: 100, source: "SEC", asOf: "2026-02" }],
    materialityThresholdPct: 0.05,
  });
  assert.ok(changes.materialChanges >= 1);

  const challenge = challengeThesis({
    theses: [{ id: "t1", claim: "Growth thesis", evidenceRefs: [], confidence: 0.80 }],
    contradictions: [], dataChanges: changes,
  });
  assert.ok(challenge.overallThesisHealth > 0);

  const score = computeIntelligenceScore({ dataQuality: 80, evidenceQuality: 70, modelReliability: 75, valuationAttractiveness: 60, riskPressure: 30 });
  assert.ok(score.grade === "A" || score.grade === "B");

  const confidenceDecomposition = { dataQuality: 80, evidenceQuality: 70, modelConfidence: 75, decisionConfidence: score.decisionConfidence };
  const sealedPayload = {
    question: "Growth thesis valid?", decision: "Confirmed with caveats",
    engineId: "research.intelligence_score", engineVersion: "1.0",
    confidenceDecomposition,
  };
  const snapshotHash = decisionSnapshotHash(sealedPayload);
  assert.equal(snapshotHash.length, 64);
  assert.equal(snapshotHash, decisionSnapshotHash(sealedPayload));
});

test("PIPELINE: BYOAI tool permissions enforce security boundaries", () => {
  // All read tools should be allowed
  for (const tool of MCP_TOOL_REGISTRY.filter((t) => t.category === "read")) {
    const decision = evaluateToolPermission(tool.id);
    assert.equal(decision.allowed, true, `Read tool ${tool.id} should be allowed`);
    assert.equal(decision.requiresApproval, false, `Read tool ${tool.id} should not require approval`);
  }
  // All write tools should require approval
  for (const tool of MCP_TOOL_REGISTRY.filter((t) => t.category === "write")) {
    const decision = evaluateToolPermission(tool.id);
    assert.equal(decision.allowed, true);
    assert.equal(decision.requiresApproval, true, `Write tool ${tool.id} should require approval`);
  }
});

test("PIPELINE: governance redaction strips secrets from diagnostic export", () => {
  const result = redactDiagnostics({
    appVersion: "1.0.0",
    apiKey: "sk-secret-key-value",
    nested: { databasePassword: "pass123", status: "ok" },
  });
  assert.equal(result.redactedData.appVersion, "1.0.0");
  assert.equal(result.redactedData.apiKey, "[REDACTED]");
  const nested = result.redactedData.nested as Record<string, unknown>;
  assert.equal(nested.databasePassword, "[REDACTED]");
  assert.equal(nested.status, "ok");
});

test("PIPELINE: control plane license → entitlement → device chain", () => {
  const license = evaluateLicenseLifecycle({ status: "active", offlineLeaseExpiresAt: "2027-01-01" });
  assert.equal(license.canAuthenticate, true);
  assert.equal(license.canUseEntitledFeatures, true);

  const device = evaluateDeviceAuthorization({ status: "authorized", leaseExpiresAt: "2027-01-01" });
  assert.equal(device.allowed, true);

  const entitled = hasFeatureEntitlement([
    { featureKey: "valuation.dcf", active: true },
    { featureKey: "export.pdf", active: true },
  ], "valuation.dcf");
  assert.equal(entitled, true);

  // Suspended license blocks everything
  const suspended = evaluateLicenseLifecycle({ status: "suspended" });
  assert.equal(suspended.canAuthenticate, false);
  assert.equal(suspended.shouldRevokeSessions, true);
});

test("PIPELINE: permission matrix enforces role boundaries", () => {
  // Admin can do everything
  assert.equal(hasPermission("internal_admin", "manage_licenses"), true);
  assert.equal(hasPermission("internal_admin", "export_diagnostics"), true);
  // Client cannot manage infrastructure
  assert.equal(hasPermission("client_user", "manage_licenses"), false);
  assert.equal(hasPermission("client_user", "manage_credentials"), false);
  assert.equal(hasPermission("client_user", "export_diagnostics"), false);
  // But client can view dashboard and export reports
  assert.equal(hasPermission("client_user", "view_dashboard"), true);
  assert.equal(hasPermission("client_user", "export_reports"), true);
});

test("ARCHITECTURE: total engine count is >= 55", () => {
  assert.ok(ENGINE_CONTRACT_DECLARATIONS.length >= 55, `Expected >= 55 engines, got ${ENGINE_CONTRACT_DECLARATIONS.length}`);
});

test("ARCHITECTURE: total contract families is >= 15", () => {
  assert.ok(CONTRACT_FAMILIES.length >= 15, `Expected >= 15 families, got ${CONTRACT_FAMILIES.length}`);
});

test("ARCHITECTURE: total built-in connectors is >= 16", () => {
  assert.ok(BUILT_IN_CONNECTORS.length >= 16, `Expected >= 16 connectors, got ${BUILT_IN_CONNECTORS.length}`);
});

test("ARCHITECTURE: total AI providers is >= 6", () => {
  assert.ok(AI_PROVIDERS.length >= 6, `Expected >= 6 AI providers, got ${AI_PROVIDERS.length}`);
});

test("ARCHITECTURE: total MCP tools is >= 14", () => {
  assert.ok(MCP_TOOL_REGISTRY.length >= 14, `Expected >= 14 MCP tools, got ${MCP_TOOL_REGISTRY.length}`);
});

