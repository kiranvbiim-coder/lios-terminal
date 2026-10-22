import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { boundedTerminalExecutionSlot } from "@shared/terminalArtifact";
import { useState, useMemo, useEffect, memo } from "react";
import { useQueries, useMutation, useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot } from "recharts";
import { Award, Compass, RefreshCw, BarChart3, Sliders, CheckCircle, Activity, Layers, X, Plus, Shuffle } from "lucide-react";
import type { OHLCVSeries } from "@/lib/finance";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/finance";
import { useFamaFrench3 } from "@/lib/useFamaFrench";
import { blackLitterman, olsRegression, type BlackLittermanView } from "@/lib/quantModels";
import { ConceptExplainer } from "./ConceptExplainer";
import { apiRequest } from "@/lib/queryClient";
import {
  buildMaxSharpeGaExpression, maxSharpeGaBounds, normalizeWeights, portfolioReturnRiskSharpe,
} from "@/lib/globalSearchModels";
import { assertSquareMatrix, assertWeights, parseNumberList, withManualProvenance, type AdvancedRiskResponse } from "@/lib/advancedPortfolioRisk";
import { useTerminalQuantRun } from "@/lib/useTerminalQuantRun";
import { AdvancedPortfolioRiskReceipt } from "@/lib/advancedPortfolioRiskReceipt";
import { runFactorPortfolioJson } from "@/lib/FactorPortfolioAdapter";
import { evaluateMandatePreTrade, type MandatePreTradeInput, type MandatePreTradeSourceMetadata } from "@shared/mandatePreTradeEngine";
import { ReadableValueTable } from "@/components/terminal/ReadableValueTable";
import { StructuredJsonEditor, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";

// Standard He-Litterman defaults -- kept independent of the execution-cost
// risk-aversion slider elsewhere in this panel, which tunes a different
// model (Almgren-Chriss optimal execution), not the BL reverse-optimization.
const BL_DELTA = 2.5;
const BL_TAU = 0.05;
const BL_VIEW_CONFIDENCE = 0.5;

const DEFAULT_OPT_ASSETS = ["AAPL", "MSFT", "RELIANCE.NS", "INFY.NS", "BTC-USD"];
const MIN_OPT_ASSETS = 2;
const MAX_OPT_ASSETS = 8;

// Simple covariance helper
function getCovariance(x: number[], y: number[], meanX: number, meanY: number) {
  const n = x.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (x[i] - meanX) * (y[i] - meanY);
  }
  return sum / (n - 1);
}

// Portfolio-construction lab (8 remaining /portfolio/* advanced routes).
// HRP, Ledoit-Wolf and Bayesian mean-shrinkage reuse this panel's real
// basket mu/covariance (their job is estimation/allocation over the same
// data already driving the frontier above); risk-budget layers a manual
// per-asset target budget on top of the real covariance; factor-risk,
// tracking-error, tax-aware-rebalance and stress-aware need factor
// loadings, a benchmark, tax lots or stress scenarios this panel has no
// real source for, so those stay explicit manual JSON entry.
type AdvancedPortfolioModel = "hrp" | "risk-budget" | "factor-risk" | "tracking-error" | "tax-aware-rebalance" | "stress-aware" | "bayesian-mean-shrinkage" | "ledoit-wolf-covariance" | "mandate-pre-trade";
const ADVANCED_PORTFOLIO_MODELS: Array<{ id: AdvancedPortfolioModel; label: string; source: "basket" | "manual" | "basket+manual" }> = [
  { id: "hrp", label: "HRP", source: "basket" },
  { id: "risk-budget", label: "RISK BUDGET", source: "basket+manual" },
  { id: "factor-risk", label: "FACTOR RISK", source: "manual" },
  { id: "tracking-error", label: "TRACKING ERROR", source: "manual" },
  { id: "tax-aware-rebalance", label: "TAX-AWARE REBAL.", source: "manual" },
  { id: "stress-aware", label: "STRESS-AWARE", source: "manual" },
  { id: "bayesian-mean-shrinkage", label: "BAYESIAN SHRINK", source: "basket" },
  { id: "ledoit-wolf-covariance", label: "LEDOIT-WOLF COV", source: "basket" },
  { id: "mandate-pre-trade", label: "MANDATE PRE-TRADE", source: "basket+manual" },
];

type PortfolioWeightsResult = { weights: Record<string, number> };
type RiskBudgetResult = { weights: Record<string, number>; riskContributions: Record<string, number>; budgetError: number };
type FactorRiskResult = { weights: Record<string, number>; factorExposures: number[]; expectedReturnPct: number; volatilityPct: number };
type ProviderFactorRiskSecurity = { securityId: string; exposures: Record<string, number> };
type ProviderFactorRiskSnapshot = {
  snapshotId: string;
  contentHash: string;
  cache: "hit" | "miss";
  request: { symbols: string[]; benchmarkSymbol: string; range: string; asOf: string };
  sources?: {
    benchmark?: { symbol: string; provider: string; status: string; source: string; asOf?: string; retrievedAt: string; bars?: number; fundamentalsAvailable?: boolean };
    securities?: Record<string, { symbol: string; provider: string; status: string; source: string; asOf?: string; retrievedAt: string; bars?: number; fundamentalsAvailable?: boolean }>;
  };
  provenance?: ProviderFactorRiskSnapshot["sources"];
  factors: Array<{ id: string; label?: string }>;
  securities: ProviderFactorRiskSecurity[];
  estimation?: {
    factorReturnSeries?: Array<{ periodEnd: string; returns: Record<string, number> }>;
    factorCovariance?: number[][];
    specificVariances?: Record<string, number>;
    periodsUsed?: number;
    excludedPeriods?: Array<{ periodEnd: string; reason: string }>;
  };
  estimator?: ProviderFactorRiskSnapshot["estimation"];
  excluded: Array<{ securityId: string; reason: string }>;
  limitations: string[];
};
type ProviderFactorRiskCaptureResponse = ProviderFactorRiskSnapshot;
type ProviderFactorRiskDecomposeResponse = {
  snapshotId: string;
  contentHash: string;
  provenance?: ProviderFactorRiskSnapshot["sources"];
  result: {
    expectedReturn: number;
    totalExpectedReturn: number;
    portfolioExposure: Record<string, number>;
    factorContributions: Array<{ factorId: string; exposure: number; expectedContribution: number; varianceContribution: number }>;
    specificContribution: number;
    risk: {
      factorVariance: number;
      specificVariance: number;
      totalVariance: number;
      volatility: number;
      factorVarianceContributions: Record<string, number>;
    };
    active?: {
      activeExposure: Record<string, number>;
      activeExpectedReturn: number;
      factorVariance: number;
      specificVariance: number;
      totalVariance: number;
      volatility: number;
    };
  };
};
type TrackingErrorResult = { weights: Record<string, number>; trackingErrorPct: number; expectedActiveReturnPct: number };
type TaxAwareResult = { weights: Record<string, number>; estimatedTaxCostPct: number; turnover: number; trackingErrorL2: number };
type StressAwareResult = { weights: Record<string, number>; expectedStressLossPct: number; worstScenarioLossPct: number };
type BayesianShrinkageResult = { posteriorMeanReturnsPct: Record<string, number>; posteriorStdPct: Record<string, number>; dataWeights: Record<string, number> };
type LedoitWolfResult = { covarianceMatrixPct2: number[][]; sampleCovarianceMatrixPct2: number[][]; shrinkageIntensity: number; conditionNumberSample: number | null; conditionNumberShrunk: number | null };

const ADVANCED_PORTFOLIO_PLACEHOLDERS: Record<"factor-risk" | "tracking-error" | "tax-aware-rebalance" | "stress-aware", string> = {
  "factor-risk": JSON.stringify({ assets: ["A", "B", "C"], expectedReturnsPct: [8, 7, 10], factorLoadings: [[1, 0.3], [0.8, -0.2], [1.2, 0.6]], factorCovMatrix: [[4, 0.5], [0.5, 2]], idiosyncraticVariancePct2: [2, 1.5, 3], maxFactorExposureAbs: [1.1, 0.4], riskAversion: 1 }),
  "tracking-error": JSON.stringify({ assets: ["A", "B", "C"], expectedReturnsPct: [8, 7, 10], covMatrix: [[4, 1, 0.5], [1, 3, 0.4], [0.5, 0.4, 5]], benchmarkWeights: [0.4, 0.4, 0.2], maxTrackingErrorPct: 2.5 }),
  "tax-aware-rebalance": JSON.stringify({ assets: ["A", "B", "C"], targetWeights: [0.3, 0.4, 0.3], lots: [{ asset: "A", currentWeight: 0.5, costBasisWeightEquivalent: 0.35, unrealizedGainPct: 30 }, { asset: "B", currentWeight: 0.3, costBasisWeightEquivalent: 0.28, unrealizedGainPct: 5 }, { asset: "C", currentWeight: 0.2, costBasisWeightEquivalent: 0.22, unrealizedGainPct: -10 }], taxRatePct: 20, turnoverPenalty: 0.2, taxPenalty: 1 }),
  "stress-aware": JSON.stringify({ assets: ["A", "B", "C"], expectedReturnsPct: [8, 7, 10], covMatrix: [[4, 1, 0.5], [1, 3, 0.4], [0.5, 0.4, 5]], scenarios: [{ name: "recession", assetReturnsPct: [-15, -8, -22], probability: 0.5 }, { name: "inflation", assetReturnsPct: [-8, -5, -10], probability: 0.5 }], maxExpectedStressLossPct: 12, riskAversion: 1 }),
};

const FACTOR_PORTFOLIO_PLACEHOLDER = JSON.stringify({
  sourceClassification: "MANUAL",
  factors: [{ id: "factor_id", label: "Replace with analyst/provider factor", source: "REQUIRED", asOf: "YYYY-MM-DD", units: "decimal return" }],
  factorReturns: { factor_id: null },
  factorReturnProvenance: { factor_id: { source: "REQUIRED", asOf: "YYYY-MM-DD", units: "decimal return" } },
  factorCovariance: [],
  factorCovarianceProvenance: { source: "REQUIRED", asOf: "YYYY-MM-DD", units: "squared decimal return" },
  securities: [],
  specificVariances: {},
  specificVarianceProvenance: { source: "REQUIRED", asOf: "YYYY-MM-DD", units: "squared decimal return" },
  portfolioWeights: {},
});

const MANDATE_PRE_TRADE_PLACEHOLDER = JSON.stringify({
  currentWeights: { AAPL: 0.30, MSFT: 0.25, "RELIANCE.NS": 0.20, "INFY.NS": 0.15, "BTC-USD": 0.10 },
  maxTurnover: 0.25,
  maxWeights: { "BTC-USD": 0.15 },
  minWeights: { AAPL: 0.05 },
  restrictedAssets: [],
  liquidity: {
    AAPL: { advValue: 8000000000, maxParticipationRate: 0.1 },
    MSFT: { advValue: 6000000000, maxParticipationRate: 0.1 },
    "RELIANCE.NS": { advValue: 40000000, maxParticipationRate: 0.1 },
    "INFY.NS": { advValue: 25000000, maxParticipationRate: 0.1 },
    "BTC-USD": { advValue: 20000000000, maxParticipationRate: 0.1 },
  },
  portfolioValue: 50000000,
  transactionCost: { bps: 8 },
  taxCost: { rate: 0.15 },
  sourceMetadata: {
    source: "REPLACE: manual client mandate / account entry",
    status: "manual",
    asOf: "YYYY-MM-DD",
    period: "current",
    unit: "decimal weight",
  },
}, null, 2);

// StructuredJsonEditor schemas for the manual-JSON advanced portfolio routes.
// Field keys mirror the raw document shape 1:1 so the reconstructed object
// satisfies the exact same validators these routes already run.
//
// Known limitations (kept reachable only via each editor's own built-in
// "ADVANCED: EDIT AS JSON" raw-text toggle, never dropped from state):
// - Factor Portfolio: `factorReturnProvenance` is a Record keyed by
//   dynamically-named factor ids -- StructuredJsonEditor's `record` kind only
//   holds number/string values, and per-factor provenance is itself an
//   object, so it has no fixed-field UI and passes through untouched.
// - Factor Portfolio `securities[].exposures` is a Record<factorId, number>
//   with no fixed key set (objectArray table cells only render scalar
//   number/string/select/boolean inputs) -- edited as a compact JSON-object
//   string per row and parsed back into a real record before submission.
// - Stress-aware `scenarios[].assetReturnsPct` is a per-asset number[]
//   column inside an objectArray row (same scalar-cell limitation) --
//   edited as a JSON-array string per row and parsed back into a real
//   number[] before submission.
// - Mandate Pre-Trade: `liquidity` (per-asset ADV/participation caps) and
//   `transactionCost.byAsset` / `taxCost.byAsset` are Records keyed by
//   dynamic, portfolio-specific asset ids holding nested objects/values --
//   no fixed-field UI; edited via the top-level raw-JSON toggle.

const FACTOR_PORTFOLIO_SCHEMA: JsonFieldSchema[] = [
  { kind: "select", key: "sourceClassification", label: "SOURCE CLASSIFICATION", options: ["MANUAL", "PRIVATE"], default: "MANUAL" },
  {
    kind: "objectArray", key: "factors", label: "FACTORS", itemFields: [
      { kind: "string", key: "id", label: "ID" },
      { kind: "string", key: "label", label: "LABEL" },
      { kind: "string", key: "source", label: "SOURCE" },
      { kind: "string", key: "asOf", label: "AS-OF" },
      { kind: "string", key: "units", label: "UNITS" },
    ],
  },
  { kind: "record", key: "factorReturns", label: "FACTOR RETURNS", valueKind: "number" },
  { kind: "numberMatrix", key: "factorCovariance", label: "FACTOR COVARIANCE MATRIX" },
  {
    kind: "object", key: "factorCovarianceProvenance", label: "FACTOR COVARIANCE PROVENANCE", fields: [
      { kind: "string", key: "source", label: "SOURCE" },
      { kind: "string", key: "asOf", label: "AS-OF" },
      { kind: "string", key: "units", label: "UNITS" },
    ],
  },
  {
    kind: "objectArray", key: "securities", label: "SECURITIES (exposures entered as a JSON object, e.g. {\"factor_id\":0.5})", itemFields: [
      { kind: "string", key: "securityId", label: "SECURITY ID" },
      { kind: "string", key: "source", label: "SOURCE" },
      { kind: "string", key: "asOf", label: "AS-OF" },
      { kind: "string", key: "units", label: "UNITS" },
      { kind: "string", key: "exposures", label: "EXPOSURES (JSON)", default: "{}" },
      { kind: "number", key: "specificReturn", label: "SPECIFIC RETURN", optional: true },
    ],
  },
  { kind: "record", key: "specificVariances", label: "SPECIFIC VARIANCES", valueKind: "number" },
  {
    kind: "object", key: "specificVarianceProvenance", label: "SPECIFIC VARIANCE PROVENANCE", fields: [
      { kind: "string", key: "source", label: "SOURCE" },
      { kind: "string", key: "asOf", label: "AS-OF" },
      { kind: "string", key: "units", label: "UNITS" },
    ],
  },
  { kind: "record", key: "portfolioWeights", label: "PORTFOLIO WEIGHTS", valueKind: "number" },
];

// Converts the form's editable state (where `securities[].exposures` is a
// compact JSON-object string, see limitations note above) back into the
// real document shape `runFactorPortfolioJson` validates/consumes.
function buildFactorPortfolioDocument(state: Record<string, unknown>): Record<string, unknown> {
  const securities = Array.isArray(state.securities)
    ? (state.securities as Record<string, unknown>[]).map((row) => {
        const { exposures, ...rest } = row;
        let parsedExposures: Record<string, number> = {};
        if (typeof exposures === "string") {
          try { parsedExposures = JSON.parse(exposures || "{}"); } catch { parsedExposures = {}; }
        } else if (exposures && typeof exposures === "object") {
          parsedExposures = exposures as Record<string, number>;
        }
        return { ...rest, exposures: parsedExposures };
      })
    : state.securities;
  return { ...state, securities };
}

const FACTOR_RISK_SCHEMA: JsonFieldSchema[] = [
  { kind: "stringArray", key: "assets", label: "ASSETS" },
  { kind: "numberArray", key: "expectedReturnsPct", label: "EXPECTED RETURNS %", itemLabel: "ASSET" },
  { kind: "numberMatrix", key: "factorLoadings", label: "FACTOR LOADINGS (ASSETS \u00d7 FACTORS)" },
  { kind: "numberMatrix", key: "factorCovMatrix", label: "FACTOR COVARIANCE MATRIX" },
  { kind: "numberArray", key: "idiosyncraticVariancePct2", label: "IDIOSYNCRATIC VARIANCE %\u00b2", itemLabel: "ASSET" },
  { kind: "numberArray", key: "maxFactorExposureAbs", label: "MAX FACTOR EXPOSURE (ABS)", itemLabel: "FACTOR" },
  { kind: "number", key: "riskAversion", label: "RISK AVERSION", default: 1, optional: true },
];

const TRACKING_ERROR_SCHEMA: JsonFieldSchema[] = [
  { kind: "stringArray", key: "assets", label: "ASSETS" },
  { kind: "numberArray", key: "expectedReturnsPct", label: "EXPECTED RETURNS %", itemLabel: "ASSET" },
  { kind: "numberMatrix", key: "covMatrix", label: "COVARIANCE MATRIX" },
  { kind: "numberArray", key: "benchmarkWeights", label: "BENCHMARK WEIGHTS", itemLabel: "ASSET" },
  { kind: "number", key: "maxTrackingErrorPct", label: "MAX TRACKING ERROR %" },
];

