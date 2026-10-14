/**
 * Deterministic stand-ins for the network-facing tools, used only by the H0 journey harness.
 * The runtime, planner, artifact builders, receipts and trust manifest run for real; only identity,
 * market data, statements and the technical engine are replaced with fixed, labelled fixtures.
 */
import { getConversationTool, registerConversationTool } from "../server/conversationRuntime";
import type { OHLCVBar, Quote } from "../server/marketData";

export const FIXTURE_RSI = 58.4;

// Keep the real validation, permission, replay and cancellation contracts; replace only data retrieval.
function fixtureContract(id: string) {
  const descriptor = getConversationTool(id);
  if (!descriptor) throw new Error(`Journey fixture requires canonical tool "${id}".`);
  return descriptor;
}

function bars(): OHLCVBar[] {
  return Array.from({ length: 120 }, (_, index) => {
    const close = 100 + index * 0.25 + Math.sin(index / 5) * 2;
    return {
      date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1_000_000 + index * 1_000,
    };
  });
}

function quote(): Quote {
  return {
    symbol: "AAPL", name: "Apple Inc.", price: 215, change: 2, changePercent: 0.94, volume: 48_000_000,
    marketCap: 3_200_000_000_000, pe: 31.2, eps: 6.9, revenue: 395_000_000_000, high52: 230, low52: 165,
    open: 213, previousClose: 213, dayHigh: 216, dayLow: 211, avgVolume: 52_000_000, exchange: "NASDAQ",
    sector: "Technology", quoteSource: "eval-fixture", isLive: false,
    status: { provider: "Eval fixture", freshness: "delayed", asOf: "2026-09-26T00:00:00.000Z", delayLabel: "Delayed fixture", isFallback: false },
    currency: "$",
    entitlement: { state: "delayed_available", servedTier: "delayed", bestAvailableTier: "delayed", entitlementRequired: false, upgradeConnectorId: null, upgradeConnectorLabel: null, reason: "eval fixture" },
  };
}

function statement(reportType: "income" | "balance" | "cashflow", data: Record<string, number>, conflicts: unknown[] = []) {
  const report = { symbol: "AAPL", report_type: reportType, date: "2026-09-25", fiscal_year: "2026", period: "FY", reported_currency: "USD", filing_date: "2026-09-25", data: JSON.stringify(data) };
  return {
    capability: "financial_statements", entity: "AAPL",
    authoritative: { providerId: "sec_edgar", providerLabel: "SEC EDGAR", value: [report] },
    observations: [{ providerId: "sec_edgar", providerLabel: "SEC EDGAR", value: [report] }],
    attemptedProviders: ["sec_edgar"], failures: [], conflicts,
    authoritativeReason: "SEC EDGAR ranked highest among providers that returned data.",
    resolvedAt: "2026-09-26T10:00:00.000Z",
  };
}

export interface FixtureCalls { started: string[] }

export function installJourneyFixtures(calls: FixtureCalls): void {
  const history = bars();
  const track = (id: string) => calls.started.push(id);
  registerConversationTool({
    ...fixtureContract("lios.instrument-master"),
    label: "Eval instrument master",
    invoke: async () => {
      track("lios.instrument-master");
      return { output: { entityId: "lios:entity:apple", listingId: "lios:listing:aapl", symbol: "AAPL", name: "Apple Inc.", canonical: true }, summary: "Apple → AAPL", deterministic: true, sourceRefs: ["fixture:instrument-master"] };
    },
  });
  registerConversationTool({
    ...fixtureContract("lios.market-data"),
    label: "Eval market data",
    invoke: async () => {
      track("lios.market-data");
      return { output: { quote: quote(), bars: history }, summary: `${history.length} fixture bars`, deterministic: false, sourceRefs: ["fixture:market-data"] };
    },
  });
  registerConversationTool({
    ...fixtureContract("lios.finance.technical"),
    label: "Eval technical engine",
    invoke: async () => {
      track("lios.finance.technical");
      return { output: { rsi14: FIXTURE_RSI, macdHistogram: 0.42, macdCrossover: "bullish", support20: 121, resistance20: 132 }, summary: "RSI, MACD and support/resistance calculated", deterministic: true, sourceRefs: ["fixture:market-data", "engine:technical"] };
    },
  });
  registerConversationTool({
    ...fixtureContract("lios.company-intelligence"),
    label: "Eval company intelligence",
    invoke: async () => {
      track("lios.company-intelligence");
      const conflict = { key: "income:2026:FY", field: "revenue", material: true, values: [{ providerId: "sec_edgar", value: 420_000_000_000 }, { providerId: "finnhub", value: 410_000_000_000 }] };
      return {
        output: {
          income: statement("income", { revenue: 420_000_000_000, netIncome: 110_000_000_000 }, [conflict]),
          balance: statement("balance", { totalAssets: 370_000_000_000, cash: 60_000_000_000 }),
          cashflow: statement("cashflow", { operatingCashFlow: 130_000_000_000, freeCashFlow: 105_000_000_000 }),
          sourceRefs: ["provider:sec_edgar", "provider:finnhub"], warnings: ["1 income statement conflict(s) preserved for review."],
        },
        summary: "FY statements resolved with one preserved provider conflict.", deterministic: false, sourceRefs: ["provider:sec_edgar", "provider:finnhub"],
      };
    },
  });
}
