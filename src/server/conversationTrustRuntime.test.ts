import assert from "node:assert/strict";
import test from "node:test";
import { buildDataStatus } from "@shared/dataStatus";
import type { UniversalDataPlan } from "@shared/trustContracts";
import {
  executeConversationRuntime,
  getConversationTool,
  registerConversationTool,
} from "./conversationRuntime";
import type { OHLCVBar, Quote } from "./marketData";

function canonicalFixtureTool(toolId: string) {
  const tool = getConversationTool(toolId);
  assert.ok(tool, `Missing canonical governed tool fixture source: ${toolId}`);
  return tool;
}

function bars(): OHLCVBar[] {
  return Array.from({ length: 80 }, (_, index) => {
    const close = 150 + index * 0.4;
    return {
      date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000 + index,
    };
  });
}

const quote: Quote = {
  symbol: "AAPL",
  name: "Apple Inc.",
  price: 215,
  change: 2,
  changePercent: 0.94,
  volume: 48_000_000,
  marketCap: 3_200_000_000_000,
  pe: 31.2,
  eps: 6.9,
  revenue: 395_000_000_000,
  high52: 230,
  low52: 165,
  open: 213,
  previousClose: 213,
  dayHigh: 216,
  dayLow: 211,
  avgVolume: 52_000_000,
  exchange: "NASDAQ",
  sector: "Technology",
  quoteSource: "Test Quote Provider",
  isLive: false,
  status: buildDataStatus({
    provider: "Test Quote Provider",
    freshness: "delayed",
    asOf: "2026-09-26T05:30:00.000Z",
    delayLabel: "Fixture delayed",
    isFallback: false,
  }),
  currency: "$",
  entitlement: {
    state: "delayed_available",
    servedTier: "delayed",
    bestAvailableTier: "delayed",
    entitlementRequired: false,
    upgradeConnectorId: null,
    upgradeConnectorLabel: null,
    reason: "test fixture",
  },
};

function dataPlan(series: "quote" | "ohlcv", connectorId: string, label: string): UniversalDataPlan {
  return {
    schemaVersion: "1",
    request: {
      schemaVersion: "1",
      requestId: crypto.randomUUID(),
      projectId: null,
      capability: "prices",
      entity: { ref: "AAPL", symbol: "AAPL", identifiers: {} },
      fields: [series],
      parameters: { series },
      pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
      providerAllow: [],
      providerDeny: [],
      sourceScope: "auto",
      allowPartial: false,
      maxAgeMs: null,
    },
    candidates: [{
      connectorId,
      label,
      contractFamily: series === "quote" ? "market_data" : "price_history",
      fields: [series],
      coverage: "fixture",
      runtimeState: "live_verified",
      operational: true,
      requiresConnection: false,
      rank: 0,
      reason: "Fixture provider is live.",
    }],
    selectedCandidateIds: [connectorId],
    availability: "ready",
    missingFields: [],
    recoveryActions: [],
    plannedAt: new Date().toISOString(),
  };
}

function installTrustFixtures() {
  const history = bars();
  registerConversationTool({
    ...canonicalFixtureTool("lios.instrument-master"),
    label: "Fixture instrument master",
    invoke: async () => ({
      output: { entityId: "entity:aapl", listingId: "listing:aapl", symbol: "AAPL", name: "Apple Inc.", canonical: true },
      summary: "Apple Inc. → AAPL",
      deterministic: true,
      sourceRefs: ["lios:global-instrument-master"],
    }),
  });
  const quotePlan = dataPlan("quote", "test_quote", "Test Quote Provider");
  const historyPlan = dataPlan("ohlcv", "test_history", "Test History Provider");
  registerConversationTool({
    ...canonicalFixtureTool("lios.market-data"),
    label: "Fixture governed market data",
    invoke: async () => ({
      output: {
        quote,
        bars: history,
        historyProvenance: {
          sourceRefs: ["provider:test_history"],
          providerIds: ["test_history"],
          providerLabels: ["Test History Provider"],
          status: buildDataStatus({
            provider: "Test History Provider",
            freshness: "daily",
            asOf: "2026-09-25T23:59:59.999Z",
            isFallback: false,
          }),
          observedAt: "2026-09-26T05:31:00.000Z",
          notes: [],
        },
        dataPlans: [quotePlan, historyPlan],
      },
      summary: "80 daily bars plus delayed quote.",
      deterministic: false,
      sourceRefs: ["provider:test_quote", "provider:test_history"],
      trustContext: {
        dataPlans: [quotePlan, historyPlan],
        historyProvenance: {
          sourceRefs: ["provider:test_history"],
          providerIds: ["test_history"],
          providerLabels: ["Test History Provider"],
          status: buildDataStatus({
            provider: "Test History Provider",
            freshness: "daily",
            asOf: "2026-09-25T23:59:59.999Z",
            isFallback: false,
          }),
          observedAt: "2026-09-26T05:31:00.000Z",
          notes: [],
        },
      },
    }),
  });
  registerConversationTool({
    ...canonicalFixtureTool("lios.finance.technical"),
    label: "Fixture technical engine",
    invoke: async () => ({
      output: { rsi14: 57, macdHistogram: 0.3, macdCrossover: "bullish", support20: 170, resistance20: 182 },
      summary: "Technical snapshot calculated.",
      deterministic: true,
      sourceRefs: ["provider:test_history", "engine:technical"],
    }),
  });
}