const TAX_AWARE_SCHEMA: JsonFieldSchema[] = [
  { kind: "stringArray", key: "assets", label: "ASSETS" },
  { kind: "numberArray", key: "targetWeights", label: "TARGET WEIGHTS", itemLabel: "ASSET" },
  {
    kind: "objectArray", key: "lots", label: "TAX LOTS", itemFields: [
      { kind: "string", key: "asset", label: "ASSET" },
      { kind: "number", key: "currentWeight", label: "CURRENT WEIGHT" },
      { kind: "number", key: "costBasisWeightEquivalent", label: "COST BASIS WEIGHT" },
      { kind: "number", key: "unrealizedGainPct", label: "UNREALIZED GAIN %" },
    ],
  },
  { kind: "number", key: "taxRatePct", label: "TAX RATE %" },
  { kind: "number", key: "turnoverPenalty", label: "TURNOVER PENALTY" },
  { kind: "number", key: "taxPenalty", label: "TAX PENALTY" },
];

const STRESS_AWARE_SCHEMA: JsonFieldSchema[] = [
  { kind: "stringArray", key: "assets", label: "ASSETS" },
  { kind: "numberArray", key: "expectedReturnsPct", label: "EXPECTED RETURNS %", itemLabel: "ASSET" },
  { kind: "numberMatrix", key: "covMatrix", label: "COVARIANCE MATRIX" },
  {
    kind: "objectArray", key: "scenarios", label: "STRESS SCENARIOS (returns entered as a JSON array, e.g. [-15,-8,-22])", itemFields: [
      { kind: "string", key: "name", label: "NAME" },
      { kind: "string", key: "assetReturnsPct", label: "ASSET RETURNS % (JSON ARRAY)" },
      { kind: "number", key: "probability", label: "PROBABILITY" },
    ],
  },
  { kind: "number", key: "maxExpectedStressLossPct", label: "MAX EXPECTED STRESS LOSS %" },
  { kind: "number", key: "riskAversion", label: "RISK AVERSION", default: 1, optional: true },
];

// Converts placeholder/example JSON (real `assetReturnsPct` number[]) into
// the form's editable state (`assetReturnsPct` as a JSON-array string, see
// limitations note above).
function seedStressAwareState(json: string): Record<string, unknown> {
  const parsed = JSON.parse(json) as { scenarios?: Array<Record<string, unknown> & { assetReturnsPct?: number[] }> };
  return {
    ...parsed,
    scenarios: (parsed.scenarios ?? []).map((s) => ({ ...s, assetReturnsPct: JSON.stringify(s.assetReturnsPct ?? []) })),
  };
}

// Converts the form's editable state back into the real document shape
// the stress-aware validator/route consume.
function buildStressAwareDocument(state: Record<string, unknown>): Record<string, unknown> {
  const scenarios = Array.isArray(state.scenarios)
    ? (state.scenarios as Record<string, unknown>[]).map((row) => {
        const raw = row.assetReturnsPct;
        let assetReturnsPct: unknown = raw;
        if (typeof raw === "string") {
          try { assetReturnsPct = JSON.parse(raw); } catch { assetReturnsPct = []; }
        }
        return { ...row, assetReturnsPct };
      })
    : state.scenarios;
  return { ...state, scenarios };
}

const MANDATE_PRE_TRADE_SCHEMA: JsonFieldSchema[] = [
  { kind: "record", key: "currentWeights", label: "CURRENT WEIGHTS", valueKind: "number" },
  { kind: "number", key: "maxTurnover", label: "MAX TURNOVER" },
  { kind: "record", key: "maxWeights", label: "MAX WEIGHTS", valueKind: "number" },
  { kind: "record", key: "minWeights", label: "MIN WEIGHTS", valueKind: "number" },
  { kind: "stringArray", key: "restrictedAssets", label: "RESTRICTED ASSETS" },
  { kind: "number", key: "portfolioValue", label: "PORTFOLIO VALUE", optional: true },
  {
    kind: "object", key: "transactionCost", label: "TRANSACTION COST", fields: [
      { kind: "number", key: "rate", label: "RATE (DECIMAL)", optional: true },
      { kind: "number", key: "bps", label: "BASIS POINTS", optional: true },
    ],
  },
  {
    kind: "object", key: "taxCost", label: "TAX COST", fields: [
      { kind: "number", key: "rate", label: "RATE (DECIMAL)", optional: true },
      { kind: "number", key: "bps", label: "BASIS POINTS", optional: true },
    ],
  },
  {
    kind: "object", key: "sourceMetadata", label: "SOURCE METADATA", fields: [
      { kind: "string", key: "source", label: "SOURCE" },
      { kind: "string", key: "provider", label: "PROVIDER", optional: true },
      { kind: "string", key: "status", label: "STATUS" },
      { kind: "string", key: "asOf", label: "AS-OF" },
      { kind: "string", key: "period", label: "PERIOD" },
      { kind: "string", key: "unit", label: "UNIT" },
      { kind: "string", key: "snapshotId", label: "SNAPSHOT ID", optional: true },
      { kind: "string", key: "sourceReference", label: "SOURCE REFERENCE", optional: true },
    ],
  },
];

