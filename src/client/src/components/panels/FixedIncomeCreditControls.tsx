import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { ReceiptSummary } from "@/lib/advancedRatesDerivatives";
import { StructuredJsonEditor, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";

export type FixedIncomeCreditRoute =
  | "fixed-income/spread-analytics"
  | "fixed-income/key-rate-risk"
  | "fixed-income/immunize-duration"
  | "fixed-income/callable-oas"
  | "fixed-income/floating-rate-note"
  | "fixed-income/inflation-linked-bond"
  | "fixed-income/credit-spread-curve"
  | "credit/rating-migration"
  | "credit/creditmetrics"
  | "credit/stress-pd"
  | "credit/covenant-headroom";

type DataMode = "manual" | "private";
export type PrivateImportMetadata = { sourceReference: string; provider: string; asOf: string; retrievedAt: string; snapshotId: string; contentHash: string };
type Result = Record<string, unknown> & { receipt?: Record<string, unknown> };
type ReceiptView = { dataClassification?: string; modelId?: string; modelVersion?: string; validationLevel?: string; runId?: string; inputSnapshotHash?: string; outputSnapshotHash?: string; sourceBindings?: Array<{ provider?: string; sourceReference?: string; snapshot?: { id?: string } }>; warnings?: string[] };
type OutputField = { key: string; label: string; unit: string };

type WorkflowSpec = {
  path: FixedIncomeCreditRoute;
  label: string;
  description: string;
  requiredFields: string[];
  example: Record<string, unknown>;
  outputs: OutputField[];
  schema: JsonFieldSchema[];
};

const cashFlows = [{ timeYears: 1, amount: 5 }, { timeYears: 2, amount: 105 }];
const curve = [{ maturityYears: 1, zeroRatePct: 4.5 }, { maturityYears: 2, zeroRatePct: 4.6 }, { maturityYears: 5, zeroRatePct: 4.8 }];

const cashFlowsSchemaField = (defaultValue: Record<string, unknown>[]): JsonFieldSchema => ({
  kind: "objectArray", key: "cashFlows", label: "CASH FLOWS",
  itemFields: [
    { kind: "number", key: "timeYears", label: "TIME (YEARS)", min: 0, step: 0.25 },
    { kind: "number", key: "amount", label: "AMOUNT" },
  ],
  default: defaultValue,
});
const curveSchemaField = (defaultValue: Record<string, unknown>[]): JsonFieldSchema => ({
  kind: "objectArray", key: "curve", label: "ZERO CURVE",
  itemFields: [
    { kind: "number", key: "maturityYears", label: "MATURITY (YEARS)", min: 0, step: 0.25 },
    { kind: "number", key: "zeroRatePct", label: "ZERO RATE (%)" },
  ],
  default: defaultValue,
});

export const FIXED_INCOME_CREDIT_WORKFLOWS: WorkflowSpec[] = [
  {
    path: "fixed-income/spread-analytics", label: "Z-SPREAD / SPREAD DURATION", description: "Manual bond cash flows, zero curve and observed price; no quote feed is bound.",
    requiredFields: ["cashFlows", "curve", "marketPrice"], example: { cashFlows, curve: curve.slice(0, 2), marketPrice: 100 },
    outputs: [{ key: "zSpreadBps", label: "Z-SPREAD", unit: "bps" }, { key: "spreadDurationYears", label: "SPREAD DURATION", unit: "years" }, { key: "dv01", label: "DV01", unit: "price units / bp" }, { key: "modelPrice", label: "MODEL PRICE", unit: "price units / par" }],
    schema: [
      cashFlowsSchemaField(cashFlows),
      curveSchemaField(curve.slice(0, 2)),
      { kind: "number", key: "marketPrice", label: "MARKET PRICE", min: 0, default: 100 },
    ],
  },
  {
    path: "fixed-income/key-rate-risk", label: "KEY-RATE RISK / DV01", description: "Manual cash flows, zero curve, key maturities and positive rate bump.",
    requiredFields: ["cashFlows", "curve", "keyMaturitiesYears"], example: { cashFlows, curve, keyMaturitiesYears: [1, 2, 5], bumpBps: 1 },
    outputs: [{ key: "basePrice", label: "BASE PRICE", unit: "price units / par" }, { key: "parallelDurationYears", label: "PARALLEL DURATION", unit: "years" }, { key: "keyRateDurations", label: "KEY-RATE DURATIONS", unit: "years" }, { key: "keyRateDv01", label: "KEY-RATE DV01", unit: "price units / bp" }],
    schema: [
      cashFlowsSchemaField(cashFlows),
      curveSchemaField(curve),
      { kind: "numberArray", key: "keyMaturitiesYears", label: "KEY MATURITIES (YEARS)", itemLabel: "YEARS", default: [1, 2, 5] },
      { kind: "number", key: "bumpBps", label: "RATE BUMP (BPS)", min: 0, max: 100, optional: true, default: 1 },
    ],
  },
  {
    path: "fixed-income/immunize-duration", label: "DURATION IMMUNIZATION", description: "Manual asset prices and durations; target duration must be feasible.",
    requiredFields: ["assets", "targetDurationYears"], example: { assets: [{ name: "Short", price: 98, durationYears: 2 }, { name: "Long", price: 104, durationYears: 8 }], targetDurationYears: 5 },
    outputs: [{ key: "weights", label: "ASSET WEIGHTS", unit: "fraction of portfolio" }, { key: "achievedDurationYears", label: "ACHIEVED DURATION", unit: "years" }],
    schema: [
      { kind: "objectArray", key: "assets", label: "ASSETS", itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "price", label: "PRICE", min: 0 },
        { kind: "number", key: "durationYears", label: "DURATION (YEARS)", min: 0 },
      ], default: [{ name: "Short", price: 98, durationYears: 2 }, { name: "Long", price: 104, durationYears: 8 }] },
      { kind: "number", key: "targetDurationYears", label: "TARGET DURATION (YEARS)", min: 0, default: 5 },
    ],
  },
  {
    path: "fixed-income/callable-oas", label: "CALLABLE BOND OAS", description: "Manual callable-bond terms, flat risk-free curve and market price.",
    requiredFields: ["couponRatePct", "maturityYears", "flatRiskFreeRatePct", "marketPrice"], example: { faceValue: 100, couponRatePct: 5, maturityYears: 5, frequency: 2, flatRiskFreeRatePct: 4, shortRateVolatilityPct: 1, marketPrice: 101, callSchedule: [{ year: 3, callPricePct: 100 }] },
    outputs: [{ key: "optionAdjustedSpreadBps", label: "OAS", unit: "bps" }, { key: "modelPriceAtOas", label: "MODEL PRICE", unit: "price units / par" }, { key: "embeddedCallValue", label: "EMBEDDED CALL VALUE", unit: "price units / par" }, { key: "effectiveDurationYears", label: "EFFECTIVE DURATION", unit: "years" }, { key: "effectiveConvexity", label: "EFFECTIVE CONVEXITY", unit: "years²" }],
    schema: [
      { kind: "number", key: "faceValue", label: "FACE VALUE", min: 0, default: 100 },
      { kind: "number", key: "couponRatePct", label: "COUPON RATE (%)", min: 0, default: 5 },
      { kind: "number", key: "maturityYears", label: "MATURITY (YEARS)", min: 0, max: 50, default: 5 },
      { kind: "number", key: "frequency", label: "FREQUENCY (PAYMENTS/YR)", min: 1, max: 12, step: 1, default: 2 },
      { kind: "number", key: "flatRiskFreeRatePct", label: "FLAT RISK-FREE RATE (%)", default: 4 },
      { kind: "number", key: "shortRateVolatilityPct", label: "SHORT-RATE VOLATILITY (%)", min: 0, default: 1 },
      { kind: "number", key: "marketPrice", label: "MARKET PRICE", min: 0, default: 101 },
      { kind: "objectArray", key: "callSchedule", label: "CALL SCHEDULE", itemFields: [
        { kind: "number", key: "year", label: "CALL YEAR", min: 0 },
        { kind: "number", key: "callPricePct", label: "CALL PRICE (% PAR)", min: 0 },
      ], default: [{ year: 3, callPricePct: 100 }] },
    ],
  },
  {
    path: "fixed-income/floating-rate-note", label: "FLOATING-RATE NOTE", description: "Manual reference rate, quoted margin, discount margin and maturity.",
    requiredFields: ["referenceRatePct", "maturityYears"], example: { faceValue: 100, referenceRatePct: 4.5, quotedMarginBps: 75, discountMarginBps: 80, maturityYears: 3, frequency: 4 },
    outputs: [{ key: "price", label: "PRICE", unit: "price units / par" }, { key: "currentCouponPct", label: "CURRENT COUPON", unit: "% p.a." }, { key: "discountMarginBps", label: "DISCOUNT MARGIN", unit: "bps" }, { key: "effectiveDurationYears", label: "EFFECTIVE DURATION", unit: "years" }, { key: "dv01", label: "DV01", unit: "price units / bp" }],
    schema: [
      { kind: "number", key: "faceValue", label: "FACE VALUE", min: 0, default: 100 },
      { kind: "number", key: "referenceRatePct", label: "REFERENCE RATE (%)", default: 4.5 },
      { kind: "number", key: "quotedMarginBps", label: "QUOTED MARGIN (BPS)", default: 75 },
      { kind: "number", key: "discountMarginBps", label: "DISCOUNT MARGIN (BPS)", default: 80 },
      { kind: "number", key: "maturityYears", label: "MATURITY (YEARS)", min: 0, max: 50, default: 3 },
      { kind: "number", key: "frequency", label: "FREQUENCY (PAYMENTS/YR)", min: 1, max: 12, step: 1, default: 4 },
    ],
  },
  {
    path: "fixed-income/inflation-linked-bond", label: "INFLATION-LINKED BOND", description: "Manual real terms, index levels and expected inflation; index source is not bound.",
    requiredFields: ["realCouponRatePct", "realYieldPct", "maturityYears", "baseIndex", "currentIndex", "expectedInflationPct"], example: { faceValue: 100, realCouponRatePct: 1, realYieldPct: 1.5, maturityYears: 5, frequency: 2, baseIndex: 100, currentIndex: 112, expectedInflationPct: 2.5 },
    outputs: [{ key: "realPrice", label: "REAL PRICE", unit: "price units / par" }, { key: "indexedNominalPrice", label: "INDEXED NOMINAL PRICE", unit: "price units / par" }, { key: "currentIndexRatio", label: "CURRENT INDEX RATIO", unit: "x" }, { key: "projectedMaturityIndexRatio", label: "PROJECTED INDEX RATIO", unit: "x" }, { key: "projectedMaturityPrincipal", label: "PROJECTED PRINCIPAL", unit: "price units / par" }],
    schema: [
      { kind: "number", key: "faceValue", label: "FACE VALUE", min: 0, default: 100 },
      { kind: "number", key: "realCouponRatePct", label: "REAL COUPON RATE (%)", min: 0, default: 1 },
      { kind: "number", key: "realYieldPct", label: "REAL YIELD (%)", default: 1.5 },
      { kind: "number", key: "maturityYears", label: "MATURITY (YEARS)", min: 0, max: 50, default: 5 },
      { kind: "number", key: "frequency", label: "FREQUENCY (PAYMENTS/YR)", min: 1, max: 12, step: 1, default: 2 },
      { kind: "number", key: "baseIndex", label: "BASE INDEX LEVEL", min: 0, default: 100 },
      { kind: "number", key: "currentIndex", label: "CURRENT INDEX LEVEL", min: 0, default: 112 },
      { kind: "number", key: "expectedInflationPct", label: "EXPECTED INFLATION (%)", default: 2.5 },
    ],
  },
  {
    path: "fixed-income/credit-spread-curve", label: "CREDIT-SPREAD CURVE", description: "Manual maturity/spread observations, recovery and query maturities; curve source is not bound.",
    requiredFields: ["maturitiesYears", "spreadsBps", "queryMaturitiesYears"], example: { maturitiesYears: [1, 3, 5], spreadsBps: [80, 120, 160], recoveryRatePct: 40, queryMaturitiesYears: [1, 2, 3, 5] },
    outputs: [{ key: "interpolatedSpreadsBps", label: "INTERPOLATED SPREADS", unit: "bps" }, { key: "impliedHazardRatesPct", label: "IMPLIED HAZARD", unit: "% p.a." }, { key: "survivalProbabilitiesPct", label: "SURVIVAL PROBABILITY", unit: "%" }],
    schema: [
      { kind: "numberArray", key: "maturitiesYears", label: "MATURITIES (YEARS)", default: [1, 3, 5] },
      { kind: "numberArray", key: "spreadsBps", label: "SPREADS (BPS)", default: [80, 120, 160] },
      { kind: "number", key: "recoveryRatePct", label: "RECOVERY RATE (%)", min: 0, max: 100, optional: true, default: 40 },
      { kind: "numberArray", key: "queryMaturitiesYears", label: "QUERY MATURITIES (YEARS)", default: [1, 2, 3, 5] },
    ],
  },
  {
    path: "credit/rating-migration", label: "RATING MIGRATION MATRIX", description: "Manual ratings, row-stochastic transition matrix and current distribution.",
    requiredFields: ["ratings", "transitionMatrix", "currentDistribution"], example: { ratings: ["A", "BBB", "BB", "D"], transitionMatrix: [[0.88, 0.1, 0.015, 0.005], [0.04, 0.88, 0.07, 0.01], [0.01, 0.07, 0.86, 0.06], [0, 0, 0, 1]], currentDistribution: [0.4, 0.4, 0.2, 0], periods: 3 },
    outputs: [{ key: "futureDistribution", label: "FUTURE DISTRIBUTION", unit: "% by rating" }, { key: "cumulativeDefaultProbability", label: "CUMULATIVE DEFAULT", unit: "%" }, { key: "matrixRowSumMaxError", label: "ROW-SUM ERROR", unit: "absolute probability" }],
    schema: [
      { kind: "stringArray", key: "ratings", label: "RATINGS", default: ["A", "BBB", "BB", "D"] },
      { kind: "numberMatrix", key: "transitionMatrix", label: "TRANSITION MATRIX", default: [[0.88, 0.1, 0.015, 0.005], [0.04, 0.88, 0.07, 0.01], [0.01, 0.07, 0.86, 0.06], [0, 0, 0, 1]] },
      { kind: "numberArray", key: "currentDistribution", label: "CURRENT DISTRIBUTION", default: [0.4, 0.4, 0.2, 0] },
      { kind: "number", key: "periods", label: "PERIODS", min: 1, max: 100, step: 1, optional: true, default: 3 },
    ],
  },
  {
    path: "credit/creditmetrics", label: "CREDITMETRICS PORTFOLIO", description: "Manual EAD/PD/LGD exposures with seeded one-factor Gaussian-copula simulation.",
    requiredFields: ["exposures"], example: { exposures: [{ name: "IssuerA", ead: 1000000, pdPct: 1, lgdPct: 45, sector: "Industrials" }, { name: "IssuerB", ead: 700000, pdPct: 3, lgdPct: 50, sector: "Financials" }], assetCorrelation: 0.2, confidencePct: 99, nSimulations: 20000, seed: 42 },
    outputs: [{ key: "expectedLoss", label: "EXPECTED LOSS", unit: "notional currency units" }, { key: "unexpectedLossStd", label: "UNEXPECTED LOSS STD", unit: "notional currency units" }, { key: "creditVar", label: "CREDIT VaR", unit: "notional currency units" }, { key: "economicCapital", label: "ECONOMIC CAPITAL", unit: "notional currency units" }, { key: "tailExpectedShortfall", label: "TAIL EXPECTED SHORTFALL", unit: "notional currency units" }, { key: "seed", label: "SEED", unit: "integer" }],
    schema: [
      { kind: "objectArray", key: "exposures", label: "EXPOSURES", itemFields: [
        { kind: "string", key: "name", label: "NAME" },
        { kind: "number", key: "ead", label: "EAD", min: 0 },
        { kind: "number", key: "pdPct", label: "PD (%)", min: 0, max: 100 },
        { kind: "number", key: "lgdPct", label: "LGD (%)", min: 0, max: 100 },
        { kind: "string", key: "sector", label: "SECTOR" },
      ], default: [{ name: "IssuerA", ead: 1000000, pdPct: 1, lgdPct: 45, sector: "Industrials" }, { name: "IssuerB", ead: 700000, pdPct: 3, lgdPct: 50, sector: "Financials" }] },
      { kind: "number", key: "assetCorrelation", label: "ASSET CORRELATION", min: 0, max: 0.999999, optional: true, default: 0.2 },
      { kind: "number", key: "confidencePct", label: "CONFIDENCE (%)", min: 90, max: 99.999999, optional: true, default: 99 },
      { kind: "number", key: "nSimulations", label: "SIMULATIONS", min: 5000, max: 500000, step: 1000, optional: true, default: 20000 },
      { kind: "number", key: "seed", label: "SEED", step: 1, optional: true, default: 42 },
    ],
  },
  {
    path: "credit/stress-pd", label: "MACRO-STRESS PD", description: "Manual base PDs and beta sensitivities under a scalar macro shock.",
    requiredFields: ["basePdPct", "macroShock", "beta"], example: { basePdPct: [1, 3, 8], macroShock: 1.5, beta: [0.8, 1, 1.3] },
    outputs: [{ key: "stressedPdPct", label: "STRESSED PD", unit: "%" }],
    schema: [
      { kind: "numberArray", key: "basePdPct", label: "BASE PD (%)", default: [1, 3, 8] },
      { kind: "number", key: "macroShock", label: "MACRO SHOCK", default: 1.5 },
      { kind: "numberArray", key: "beta", label: "BETA SENSITIVITIES", default: [0.8, 1, 1.3] },
    ],
  },
  {
    path: "credit/covenant-headroom", label: "COVENANT HEADROOM", description: "Manual financial statement inputs and optional leverage/coverage thresholds.",
    requiredFields: ["ebitda", "netDebt", "interestExpense", "cashFlowFromOperations", "debtService"], example: { ebitda: 120, netDebt: 360, interestExpense: 30, cashFlowFromOperations: 90, debtService: 50, maxNetLeverage: 3.5, minInterestCoverage: 3, minDebtServiceCoverage: 1.5 },
    outputs: [{ key: "netLeverage", label: "NET LEVERAGE", unit: "x" }, { key: "interestCoverage", label: "INTEREST COVERAGE", unit: "x" }, { key: "debtServiceCoverage", label: "DEBT SERVICE COVERAGE", unit: "x" }, { key: "headroom", label: "COVENANT HEADROOM", unit: "x" }, { key: "breached", label: "BREACHED COVENANTS", unit: "status" }],
    schema: [
      { kind: "number", key: "ebitda", label: "EBITDA", default: 120 },
      { kind: "number", key: "netDebt", label: "NET DEBT", default: 360 },
      { kind: "number", key: "interestExpense", label: "INTEREST EXPENSE", default: 30 },
      { kind: "number", key: "cashFlowFromOperations", label: "CASH FLOW FROM OPERATIONS", default: 90 },
      { kind: "number", key: "debtService", label: "DEBT SERVICE", default: 50 },
      { kind: "number", key: "maxNetLeverage", label: "MAX NET LEVERAGE", optional: true, default: 3.5 },
      { kind: "number", key: "minInterestCoverage", label: "MIN INTEREST COVERAGE", optional: true, default: 3 },
      { kind: "number", key: "minDebtServiceCoverage", label: "MIN DEBT SERVICE COVERAGE", optional: true, default: 1.5 },
    ],
  },
];