test("P3 technical result emits a rich trust manifest with separate quote and history provenance", async () => {
  installTrustFixtures();
  const events: any[] = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 50,
    projectId: null,
    history: [],
    request: {
      requestId: "9f682f1f-c450-4c71-a29d-e45ba01e2fbf",
      message: "technical analysis AAPL with RSI and MACD",
      sourceScope: "auto",
      executionMode: "deterministic_first",
    },
    emit: (event) => { events.push(event); },
  });

  const trust = events.find((event) => event.type === "trust");
  assert.equal(Boolean(trust), true);
  assert.equal(result.trustManifest?.trustId, trust.manifest.trustId);
  assert.equal(trust.manifest.summary.sourceCount >= 3, true);
  assert.equal(trust.manifest.summary.receiptCount, 1);
  assert.equal(trust.manifest.summary.conflictState, "not_evaluated_single_source");
  assert.equal(trust.manifest.evidence.some((item: any) => item.providerLabel === "Test Quote Provider"), true);
  const quoteEvidence = trust.manifest.evidence.find((item: any) => item.providerLabel === "Test Quote Provider");
  assert.equal(quoteEvidence?.access?.state, "delayed_available");
  assert.equal(quoteEvidence?.access?.servedTier, "delayed");
  assert.equal(trust.manifest.evidence.some((item: any) => item.providerLabel === "Test History Provider"), true);
  assert.equal(trust.manifest.claims.some((claim: any) => claim.formulaRefs.some((ref: string) => ref.startsWith("RSI:"))), true);
  assert.equal(trust.manifest.methodology.some((step: any) => step.componentId === "lios.finance.technical"), true);
});

test("P3 governed data gap emits missing-evidence trust before failure", async () => {
  const events: any[] = [];
  await assert.rejects(() => executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 51,
    projectId: null,
    history: [],
    request: {
      requestId: "8a661db8-93e7-4a0a-b2f4-348ef8574d77",
      message: "run technical analysis and show momentum",
      sourceScope: "auto",
      executionMode: "deterministic_first",
    },
    emit: (event) => { events.push(event); },
  }), /requires a security\/company identity/);

  const trustIndex = events.findIndex((event) => event.type === "trust");
  const gapIndex = events.findIndex((event) => event.type === "data_gap");
  assert.equal(trustIndex >= 0, true);
  assert.equal(gapIndex > trustIndex, true);
  const trust = events[trustIndex];
  assert.equal(trust.manifest.summary.evidenceCoveragePct, 0);
  assert.equal(trust.manifest.summary.missingCount, 1);
  assert.equal(trust.manifest.claims[0].status, "unsupported");
});


test("P3 generic deterministic trust carries tool-result and receipt source refs for identity resolution", async () => {
  registerConversationTool({
    ...canonicalFixtureTool("lios.instrument-master"),
    label: "Fixture instrument master",
    invoke: async () => ({
      output: { entityId: "entity:aapl", listingId: "listing:aapl", symbol: "AAPL", canonical: true },
      summary: "AAPL resolved canonically.",
      deterministic: true,
      sourceRefs: ["lios:global-instrument-master"],
    }),
  });

  const events: any[] = [];
  const result = await executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 52,
    projectId: null,
    history: [],
    request: {
      requestId: "5ed1557f-9ea1-4f9f-8f9a-d64e31162b70",
      message: "resolve AAPL",
      sourceScope: "auto",
      executionMode: "deterministic_first",
    },
    emit: (event) => { events.push(event); },
  });

  const trust = events.find((event) => event.type === "trust");
  assert.equal(Boolean(trust), true);
  assert.equal(result.trustManifest?.evidence.some((item) => item.sourceRef === "lios:global-instrument-master"), true);
  assert.equal(trust.manifest.summary.receiptCount, 1);
  assert.equal(trust.manifest.claims[0].status, "supported");
});

test("P3 data-gap trust preserves evidence observed before a later retrieval failure", async () => {
  registerConversationTool({
    ...canonicalFixtureTool("lios.instrument-master"),
    label: "Fixture instrument master",
    invoke: async () => ({
      output: { entityId: "entity:aapl", listingId: "listing:aapl", symbol: "AAPL", name: "Apple Inc.", canonical: true },
      summary: "AAPL resolved canonically.",
      deterministic: true,
      sourceRefs: ["lios:global-instrument-master"],
    }),
  });
  registerConversationTool({
    ...canonicalFixtureTool("lios.market-data"),
    label: "Fixture unavailable market data",
    invoke: async () => {
      throw new Error("insufficient market data for AAPL");
    },
  });

  const events: any[] = [];
  await assert.rejects(() => executeConversationRuntime({
    tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
    scope: "quick",
    chatId: 53,
    projectId: null,
    history: [],
    request: {
      requestId: "f2b83c07-a698-42ab-a73c-344e3907c621",
      message: "technical analysis AAPL with RSI",
      sourceScope: "auto",
      executionMode: "deterministic_first",
    },
    emit: (event) => { events.push(event); },
  }), /insufficient market data/i);

  const trust = events.find((event) => event.type === "trust");
  assert.equal(Boolean(trust), true);
  assert.equal(trust.manifest.evidence.some((item: any) => item.sourceRef === "lios:global-instrument-master"), true);
  assert.equal(trust.manifest.summary.missingCount, 1);
  assert.equal(trust.manifest.claims[0].status, "unsupported");
});