function PortfolioOptimizerPanel({ onSymbol, externalRiskMod }: { onSymbol: (sym: string) => void; externalRiskMod?: number }) {
  const terminal = useTerminalArtifactContext();
  const [assets, setAssets] = useTerminalArtifactState<string[]>("PortfolioOptimizerPanel.assets", DEFAULT_OPT_ASSETS);
  const quant = useTerminalQuantRun();
  function runAdvancedPortfolioRisk<T extends Record<string, unknown>>(path: string, parameters: Record<string, unknown>, transformations: readonly string[] = []): Promise<AdvancedRiskResponse<T>> {
    return quant.run<AdvancedRiskResponse<T>>(path, withManualProvenance(parameters, transformations), boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.${path}`));
  }
  const [advancedModel, setAdvancedModel] = useTerminalArtifactState<AdvancedPortfolioModel>("PortfolioOptimizerPanel.advancedModel", "hrp");
  const [factorRiskState, setFactorRiskState] = useTerminalArtifactState<Record<string, unknown>>("PortfolioOptimizerPanel.factorRiskState", () => JSON.parse(ADVANCED_PORTFOLIO_PLACEHOLDERS["factor-risk"]));
  const [trackingErrorState, setTrackingErrorState] = useTerminalArtifactState<Record<string, unknown>>("PortfolioOptimizerPanel.trackingErrorState", () => JSON.parse(ADVANCED_PORTFOLIO_PLACEHOLDERS["tracking-error"]));
  const [taxAwareState, setTaxAwareState] = useTerminalArtifactState<Record<string, unknown>>("PortfolioOptimizerPanel.taxAwareState", () => JSON.parse(ADVANCED_PORTFOLIO_PLACEHOLDERS["tax-aware-rebalance"]));
  const [stressAwareState, setStressAwareState] = useTerminalArtifactState<Record<string, unknown>>("PortfolioOptimizerPanel.stressAwareState", () => seedStressAwareState(ADVANCED_PORTFOLIO_PLACEHOLDERS["stress-aware"]));
  const [mandatePreTradeState, setMandatePreTradeState] = useTerminalArtifactState<Record<string, unknown>>("PortfolioOptimizerPanel.mandatePreTradeState", () => JSON.parse(MANDATE_PRE_TRADE_PLACEHOLDER));
  const [riskBudgetText, setRiskBudgetText] = useTerminalArtifactState("PortfolioOptimizerPanel.riskBudgetText", "");
  const [allowShortBudget, setAllowShortBudget] = useTerminalArtifactState("PortfolioOptimizerPanel.allowShortBudget", false);
  const [bayesianPriorStdPct, setBayesianPriorStdPct] = useTerminalArtifactState("PortfolioOptimizerPanel.bayesianPriorStdPct", 5);
  const [assetInput, setAssetInput] = useTerminalArtifactState("PortfolioOptimizerPanel.assetInput", "");
  const [activeSegment, setActiveSegment] = useTerminalArtifactState<"frontier" | "execution" | "globalSearch" | "construction" | "factorAttribution">("PortfolioOptimizerPanel.activeSegment", "frontier");
  const [factorPortfolioState, setFactorPortfolioState] = useTerminalArtifactState<Record<string, unknown>>("PortfolioOptimizerPanel.factorPortfolioState", () => JSON.parse(FACTOR_PORTFOLIO_PLACEHOLDER));
  const [providerFactorRange, setProviderFactorRange] = useTerminalArtifactState<"1Y" | "2Y" | "3Y" | "5Y">("PortfolioOptimizerPanel.providerFactorRange", "5Y");
  const [isExecutingSim, setIsExecutingSim] = useState(false);
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [simProgress, setSimProgress] = useState(100000);
  const [sharesToLiquidate, setSharesToLiquidate] = useTerminalArtifactState("PortfolioOptimizerPanel.sharesToLiquidate", 100000);
  const [riskAversion, setRiskAversion] = useTerminalArtifactState("PortfolioOptimizerPanel.riskAversion", 0.15);
  const [daysToLiquidate, setDaysToLiquidate] = useTerminalArtifactState("PortfolioOptimizerPanel.daysToLiquidate", 5);
  const [rfRate, setRfRate] = useTerminalArtifactState("PortfolioOptimizerPanel.rfRate", 4.0);
  const [viewAsset, setViewAsset] = useTerminalArtifactState("PortfolioOptimizerPanel.viewAsset", "AAPL");
  
  // Black-Litterman subjective views (adjustment to annualized expected returns)
  const [viewReliance, setViewReliance] = useTerminalArtifactState("PortfolioOptimizerPanel.viewReliance", 0);
  const [viewBTC, setViewBTC] = useTerminalArtifactState("PortfolioOptimizerPanel.viewBTC", 0);

  // GA global-search cross-check (Portfolio Optimizer, item 2) -- optional
  // "best K of N" cardinality constraint the closed-form/MC-sampled
  // optimizer above cannot express.
  const [cardinalityEnabled, setCardinalityEnabled] = useTerminalArtifactState("PortfolioOptimizerPanel.cardinalityEnabled", false);
  const [cardinalityK, setCardinalityK] = useTerminalArtifactState("PortfolioOptimizerPanel.cardinalityK", 4);

  const [simulationTrigger, setSimulationTrigger] = useState(0);

  const activeRiskAversion = externalRiskMod !== undefined
    ? Math.min(2.0, riskAversion * (1 + (externalRiskMod / 2.0)))
    : riskAversion;

  const addAsset = () => {
    const t = assetInput.trim().toUpperCase();
    if (t && !assets.includes(t) && assets.length < MAX_OPT_ASSETS) {
      setAssets((prev) => [...prev, t]);
      setAssetInput("");
    }
  };
  const removeAsset = (t: string) => {
    if (assets.length <= MIN_OPT_ASSETS) return;
    setAssets((prev) => prev.filter((x) => x !== t));
  };

  // Fama-French asset selector must always point at an asset still in the
  // basket -- otherwise removing the selected asset would silently blank
  // that section instead of falling back to another asset in the list.
  useEffect(() => {
    if (!assets.includes(viewAsset)) setViewAsset(assets[0]);
  }, [assets, viewAsset]);

  // Cardinality K must always stay a valid "fewer than N" constraint as the
  // basket is edited -- otherwise K>=N would be a no-op constraint silently
  // left stale after removing assets.
  useEffect(() => {
    setCardinalityK((k) => Math.min(Math.max(1, k), Math.max(1, assets.length - 1)));
  }, [assets.length]);

  // Genetic-algorithm global-search cross-check -- real pymoo GA run
  // through the live optimization sidecar (/api/quant/optimization/
  // genetic-algorithm) over this basket's real mu/Sigma, built on demand
  // (not on every render) since a 100-pop/150-generation run takes a few
  // real seconds.
  const gaCrossCheckMutation = useMutation({
    mutationFn: async (body: { expression: string; bounds: [number, number][] }) => quant.run<{
      bestX: number[]; bestF: number; generationsRun: number; receipt?: { parameters?: Record<string, unknown> };
    }>("/optimization/genetic-algorithm", {
      expression: body.expression, bounds: body.bounds, popSize: 100, nGenerations: 150,
    }, "portfolio.original-ga", "/api/quant/optimization/genetic-algorithm"),
  });
  const gaCrossCheck = { ...gaCrossCheckMutation, data: terminal?.target ? quant.stored?.["portfolio.original-ga"] as typeof gaCrossCheckMutation.data : gaCrossCheckMutation.data };
  const gaCrossCheckReset = gaCrossCheck.reset;
  useEffect(() => { gaCrossCheckReset(); }, [assets, cardinalityEnabled, cardinalityK, gaCrossCheckReset]);

  // HFT simulation ticking loop
  useEffect(() => {
    if (!isExecutingSim) return;
    
    let currentShares = 100000;
    setSimProgress(100000);
    setSimLogs([
      `[${new Date().toLocaleTimeString()}] [SYSTEM] Matcher online. Initializing Almgren-Chriss block execution...`,
      `[${new Date().toLocaleTimeString()}] [SYSTEM] Liquidation size: 100,000 shares of ${viewAsset} over ${daysToLiquidate} days.`,
      `[${new Date().toLocaleTimeString()}] [SYSTEM] Optimal Trading Rate: ~20,000 shares/day. Lambda=${activeRiskAversion.toFixed(2)}.`
    ]);

    const interval = setInterval(() => {
      if (currentShares <= 0) {
        clearInterval(interval);
        setIsExecutingSim(false);
        setSimLogs(prev => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] [COMPLETE] Block crossed. Crossed 100,000 shares total. avg slippage: 8.4 bps.`
        ]);
        return;
      }

      // Decrement shares
      const tradeSize = Math.min(currentShares, Math.floor(8000 + Math.random() * 5000));
      currentShares -= tradeSize;
      setSimProgress(currentShares);

      const timeStr = new Date().toLocaleTimeString();
      const slippage = -(0.005 + Math.random() * 0.015).toFixed(3);
      const algoType = Math.random() > 0.4 ? "Optimal" : "VWAP ENG";
      const sizeDepth = Math.floor(10000 + Math.random() * 20000).toLocaleString();

      setSimLogs(prev => [
        ...prev,
        `[${timeStr}] [${algoType}] Sold ${tradeSize.toLocaleString()} shares @ limit (Slippage: ${slippage}% | Ask Depth: ${sizeDepth} size)`,
        `[${timeStr}] [QUEUE] ${currentShares.toLocaleString()} shares remaining in execution queue.`
      ]);
    }, 1000);

    return () => clearInterval(interval);
  }, [isExecutingSim, viewAsset, daysToLiquidate, activeRiskAversion]);

  // Fetch 1-year history for all assets in parallel
  const results = useQueries({
    queries: assets.map((symbol) => ({
      queryKey: ["/api/finance/ohlcv", symbol, "1Y", "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol, range: "1Y", interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to fetch ${symbol}`);
        return res.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60000,
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const hasError = results.some((r) => r.isError);

  // Real Fama-French 3-factor data (replaces the old AAPL/BTC OLS proxy).
  const ff3StartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 400);
    return d.toISOString().slice(0, 10);
  }, []);
  const ff3EndDate = new Date().toISOString().slice(0, 10);
  const { data: ff3Factors = [] } = useFamaFrench3(ff3StartDate, ff3EndDate);

  const executionTrajectory = useMemo(() => {
    const X0 = sharesToLiquidate;
    const lambda = activeRiskAversion;
    const T = daysToLiquidate;
    const eta = 0.08; // temporary impact coefficient
    const sigma = 0.25; // return volatility
    
    // kappa = sqrt( (lambda * sigma^2) / eta )
    const kappa = Math.sqrt((lambda * Math.pow(sigma, 2)) / eta);
    const halfKappa = kappa / 2;
    
    const points: Array<{
      day: string;
      remaining: number;
      sharesRemaining: number;
      linearVWAP: number;
      trade: number;
      cost: number;
    }> = [];
    let currentX = X0;
    let impactCost = 0;
    let riskPremiumCost = 0;

    for (let t = 0; t <= T; t++) {
      // Optimal trajectory: X(t) = X0 * sinh(kappa * (T - t)) / sinh(kappa * T)
      // If kappa is extremely small, linear path is used
      let pathX = 0;
      if (kappa < 0.001) {
        pathX = X0 * (1 - t / T);
      } else {
        pathX = X0 * (Math.sinh(kappa * (T - t)) / Math.sinh(kappa * T));
      }
      
      const tradeSize = t === 0 ? 0 : points[t - 1].remaining - pathX;
      
      // Transaction cost formulas (Almgren-Chriss)
      // temporary impact = eta * (tradeSize / dt) * sign(tradeSize)
      // permanent impact = gamma * tradeSize
      const dt = 1;
      const tempImpact = eta * (tradeSize / dt);
      const costThisStep = tradeSize * tempImpact;
      
      if (t > 0) {
        impactCost += costThisStep;
        // risk premium = lambda * sigma^2 * remainingX^2 * dt
        riskPremiumCost += lambda * Math.pow(sigma, 2) * Math.pow(pathX, 2) * dt;
      }

      points.push({
        day: `Day ${t}`,
        remaining: Math.round(pathX),
        sharesRemaining: Math.round(pathX),
        linearVWAP: Math.round(X0 * (1 - t / T)),
        trade: Math.round(tradeSize),
        cost: Math.round(costThisStep),
      });
    }
    
    return {
      points,
      expectedImpact: impactCost,
      riskPremium: riskPremiumCost,
      totalCost: impactCost + riskPremiumCost,
    };
  }, [sharesToLiquidate, activeRiskAversion, daysToLiquidate]);

  const optimizationData = useMemo(() => {
    if (isLoading || hasError) return null;

    // Extract return series
    const returns: number[][] = [];
    const dates: string[] = [];

    // Find common dates
    const commonDatesSet = new Set<string>();
    const assetReturnsMap = results.map((r) => {
      const map = new Map<string, number>();
      const bars = r.data?.bars || [];
      for (let i = 1; i < bars.length; i++) {
        const prev = bars[i - 1].close;
        const curr = bars[i].close;
        if (prev > 0) {
          const dStr = bars[i].date.split("T")[0];
          map.set(dStr, (curr - prev) / prev);
        }
      }
      return map;
    });

    // Intersect common dates
    if (assetReturnsMap[0]) {
      assetReturnsMap[0].forEach((_, date) => {
        if (assetReturnsMap.every((m) => m.has(date))) {
          commonDatesSet.add(date);
        }
      });
    }

    const commonDates = Array.from(commonDatesSet).sort();
    const dailyReturns = assets.map((_, assetIdx) => {
      const map = assetReturnsMap[assetIdx];
      return commonDates.map((d) => map.get(d)!);
    });

    const numObs = commonDates.length;
    if (numObs < 10) return null;

    // Calculate means (daily)
    const dailyMeans = dailyReturns.map((retSeries) => {
      return retSeries.reduce((s, v) => s + v, 0) / numObs;
    });

    // Historical annualized returns (assuming 252 trading days) -- the raw
    // sample means, before any Black-Litterman blending.
    const historicalAnnReturns = dailyMeans.map((m) => m * 252);

    // Covariance matrix (annualized)
    const covMatrix: number[][] = [];
    for (let i = 0; i < assets.length; i++) {
      covMatrix[i] = [];
      for (let j = 0; j < assets.length; j++) {
        const dailyCov = getCovariance(dailyReturns[i], dailyReturns[j], dailyMeans[i], dailyMeans[j]);
        covMatrix[i][j] = dailyCov * 252; // annualize
      }
    }

    // Real Black-Litterman: reverse-optimize an equal-weight equilibrium
    // prior (pi = delta*Sigma*w), then blend in the slider "views" as
    // absolute view returns (equilibrium + slider adjustment) through the
    // actual He-Litterman posterior formula -- not a raw addition to the
    // historical mean like the old placeholder version.
    const priorWeights = assets.map(() => 1 / assets.length);
    const equilibriumPreview = covMatrix.map((row) => BL_DELTA * row.reduce((s, v, j) => s + v * priorWeights[j], 0));
    const blViews: BlackLittermanView[] = [];
    const relianceIdx = assets.indexOf("RELIANCE.NS");
    if (viewReliance !== 0 && relianceIdx !== -1) blViews.push({ assetIndex: relianceIdx, viewReturn: equilibriumPreview[relianceIdx] + viewReliance / 100, confidence: BL_VIEW_CONFIDENCE });
    const btcIdx = assets.indexOf("BTC-USD");
    if (viewBTC !== 0 && btcIdx !== -1) blViews.push({ assetIndex: btcIdx, viewReturn: equilibriumPreview[btcIdx] + viewBTC / 100, confidence: BL_VIEW_CONFIDENCE });
    const blResult = blackLitterman(covMatrix, priorWeights, BL_DELTA, BL_TAU, blViews);
    const annExpectedReturns = blViews.length ? blResult.posteriorReturns : historicalAnnReturns;

    // Generate random portfolios to map the Efficient Frontier cloud
    const portfolios = [];
    let maxSharpe = { Sharpe: -Infinity, Return: 0, Risk: 0, weights: [] as number[] };
    let minRisk = { Sharpe: 0, Return: 0, Risk: Infinity, weights: [] as number[] };

    const rf = rfRate / 100;

    for (let p = 0; p < 1000; p++) {
      // Dirichlet-style weight generation
      const r = assets.map(() => Math.random());
      const sum = r.reduce((a, b) => a + b, 0);
      const weights = r.map((v) => v / sum);

      // Portfolio return
      let pReturn = 0;
      for (let i = 0; i < weights.length; i++) {
        pReturn += weights[i] * annExpectedReturns[i];
      }

      // Portfolio variance w^T * Sigma * w
      let pVar = 0;
      for (let i = 0; i < weights.length; i++) {
        for (let j = 0; j < weights.length; j++) {
          pVar += weights[i] * weights[j] * covMatrix[i][j];
        }
      }
      const pRisk = Math.sqrt(pVar);
      const pSharpe = (pReturn - rf) / pRisk;

      const pt = {
        Return: pReturn * 100, // percentage
        Risk: pRisk * 100,     // percentage
        Sharpe: pSharpe,
      };

      portfolios.push(pt);

      if (pSharpe > maxSharpe.Sharpe) {
        maxSharpe = { Sharpe: pSharpe, Return: pt.Return, Risk: pt.Risk, weights };
      }
      if (pt.Risk < minRisk.Risk) {
        minRisk = { Sharpe: pSharpe, Return: pt.Return, Risk: pt.Risk, weights };
      }
    }

    // Real Fama-French 3-factor regression for the active asset, using
    // actual Mkt-RF/SMB/HML factor returns from Kenneth French's Data
    // Library (replaces the old AAPL/BTC 2-asset OLS proxy that had
    // nothing to do with real size/value factors).
    const assetIdx = assets.indexOf(viewAsset);
    let ffmStats: { betaMarket: number; betaSMB: number; betaHML: number; alphaAnnual: number; rSquared: number; n: number } | null = null;
    if (assetIdx !== -1 && ff3Factors.length > 0) {
      const factorByDate = new Map(ff3Factors.map((f) => [f.date, f]));
      const matched: { excessRet: number; mktRf: number; smb: number; hml: number }[] = [];
      commonDates.forEach((d, i) => {
        const f = factorByDate.get(d);
        if (!f) return;
        const assetRetPct = dailyReturns[assetIdx][i] * 100;
        matched.push({ excessRet: assetRetPct - f.RF, mktRf: f.MktRF, smb: f.SMB, hml: f.HML });
      });
      if (matched.length >= 15) {
        const reg = olsRegression(
          matched.map((m) => m.excessRet),
          [matched.map((m) => m.mktRf), matched.map((m) => m.smb), matched.map((m) => m.hml)],
        );
        ffmStats = {
          betaMarket: reg.betas[0],
          betaSMB: reg.betas[1],
          betaHML: reg.betas[2],
          alphaAnnual: reg.alpha * 252,
          rSquared: reg.rSquared,
          n: matched.length,
        };
    }
    }

    // Calculate individual asset returns and volatilities (Standard Deviations)
    const individualAssets = assets.map((sym, idx) => {
      const assetRet = annExpectedReturns[idx] * 100;
      const assetRisk = Math.sqrt(covMatrix[idx][idx]) * 100;
      return {
        symbol: sym,
        Return: assetRet,
        Risk: assetRisk,
        Sharpe: assetRisk > 0 ? (annExpectedReturns[idx] - rf) / (assetRisk / 100) : 0,
      };
    });

    return {
      portfolios,
      maxSharpe,
      minRisk,
      annExpectedReturns,
      covMatrix,
      ffmStats,
      individualAssets,
      blViews,
      priorWeights,
      // Raw per-asset daily-return series (asset-major, fraction units) --
      // exposed additively for the portfolio-construction lab (Ledoit-Wolf
      // covariance / Bayesian mean-shrinkage) below, which need the actual
      // observation history rather than the already-aggregated mean/cov.
      dailyReturns,
      latestAsOf: commonDates.at(-1) ?? "",
    };
  }, [assets, results, isLoading, hasError, rfRate, viewReliance, viewBTC, viewAsset, simulationTrigger, ff3Factors]);

  // Black-Litterman posterior-covariance & explicit view-uncertainty
  // extension (item 4) -- calls the live portfolio_bayesian.py
  // Black-Litterman route (python-service, same He-Litterman formula as
  // the blackLitterman() call above, general P/Q view-matrix form) purely
  // to surface posteriorCovariance and per-view uncertainty the
  // client-side formula above doesn't return. Reuses the exact same
  // prior/tau/delta/omega inputs so posteriorReturnsPct matches
  // blResult.posteriorReturns above -- this is an additive display on the
  // existing Black-Litterman panel, not a second competing control.
  const blViewsKey = optimizationData ? JSON.stringify(optimizationData.blViews) : "";
  const blPosteriorMutation = useMutation({
    mutationFn: async (payload: {
      assets: string[]; marketWeights: number[]; covarianceMatrix: number[][];
      viewMatrix: number[][]; viewReturnsPct: number[]; viewUncertaintyPct2: number[];
    }) => runAdvancedPortfolioRisk<{
      equilibriumReturnsPct: Record<string, number>; posteriorReturnsPct: Record<string, number>;
      posteriorCovariance: number[][]; viewResidualPct: number[];
    }>("portfolio/black-litterman", {
      assets: payload.assets, marketWeights: payload.marketWeights, covarianceMatrix: payload.covarianceMatrix,
      riskAversion: BL_DELTA, tau: BL_TAU,
      viewMatrix: payload.viewMatrix, viewReturnsPct: payload.viewReturnsPct, viewUncertaintyPct2: payload.viewUncertaintyPct2,
    }, ["Browser-estimated displayed basket covariance and authored views. No immutable provider source binding is asserted."]),
  });
  const blPosterior = { ...blPosteriorMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/black-litterman`)] as typeof blPosteriorMutation.data : blPosteriorMutation.data };
  const blPosteriorMutate = blPosterior.mutate;
  const blPosteriorReset = blPosterior.reset;
  function runBlPosterior() {
    if (!optimizationData || optimizationData.blViews.length === 0) {
      blPosteriorReset();
      return;
    }
    const { blViews, covMatrix, priorWeights } = optimizationData;
    const viewMatrix = blViews.map((v) => assets.map((_, j) => (j === v.assetIndex ? 1 : 0)));
    const viewReturnsPct = blViews.map((v) => v.viewReturn);
    // Same Omega diagonal as blackLitterman() in quantModels.ts: for a
    // one-hot view row, P*tauSigma*P' collapses to tau*Sigma[assetIndex][assetIndex].
    const viewUncertaintyPct2 = blViews.map((v) => {
      const confidence = Math.min(0.99, Math.max(0.01, v.confidence ?? 0.5));
      return BL_TAU * covMatrix[v.assetIndex][v.assetIndex] * (1 / confidence - 1 + 0.01);
    });
    blPosteriorMutate({ assets, marketWeights: priorWeights, covarianceMatrix: covMatrix, viewMatrix, viewReturnsPct, viewUncertaintyPct2 });
  }
  useEffect(() => { if (!terminal) runBlPosterior(); }, [blViewsKey, assets, blPosteriorMutate, blPosteriorReset]);

  // Portfolio-construction lab -- HRP / risk-budget / Bayesian shrinkage /
  // Ledoit-Wolf reuse the real basket covariance/returns computed above
  // (converted fraction -> percent / percent^2 to match this route
  // family's Pct-suffixed field convention, same conversion the
  // risk/tail-report route already applies elsewhere in this codebase);
  // factor-risk / tracking-error / tax-aware-rebalance / stress-aware
  // require factor loadings, a benchmark, tax lots or stress scenarios
  // this panel has no real source for, so those stay manual JSON.
  const hrpMutation = useMutation({
    mutationFn: async () => {
      if (!optimizationData) throw new Error("Basket optimization data is not ready yet.");
      const covMatrixPct2 = optimizationData.covMatrix.map((row) => row.map((v) => v * 10000));
      assertSquareMatrix(covMatrixPct2, assets.length, "Basket covariance matrix");
      return runAdvancedPortfolioRisk<PortfolioWeightsResult>("portfolio/hrp", { assets, covMatrix: covMatrixPct2 }, ["Browser-estimated basket covariance from displayed return history; converted fraction-squared to percent-squared. No immutable provider source binding is asserted."]);
    },
  });
  const hrpRun = { ...hrpMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/hrp`)] as typeof hrpMutation.data : hrpMutation.data };

  const riskBudgetMutation = useMutation({
    mutationFn: async () => {
      if (!optimizationData) throw new Error("Basket optimization data is not ready yet.");
      const budgets = parseNumberList(riskBudgetText, "Risk budgets", assets.length);
      if (budgets.length !== assets.length || budgets.some((b) => b < 0) || budgets.every((b) => b === 0)) throw new Error(`Risk budgets requires exactly ${assets.length} non-negative comma-separated values (one per basket asset), not all zero.`);
      const covMatrixPct2 = optimizationData.covMatrix.map((row) => row.map((v) => v * 10000));
      return runAdvancedPortfolioRisk<RiskBudgetResult>("portfolio/risk-budget", { assets, covMatrix: covMatrixPct2, riskBudgets: budgets, allowShort: allowShortBudget }, ["Browser-estimated basket covariance converted fraction-squared to percent-squared; user-authored risk budgets. No immutable provider source binding is asserted."]);
    },
  });
  const riskBudgetRun = { ...riskBudgetMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/risk-budget`)] as typeof riskBudgetMutation.data : riskBudgetMutation.data };

  const factorRiskMutation = useMutation({
    mutationFn: async () => {
      const payload = factorRiskState as { assets?: string[]; expectedReturnsPct?: number[]; factorLoadings?: number[][]; factorCovMatrix?: number[][]; idiosyncraticVariancePct2?: number[]; maxFactorExposureAbs?: number[]; riskAversion?: number };
      const n = payload.assets?.length ?? 0;
      if (n < 1 || new Set(payload.assets).size !== n) throw new Error("Factor-risk requires unique, non-empty asset names.");
      if (!Array.isArray(payload.expectedReturnsPct) || payload.expectedReturnsPct.length !== n || payload.expectedReturnsPct.some((v) => !Number.isFinite(v))) throw new Error("expectedReturnsPct must contain one finite value per asset.");
      if (!Array.isArray(payload.factorLoadings) || payload.factorLoadings.length !== n || payload.factorLoadings.some((row) => !Array.isArray(row) || row.length === 0 || row.some((v) => !Number.isFinite(v)))) throw new Error("factorLoadings must be an assets \u00d7 factors finite matrix.");
      const k = payload.factorLoadings[0].length;
      if (payload.factorLoadings.some((row) => row.length !== k)) throw new Error("Every factorLoadings row must have the same factor count.");
      if (!Array.isArray(payload.factorCovMatrix)) throw new Error("factorCovMatrix is required.");
      assertSquareMatrix(payload.factorCovMatrix, k, "factorCovMatrix");
      if (!Array.isArray(payload.idiosyncraticVariancePct2) || payload.idiosyncraticVariancePct2.length !== n || payload.idiosyncraticVariancePct2.some((v) => !Number.isFinite(v) || v < 0)) throw new Error("idiosyncraticVariancePct2 must contain one non-negative finite value per asset.");
      if (payload.maxFactorExposureAbs !== undefined && (!Array.isArray(payload.maxFactorExposureAbs) || payload.maxFactorExposureAbs.length !== k || payload.maxFactorExposureAbs.some((v) => !Number.isFinite(v) || v < 0))) throw new Error("maxFactorExposureAbs must contain one non-negative cap per factor.");
      return runAdvancedPortfolioRisk<FactorRiskResult>("portfolio/factor-risk", payload as unknown as Record<string, unknown>);
    },
  });
  const factorRiskRun = { ...factorRiskMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/factor-risk`)] as typeof factorRiskMutation.data : factorRiskMutation.data };

  const trackingErrorMutation = useMutation({
    mutationFn: async () => {
      const payload = trackingErrorState as { assets?: string[]; expectedReturnsPct?: number[]; covMatrix?: number[][]; benchmarkWeights?: number[]; maxTrackingErrorPct?: number; minActiveReturnPct?: number };
      const n = payload.assets?.length ?? 0;
      if (n < 2 || new Set(payload.assets).size !== n) throw new Error("Tracking-error requires at least two unique assets.");
      if (!Array.isArray(payload.expectedReturnsPct) || payload.expectedReturnsPct.length !== n || payload.expectedReturnsPct.some((v) => !Number.isFinite(v))) throw new Error("expectedReturnsPct must contain one finite value per asset.");
      if (!Array.isArray(payload.covMatrix)) throw new Error("covMatrix is required.");
      assertSquareMatrix(payload.covMatrix, n, "covMatrix");
      if (!Array.isArray(payload.benchmarkWeights)) throw new Error("benchmarkWeights is required.");
      assertWeights(payload.benchmarkWeights, n, "benchmarkWeights");
      if (!Number.isFinite(payload.maxTrackingErrorPct) || (payload.maxTrackingErrorPct as number) <= 0) throw new Error("maxTrackingErrorPct must be a positive finite number.");
      return runAdvancedPortfolioRisk<TrackingErrorResult>("portfolio/tracking-error", payload as unknown as Record<string, unknown>);
    },
  });
  const trackingErrorRun = { ...trackingErrorMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/tracking-error`)] as typeof trackingErrorMutation.data : trackingErrorMutation.data };

  const taxAwareMutation = useMutation({
    mutationFn: async () => {
      const payload = taxAwareState as { assets?: string[]; targetWeights?: number[]; lots?: Array<{ asset?: string; currentWeight?: number; costBasisWeightEquivalent?: number; unrealizedGainPct?: number }>; taxRatePct?: number; turnoverPenalty?: number; taxPenalty?: number };
      const n = payload.assets?.length ?? 0;
      if (n < 1 || new Set(payload.assets).size !== n) throw new Error("Tax-aware rebalance requires unique, non-empty asset names.");
      if (!Array.isArray(payload.targetWeights)) throw new Error("targetWeights is required.");
      assertWeights(payload.targetWeights, n, "targetWeights");
      const assetSet = new Set(payload.assets);
      if (!Array.isArray(payload.lots) || payload.lots.length !== n || new Set(payload.lots.map((lot) => lot.asset)).size !== n || payload.lots.some((lot) => !lot.asset || !assetSet.has(lot.asset) || !Number.isFinite(lot.currentWeight) || (lot.currentWeight as number) < 0 || !Number.isFinite(lot.costBasisWeightEquivalent) || (lot.costBasisWeightEquivalent as number) < 0 || !Number.isFinite(lot.unrealizedGainPct))) throw new Error("lots must contain exactly one entry per basket asset with finite non-negative weight/cost-basis and a finite unrealizedGainPct.");
      if (Math.abs(payload.lots.reduce((s, lot) => s + (lot.currentWeight as number), 0) - 1) > 1e-6) throw new Error("Tax-lot current weights must sum to 1.");
      if (!Number.isFinite(payload.taxRatePct) || (payload.taxRatePct as number) < 0 || (payload.taxRatePct as number) > 100) throw new Error("taxRatePct must be between 0 and 100.");
      return runAdvancedPortfolioRisk<TaxAwareResult>("portfolio/tax-aware-rebalance", payload as unknown as Record<string, unknown>);
    },
  });
  const taxAwareRun = { ...taxAwareMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/tax-aware-rebalance`)] as typeof taxAwareMutation.data : taxAwareMutation.data };

  const stressAwareMutation = useMutation({
    mutationFn: async () => {
      const payload = buildStressAwareDocument(stressAwareState) as { assets?: string[]; expectedReturnsPct?: number[]; covMatrix?: number[][]; scenarios?: Array<{ name?: string; assetReturnsPct?: number[]; probability?: number }>; maxExpectedStressLossPct?: number; riskAversion?: number };
      const n = payload.assets?.length ?? 0;
      if (n < 1 || new Set(payload.assets).size !== n) throw new Error("Stress-aware optimization requires unique, non-empty asset names.");
      if (!Array.isArray(payload.expectedReturnsPct) || payload.expectedReturnsPct.length !== n || payload.expectedReturnsPct.some((v) => !Number.isFinite(v))) throw new Error("expectedReturnsPct must contain one finite value per asset.");
      if (!Array.isArray(payload.covMatrix)) throw new Error("covMatrix is required.");
      assertSquareMatrix(payload.covMatrix, n, "covMatrix");
      if (!Array.isArray(payload.scenarios) || payload.scenarios.length === 0 || payload.scenarios.some((s) => !s.name || !Array.isArray(s.assetReturnsPct) || s.assetReturnsPct.length !== n || s.assetReturnsPct.some((v) => !Number.isFinite(v)) || !Number.isFinite(s.probability) || (s.probability as number) < 0 || (s.probability as number) > 1)) throw new Error("scenarios requires at least one named stress case with one return per asset and a probability in [0, 1].");
      return runAdvancedPortfolioRisk<StressAwareResult>("portfolio/stress-aware", payload as unknown as Record<string, unknown>);
    },
  });
  const stressAwareRun = { ...stressAwareMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/stress-aware`)] as typeof stressAwareMutation.data : stressAwareMutation.data };

  const bayesianShrinkageMutation = useMutation({
    mutationFn: async () => {
      if (!optimizationData) throw new Error("Basket optimization data is not ready yet.");
      const { annExpectedReturns, dailyReturns } = optimizationData;
      const nObs = dailyReturns[0]?.length ?? 0;
      if (nObs < 5) throw new Error("Not enough overlapping return history to estimate standard errors for the basket.");
      const sampleMeanReturnsPct = annExpectedReturns.map((v) => v * 100);
      const standardErrorsPct = dailyReturns.map((series) => {
        const mean = series.reduce((s, v) => s + v, 0) / series.length;
        const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / (series.length - 1);
        const dailyStd = Math.sqrt(Math.max(variance, 0));
        // Standard error of the daily mean (std/sqrt(n)), annualized by the
        // same x252 factor used to annualize the mean itself above, then
        // converted fraction -> percent to match this route's Pct fields.
        return (dailyStd / Math.sqrt(series.length)) * 252 * 100;
      });
      return runAdvancedPortfolioRisk<BayesianShrinkageResult>("portfolio/bayesian-mean-shrinkage", { assets, sampleMeanReturnsPct, standardErrorsPct, priorStdPct: bayesianPriorStdPct }, ["Browser-estimated sample return means and standard errors from displayed history; fraction returns converted to percent. No immutable provider source binding is asserted."]);
    },
  });
  const bayesianShrinkageRun = { ...bayesianShrinkageMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/bayesian-mean-shrinkage`)] as typeof bayesianShrinkageMutation.data : bayesianShrinkageMutation.data };

  const ledoitWolfMutation = useMutation({
    mutationFn: async () => {
      if (!optimizationData) throw new Error("Basket optimization data is not ready yet.");
      const { dailyReturns } = optimizationData;
      const nObs = dailyReturns[0]?.length ?? 0;
      const minObs = Math.max(20, assets.length + 2);
      if (nObs < minObs) throw new Error(`Ledoit-Wolf covariance requires at least ${minObs} overlapping return observations across the basket (have ${nObs}).`);
      const returnsMatrixPct: number[][] = [];
      for (let t = 0; t < nObs; t++) returnsMatrixPct.push(assets.map((_, assetIdx) => dailyReturns[assetIdx][t] * 100));
      return runAdvancedPortfolioRisk<LedoitWolfResult>("portfolio/ledoit-wolf-covariance", { assets, returnsMatrixPct }, ["Displayed basket daily returns assembled into an observation-major matrix and converted from fractions to percent. No immutable provider source binding is asserted."]);
    },
  });
  const ledoitWolfRun = { ...ledoitWolfMutation, data: terminal?.target ? terminal.executions?.[boundedTerminalExecutionSlot(`portfolio.${assets.join(",")}.portfolio/ledoit-wolf-covariance`)] as typeof ledoitWolfMutation.data : ledoitWolfMutation.data };

  const mandatePreTradeRun = useMutation({
    mutationFn: async () => {
      const payload = mandatePreTradeState;
      const currentWeights = payload.currentWeights as Record<string, number> | undefined;
      if (!currentWeights || typeof currentWeights !== "object" || Array.isArray(currentWeights) || Object.keys(currentWeights).length === 0) {
        throw new Error("currentWeights (the starting portfolio, one decimal weight per asset) is required.");
      }
      const maxTurnover = payload.maxTurnover;
      if (typeof maxTurnover !== "number" || !Number.isFinite(maxTurnover) || maxTurnover < 0) {
        throw new Error("maxTurnover must be a finite non-negative decimal weight (e.g. 0.25 for 25%).");
      }
      const sourceMetadata = payload.sourceMetadata as MandatePreTradeSourceMetadata | undefined;
      if (!sourceMetadata || typeof sourceMetadata !== "object" || !sourceMetadata.source || !sourceMetadata.status || !sourceMetadata.asOf || !sourceMetadata.period || !sourceMetadata.unit) {
        throw new Error("sourceMetadata {source, status, asOf, period, unit} is required so currentWeights/mandate limits are never treated as fabricated.");
      }
      let targetWeights = payload.targetWeights as Record<string, number> | undefined;
      if (!targetWeights) {
        if (!optimizationData) throw new Error("Basket optimization data is not ready yet; wait for the frontier to load or supply targetWeights explicitly.");
        targetWeights = Object.fromEntries(assets.map((sym, idx) => [sym, optimizationData.maxSharpe.weights[idx] ?? 0]));
      }
      const input: MandatePreTradeInput = {
        ...(payload as object),
        currentWeights,
        targetWeights,
        maxTurnover,
        sourceMetadata,
      } as MandatePreTradeInput;
      return evaluateMandatePreTrade(input);
    },
  });
  const factorAttributionRun = useMutation({
    mutationFn: async () => runFactorPortfolioJson(JSON.stringify(buildFactorPortfolioDocument(factorPortfolioState)), {
      assets,
      weights: optimizationData?.maxSharpe.weights ?? [],
      asOf: optimizationData?.latestAsOf ?? "",
    }),
  });
  const factorAttributionReset = factorAttributionRun.reset;
  useEffect(() => { factorAttributionReset(); }, [assets, factorAttributionReset]);
  const [providerSnapshotId, setProviderSnapshotId] = useTerminalArtifactState<string | null>(`PortfolioOptimizerPanel.providerSnapshot.${assets.join(",")}`, null);
  const restoredProviderSnapshot = useQuery<ProviderFactorRiskCaptureResponse>({
    queryKey: ["/api/factor-risk/snapshots", providerSnapshotId],
    enabled: providerSnapshotId !== null,
    staleTime: 0,
    queryFn: async () => (await apiRequest("GET", `/api/factor-risk/snapshots/${encodeURIComponent(providerSnapshotId!)}`)).json(),
  });
  const providerFactorCapture = useMutation({
    mutationFn: async (payload: { symbols: string[]; benchmarkSymbol: string; range: "1Y" | "2Y" | "3Y" | "5Y" }) => (
      await apiRequest("POST", "/api/factor-risk/snapshots", payload)
    ).json() as Promise<ProviderFactorRiskCaptureResponse>,
    onSuccess: snapshot => setProviderSnapshotId(snapshot.snapshotId),
  });
  const providerSnapshot = providerFactorCapture.data ?? (!restoredProviderSnapshot.isError && restoredProviderSnapshot.isFetchedAfterMount ? restoredProviderSnapshot.data : undefined);
  const providerFactorDecompose = useMutation({
    mutationFn: async () => {
      const snapshot = providerSnapshot;
      if (!snapshot) throw new Error("Capture a provider factor model before decomposition.");
      const securityIds = snapshot.securities.map((security) => security.securityId);
      const missingAssets = assets.filter((symbol) => !securityIds.includes(symbol));
      if (missingAssets.length > 0) throw new Error("DECOMPOSE BLOCKED: snapshot exclusions require a complete portfolio universe");
      const portfolioWeights: Record<string, number> = {};
      for (const securityId of securityIds) {
        const assetIndex = assets.indexOf(securityId);
        const weight = optimizationData?.maxSharpe.weights[assetIndex];
        if (assetIndex < 0 || !Number.isFinite(weight)) throw new Error("DECOMPOSE BLOCKED: exact basket weights are unavailable");
        portfolioWeights[securityId] = weight as number;
      }
      return (
        await apiRequest("POST", "/api/factor-risk/decompose", {
          snapshotId: snapshot.snapshotId,
          portfolioWeights,
        })
      ).json() as Promise<ProviderFactorRiskDecomposeResponse>;
    },
  });
  const providerFactorCaptureReset = providerFactorCapture.reset;
  const providerFactorDecomposeReset = providerFactorDecompose.reset;
  useEffect(() => {
    providerFactorCaptureReset();
    providerFactorDecomposeReset();
  }, [assets, providerFactorCaptureReset, providerFactorDecomposeReset]);
  const setCaptureEditing = terminal?.setEditing;
  useEffect(() => {
    setCaptureEditing?.("portfolio-provider-capture", providerFactorCapture.isPending || providerFactorDecompose.isPending);
    return () => setCaptureEditing?.("portfolio-provider-capture", false);
  }, [setCaptureEditing, providerFactorCapture.isPending, providerFactorDecompose.isPending]);


  if (isLoading || !optimizationData) {
    const recorded = Object.entries(terminal?.executions ?? {}).filter(([slot]) => slot.startsWith("portfolio."));
    return <div className="h-full overflow-auto p-4 space-y-4 bg-[#050505]">
      <p role="status" className="text-sm">{isLoading ? "Loading current basket observations…" : "Current basket observations are unavailable. Saved native calculations below remain recorded results; no live inputs or refreshed values were substituted."}</p>
      {recorded.map(([slot, value]) => <section key={slot} className="border border-border p-3"><ReadableValueTable title={slot} values={value as Record<string, unknown>} options={{ showExact: true }}/></section>)}
      {restoredProviderSnapshot.error && <p role="alert" className="text-xs text-rose-300">Saved provider capture is unavailable: {restoredProviderSnapshot.error.message}</p>}
      {providerSnapshot && <ReadableValueTable title="Recorded provider factor capture" values={{ snapshotId: providerSnapshot.snapshotId, contentHash: providerSnapshot.contentHash, sources: providerSnapshot.sources, limitations: providerSnapshot.limitations }} options={{ showExact: true }}/>}
    </div>;
  }

  const runGlobalSearch = () => {
    const { annExpectedReturns: mu, covMatrix: sigma } = optimizationData;
    const rf = rfRate / 100;
    const expression = buildMaxSharpeGaExpression(mu, sigma, rf, cardinalityEnabled ? cardinalityK : undefined);
    gaCrossCheck.mutate({ expression, bounds: maxSharpeGaBounds(mu.length) });
  };

  // GA result -> normalized weights -> real portfolio stats, scored with
  // the exact same w.mu / w^T*Sigma*w math as the Monte-Carlo maxSharpe
  // point above, so the two rows in the comparison table are apples-to-apples.
  const recordedGaExpression = gaCrossCheck.data?.receipt?.parameters?.expression;
  const currentGaExpression = buildMaxSharpeGaExpression(optimizationData.annExpectedReturns, optimizationData.covMatrix, rfRate / 100, cardinalityEnabled ? cardinalityK : undefined);
  const gaWeights = gaCrossCheck.data && (!terminal?.target || recordedGaExpression === currentGaExpression) && gaCrossCheck.data.bestX.length === assets.length
    ? normalizeWeights(gaCrossCheck.data.bestX)
    : null;
  const gaStats = gaWeights
    ? portfolioReturnRiskSharpe(gaWeights, optimizationData.annExpectedReturns, optimizationData.covMatrix, rfRate / 100)
    : null;
  const mcStats = {
    return: optimizationData.maxSharpe.Return / 100,
    risk: optimizationData.maxSharpe.Risk / 100,
    sharpe: optimizationData.maxSharpe.Sharpe,
  };
  const providerEstimation = providerSnapshot?.estimation ?? providerSnapshot?.estimator;
  const providerExcluded = providerSnapshot?.excluded ?? [];
  const providerPeriodsUsed = providerEstimation?.periodsUsed ?? providerEstimation?.factorReturnSeries?.length ?? 0;
  const providerMissingAssets = providerSnapshot
    ? assets.filter((symbol) => !providerSnapshot.securities.some((security) => security.securityId === symbol))
    : assets;
  const providerHasInsufficientData = Boolean(providerSnapshot && (providerExcluded.length > 0 || providerPeriodsUsed === 0));
  const providerHasCompleteUniverse = Boolean(providerSnapshot && providerMissingAssets.length === 0);
  const providerHasExactWeights = Boolean(providerHasCompleteUniverse && assets.every((symbol, index) => Number.isFinite(optimizationData.maxSharpe.weights[index])));
  const providerStatus = providerSnapshot
    ? providerHasInsufficientData ? "PROVIDER MODEL: INSUFFICIENT DATA" : "PROVIDER MODEL: SOURCE-BOUND"
    : null;
  const providerDecomposeOutput = providerFactorDecompose.data?.result;


  const factorRunOutput = factorAttributionRun.data && "attribution" in factorAttributionRun.data
    ? factorAttributionRun.data.attribution
    : null;
  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* Parameters Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[hsl(38,95%,55%)]" />
            <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">PORTFOLIO OPTIMIZATION & TRADE EXECUTION</span>
          </div>

          <div className="flex items-center gap-1 bg-border/10 p-0.5 rounded border border-border/40">
            <button
              onClick={() => setActiveSegment("frontier")}
              className={`px-2.5 py-0.5 font-terminal text-[8px] tracking-widest transition-all rounded-sm ${
                activeSegment === "frontier"
                  ? "bg-amber-500 text-black font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              MARKOWITZ FRONTIER
            </button>
            <button
              onClick={() => setActiveSegment("execution")}
              className={`px-2.5 py-0.5 font-terminal text-[8px] tracking-widest transition-all rounded-sm ${
                activeSegment === "execution"
                  ? "bg-amber-500 text-black font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              OPTIMAL EXECUTION
            </button>
            <button
              onClick={() => setActiveSegment("globalSearch")}
              className={`px-2.5 py-0.5 font-terminal text-[8px] tracking-widest transition-all rounded-sm ${
                activeSegment === "globalSearch"
                  ? "bg-amber-500 text-black font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              GA CROSS-CHECK
            </button>
            <button
              onClick={() => setActiveSegment("construction")}
              className={`px-2.5 py-0.5 font-terminal text-[8px] tracking-widest transition-all rounded-sm ${
                activeSegment === "construction"
                  ? "bg-amber-500 text-black font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              CONSTRUCTION LAB
            </button>
            <button
              data-testid="factor-portfolio-mode"
              onClick={() => setActiveSegment("factorAttribution")}
              className={`px-2.5 py-0.5 font-terminal text-[8px] tracking-widest transition-all rounded-sm ${
                activeSegment === "factorAttribution"
                  ? "bg-amber-500 text-black font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              FACTOR ATTRIBUTION / EXPOSURE
            </button>
          </div>
        </div>

        {activeSegment === "frontier" ? (
          <div className="flex items-center gap-2.5">
            <span className="font-terminal text-[9px] text-muted-foreground">RISK-FREE RATE:</span>
            <input
              type="number"
              min="0"
              max="15"
              step="0.1"
              value={rfRate}
              onChange={(e) => setRfRate(parseFloat(e.target.value) || 0)}
              className="w-14 bg-black border border-border p-0.5 text-center font-terminal text-[9px] font-bold text-[hsl(38,95%,55%)] font-mono"
            />
            <button
              onClick={() => setSimulationTrigger((t) => t + 1)}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-[hsl(38,95%,55%)] border border-amber-500/30 transition-colors font-terminal text-[9px] tracking-widest"
            >
              <RefreshCw className="w-3 h-3" /> RE-OPTIMIZE
            </button>
          </div>
        ) : activeSegment === "execution" ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-terminal text-[9px] text-muted-foreground">EXECUTION TRAJECTORY ENGINE:</span>
              {externalRiskMod !== undefined && (
                <div className="bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded text-[8px] font-terminal text-[hsl(38,95%,55%)] flex items-center gap-1.5 animate-pulse select-none">
                  <span>⚡ LINKED TO HAWKES HFT INTENSITY</span>
                  <span className="font-mono font-bold">({externalRiskMod.toFixed(1)}x events)</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-terminal text-[8px] text-muted-foreground">SHARES:</span>
              <input
                type="number"
                min="1000"
                max="1000000"
                step="1000"
                value={sharesToLiquidate}
                onChange={(e) => setSharesToLiquidate(parseInt(e.target.value) || 1000)}
                className="w-20 bg-black border border-border p-0.5 text-center font-terminal text-[9px] font-bold text-amber-500 font-mono"
              />
            </div>
          </div>
        ) : activeSegment === "factorAttribution" ? (
          <div className="flex items-center gap-2.5">
            <span className="font-terminal text-[9px] text-muted-foreground">EXPLICIT LOADINGS / RETURNS / COVARIANCE · RECEIPT-BOUND</span>
            <button
              data-testid="factor-portfolio-run-header"
              onClick={() => factorAttributionRun.mutate()}
              disabled={factorAttributionRun.isPending}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-[hsl(38,95%,55%)] border border-amber-500/30 transition-colors font-terminal text-[9px] tracking-widest disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" /> {factorAttributionRun.isPending ? "RUNNING…" : "RUN ATTRIBUTION"}
            </button>
          </div>
        ) : activeSegment === "globalSearch" ? (
          <div className="flex items-center gap-2.5">
            <span className="font-terminal text-[9px] text-muted-foreground">{assets.length} ASSETS · REAL μ/Σ FROM BASKET ABOVE</span>
            <button
              onClick={runGlobalSearch}
              disabled={gaCrossCheck.isPending}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-[hsl(38,95%,55%)] border border-amber-500/30 transition-colors font-terminal text-[9px] tracking-widest disabled:opacity-40"
            >
              <Shuffle className="w-3 h-3" /> {gaCrossCheck.isPending ? "RUNNING GA…" : "RUN GA CROSS-CHECK"}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="font-terminal text-[9px] text-muted-foreground">8 ADVANCED /portfolio/* ROUTES · MANUAL &amp; BASKET-DERIVED INPUTS</span>
          </div>
        )}
      </div>

      {/* Editable asset basket -- the optimizer used to run over a fixed
          5-symbol list with no way to change it; this lets a user swap in
          their own assets, re-running the frontier/covariance calc live. */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-[#060606] flex-wrap">
        <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">BASKET:</span>
        {assets.map((t) => (
          <div key={t} className="flex items-center gap-1 px-2 py-0.5 border border-border font-terminal text-[9px] text-muted-foreground">
            {t}
            {assets.length > MIN_OPT_ASSETS && (
              <button onClick={() => removeAsset(t)} className="hover:text-[hsl(0,80%,55%)]"><X className="w-2.5 h-2.5" /></button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={assetInput}
            onChange={(e) => setAssetInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && addAsset()}
            disabled={assets.length >= MAX_OPT_ASSETS}
            placeholder={assets.length >= MAX_OPT_ASSETS ? `MAX ${MAX_OPT_ASSETS} ASSETS` : "ADD ASSET…"}
            className="w-28 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40"
          />
          <button
            onClick={addAsset}
            disabled={assets.length >= MAX_OPT_ASSETS}
            className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-2.5 h-2.5" /> ADD
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {activeSegment === "frontier" ? (
          <>
            {/* Left Column: Efficient Frontier Scatter Plot */}
            <div className="flex-1 p-4 flex flex-col overflow-hidden border-b xl:border-b-0 xl:border-r border-border">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase">MARKOWITZ EFFICIENT FRONTIER CLOUD</span>
                <span className="font-terminal text-[9px] text-muted-foreground">
                  Max Sharpe: {optimizationData.maxSharpe.Sharpe.toFixed(2)}x (Return: {optimizationData.maxSharpe.Return.toFixed(1)}% / Vol: {optimizationData.maxSharpe.Risk.toFixed(1)}%)
                </span>
              </div>

              <div className="flex-1 min-h-[220px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                    <CartesianGrid stroke="#111" />
                    <XAxis
                      type="number"
                      dataKey="Risk"
                      name="Risk (Vol)"
                      unit="%"
                      stroke="#555"
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                    />
                    <YAxis
                      type="number"
                      dataKey="Return"
                      name="Expected Return"
                      unit="%"
                      stroke="#555"
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0].payload;
                        return (
                          <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5">
                            {pt.symbol && <div className="text-[hsl(186,80%,55%)] font-bold mb-0.5">{pt.symbol}</div>}
                            <div className="text-foreground">Exp Return: {pt.Return.toFixed(2)}%</div>
                            <div className="text-foreground">Vol (Risk): {pt.Risk.toFixed(2)}%</div>
                            <div className="text-amber-500 font-bold">Sharpe Ratio: {pt.Sharpe.toFixed(2)}x</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter name="Portfolios" data={optimizationData.portfolios} fill="rgba(245,158,11,0.15)" line={{ stroke: "rgba(245,158,11,0.05)", strokeWidth: 1 }} />
                    <Scatter
                      name="Assets"
                      data={optimizationData.individualAssets}
                      fill="hsl(186,80%,55%)"
                      shape={(props: any) => {
                        const { cx, cy, payload } = props;
                        if (!cx || !cy) return <g />;
                        return (
                          <g>
                            <circle cx={cx} cy={cy} r={5} fill="hsl(186,80%,55%)" stroke="white" strokeWidth={1} />
                            <text x={cx + 7} y={cy + 3} fill="hsl(186,80%,55%)" fontSize={8} fontFamily="'JetBrains Mono', monospace" fontWeight="bold">
                              {payload.symbol.replace(".NS", "")}
                            </text>
                          </g>
                        );
                      }}
                    />
                    <ReferenceDot x={optimizationData.maxSharpe.Risk} y={optimizationData.maxSharpe.Return} fill="hsl(38,95%,55%)" stroke="white" strokeWidth={1.5} r={5} label={{ value: "MAX SHARPE", fill: "hsl(38,95%,55%)", fontSize: 8, dy: -10, fontFamily: "'JetBrains Mono', monospace" }} />
                    <ReferenceDot x={optimizationData.minRisk.Risk} y={optimizationData.minRisk.Return} fill="rgb(34,197,94)" stroke="white" strokeWidth={1.5} r={5} label={{ value: "MIN VAR", fill: "rgb(34,197,94)", fontSize: 8, dy: 12, fontFamily: "'JetBrains Mono', monospace" }} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Individual Asset Risk & Return Analysis Table */}
              <div className="mt-4 border-t border-border/50 pt-3 shrink-0">
                <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
                  <Layers className="w-3.5 h-3.5 text-[hsl(186,80%,55%)]" />
                  <span className="font-terminal text-[9px] tracking-widest font-bold uppercase text-[hsl(186,80%,55%)]">
                    INDIVIDUAL ASSET RISK & EXPECTED RETURN PROFILE
                  </span>
                </div>
                <div className="grid grid-cols-[1.5fr_2fr_2fr_2fr_1.5fr_1.5fr] gap-px border border-border/40 bg-[#0a0a0a] rounded-sm text-[9px] font-terminal overflow-hidden">
                  {/* Table Header */}
                  <div className="grid grid-cols-[1.5fr_2fr_2fr_2fr_1.5fr_1.5fr] col-span-6 bg-[#111] px-3 py-1.5 border-b border-border text-muted-foreground font-semibold">
                    <span>ASSET</span>
                    <span className="text-right">EXPECTED RET</span>
                    <span className="text-right">STD DEV (VOL)</span>
                    <span className="text-right">SHARPE RATIO</span>
                    <span className="text-right">MAX SHARPE</span>
                    <span className="text-right">MIN VAR</span>
                  </div>
                  {/* Table Rows */}
                  {optimizationData.individualAssets.map((asset: any, idx: number) => {
                    const maxSharpeWt = optimizationData.maxSharpe.weights[idx] * 100;
                    const minRiskWt = optimizationData.minRisk.weights[idx] * 100;
                    return (
                      <div key={asset.symbol} className="grid grid-cols-[1.5fr_2fr_2fr_2fr_1.5fr_1.5fr] col-span-6 px-3 py-1.5 border-b border-border/20 hover:bg-white/5 items-center">
                        <span className="font-bold text-[hsl(186,80%,55%)]">{asset.symbol.replace(".NS", "")}</span>
                        <span className="text-right tabular-nums text-foreground">{asset.Return.toFixed(2)}%</span>
                        <span className="text-right tabular-nums text-foreground">{asset.Risk.toFixed(2)}%</span>
                        <span className="text-right tabular-nums text-amber-500 font-bold">{asset.Sharpe.toFixed(2)}x</span>
                        <span className="text-right tabular-nums text-foreground">{maxSharpeWt.toFixed(1)}%</span>
                        <span className="text-right tabular-nums text-foreground">{minRiskWt.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Optimizer weights & BL views & factor loaders */}
            <div className="w-full xl:w-80 bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
              <div className="p-4 border-b border-border space-y-4">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Compass className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">MAX SHARPE PORTFOLIO ALLOCATION</span>
                </div>

                <div className="space-y-2.5">
                  {assets.map((sym, idx) => {
                    const weight = optimizationData.maxSharpe.weights[idx];
                    return (
                      <div key={sym} className="space-y-1">
                        <div className="flex justify-between font-terminal text-[9px]">
                          <span className="text-muted-foreground">{sym}</span>
                          <span className="text-foreground font-mono font-bold">{(weight * 100).toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-border/20 h-1 rounded overflow-hidden">
                          <div className="bg-[hsl(38,95%,50%)] h-full transition-all duration-300" style={{ width: `${weight * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Black-Litterman subjective views */}
              <div className="p-4 border-b border-border space-y-3.5">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Sliders className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">BLACK-LITTERMAN VIEWS</span>
                </div>

                <div className="space-y-3">
                  {!assets.includes("RELIANCE.NS") && !assets.includes("BTC-USD") && (
                    <div className="text-[8px] font-terminal text-muted-foreground italic">
                      Add RELIANCE.NS or BTC-USD to the basket above to set a subjective view on it.
                    </div>
                  )}
                  {assets.includes("RELIANCE.NS") && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between font-terminal text-[9px]">
                        <span className="text-muted-foreground">RELIANCE view (equilibrium + adjustment)</span>
                        <span className="text-foreground font-mono font-bold">{(viewReliance >= 0 ? "+" : "") + viewReliance}%</span>
                      </div>
                      <input
                        type="range"
                        min="-15"
                        max="15"
                        step="1"
                        value={viewReliance}
                        onChange={(e) => setViewReliance(parseInt(e.target.value))}
                        className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    </div>
                  )}

                  {assets.includes("BTC-USD") && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between font-terminal text-[9px]">
                        <span className="text-muted-foreground">BITCOIN view (equilibrium + adjustment)</span>
                        <span className="text-foreground font-mono font-bold">{(viewBTC >= 0 ? "+" : "") + viewBTC}%</span>
                      </div>
                      <input
                        type="range"
                        min="-40"
                        max="40"
                        step="2"
                        value={viewBTC}
                        onChange={(e) => setViewBTC(parseInt(e.target.value))}
                        className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    </div>
                  )}
                  {(assets.includes("RELIANCE.NS") || assets.includes("BTC-USD")) && (
                    <div className="text-[7.5px] font-terminal text-muted-foreground leading-normal italic">
                      * Real He-Litterman blend: equal-weight equilibrium prior (δ={BL_DELTA}, τ={BL_TAU}) reverse-optimized from the covariance matrix above, posterior-blended with your view at 50% confidence. Slider at 0 = no view, uses historical means unchanged.
                    </div>
                  )}
                  {terminal && <button type="button" onClick={runBlPosterior} disabled={quant.running || optimizationData.blViews.length === 0} className="border border-border p-2 text-xs">Run posterior covariance explicitly</button>}
                  {blPosterior.error && <p role="alert" className="text-xs text-red-300">{blPosterior.error.message}</p>}
                  {blPosterior.data && optimizationData.blViews.length > 0 && (
                    <div className="pt-2 border-t border-border/40 space-y-2">
                      <div className="font-terminal text-[8px] font-bold text-muted-foreground uppercase tracking-widest">
                        RECORDED POSTERIOR COVARIANCE & VIEW UNCERTAINTY
                      </div>
                      {optimizationData.blViews.map((view, i) => {
                        const asset = assets[view.assetIndex];
                        const posteriorVol = Math.sqrt(Math.max(0, blPosterior.data!.posteriorCovariance[view.assetIndex][view.assetIndex])) * 100;
                        const priorVol = Math.sqrt(Math.max(0, optimizationData.covMatrix[view.assetIndex][view.assetIndex])) * 100;
                        const residualPct = (blPosterior.data!.viewResidualPct[i] ?? 0) * 100;
                        return (
                          <div key={asset} className="text-[8px] font-terminal space-y-0.5 bg-[#050505] border border-border/40 px-2 py-1.5">
                            <div className="flex justify-between">
                              <span className="text-cyan-400 font-bold">{asset.replace(".NS", "")}</span>
                              <span className="text-muted-foreground">confidence {((view.confidence ?? 0.5) * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Posterior vol (vs prior)</span>
                              <span className="text-foreground font-mono">{posteriorVol.toFixed(2)}% (vs {priorVol.toFixed(2)}%)</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">View residual</span>
                              <span className="text-foreground font-mono">{residualPct >= 0 ? "+" : ""}{residualPct.toFixed(2)}%</span>
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-[7.5px] font-terminal text-muted-foreground leading-normal italic">
                        Calculated through the original Python Black–Litterman engine using the submitted basket and views. This recorded result is not a refreshed provider observation; run explicitly after changing inputs.
                      </p>
                      <AdvancedPortfolioRiskReceipt receipt={blPosterior.data.receipt}/>
                    </div>
                  )}
                  {blPosterior.isPending && optimizationData.blViews.length > 0 && (
                    <div className="text-[7.5px] font-terminal text-muted-foreground italic">Fetching posterior covariance…</div>
                  )}
                </div>
              </div>

              {/* Fama-French Regression factors */}
              <div className="p-4 flex-1 space-y-3 bg-[#080808]">
                <div className="flex justify-between items-center text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-amber-500" />
                    <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">FAMA-FRENCH 3-FACTOR (REAL)</span>
                  </div>
                  <select
                    value={viewAsset}
                    onChange={(e) => setViewAsset(e.target.value)}
                    className="bg-black border border-border rounded px-1.5 py-0.5 font-terminal text-[8px] text-foreground font-bold"
                  >
                    {assets.map((sym) => (
                      <option key={sym} value={sym}>
                        {sym.replace(".NS", "")}
                      </option>
                    ))}
                  </select>
                </div>

                {optimizationData.ffmStats ? (
                  <div className="space-y-2">
                    <div className="bg-[#080808] border border-border/60 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between font-terminal text-[9px]">
                        <span className="text-muted-foreground">MARKET (Mkt-RF) LOAD</span>
                        <span className="text-foreground font-mono font-bold">
                          {optimizationData.ffmStats.betaMarket.toFixed(3)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between font-terminal text-[9px]">
                        <span className="text-muted-foreground">SIZE (SMB) LOAD</span>
                        <span className="text-foreground font-mono font-bold">
                          {optimizationData.ffmStats.betaSMB.toFixed(3)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between font-terminal text-[9px]">
                        <span className="text-muted-foreground">VALUE (HML) LOAD</span>
                        <span className="text-foreground font-mono font-bold">
                          {optimizationData.ffmStats.betaHML.toFixed(3)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between font-terminal text-[9px] border-t border-border/40 pt-1.5 mt-1.5">
                        <span className="text-amber-500 font-bold">ALPHA (α, ANNUALIZED)</span>
                        <span className={`font-mono font-bold ${(optimizationData.ffmStats.alphaAnnual >= 0) ? "text-up" : "text-down"}`}>
                          {optimizationData.ffmStats.alphaAnnual.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between font-terminal text-[9px]">
                        <span className="text-muted-foreground">R² / OBSERVATIONS</span>
                        <span className="text-foreground font-mono font-bold">{optimizationData.ffmStats.rSquared.toFixed(3)} / {optimizationData.ffmStats.n}</span>
                      </div>
                    </div>
                    <div className="text-[7.5px] font-terminal text-muted-foreground leading-normal italic">
                      * Real Mkt-RF/SMB/HML factor returns from Kenneth French's Data Library (official, free), regressed against {viewAsset}'s actual excess daily returns over the overlapping date range.
                    </div>
                  </div>
                ) : (
                  <Skeleton className="h-20 w-full bg-border" />
                )}
              </div>
            </div>
          </>
        ) : activeSegment === "execution" ? (
          <>
            {/* Left Column: Trajectory Line Chart + HFT Visualizer */}
            <div className="flex-1 p-4 flex flex-col overflow-hidden border-b xl:border-b-0 xl:border-r border-border space-y-4">
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase">OPTIMAL LIQUIDATION TRAJECTORY (ALMGREN-CHRISS)</span>
                  <span className="font-terminal text-[9px] text-muted-foreground">
                    Expected Impact Slippage Cost: ${Math.round(executionTrajectory.expectedImpact).toLocaleString()}
                  </span>
                </div>

                <div className="flex-1 min-h-[180px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={executionTrajectory.points} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid stroke="#111" />
                      <XAxis dataKey="day" stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
                      <YAxis stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
                      <Tooltip
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const pt = payload[0].payload;
                          return (
                            <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5 font-mono">
                              <div>{pt.day}</div>
                              <div className="text-amber-500 font-bold">Optimal Remainder: {pt.sharesRemaining.toLocaleString()} shares</div>
                              <div className="text-muted-foreground">VWAP Remainder: {pt.linearVWAP.toLocaleString()} shares</div>
                            </div>
                          );
                        }}
                      />
                      <Line type="monotone" dataKey="sharesRemaining" stroke="hsl(38,95%,55%)" strokeWidth={2.5} name="Optimal Path" />
                      <Line type="monotone" dataKey="linearVWAP" stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} strokeDasharray="3 3" name="VWAP Linear Path" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* HFT Execution Visualizer Log */}
              <div className="h-[180px] border border-border bg-[#070707] flex flex-col">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-[#0a0a0a]">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                    <span className="font-terminal text-[9px] font-bold text-muted-foreground uppercase">HFT LIMIT ORDER MATCHING ENGINE</span>
                  </div>
                  <button
                    onClick={() => setIsExecutingSim(true)}
                    disabled={isExecutingSim}
                    className="px-2 py-0.5 bg-[#111] hover:bg-neutral-800 border border-border text-[8.5px] font-terminal font-semibold disabled:opacity-40 disabled:hover:bg-[#111]"
                  >
                    {isExecutingSim ? "EXECUTION RUNNING..." : "RUN SIMULATED ORDER EXECUTION"}
                  </button>
                </div>

                <div className="flex-1 flex gap-4 p-3 min-h-0">
                  {/* Left stats */}
                  <div className="w-48 shrink-0 flex flex-col justify-between font-terminal text-[9.5px]">
                    <div className="space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">BLOCK STATUS:</span>
                        <span className={`font-bold ${isExecutingSim ? "text-amber-400" : simProgress === 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {isExecutingSim ? "RUNNING" : simProgress === 0 ? "FILLED" : "IDLE"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">REMAINDER SIZE:</span>
                        <span className="font-bold font-mono">{simProgress.toLocaleString()} SHRS</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">AVG SLIPPAGE:</span>
                        <span className="font-bold text-rose-400 font-mono">-0.012%</span>
                      </div>
                    </div>
                    {/* Linear progress bar */}
                    <div className="space-y-1">
                      <div className="h-1 w-full bg-[#111] border border-border relative overflow-hidden">
                        <div 
                          className="h-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${((100000 - simProgress) / 100000) * 100}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[7.5px] text-muted-foreground">
                        <span>{(((100000 - simProgress) / 100000) * 100).toFixed(0)}% FILLED</span>
                        <span>100K TOTAL</span>
                      </div>
                    </div>
                  </div>

                  {/* Scrolling fills logs */}
                  <div className="flex-1 border border-border bg-[#030303] p-2 overflow-y-auto font-mono text-[8px] text-muted-foreground space-y-1 scrollbar-thin">
                    {simLogs.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground/40 italic">
                        Click "RUN SIMULATED ORDER EXECUTION" to sweep order book bid queues
                      </div>
                    ) : (
                      simLogs.map((log, idx) => (
                        <div key={idx} className={log.includes("COMPLETE") ? "text-emerald-400 font-bold" : log.includes("SYSTEM") ? "text-cyan-400" : ""}>
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Trajectory Parameters & Cost Summary */}
            <div className="w-full xl:w-80 bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
              <div className="p-4 border-b border-border space-y-4">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Sliders className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">EXECUTION COEFFICIENTS</span>
                </div>

                {/* Risk Aversion */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-terminal text-[9px]">
                    <span className="text-muted-foreground">RISK AVERSION (LAMBDA)</span>
                    <span className="text-foreground font-mono font-bold">{riskAversion.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.80"
                    step="0.02"
                    value={riskAversion}
                    onChange={(e) => setRiskAversion(parseFloat(e.target.value))}
                    className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-terminal text-[9px]">
                    <span className="text-muted-foreground">LIQUIDATION DAYS (T)</span>
                    <span className="text-foreground font-mono font-bold">{daysToLiquidate} days</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="10"
                    step="1"
                    value={daysToLiquidate}
                    onChange={(e) => setDaysToLiquidate(parseInt(e.target.value))}
                    className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>
              </div>

              {/* Cost Summary Box */}
              <div className="p-4 flex-1 space-y-3 bg-[#080808]">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Activity className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
                  <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">TRANSACTION COST BREAKDOWN</span>
                </div>

                <div className="space-y-2">
                  <div className="bg-[#050505] border border-border/80 p-2.5 flex justify-between items-center font-terminal text-[10px]">
                    <span className="text-muted-foreground">MARKET IMPACT COST</span>
                    <span className="text-foreground font-mono font-bold">${Math.round(executionTrajectory.expectedImpact).toLocaleString()}</span>
                  </div>

                  <div className="bg-[#050505] border border-border/80 p-2.5 flex justify-between items-center font-terminal text-[10px]">
                    <span className="text-muted-foreground">INVENTORY RISK PREMIUM</span>
                    <span className="text-foreground font-mono font-bold">${Math.round(executionTrajectory.riskPremium).toLocaleString()}</span>
                  </div>

                  <div className="bg-[#050505] border border-border/80 p-2.5 flex justify-between items-center font-terminal text-[10px] border-t-2 border-amber-500/20 pt-3">
                    <span className="text-amber-500 font-bold">TOTAL EXECUTION COST</span>
                    <span className="text-amber-500 font-bold font-mono text-xs">${Math.round(executionTrajectory.totalCost).toLocaleString()}</span>
                  </div>

                  <ConceptExplainer title="THE ALMGREN-CHRISS THEORY">
                    <p>
                      Liquidating rapidly creates high market impact. Waiting reduces impact but exposes the inventory to market volatility. The optimal path balances both, accelerating selling when risk aversion is high.
                    </p>
                  </ConceptExplainer>
                </div>
              </div>
            </div>
          </>
        ) : activeSegment === "factorAttribution" ? (
          <>
            <div className="flex-1 p-4 flex flex-col overflow-y-auto border-b xl:border-b-0 xl:border-r border-border space-y-3">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <BarChart3 className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">FACTOR ATTRIBUTION / EXPOSURE</span>
              </div>
              <p className="font-terminal text-[8px] text-muted-foreground leading-relaxed">
                Explicit factor-model attribution over the current basket. Loadings, factor returns, factor covariance and specific variances must be supplied by an analyst or provider with source/as-of/units. Nothing is inferred from security labels or historical returns. This is not a live Barra model until source-bound loadings are supplied.
              </p>
              <div data-testid="provider-factor-model" className="border border-amber-500/30 bg-[#090909] p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-terminal text-[8px] text-amber-300 font-bold">PROVIDER FACTOR MODEL · EXPLICIT SOURCE CONTROL</span>
                  {(providerStatus || providerFactorCapture.error) && <span data-testid="provider-factor-status" className={`font-terminal text-[7px] font-bold ${providerHasInsufficientData || providerFactorCapture.error ? "text-rose-300" : "text-emerald-300"}`}>{providerStatus ?? "PROVIDER MODEL: INSUFFICIENT DATA"}</span>}
                </div>
                <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">
                  SOURCE universe: {assets.join(", ")} · BENCHMARK: ^GSPC. Capture is explicit and bounded; it does not replace the manual factor portfolio below.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="font-terminal text-[7px] text-muted-foreground flex items-center gap-1">
                    RANGE
                    <select
                      data-testid="provider-factor-range"
                      value={providerFactorRange}
                      onChange={(event) => setProviderFactorRange(event.target.value as "1Y" | "2Y" | "3Y" | "5Y")}
                      className="border border-border bg-[#0a0a0a] px-1 py-0.5 font-terminal text-[8px] text-amber-200"
                    >
                      {(["1Y", "2Y", "3Y", "5Y"] as const).map((range) => <option key={range} value={range}>{range}</option>)}
                    </select>
                  </label>
                  <button
                    data-testid="provider-factor-capture"
                    onClick={() => { providerFactorDecompose.reset(); providerFactorCapture.mutate({ symbols: assets, benchmarkSymbol: "^GSPC", range: providerFactorRange }); }}
                    disabled={providerFactorCapture.isPending}
                    className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40"
                  >
                    {providerFactorCapture.isPending ? "CAPTURING…" : "CAPTURE PROVIDER FACTOR MODEL"}
                  </button>
                  <button
                    data-testid="provider-factor-decompose"
                    disabled={!providerSnapshot || !providerHasCompleteUniverse || !providerHasExactWeights || providerHasInsufficientData || providerFactorDecompose.isPending}
                    className="border border-emerald-400/50 px-2 py-1 font-terminal text-[8px] text-emerald-200 disabled:opacity-40"
                  >
                    {providerFactorDecompose.isPending ? "DECOMPOSING…" : "DECOMPOSE PROVIDER MODEL"}
                  </button>
                </div>
                {providerFactorCapture.error && <div data-testid="provider-factor-capture-error" className="font-terminal text-[7px] text-rose-300">{(providerFactorCapture.error as Error).message}</div>}
                {restoredProviderSnapshot.error && <p role="alert" className="text-xs text-rose-300">Saved provider capture is no longer available: {restoredProviderSnapshot.error.message}</p>}
                {providerSnapshot && (
                  <div data-testid="provider-factor-capture-summary" className="border border-border/50 bg-[#050505] p-2 space-y-1 font-terminal text-[7px]">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span className="text-muted-foreground">CACHE</span><span className="text-foreground">{providerSnapshot.cache.toUpperCase()}</span>
                      <span className="text-muted-foreground">SNAPSHOT ID</span><span className="text-foreground break-all">{providerSnapshot.snapshotId}</span>
                      <span className="text-muted-foreground">CONTENT HASH</span><span className="text-foreground break-all">{providerSnapshot.contentHash}</span>
                      <span className="text-muted-foreground">INCLUDED / EXCLUDED</span><span className="text-foreground">{providerSnapshot.securities.length} / {providerExcluded.length}</span>
                      <span className="text-muted-foreground">FACTORS / PERIODS USED</span><span className="text-foreground">{providerSnapshot.factors.length} / {providerPeriodsUsed}</span>
                    </div>
                    <div className="border-t border-border/30 pt-1 text-muted-foreground">
                      SOURCE: <span className="text-foreground">{providerSnapshot.sources?.benchmark?.source ?? providerSnapshot.provenance?.benchmark?.source ?? "marketData provider/cache"}</span>
                      {" · "}BENCHMARK STATUS: <span className="text-foreground">{providerSnapshot.sources?.benchmark?.status ?? providerSnapshot.provenance?.benchmark?.status ?? "—"}</span>
                    <div className="text-muted-foreground break-all">
                      SECURITY SOURCES: {Object.entries(providerSnapshot.sources?.securities ?? providerSnapshot.provenance?.securities ?? {}).map(([symbol, source]) => `${symbol}=${source.provider}/${source.status}`).join(" · ") || "—"}
                    </div>
                    <div className="text-muted-foreground">BENCHMARK WEIGHTS: OMITTED · NO REAL BENCHMARK VECTOR IN THIS PANEL</div>
                    </div>
                    {providerExcluded.length > 0 && (
                      <div data-testid="provider-factor-exclusions" className="text-rose-300">
                        EXCLUDED: {providerExcluded.map((entry) => `${entry.securityId} (${entry.reason})`).join(" · ")}
                      </div>
                    )}
                    {providerSnapshot.limitations.length > 0 && (
                      <div className="border-t border-border/30 pt-1 space-y-0.5">
                        <div className="text-muted-foreground font-bold">LIMITATIONS (SOURCE)</div>
                        {providerSnapshot.limitations.map((limitation) => <div key={limitation} className="text-muted-foreground">· {limitation}</div>)}
                      </div>
                    )}
                  </div>
                )}
                {providerSnapshot && providerMissingAssets.length > 0 && (
                  <div data-testid="provider-factor-decompose-blocked" className="font-terminal text-[7px] text-rose-300">
                    DECOMPOSE BLOCKED: snapshot exclusions require a complete portfolio universe ({providerMissingAssets.join(", ")} missing). No replacement or renormalized weights are used.
                  </div>
                )}
                {providerSnapshot && providerMissingAssets.length === 0 && providerHasInsufficientData && (
                  <div data-testid="provider-factor-insufficient" className="font-terminal text-[7px] text-rose-300">
                    DECOMPOSE BLOCKED: snapshot has insufficient usable estimation periods ({providerPeriodsUsed} periods used).
                  </div>
                )}
                {providerFactorDecompose.error && <div data-testid="provider-factor-decompose-error" className="font-terminal text-[7px] text-rose-300">{(providerFactorDecompose.error as Error).message}</div>}
              </div>
              {providerDecomposeOutput && providerFactorDecompose.data && (
                <div data-testid="provider-factor-decomposition" className="border border-emerald-500/30 bg-emerald-500/5 p-2 space-y-2 font-terminal text-[8px]">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-300 font-bold">DERIVED · PROVIDER MODEL DECOMPOSITION</span>
                    <span className="text-muted-foreground">SOURCE SNAPSHOT: {providerFactorDecompose.data.snapshotId}</span>
                  </div>
                  <div className="text-muted-foreground break-all">SOURCE HASH: <span className="text-foreground">{providerFactorDecompose.data.contentHash}</span></div>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="border border-border/40 p-1.5"><div className="text-muted-foreground">EXPECTED RETURN</div><div className="text-amber-300 font-bold">{providerDecomposeOutput.expectedReturn.toFixed(6)} [decimal return]</div></div>
                    <div className="border border-border/40 p-1.5"><div className="text-muted-foreground">TOTAL EXPECTED RETURN</div><div className="text-foreground font-bold">{providerDecomposeOutput.totalExpectedReturn.toFixed(6)} [decimal return]</div></div>
                    <div className="border border-border/40 p-1.5"><div className="text-muted-foreground">FACTOR VARIANCE / VOLATILITY</div><div className="text-foreground font-bold">{providerDecomposeOutput.risk.factorVariance.toFixed(6)} / {providerDecomposeOutput.risk.volatility.toFixed(6)}</div></div>
                    <div className="border border-border/40 p-1.5"><div className="text-muted-foreground">SPECIFIC VARIANCE</div><div className="text-foreground font-bold">{providerDecomposeOutput.risk.specificVariance.toFixed(6)} [squared return]</div></div>
                    <div className="border border-border/40 p-1.5"><div className="text-muted-foreground">TOTAL VARIANCE</div><div className="text-foreground font-bold">{providerDecomposeOutput.risk.totalVariance.toFixed(6)} [squared return]</div></div>
                  </div>
                  <div className="border-t border-border/40 pt-1 space-y-0.5">
                    <div className="text-muted-foreground font-bold">FACTOR EXPOSURES / FACTOR VARIANCE CONTRIBUTIONS (DERIVED)</div>
                    {providerDecomposeOutput.factorContributions.map((factor) => (
                      <div key={factor.factorId} className="flex justify-between gap-2">
                        <span className="text-cyan-300">{factor.factorId}</span>
                        <span className="text-right">EXPOSURE {factor.exposure.toFixed(6)} · RETURN {factor.expectedContribution.toFixed(6)} · VAR {factor.varianceContribution.toFixed(6)}</span>
                      </div>
                    ))}
                    {Object.entries(providerDecomposeOutput.risk.factorVarianceContributions).length === 0 && <div className="text-muted-foreground">No factor variance contributions returned.</div>}
                  </div>
                  {providerDecomposeOutput.active && (
                    <div className="border-t border-cyan-500/30 pt-1 space-y-0.5 text-cyan-200">
                      <div className="font-bold">ACTIVE EXPOSURE (DERIVED)</div>
                      {Object.entries(providerDecomposeOutput.active.activeExposure).map(([factorId, exposure]) => <div key={factorId} className="flex justify-between"><span>{factorId}</span><span>{exposure.toFixed(6)}</span></div>)}
                      <div className="flex justify-between"><span>ACTIVE EXPECTED RETURN</span><span>{providerDecomposeOutput.active.activeExpectedReturn.toFixed(6)}</span></div>
                    </div>
                  )}
                </div>
              )}
              <div className="border border-border/50 bg-[#090909] p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-terminal text-[8px] text-muted-foreground">VALIDATED JSON / MANUAL IMPORT <span className="text-amber-300 font-bold">· MANUAL OVERRIDE</span></span>
                  <button data-testid="factor-portfolio-load-template" onClick={() => setFactorPortfolioState(JSON.parse(FACTOR_PORTFOLIO_PLACEHOLDER))} className="border border-border px-2 py-0.5 font-terminal text-[7px] text-muted-foreground hover:text-foreground">LOAD EMPTY TEMPLATE</button>
                </div>
                <div data-testid="factor-portfolio-json">
                  <StructuredJsonEditor schema={FACTOR_PORTFOLIO_SCHEMA} value={factorPortfolioState} onChange={setFactorPortfolioState} />
                </div>
                <button
                  data-testid="factor-portfolio-run"
                  onClick={() => factorAttributionRun.mutate()}
                  disabled={factorAttributionRun.isPending}
                  className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40"
                >
                  {factorAttributionRun.isPending ? "RUNNING…" : "VALIDATE & RUN FACTOR ATTRIBUTION"}
                </button>
              </div>

              {factorAttributionRun.data && (
                <div data-testid="factor-portfolio-receipt" className={`border p-2 font-terminal text-[8px] space-y-1 ${factorAttributionRun.data.receipt.status === "READY" ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"}`}>
                  <div className="flex items-center justify-between">
                    <span className={factorAttributionRun.data.receipt.status === "READY" ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{factorAttributionRun.data.receipt.status}</span>
                    <span className="text-amber-300 font-bold">{factorAttributionRun.data.receipt.sourceClassification}</span>
                  </div>
                  <div className="text-muted-foreground">SOURCE: <span className="text-foreground">{factorAttributionRun.data.receipt.source || "—"}</span> · AS-OF: <span className="text-foreground">{factorAttributionRun.data.receipt.asOf || "—"}</span> · UNITS: <span className="text-foreground">{factorAttributionRun.data.receipt.units || "—"}</span></div>
                  {factorAttributionRun.data.receipt.errors.length > 0 && <div data-testid="factor-portfolio-validation-errors" className="text-rose-300">{factorAttributionRun.data.receipt.errors.join(" · ")}</div>}
                </div>
              )}

              {factorRunOutput ? (
                <>
                  <div className="border border-border/40 bg-[#0a0a0a] font-terminal text-[8px]">
                    <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] bg-[#111] px-2 py-1.5 border-b border-border text-muted-foreground font-semibold">
                      <span>FACTOR</span><span className="text-right">PORTFOLIO EXPOSURE</span><span className="text-right">EXPECTED CONTRIB.</span><span className="text-right">VARIANCE CONTRIB.</span>
                    </div>
                    {factorRunOutput.factorContributions.map((factor) => (
                      <div data-testid={`factor-portfolio-factor-${factor.factorId}`} key={factor.factorId} className="grid grid-cols-[1.3fr_1fr_1fr_1fr] px-2 py-1.5 border-b border-border/20">
                        <span className="text-cyan-300 font-bold">{factor.factorId}</span>
                        <span className="text-right tabular-nums">{factor.exposure.toFixed(4)} <span className="text-muted-foreground">[load]</span></span>
                        <span className="text-right tabular-nums">{factor.expectedContribution.toFixed(4)} <span className="text-muted-foreground">[return]</span></span>
                        <span className="text-right tabular-nums">{factor.varianceContribution.toFixed(4)} <span className="text-muted-foreground">[variance]</span></span>
                      </div>
                    ))}
                  </div>
                  <div className="border border-border/40 bg-[#0a0a0a] font-terminal text-[8px]">
                    <div className="bg-[#111] px-2 py-1.5 border-b border-border text-muted-foreground font-semibold">SECURITY CONTRIBUTIONS (EXPLICIT LOADINGS)</div>
                    {factorRunOutput.securityContributions.map((security) => (
                      <div data-testid={`factor-portfolio-security-${security.securityId}`} key={security.securityId} className="grid grid-cols-[1.1fr_1fr_1fr_1fr_1.2fr] px-2 py-1.5 border-b border-border/20">
                        <span className="text-cyan-300 font-bold">{security.securityId}</span>
                        <span className="text-right">WT {(security.weight * 100).toFixed(2)}%</span>
                        <span className="text-right">FACTOR {security.factorReturn.toFixed(4)}</span>
                        <span className="text-right">SPECIFIC {security.specificReturn.toFixed(4)}</span>
                        <span className="text-right text-amber-300">TOTAL {security.expectedReturn.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground/50 font-terminal text-[8px] italic text-center px-8">
                  Enter explicit model inputs and run validation. Output remains blocked until every loading, factor return, covariance, variance and provenance requirement is satisfied.
                </div>
              )}
            </div>
            <div className="w-full xl:w-96 bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
              <div className="p-4 border-b border-border space-y-3">
                <div className="font-terminal text-[9px] tracking-widest font-bold text-muted-foreground">RETURN &amp; RISK DECOMPOSITION</div>
                {factorRunOutput && (
                  <>
                    <div data-testid="factor-portfolio-risk-summary" className="grid grid-cols-2 gap-1 font-terminal text-[8px]">
                      <div className="border border-border/50 p-2"><div className="text-muted-foreground">TOTAL EXPECTED RETURN</div><div className="text-amber-300 font-bold">{factorRunOutput.totalExpectedReturn.toFixed(4)} [decimal return]</div></div>
                      <div className="border border-border/50 p-2"><div className="text-muted-foreground">SPECIFIC RETURN</div><div className="text-foreground font-bold">{factorRunOutput.specificContribution.toFixed(4)} [decimal return]</div></div>
                      <div className="border border-border/50 p-2"><div className="text-muted-foreground">FACTOR VARIANCE</div><div className="text-foreground font-bold">{factorRunOutput.risk.factorVariance.toFixed(4)} [squared return]</div></div>
                      <div className="border border-border/50 p-2"><div className="text-muted-foreground">SPECIFIC VARIANCE</div><div className="text-foreground font-bold">{factorRunOutput.risk.specificVariance.toFixed(4)} [squared return]</div></div>
                      <div className="border border-border/50 p-2 col-span-2"><div className="text-muted-foreground">TOTAL VARIANCE / VOLATILITY</div><div className="text-amber-300 font-bold">{factorRunOutput.risk.totalVariance.toFixed(4)} / {factorRunOutput.risk.volatility.toFixed(4)} [variance / decimal volatility]</div></div>
                    </div>
                    {factorRunOutput.benchmark && factorRunOutput.active && (
                      <div data-testid="factor-portfolio-benchmark-risk" className="border border-cyan-500/30 bg-cyan-500/5 p-2 space-y-1 font-terminal text-[8px]">
                        <div className="text-cyan-300 font-bold">BENCHMARK ACTIVE EXPOSURE / RISK</div>
                        {Object.entries(factorRunOutput.active.activeExposure).map(([factorId, exposure]) => <div key={factorId} className="flex justify-between"><span className="text-muted-foreground">{factorId} ACTIVE LOAD</span><span>{exposure.toFixed(4)}</span></div>)}
                        <div className="flex justify-between border-t border-border/40 pt-1"><span className="text-muted-foreground">ACTIVE EXPECTED RETURN</span><span>{factorRunOutput.active.activeExpectedReturn.toFixed(4)} [return]</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">ACTIVE VARIANCE / VOL</span><span>{factorRunOutput.active.totalVariance.toFixed(4)} / {factorRunOutput.active.volatility.toFixed(4)} [variance / vol]</span></div>
                        <div className="text-muted-foreground">BENCHMARK EXPECTED RETURN {factorRunOutput.benchmark.totalExpectedReturn.toFixed(4)} [return] · VOL {factorRunOutput.benchmark.risk.volatility.toFixed(4)} [decimal vol]</div>
                      </div>
                    )}
                    {factorRunOutput.scenario && (
                      <div data-testid="factor-portfolio-scenario" className="border border-amber-500/30 bg-amber-500/5 p-2 space-y-1 font-terminal text-[8px]">
                        <div className="text-amber-300 font-bold">FACTOR-SHOCK WHAT-IF ACTION IMPACT: {factorRunOutput.scenario.label ?? factorRunOutput.scenario.id ?? "SCENARIO"}</div>
                        <div className="flex justify-between"><span className="text-muted-foreground">PORTFOLIO PNL</span><span>{factorRunOutput.scenario.portfolioPnl.toFixed(4)} [return shock]</span></div>
                        {factorRunOutput.scenario.benchmarkPnl !== undefined && <div className="flex justify-between"><span className="text-muted-foreground">BENCHMARK / ACTIVE PNL</span><span>{factorRunOutput.scenario.benchmarkPnl.toFixed(4)} / {factorRunOutput.scenario.activePnl?.toFixed(4) ?? "—"} [return shock]</span></div>}
                        {factorRunOutput.scenario.securities.map((row) => <div key={row.securityId} className="flex justify-between text-muted-foreground"><span>{row.securityId}</span><span>{row.totalPnl.toFixed(4)} [factor {row.factorPnl.toFixed(4)} + specific {row.specificPnl.toFixed(4)}]</span></div>)}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="p-4 flex-1 space-y-2 bg-[#080808]">
                <ConceptExplainer title="MODEL BOUNDARY">
                  <p>
                    This output is engine-derived only after explicit provenance is validated. MANUAL and PRIVATE imports are visible in the receipt above; the optimizer's real current basket weights are reused only when security order matches exactly. Supply provider-bound loadings, factor returns, covariance and specific variances before treating this as a live Barra-style model.
                  </p>
                </ConceptExplainer>
              </div>
            </div>
          </>
        ) : activeSegment === "globalSearch" ? (
          <>
            {/* Left Column: GA vs Monte-Carlo comparison */}
            <div className="flex-1 p-4 flex flex-col overflow-hidden border-b xl:border-b-0 xl:border-r border-border overflow-y-auto scrollbar-thin">
              <div className="mb-3 flex items-center gap-1.5 text-muted-foreground">
                <Shuffle className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">GENETIC ALGORITHM GLOBAL-SEARCH CROSS-CHECK</span>
              </div>
              <p className="font-terminal text-[8px] text-muted-foreground leading-relaxed mb-3">
                The Max-Sharpe point on the Markowitz Frontier tab comes from sampling 1,000 random weight draws against this basket's real historical mean/covariance. This tab runs a real genetic algorithm (pymoo, via the live optimization sidecar) as a global, non-convex search over the exact same objective and the exact same real μ (expected returns) / Σ (covariance) -- a cross-check, not a replacement. If it lands on the same weights, that agreement is itself the useful signal: the sampled frontier was already close to optimal.
              </p>

              {gaCrossCheck.isError && (
                <div className="mb-3 px-2 py-1.5 border border-rose-500/40 bg-rose-500/5 font-terminal text-[8px] text-rose-400">
                  {(gaCrossCheck.error as Error).message}
                </div>
              )}

              {gaCrossCheck.data && !gaWeights && <section className="space-y-2"><p className="text-xs text-muted-foreground">Recorded original GA output. The current basket objective differs; saved weights are not recombined with refreshed moments. Input order and objective remain in its receipt.</p><ReadableValueTable title="Recorded GA result" values={gaCrossCheck.data} options={{ showExact: true }}/></section>}
              {!gaWeights || !gaStats ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground/40 font-terminal text-[9px] italic text-center px-6">
                  {gaCrossCheck.isPending
                    ? "Running genetic algorithm over the live optimization sidecar…"
                    : "Click \"RUN GA CROSS-CHECK\" above to search this basket's real \u03bc/\u03a3."}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border border-border/40 bg-[#0a0a0a] text-[9px] font-terminal">
                    <div className="grid grid-cols-[1.3fr_1fr_1fr] bg-[#111] px-3 py-1.5 border-b border-border text-muted-foreground font-semibold">
                      <span>METRIC</span>
                      <span className="text-right">MC SAMPLE (1,000)</span>
                      <span className="text-right">GA GLOBAL SEARCH</span>
                    </div>
                    <div className="grid grid-cols-[1.3fr_1fr_1fr] px-3 py-1.5 border-b border-border/20 items-center">
                      <span className="text-muted-foreground">Expected Return</span>
                      <span className="text-right tabular-nums text-foreground">{(mcStats.return * 100).toFixed(2)}%</span>
                      <span className="text-right tabular-nums text-foreground">{(gaStats.return * 100).toFixed(2)}%</span>
                    </div>
                    <div className="grid grid-cols-[1.3fr_1fr_1fr] px-3 py-1.5 border-b border-border/20 items-center">
                      <span className="text-muted-foreground">Volatility</span>
                      <span className="text-right tabular-nums text-foreground">{(mcStats.risk * 100).toFixed(2)}%</span>
                      <span className="text-right tabular-nums text-foreground">{(gaStats.risk * 100).toFixed(2)}%</span>
                    </div>
                    <div className="grid grid-cols-[1.3fr_1fr_1fr] px-3 py-1.5 items-center">
                      <span className="text-amber-500 font-bold">Sharpe Ratio</span>
                      <span className="text-right tabular-nums text-amber-500 font-bold">{mcStats.sharpe.toFixed(3)}x</span>
                      <span className="text-right tabular-nums text-amber-500 font-bold">{gaStats.sharpe.toFixed(3)}x</span>
                    </div>
                  </div>

                  <div className="font-terminal text-[8.5px] leading-relaxed px-2.5 py-2 border border-border/50 bg-[#080808]">
                    {Math.abs(gaStats.sharpe - mcStats.sharpe) < 0.005 ? (
                      <span className="text-emerald-400">GA agrees with the 1,000-sample Monte-Carlo search within 0.005 Sharpe -- the sampled frontier already found (near-)optimal weights for this basket. Real agreement, not a manufactured "win".</span>
                    ) : gaStats.sharpe > mcStats.sharpe ? (
                      <span className="text-amber-400">GA found a +{(gaStats.sharpe - mcStats.sharpe).toFixed(3)} Sharpe improvement over the 1,000-sample search ({(((gaStats.sharpe - mcStats.sharpe) / Math.abs(mcStats.sharpe)) * 100).toFixed(1)}% higher).</span>
                    ) : (
                      <span className="text-muted-foreground">GA landed {(mcStats.sharpe - gaStats.sharpe).toFixed(3)} Sharpe below the Monte-Carlo sample -- expected on a smooth objective where random sampling already covers the space well; the GA's own convergence (generation {gaCrossCheck.data?.generationsRun ?? "?"}) is still real, just not better here.</span>
                    )}
                    {cardinalityEnabled && (
                      <div className="mt-1.5 text-cyan-400">
                        Cardinality constraint active: at most {cardinalityK} of {assets.length} assets held above 2% weight -- a hard combinatorial constraint the Markowitz-frontier tab's smooth quadratic search cannot express at all.
                      </div>
                    )}
                  </div>

                  <div className="border border-border/40 bg-[#0a0a0a] text-[9px] font-terminal">
                    <div className="grid grid-cols-[1.5fr_1.5fr_1.5fr] bg-[#111] px-3 py-1.5 border-b border-border text-muted-foreground font-semibold">
                      <span>ASSET</span>
                      <span className="text-right">MC WEIGHT</span>
                      <span className="text-right">GA WEIGHT</span>
                    </div>
                    {assets.map((sym, idx) => (
                      <div key={sym} className="grid grid-cols-[1.5fr_1.5fr_1.5fr] px-3 py-1.5 border-b border-border/20 items-center">
                        <span className="font-bold text-[hsl(186,80%,55%)]">{sym.replace(".NS", "")}</span>
                        <span className="text-right tabular-nums text-foreground">{(optimizationData.maxSharpe.weights[idx] * 100).toFixed(1)}%</span>
                        <span className="text-right tabular-nums text-amber-500 font-bold">{(gaWeights[idx] * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: cardinality constraint + methodology */}
            <div className="w-full xl:w-80 bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
              <div className="p-4 border-b border-border space-y-3">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Sliders className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">CARDINALITY CONSTRAINT (BEST K OF N)</span>
                </div>
                <label className="flex items-center gap-2 font-terminal text-[9px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cardinalityEnabled}
                    onChange={(e) => setCardinalityEnabled(e.target.checked)}
                    className="accent-amber-500"
                  />
                  Force at most K holdings (non-convex; GA only)
                </label>
                {cardinalityEnabled && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between font-terminal text-[9px]">
                      <span className="text-muted-foreground">MAX HOLDINGS (K)</span>
                      <span className="text-foreground font-mono font-bold">{cardinalityK} of {assets.length}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max={Math.max(1, assets.length - 1)}
                      step="1"
                      value={cardinalityK}
                      onChange={(e) => setCardinalityK(parseInt(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                  </div>
                )}
                <p className="text-[7.5px] font-terminal text-muted-foreground leading-normal italic">
                  Encoded as a penalty term inside the GA's objective expression (50 x holdings above K). Re-run "RUN GA CROSS-CHECK" above after changing this.
                </p>
              </div>

              <div className="p-4 flex-1 space-y-2 bg-[#080808]">
                <ConceptExplainer title="WHY A SECOND SEARCH?">
                  <p>
                    The frontier tab's Max-Sharpe point comes from 1,000 random Dirichlet-weight draws -- fast, but not exhaustive. This tab runs a real pymoo genetic algorithm (population 100, 150 generations) over the exact same real basket μ/Σ via the live /api/quant/optimization/genetic-algorithm sidecar route. It exists to (a) sanity-check the sampled result and (b) reach constraints, like cardinality, the sampled/closed-form approach structurally cannot express.
                  </p>
                </ConceptExplainer>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Left Column: model picker + active model's manual/basket-derived form and results */}
            <div className="flex-1 p-4 flex flex-col overflow-hidden border-b xl:border-b-0 xl:border-r border-border overflow-y-auto scrollbar-thin space-y-3">
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
                  <Layers className="w-3.5 h-3.5 text-[hsl(186,80%,55%)]" />
                  <span className="font-terminal text-[9px] tracking-widest font-bold uppercase text-[hsl(186,80%,55%)]">PORTFOLIO CONSTRUCTION MODEL</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {ADVANCED_PORTFOLIO_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setAdvancedModel(m.id)}
                      className={`px-2 py-1 border font-terminal text-[7.5px] tracking-widest ${advancedModel === m.id ? "border-amber-400 bg-amber-500/10 text-amber-200 font-bold" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {advancedModel === "hrp" && (
                <div className="border border-border bg-[#0a0a0a] p-3 space-y-2">
                  <div className="font-terminal text-[8px] text-foreground">HIERARCHICAL RISK PARITY</div>
                  <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">Clusters the {assets.length}-asset basket by correlation distance (single-linkage) and allocates via recursive bisection over the real annualized covariance matrix from the Markowitz tab above -- no matrix inversion, so it stays well-defined even when the sample covariance is near-singular.</div>
                  <button disabled={hrpRun.isPending} onClick={() => hrpRun.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{hrpRun.isPending ? "RUNNING…" : "RUN HRP"}</button>
                  {hrpRun.error && <div className="font-terminal text-[7px] text-red-300">{(hrpRun.error as Error).message}</div>}
                  {hrpRun.data && (
                    <>
                      <div className="grid grid-cols-2 gap-1 font-terminal text-[7px]">
                        {assets.map((a) => <span key={a}>{a}: {((hrpRun.data!.weights[a] ?? 0) * 100).toFixed(2)}%</span>)}
                      </div>
                      <AdvancedPortfolioRiskReceipt receipt={hrpRun.data.receipt} />
                    </>
                  )}
                </div>
              )}

              {advancedModel === "risk-budget" && (
                <div className="border border-border bg-[#0a0a0a] p-3 space-y-2">
                  <div className="font-terminal text-[8px] text-foreground">CUSTOM RISK BUDGET</div>
                  <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">Solves for weights whose marginal risk contributions match a manual target budget, over the real basket covariance matrix ({assets.join(", ")}).</div>
                  <label className="font-terminal text-[7px] text-muted-foreground block">TARGET BUDGET -- {assets.length} comma-separated values in basket order above (need not pre-sum to 1)
                    <input value={riskBudgetText} onChange={(e) => setRiskBudgetText(e.target.value)} placeholder={assets.map(() => (100 / assets.length).toFixed(1)).join(", ")} className="mt-1 w-full border border-border bg-transparent px-1 py-0.5 font-mono text-[8px] text-foreground" />
                  </label>
                  <label className="flex items-center gap-1.5 font-terminal text-[7px] text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={allowShortBudget} onChange={(e) => setAllowShortBudget(e.target.checked)} className="accent-amber-500" /> ALLOW SHORT POSITIONS
                  </label>
                  <button disabled={riskBudgetRun.isPending || !riskBudgetText.trim()} onClick={() => riskBudgetRun.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{riskBudgetRun.isPending ? "RUNNING…" : "RUN RISK BUDGET"}</button>
                  {riskBudgetRun.error && <div className="font-terminal text-[7px] text-red-300">{(riskBudgetRun.error as Error).message}</div>}
                  {riskBudgetRun.data && (
                    <>
                      <div className="space-y-0.5 font-terminal text-[7px]">
                        {assets.map((a) => <div key={a}>{a}: WEIGHT {((riskBudgetRun.data!.weights[a] ?? 0) * 100).toFixed(2)}% · RISK CONTRIB {((riskBudgetRun.data!.riskContributions[a] ?? 0) * 100).toFixed(2)}%</div>)}
                      </div>
                      <div className="font-terminal text-[7px] text-muted-foreground">BUDGET ERROR (L2 NORM) {riskBudgetRun.data.budgetError.toFixed(4)}</div>
                      <AdvancedPortfolioRiskReceipt receipt={riskBudgetRun.data.receipt} />
                    </>
                  )}
                </div>
              )}

              {(advancedModel === "factor-risk" || advancedModel === "tracking-error" || advancedModel === "tax-aware-rebalance" || advancedModel === "stress-aware") && (
                <div className="border border-border bg-[#0a0a0a] p-3 space-y-2">
                  <div className="font-terminal text-[8px] text-foreground">
                    {advancedModel === "factor-risk" ? "FACTOR-RISK CONSTRAINED OPTIMIZATION" : advancedModel === "tracking-error" ? "BENCHMARK TRACKING-ERROR OPTIMIZATION" : advancedModel === "tax-aware-rebalance" ? "TAX-AWARE REBALANCE" : "STRESS-SCENARIO-AWARE OPTIMIZATION"}
                  </div>
                  <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">
                    {advancedModel === "factor-risk"
                      ? "Requires manual factor loadings, factor covariance and idiosyncratic variance this panel has no live source for -- entered as exact JSON, not fabricated from the basket."
                      : advancedModel === "tracking-error"
                      ? "Requires a manual benchmark weight vector and tracking-error budget this panel does not otherwise hold -- entered as exact JSON."
                      : advancedModel === "tax-aware-rebalance"
                      ? "Requires manual per-lot cost-basis / unrealized-gain data this panel does not retain -- entered as exact JSON, not fabricated tax lots."
                      : "Requires manual stress scenarios (named shocks with a return per asset and a probability) this panel does not generate -- entered as exact JSON."}
                  </div>
                  <button
                    onClick={() => {
                      if (advancedModel === "factor-risk") setFactorRiskState(JSON.parse(ADVANCED_PORTFOLIO_PLACEHOLDERS["factor-risk"]));
                      else if (advancedModel === "tracking-error") setTrackingErrorState(JSON.parse(ADVANCED_PORTFOLIO_PLACEHOLDERS["tracking-error"]));
                      else if (advancedModel === "tax-aware-rebalance") setTaxAwareState(JSON.parse(ADVANCED_PORTFOLIO_PLACEHOLDERS["tax-aware-rebalance"]));
                      else setStressAwareState(seedStressAwareState(ADVANCED_PORTFOLIO_PLACEHOLDERS["stress-aware"]));
                    }}
                    className="border border-border px-2 py-0.5 font-terminal text-[7px] text-muted-foreground hover:text-foreground"
                  >
                    LOAD EXAMPLE SHAPE
                  </button>
                  {advancedModel === "factor-risk" && <StructuredJsonEditor schema={FACTOR_RISK_SCHEMA} value={factorRiskState} onChange={setFactorRiskState} />}
                  {advancedModel === "tracking-error" && <StructuredJsonEditor schema={TRACKING_ERROR_SCHEMA} value={trackingErrorState} onChange={setTrackingErrorState} />}
                  {advancedModel === "tax-aware-rebalance" && <StructuredJsonEditor schema={TAX_AWARE_SCHEMA} value={taxAwareState} onChange={setTaxAwareState} />}
                  {advancedModel === "stress-aware" && <StructuredJsonEditor schema={STRESS_AWARE_SCHEMA} value={stressAwareState} onChange={setStressAwareState} />}
                  <button
                    disabled={
                      (advancedModel === "factor-risk" && factorRiskRun.isPending) ||
                      (advancedModel === "tracking-error" && trackingErrorRun.isPending) ||
                      (advancedModel === "tax-aware-rebalance" && taxAwareRun.isPending) ||
                      (advancedModel === "stress-aware" && stressAwareRun.isPending)
                    }
                    onClick={() => {
                      if (advancedModel === "factor-risk") factorRiskRun.mutate();
                      else if (advancedModel === "tracking-error") trackingErrorRun.mutate();
                      else if (advancedModel === "tax-aware-rebalance") taxAwareRun.mutate();
                      else stressAwareRun.mutate();
                    }}
                    className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40"
                  >
                    {(advancedModel === "factor-risk" && factorRiskRun.isPending) ||
                    (advancedModel === "tracking-error" && trackingErrorRun.isPending) ||
                    (advancedModel === "tax-aware-rebalance" && taxAwareRun.isPending) ||
                    (advancedModel === "stress-aware" && stressAwareRun.isPending)
                      ? "RUNNING…"
                      : `RUN ${advancedModel.replace(/-/g, " ").toUpperCase()}`}
                  </button>

                  {advancedModel === "factor-risk" && factorRiskRun.error && <div className="font-terminal text-[7px] text-red-300">{(factorRiskRun.error as Error).message}</div>}
                  {advancedModel === "factor-risk" && factorRiskRun.data && (
                    <>
                      <div className="grid grid-cols-2 gap-1 font-terminal text-[7px]">
                        {Object.entries(factorRiskRun.data.weights).map(([a, w]) => <span key={a}>{a}: {(w * 100).toFixed(2)}%</span>)}
                      </div>
                      <div className="font-terminal text-[7px] text-muted-foreground">EXP RETURN {factorRiskRun.data.expectedReturnPct.toFixed(2)}% · VOL {factorRiskRun.data.volatilityPct.toFixed(2)}% · FACTOR EXPOSURES [{factorRiskRun.data.factorExposures.map((v) => v.toFixed(2)).join(", ")}]</div>
                      <AdvancedPortfolioRiskReceipt receipt={factorRiskRun.data.receipt} />
                    </>
                  )}

                  {advancedModel === "tracking-error" && trackingErrorRun.error && <div className="font-terminal text-[7px] text-red-300">{(trackingErrorRun.error as Error).message}</div>}
                  {advancedModel === "tracking-error" && trackingErrorRun.data && (
                    <>
                      <div className="grid grid-cols-2 gap-1 font-terminal text-[7px]">
                        {Object.entries(trackingErrorRun.data.weights).map(([a, w]) => <span key={a}>{a}: {(w * 100).toFixed(2)}%</span>)}
                      </div>
                      <div className="font-terminal text-[7px] text-muted-foreground">TRACKING ERROR {trackingErrorRun.data.trackingErrorPct.toFixed(2)}% · ACTIVE RETURN {trackingErrorRun.data.expectedActiveReturnPct.toFixed(2)}%</div>
                      <AdvancedPortfolioRiskReceipt receipt={trackingErrorRun.data.receipt} />
                    </>
                  )}

                  {advancedModel === "tax-aware-rebalance" && taxAwareRun.error && <div className="font-terminal text-[7px] text-red-300">{(taxAwareRun.error as Error).message}</div>}
                  {advancedModel === "tax-aware-rebalance" && taxAwareRun.data && (
                    <>
                      <div className="grid grid-cols-2 gap-1 font-terminal text-[7px]">
                        {Object.entries(taxAwareRun.data.weights).map(([a, w]) => <span key={a}>{a}: {(w * 100).toFixed(2)}%</span>)}
                      </div>
                      <div className="font-terminal text-[7px] text-muted-foreground">EST. TAX COST {taxAwareRun.data.estimatedTaxCostPct.toFixed(3)}% · TURNOVER {(taxAwareRun.data.turnover * 100).toFixed(2)}% · TRACKING L2 {taxAwareRun.data.trackingErrorL2.toFixed(4)}</div>
                      <AdvancedPortfolioRiskReceipt receipt={taxAwareRun.data.receipt} />
                    </>
                  )}

                  {advancedModel === "stress-aware" && stressAwareRun.error && <div className="font-terminal text-[7px] text-red-300">{(stressAwareRun.error as Error).message}</div>}
                  {advancedModel === "stress-aware" && stressAwareRun.data && (
                    <>
                      <div className="grid grid-cols-2 gap-1 font-terminal text-[7px]">
                        {Object.entries(stressAwareRun.data.weights).map(([a, w]) => <span key={a}>{a}: {(w * 100).toFixed(2)}%</span>)}
                      </div>
                      <div className="font-terminal text-[7px] text-muted-foreground">EXPECTED STRESS LOSS {stressAwareRun.data.expectedStressLossPct.toFixed(2)}% · WORST SCENARIO LOSS {stressAwareRun.data.worstScenarioLossPct.toFixed(2)}%</div>
                      <AdvancedPortfolioRiskReceipt receipt={stressAwareRun.data.receipt} />
                    </>
                  )}
                </div>
              )}

              {advancedModel === "mandate-pre-trade" && (
                <div className="border border-border bg-[#0a0a0a] p-3 space-y-2">
                  <div className="font-terminal text-[8px] text-foreground">MANDATE PRE-TRADE CHECK</div>
                  <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">Evaluates the basket's real max-Sharpe target weights (or an explicit targetWeights override) against a manually entered starting portfolio, mandate limits, liquidity/ADV, transaction/tax cost and risk-budget or tracking-error evidence -- entered as exact JSON with required sourceMetadata, since this panel has no live client account/mandate feed. Never submits orders; missing evidence blocks approval instead of being assumed.</div>
                  <button onClick={() => setMandatePreTradeState(JSON.parse(MANDATE_PRE_TRADE_PLACEHOLDER))} className="border border-border px-2 py-0.5 font-terminal text-[7px] text-muted-foreground hover:text-foreground">LOAD EXAMPLE SHAPE</button>
                  <StructuredJsonEditor schema={MANDATE_PRE_TRADE_SCHEMA} value={mandatePreTradeState} onChange={setMandatePreTradeState} />
                  <button
                    disabled={mandatePreTradeRun.isPending}
                    onClick={() => mandatePreTradeRun.mutate()}
                    className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40"
                  >
                    {mandatePreTradeRun.isPending ? "RUNNING…" : "RUN MANDATE PRE-TRADE"}
                  </button>
                  {mandatePreTradeRun.error && <div className="font-terminal text-[7px] text-red-300">{(mandatePreTradeRun.error as Error).message}</div>}
                  {mandatePreTradeRun.data && (
                    <>
                      <div className={`font-terminal text-[8px] font-bold ${mandatePreTradeRun.data.status === "feasible" ? "text-up" : mandatePreTradeRun.data.status === "rejected" ? "text-down" : "text-amber-300"}`}>
                        STATUS {mandatePreTradeRun.data.status.toUpperCase()}{mandatePreTradeRun.data.approvalRequired ? " · APPROVAL REQUIRED" : ""}
                      </div>
                      {mandatePreTradeRun.data.requiredEvidence.length > 0 && (
                        <div className="font-terminal text-[7px] text-amber-300">MISSING EVIDENCE: {mandatePreTradeRun.data.requiredEvidence.join("; ")}</div>
                      )}
                      {mandatePreTradeRun.data.violations.length > 0 && (
                        <div className="space-y-0.5">
                          {mandatePreTradeRun.data.violations.map((v, i) => (
                            <div key={i} className="font-terminal text-[7px] text-down">{v.code.toUpperCase()}{v.asset ? ` (${v.asset})` : ""}: {v.message}</div>
                          ))}
                        </div>
                      )}
                      {mandatePreTradeRun.data.proposedRebalanceTrades.length > 0 && (
                        <div className="grid grid-cols-2 gap-1 font-terminal text-[7px]">
                          {mandatePreTradeRun.data.proposedRebalanceTrades.map((t) => (
                            <span key={t.id}>{t.asset}: {t.direction === "buy" ? "+" : "-"}{(t.notionalWeight * 100).toFixed(2)}%</span>
                          ))}
                        </div>
                      )}
                      <div className="font-terminal text-[7px] text-muted-foreground">
                        TURNOVER {(mandatePreTradeRun.data.turnover * 100).toFixed(2)}%
                        {mandatePreTradeRun.data.totalEstimatedCost !== null ? ` · EST. TOTAL COST ${(mandatePreTradeRun.data.totalEstimatedCost * 100).toFixed(3)}%` : ""}
                        {mandatePreTradeRun.data.riskBudgetDelta !== null ? ` · RISK BUDGET Δ ${mandatePreTradeRun.data.riskBudgetDelta.toFixed(4)}` : ""}
                        {mandatePreTradeRun.data.trackingError !== null ? ` · TRACKING ERROR ${mandatePreTradeRun.data.trackingError.toFixed(4)}` : ""}
                      </div>
                      <div className="font-terminal text-[7px] text-muted-foreground">PROPOSAL {mandatePreTradeRun.data.proposalId} · SOURCE {mandatePreTradeRun.data.provenance.sourceMode.toUpperCase()}{mandatePreTradeRun.data.provenance.sourceMetadata ? ` (${mandatePreTradeRun.data.provenance.sourceMetadata.source}, as of ${mandatePreTradeRun.data.provenance.sourceMetadata.asOf})` : ""}</div>
                    </>
                  )}
                </div>
              )}

              {advancedModel === "bayesian-mean-shrinkage" && (
                <div className="border border-border bg-[#0a0a0a] p-3 space-y-2">
                  <div className="font-terminal text-[8px] text-foreground">BAYESIAN MEAN SHRINKAGE</div>
                  <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">Shrinks the basket's real historical annualized mean returns toward a common prior, precision-weighted by each asset's own estimated standard error -- combats the estimation-error blow-up mean-variance optimizers are notorious for.</div>
                  <label className="font-terminal text-[7px] text-muted-foreground">PRIOR STD (%) <input type="number" min="0.1" step="0.5" value={bayesianPriorStdPct} onChange={(e) => setBayesianPriorStdPct(Math.max(0.1, Number(e.target.value) || 5))} className="ml-2 w-16 border border-border bg-transparent px-1 py-0.5 text-foreground" /></label>
                  <button disabled={bayesianShrinkageRun.isPending} onClick={() => bayesianShrinkageRun.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{bayesianShrinkageRun.isPending ? "RUNNING…" : "RUN BAYESIAN SHRINKAGE"}</button>
                  {bayesianShrinkageRun.error && <div className="font-terminal text-[7px] text-red-300">{(bayesianShrinkageRun.error as Error).message}</div>}
                  {bayesianShrinkageRun.data && (
                    <>
                      <div className="space-y-0.5 font-terminal text-[7px]">
                        {assets.map((a) => <div key={a}>{a}: POSTERIOR {(bayesianShrinkageRun.data!.posteriorMeanReturnsPct[a] ?? 0).toFixed(2)}% ± {(bayesianShrinkageRun.data!.posteriorStdPct[a] ?? 0).toFixed(2)}% · DATA WEIGHT {((bayesianShrinkageRun.data!.dataWeights[a] ?? 0) * 100).toFixed(1)}%</div>)}
                      </div>
                      <AdvancedPortfolioRiskReceipt receipt={bayesianShrinkageRun.data.receipt} />
                    </>
                  )}
                </div>
              )}

              {advancedModel === "ledoit-wolf-covariance" && (
                <div className="border border-border bg-[#0a0a0a] p-3 space-y-2">
                  <div className="font-terminal text-[8px] text-foreground">LEDOIT-WOLF SHRUNK COVARIANCE</div>
                  <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">Runs scikit-learn's Ledoit-Wolf estimator over the basket's real daily return history ({optimizationData.dailyReturns[0]?.length ?? 0} overlapping observations) -- shrinks the noisy sample covariance toward a scaled-identity target, reducing condition number and out-of-sample estimation error versus the raw sample covariance used by the frontier tab above.</div>
                  <button disabled={ledoitWolfRun.isPending} onClick={() => ledoitWolfRun.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{ledoitWolfRun.isPending ? "RUNNING…" : "RUN LEDOIT-WOLF"}</button>
                  {ledoitWolfRun.error && <div className="font-terminal text-[7px] text-red-300">{(ledoitWolfRun.error as Error).message}</div>}
                  {ledoitWolfRun.data && (
                    <>
                      <div className="font-terminal text-[7px] text-muted-foreground">SHRINKAGE INTENSITY {(ledoitWolfRun.data.shrinkageIntensity * 100).toFixed(1)}% · COND # SAMPLE {ledoitWolfRun.data.conditionNumberSample?.toFixed(1) ?? "—"} · COND # SHRUNK {ledoitWolfRun.data.conditionNumberShrunk?.toFixed(1) ?? "—"}</div>
                      <div className="font-terminal text-[7px] text-muted-foreground">Lower shrunk condition number means the covariance matrix inverts more stably than the raw sample estimate used elsewhere in this panel.</div>
                      <AdvancedPortfolioRiskReceipt receipt={ledoitWolfRun.data.receipt} />
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: methodology */}
            <div className="w-full xl:w-80 bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
              <div className="p-4 flex-1 space-y-2 bg-[#080808]">
                <ConceptExplainer title="WHY 8 MORE PORTFOLIO ROUTES?">
                  <p>
                    The Markowitz frontier tab optimizes a single mean-variance tradeoff. Real construction desks layer on more: risk-budgeted (not capital-weighted) allocation, explicit multi-factor risk models, benchmark-relative tracking-error limits, tax-lot-aware turnover control, scenario stress limits, and estimation-error-aware inputs (Bayesian shrinkage, Ledoit-Wolf) that feed a cleaner μ/Σ back into any of the other optimizers. HRP, Bayesian shrinkage and Ledoit-Wolf reuse this panel's real {assets.length}-asset basket data; the rest need manual factor/benchmark/lot/scenario inputs no live source here provides, so those are explicit analyst-entered JSON, not fabricated.
                  </p>
                </ConceptExplainer>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
export default memo(PortfolioOptimizerPanel);