function finiteNumbers(value: unknown, path: string): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
  if (Array.isArray(value)) value.forEach((item, index) => finiteNumbers(item, `${path}[${index}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => finiteNumbers(item, `${path}.${key}`));
}
function arrayField(parameters: Record<string, unknown>, field: string): unknown[] {
  const value = parameters[field];
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array.`);
  return value;
}
function numberField(parameters: Record<string, unknown>, field: string, options: { min?: number; max?: number; positive?: boolean } = {}): number {
  const value = parameters[field];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number.`);
  if (options.positive && value <= 0) throw new Error(`${field} must be greater than zero.`);
  if (options.min !== undefined && value < options.min) throw new Error(`${field} must be at least ${options.min}.`);
  if (options.max !== undefined && value > options.max) throw new Error(`${field} must be at most ${options.max}.`);
  return value;
}
function integerField(parameters: Record<string, unknown>, field: string, options: { min: number; max: number }): number {
  const value = numberField(parameters, field, options);
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer.`);
  return value;
}

/** Client-side adapter validation mirrors the selected Pydantic request contract before transport. */
function validateMigrationInputs(parameters: Record<string, unknown>): void {
  const ratings = arrayField(parameters, "ratings");
  const matrix = arrayField(parameters, "transitionMatrix");
  const distribution = arrayField(parameters, "currentDistribution");
  if (matrix.length !== ratings.length || distribution.length !== ratings.length || matrix.some((row) => !Array.isArray(row) || row.length !== ratings.length)) {
    throw new Error("Transition matrix and distribution dimensions must match ratings.");
  }
  if (matrix.some((row) => (row as unknown[]).some((value) => typeof value !== "number" || value < 0) || Math.abs((row as number[]).reduce((sum, value) => sum + value, 0) - 1) > 1e-8)) {
    throw new Error("Each transition-matrix row must contain non-negative probabilities that sum to 1.");
  }
  if (distribution.some((value) => typeof value !== "number" || value < 0) || Math.abs((distribution as number[]).reduce((sum, value) => sum + value, 0) - 1) > 1e-8) {
    throw new Error("Current rating distribution must contain non-negative probabilities that sum to 1.");
  }
  if ("periods" in parameters) integerField(parameters, "periods", { min: 1, max: 100 });
}

export function validateFixedIncomeCreditRequest(path: FixedIncomeCreditRoute, parameters: Record<string, unknown>): void {
  const spec = FIXED_INCOME_CREDIT_WORKFLOWS.find((item) => item.path === path);
  if (!spec) throw new Error("Unknown fixed-income or credit route.");
  spec.requiredFields.forEach((field) => { if (!(field in parameters)) throw new Error(`Missing required field: ${field}.`); });
  finiteNumbers(parameters, "parameters");
  if ("frequency" in parameters) integerField(parameters, "frequency", { min: 1, max: 12 });
  if (path === "fixed-income/spread-analytics") { arrayField(parameters, "cashFlows"); arrayField(parameters, "curve"); numberField(parameters, "marketPrice", { positive: true }); }
  if (path === "fixed-income/key-rate-risk") { arrayField(parameters, "cashFlows"); arrayField(parameters, "curve"); arrayField(parameters, "keyMaturitiesYears"); if ("bumpBps" in parameters) numberField(parameters, "bumpBps", { positive: true, max: 100 }); }
  if (path === "fixed-income/immunize-duration") { if (arrayField(parameters, "assets").length < 2) throw new Error("assets must contain at least two assets."); numberField(parameters, "targetDurationYears", { min: 0 }); }
  if (path === "fixed-income/callable-oas") { numberField(parameters, "couponRatePct", { min: 0 }); numberField(parameters, "maturityYears", { positive: true, max: 50 }); numberField(parameters, "flatRiskFreeRatePct"); numberField(parameters, "marketPrice", { positive: true }); }
  if (path === "fixed-income/floating-rate-note") { numberField(parameters, "referenceRatePct"); numberField(parameters, "maturityYears", { positive: true, max: 50 }); }
  if (path === "fixed-income/inflation-linked-bond") { numberField(parameters, "realCouponRatePct", { min: 0 }); numberField(parameters, "realYieldPct"); numberField(parameters, "maturityYears", { positive: true, max: 50 }); numberField(parameters, "baseIndex", { positive: true }); numberField(parameters, "currentIndex", { positive: true }); numberField(parameters, "expectedInflationPct"); }
  if (path === "fixed-income/credit-spread-curve") {
    const maturities = arrayField(parameters, "maturitiesYears");
    const spreads = arrayField(parameters, "spreadsBps");
    arrayField(parameters, "queryMaturitiesYears");
    if (maturities.length < 2 || maturities.length !== spreads.length) throw new Error("maturitiesYears and spreadsBps must have matching lengths with at least two nodes.");
    if (maturities.some((value, index) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return true;
      const previous = maturities[index - 1];
      return index > 0 && (typeof previous !== "number" || value <= previous);
    })) throw new Error("maturitiesYears must be increasing and positive.");
    if (spreads.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("spreadsBps must be non-negative.");
  }
  if (path === "credit/rating-migration") validateMigrationInputs(parameters);
  if (path === "credit/creditmetrics") { const exposures = arrayField(parameters, "exposures"); exposures.forEach((exposure) => { if (!exposure || typeof exposure !== "object") throw new Error("Each exposure must be an object."); const item = exposure as Record<string, unknown>; if (typeof item.name !== "string" || !item.name.trim()) throw new Error("Each exposure requires a name."); numberField(item, "ead", { min: 0 }); numberField(item, "pdPct", { min: 0, max: 100 }); numberField(item, "lgdPct", { min: 0, max: 100 }); }); if ("assetCorrelation" in parameters) numberField(parameters, "assetCorrelation", { min: 0, max: 0.999999 }); if ("confidencePct" in parameters) numberField(parameters, "confidencePct", { min: 90, max: 99.999999 }); if ("nSimulations" in parameters) numberField(parameters, "nSimulations", { min: 5000, max: 500000 }); }
  if (path === "credit/creditmetrics" && "seed" in parameters) integerField(parameters, "seed", { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });
  if (path === "credit/stress-pd") { const base = arrayField(parameters, "basePdPct"); const beta = arrayField(parameters, "beta"); numberField(parameters, "macroShock"); if (base.length !== beta.length || base.some((value) => typeof value !== "number" || value <= 0 || value >= 100)) throw new Error("basePdPct must be strictly between 0 and 100 and match beta dimensions."); }
  if (path === "credit/covenant-headroom") { numberField(parameters, "ebitda"); numberField(parameters, "netDebt"); numberField(parameters, "interestExpense"); numberField(parameters, "cashFlowFromOperations"); numberField(parameters, "debtService"); if (parameters.ebitda === 0 || parameters.interestExpense === 0 || parameters.debtService === 0) throw new Error("EBITDA, interestExpense and debtService must be non-zero."); }
}

export function buildFixedIncomeCreditRequest(parameters: Record<string, unknown>, mode: DataMode, privateImport?: PrivateImportMetadata): Record<string, unknown> {
  if (mode === "manual") return { ...parameters, inputProvenance: { dataClassification: "manual", manualInputs: parameters } };
  if (!privateImport?.sourceReference?.trim() || !privateImport.provider?.trim() || !privateImport.asOf?.trim() || !privateImport.retrievedAt?.trim() || !privateImport.snapshotId?.trim() || !/^[a-f0-9]{64}$/.test(privateImport.contentHash ?? "")) throw new Error("Private import requires provider, source reference, ISO as-of/retrieved timestamps, snapshot id and a 64-character SHA-256 content hash.");
  const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoDateTime.test(privateImport.asOf) || !isoDateTime.test(privateImport.retrievedAt) || !Number.isFinite(Date.parse(privateImport.asOf)) || !Number.isFinite(Date.parse(privateImport.retrievedAt))) throw new Error("Private import as-of and retrieved-at must be valid ISO timestamps.");
  return { ...parameters, inputProvenance: { dataClassification: "cached", sourceBindings: [{ contractFamily: "fixed-income-credit", field: "manual-import", connectorId: "private-import", provider: privateImport.provider, priority: "manual_override", sourceReference: privateImport.sourceReference, asOf: privateImport.asOf, retrievedAt: privateImport.retrievedAt, freshness: "cached", snapshot: { id: privateImport.snapshotId, contentHash: privateImport.contentHash }, transformations: [] }] } };
}

export function formatFixedIncomeCreditValue(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(4) : "—";
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

export function formatFixedIncomeCreditResult(path: FixedIncomeCreditRoute, result: Result): Array<{ label: string; value: string; unit: string }> {
  const spec = FIXED_INCOME_CREDIT_WORKFLOWS.find((item) => item.path === path);
  if (!spec) throw new Error("Unknown fixed-income or credit route.");
  return spec.outputs.map((field) => ({ label: field.label, value: formatFixedIncomeCreditValue(result[field.key]), unit: field.unit }));
}

function routeId(path: string): string { return path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase(); }

export function FixedIncomeCreditRouteGroup({ paths, title = "INSTITUTIONAL FI / CREDIT" }: { paths: FixedIncomeCreditRoute[]; title?: string }) {
  const models = useMemo(() => paths.map((path) => FIXED_INCOME_CREDIT_WORKFLOWS.find((spec) => spec.path === path)).filter((spec): spec is WorkflowSpec => Boolean(spec)), [paths]);
  const [path, setPath] = useState(models[0]?.path ?? "fixed-income/spread-analytics");
  const selected = models.find((spec) => spec.path === path) ?? models[0];
  const [parameters, setParameters] = useState<Record<string, unknown>>(() => (selected ? (JSON.parse(JSON.stringify(selected.example)) as Record<string, unknown>) : {}));
  const [mode, setMode] = useState<DataMode>("manual");
  const [privateImport, setPrivateImport] = useState<PrivateImportMetadata>({ sourceReference: "", provider: "", asOf: "", retrievedAt: "", snapshotId: "", contentHash: "" });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => { if (selected) { setParameters(JSON.parse(JSON.stringify(selected.example)) as Record<string, unknown>); setResult(null); setError(null); setMode("manual"); setPrivateImport({ sourceReference: "", provider: "", asOf: "", retrievedAt: "", snapshotId: "", contentHash: "" }); } }, [selected?.path]);
  if (!selected) return null;
  const id = routeId(selected.path);
  const run = async () => {
    setError(null); setResult(null);
    try {
      if ("inputProvenance" in parameters) throw new Error("Do not add inputProvenance; source classification is sealed by this control.");
      validateFixedIncomeCreditRequest(selected.path, parameters);
      const payload = buildFixedIncomeCreditRequest(parameters, mode, privateImport);
      setRunning(true);
      const response = await apiRequest("POST", `/api/quant/advanced/${selected.path}`, payload);
      setResult(await response.json() as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Analysis request failed."); }
    finally { setRunning(false); }
  };
  return <section className="border border-border bg-[#080808] p-3 space-y-2" data-testid={`fixed-income-credit-group-${id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-terminal text-[9px] tracking-widest text-foreground">{title}</span><span className="font-terminal text-[7px] text-amber-300">MANUAL / PRIVATE CACHED SNAPSHOT · LIVE SOURCE NOT BOUND</span></div>
    <div className="font-terminal text-[7px] leading-relaxed text-muted-foreground">Every value below is an illustrative term unless replaced by an explicit client/private import. Source status, provider, as-of date and period are not inferred.</div>
    {models.length > 1 && <select aria-label="Institutional FI or credit model" data-testid="fixed-income-credit-model-select" value={selected.path} onChange={(event) => setPath(event.target.value as FixedIncomeCreditRoute)} className="w-full border border-border bg-[#090909] px-2 py-1 font-terminal text-[8px] text-foreground">{models.map((model) => <option key={model.path} value={model.path}>{model.label}</option>)}</select>}
    <div className="font-terminal text-[8px] text-muted-foreground">{selected.description} Exact Pydantic fields shown: {Object.keys(selected.example).join(", ")}. Fields with server defaults may be omitted; no value is treated as live.</div>
    <div className="font-terminal text-[8px] text-muted-foreground">MANUAL PARAMETERS (STRUCTURED FORM · ILLUSTRATIVE ONLY)</div>
    <div data-testid={`fixed-income-credit-input-${id}`}><StructuredJsonEditor schema={selected.schema} value={parameters} onChange={setParameters} /></div>
    <div className="flex flex-wrap items-center gap-2 font-terminal text-[8px] text-muted-foreground"><label>SOURCE STATUS <select aria-label={`${selected.label} source status`} data-testid={`fixed-income-credit-source-${id}`} value={mode} onChange={(event) => setMode(event.target.value as DataMode)} className="ml-1 border border-border bg-black px-1 py-0.5 text-foreground"><option value="manual">MANUAL</option><option value="private">PRIVATE IMPORT (CACHED SNAPSHOT)</option></select></label>{mode === "private" && <><label>PROVIDER <input aria-label={`${selected.label} private provider`} value={privateImport.provider} onChange={(event) => setPrivateImport((current) => ({ ...current, provider: event.target.value }))} placeholder="private provider" className="ml-1 w-28 border border-border bg-black px-1 py-0.5 text-foreground" /></label><label>SOURCE REF <input aria-label={`${selected.label} private source reference`} value={privateImport.sourceReference} onChange={(event) => setPrivateImport((current) => ({ ...current, sourceReference: event.target.value }))} placeholder="vault://snapshot-id" className="ml-1 w-36 border border-border bg-black px-1 py-0.5 text-foreground" /></label><label>AS-OF <input aria-label={`${selected.label} private as-of`} value={privateImport.asOf} onChange={(event) => setPrivateImport((current) => ({ ...current, asOf: event.target.value }))} placeholder="2026-08-31T00:00:00Z" className="ml-1 w-36 border border-border bg-black px-1 py-0.5 text-foreground" /></label><label>RETRIEVED <input aria-label={`${selected.label} private retrieved-at`} value={privateImport.retrievedAt} onChange={(event) => setPrivateImport((current) => ({ ...current, retrievedAt: event.target.value }))} placeholder="2026-08-31T00:00:00Z" className="ml-1 w-36 border border-border bg-black px-1 py-0.5 text-foreground" /></label><label>SNAPSHOT ID <input aria-label={`${selected.label} private snapshot id`} value={privateImport.snapshotId} onChange={(event) => setPrivateImport((current) => ({ ...current, snapshotId: event.target.value }))} placeholder="immutable-id" className="ml-1 w-28 border border-border bg-black px-1 py-0.5 text-foreground" /></label><label>SHA-256 <input aria-label={`${selected.label} private content hash`} value={privateImport.contentHash} onChange={(event) => setPrivateImport((current) => ({ ...current, contentHash: event.target.value }))} placeholder="64 hex chars" className="ml-1 w-36 border border-border bg-black px-1 py-0.5 text-foreground" /></label></>}<span>PROVIDER: {mode === "private" ? (privateImport.provider || "required") : "none"} · AS-OF: {mode === "private" ? (privateImport.asOf || "required") : "unbound"} · PERIOD: unbound</span></div>
    <button type="button" data-testid={`fixed-income-credit-run-${id}`} onClick={() => void run()} disabled={running} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{running ? "RUNNING…" : "RUN ANALYTIC"}</button>
    {result && <div data-testid={`fixed-income-credit-result-${id}`} className="space-y-2"><div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{formatFixedIncomeCreditResult(selected.path, result).map((field) => <div key={field.label} className="border border-border/60 bg-black/30 p-1.5 font-terminal"><div className="text-[7px] text-muted-foreground">{field.label}</div><div className="text-[9px] text-foreground">{field.value} <span className="text-[7px] text-amber-200">{field.unit}</span></div></div>)}</div><ReceiptSummary receipt={result.receipt as ReceiptView} /></div>}
  </section>;
}

export function FixedIncomeCreditControls({ paths, title }: { paths: FixedIncomeCreditRoute[]; title?: string }) {
  return <FixedIncomeCreditRouteGroup paths={paths} title={title} />;
}
