/**
 * Model Consensus panel's backing route. Registered under /api/quant/*,
 * which isn't in routes.ts's PUBLIC_DATA_PATH_PREFIXES, so it inherits the
 * default requireInternal gate from that file's top-level /api middleware --
 * same reasoning as the existing /finance/news/ai-smart-search
 * METERED_EXCEPTIONS entry: this calls an AI provider per request with no
 * credit metering, so it must stay internal-only rather than becoming a new
 * unmetered client AI surface as a side effect of building this panel.
 */
import type { Express } from "express";
import { z } from "zod";
import { getConsensusNote } from "./quantConsensusService";
import { getAssumptionChallenge } from "./challengeAssumptionService";
import { callPythonService, PythonServiceDataError } from "./pythonService";
import { getDamodaranIndustryBenchmarks, getDamodaranIndustryBenchmark } from "./damodaranData";
import { requireRole } from "./auth";
import { QUANT_MODEL_REGISTRY, summarizeQuantRegistry } from "./quantModelRegistry";
import { tenantContext } from "./tenantContext";
import { executeOriginalTerminalQuant, TerminalQuantTargetError } from "./terminalRegisteredQuant";
import { executeOriginalResampling, originalResamplingRequestSchema, executeOriginalManualRisk, originalManualRiskRequestSchema } from "./advancedQuantExecution";
import { terminalExecutionTargetSchema } from "@shared/terminalArtifact";
import { validateTerminalExecutionTarget } from "./terminalArtifactTool";
import { createTerminalArtifactEngineVersion } from "./artifactStore";

const consensusRequestSchema = z.object({
  question: z.string().min(1).max(300),
  methods: z.array(z.object({
    name: z.string().min(1).max(80),
    value: z.string().min(1).max(40),
    verdict: z.string().min(1).max(40),
  })).min(2).max(8),
});

const challengeRequestSchema = z.object({
  assumptionLabel: z.string().min(1).max(120),
  assumptionValue: z.string().min(1).max(40),
  results: z.array(z.object({
    testedValue: z.string().min(1).max(40),
    outputLabel: z.string().min(1).max(80),
    outputValue: z.string().min(1).max(40),
  })).min(2).max(6),
});

const bondPriceRequestSchema = z.object({
  faceValue: z.number().positive(),
  couponRatePct: z.number().min(0).max(100),
  frequency: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(12)]),
  yearsToMaturity: z.number().positive().max(100),
  marketYieldPct: z.number().min(-5).max(100),
  dayCount: z.enum(["30/360", "ACT/ACT", "ACT/360", "ACT/365"]),
});

// ─── Portfolio optimization (real scipy.optimize, see python-service/portfolio_optimization.py) ───
// 300, not a toy-demo 30 -- benchmarked, not guessed: a single SLSQP solve
// (min-variance/max-sharpe/risk-parity/max-diversification) stays under
// 1.3s even at n=500, and mean-CVaR's linprog is fast regardless of asset
// count (scales with scenario count instead). A real institutional
// portfolio or a diversified client book plausibly has hundreds of
// holdings, not a 30-name toy basket.
const assetsSchema = z.array(z.string().min(1).max(20)).min(2).max(300);
const covMatrixSchema = z.array(z.array(z.number())).min(2).max(300);

const meanVarianceSchema = z.object({
  assets: assetsSchema,
  expectedReturns: z.array(z.number()).min(2).max(300),
  covMatrix: covMatrixSchema,
  allowShort: z.boolean(),
});
const maxSharpeSchema = meanVarianceSchema.extend({ riskFreeRatePct: z.number() });
// Tighter cap than the other portfolio methods: efficient-frontier runs
// nPoints separate SLSQP solves (15 by default), not one -- benchmarked at
// 0.69s/n=100, 1.87s/n=150, 10.68s/n=300. 150 keeps it well under 2s.
const efficientFrontierSchema = z.object({
  assets: z.array(z.string().min(1).max(20)).min(2).max(150),
  expectedReturns: z.array(z.number()).min(2).max(150),
  covMatrix: z.array(z.array(z.number())).min(2).max(150),
  allowShort: z.boolean(),
  nPoints: z.number().int().min(2).max(50),
});
const covOnlySchema = z.object({ assets: assetsSchema, covMatrix: covMatrixSchema });
const maxDiversificationSchema = covOnlySchema.extend({ assetVolsPct: z.array(z.number()).min(2).max(300) });
const meanCvarSchema = z.object({
  assets: assetsSchema,
  returnsMatrixPct: z.array(z.array(z.number())).min(10),
  confidence: z.number().min(50).max(99.9),
  allowShort: z.boolean(),
});

const PORTFOLIO_ROUTES = [
  { path: "min-variance", schema: meanVarianceSchema },
  { path: "max-sharpe", schema: maxSharpeSchema },
  { path: "efficient-frontier", schema: efficientFrontierSchema },
  { path: "risk-parity", schema: covOnlySchema },
  { path: "max-diversification", schema: maxDiversificationSchema },
  { path: "mean-cvar", schema: meanCvarSchema },
] as const;

// ─── Credit / operational risk (Monte Carlo, see python-service/credit_operational_risk.py) ───
// 2000, not a toy-demo 200 -- see python-service/credit_operational_risk.py's
// comment for the real benchmark behind this cap (~2.6s at 2000 obligors x
// the nSims cap below, after fixing two O(n) memory-allocation bottlenecks).
const creditVarSchema = z.object({
  obligors: z.array(z.string().min(1).max(60)).min(1).max(2000),
  pdPct: z.array(z.number().min(0).max(100)).min(1).max(2000),
  lgdPct: z.array(z.number().min(0).max(100)).min(1).max(2000),
  ead: z.array(z.number().nonnegative()).min(1).max(2000),
  assetCorrelation: z.number().min(0).max(0.99),
  confidence: z.number().min(90).max(99.99),
  nSims: z.number().int().min(1000).max(100000),
  seed: z.number().int(),
});
const operationalRiskSchema = z.object({
  annualFrequency: z.number().positive().max(10000),
  severityMu: z.number(),
  severitySigma: z.number().positive(),
  confidence: z.number().min(90).max(99.99),
  nSims: z.number().int().min(1000).max(100000),
  seed: z.number().int(),
});

// ─── Statistics & econometrics (LIMURIA_ENGINES port plan Phase 2a, see python-service/statistics_econometrics.py) ───
const numArraySchema = z.array(z.number()).min(3).max(5000);
const normalitySchema = z.object({ data: numArraySchema });
const hypothesisTestSchema = z.object({ group1: numArraySchema, group2: numArraySchema });
const correlationSchema = z.object({ x: numArraySchema, y: numArraySchema });
const partialCorrelationSchema = z.object({ x: numArraySchema, y: numArraySchema, z: numArraySchema });
const covTypeSchema = z.enum(["nonrobust", "HC1", "HC3", "HAC", "cluster"]).default("nonrobust");
const clusterLabelsSchema = z.array(z.string().min(1).max(60)).min(3).max(5000);
const regressionSchema = z.object({
  y: numArraySchema,
  x: z.array(numArraySchema).min(1).max(10),
});
const regressionWithCovSchema = regressionSchema.extend({
  covType: covTypeSchema,
  clusterVar: clusterLabelsSchema.optional(),
  maxLags: z.number().int().min(0).max(200).optional(),
});
const glsSchema = regressionWithCovSchema.extend({ weights: numArraySchema });
const robustRegressionSchema = z.object({
  y: numArraySchema,
  x: z.array(numArraySchema).min(1).max(10),
  normType: z.enum(["huber", "bisquare", "tukey"]).default("huber"),
});
const vifSchema = z.object({ x: z.array(numArraySchema).min(2).max(10) });
const autocorrelationTestSchema = z.object({
  y: numArraySchema,
  x: z.array(numArraySchema).min(1).max(10),
  lags: z.number().int().min(1).max(40).default(4),
});
const nullableNumArraySchema = z.array(z.number().nullable()).min(3).max(100000);
const descriptiveDiagnosticsSchema = z.object({
  data: nullableNumArraySchema, quantiles: z.array(z.number().min(0).max(1)).max(25).default([0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]),
  trimProportion: z.number().min(0).max(0.499).default(0.05), winsorProportion: z.number().min(0).max(0.499).default(0.05),
  outlierZThreshold: z.number().positive().max(20).default(3.5),
});
const distributionFitSchema = z.object({
  data: z.array(z.number()).min(8).max(10000), distributions: z.array(z.enum(["normal", "student_t", "lognormal", "gamma"])).min(1).max(4).default(["normal", "student_t", "lognormal", "gamma"]),
  nMcSamples: z.number().int().min(199).max(4999).default(999), seed: z.number().int().min(0).max(2_147_483_647),
});
const professionalInferenceSchema = z.object({
  group1: z.array(z.number()).min(3).max(50000), group2: z.array(z.number()).min(3).max(50000).optional(), paired: z.boolean().default(false),
  alpha: z.number().positive().max(0.499).default(0.05), alternative: z.enum(["two-sided", "less", "greater"]).default("two-sided"),
  targetPower: z.number().min(0.5001).max(0.9999).default(0.8),
});
const seededResamplingSchema = z.object({
  data: z.array(z.number()).min(5).max(10000), group2: z.array(z.number()).min(5).max(10000).optional(),
  statistic: z.enum(["mean", "median", "standard_deviation"]).default("mean"), confidence: z.number().min(0.5001).max(0.9999).default(0.95),
  iterations: z.number().int().min(200).max(20000).default(2000), blockLength: z.number().int().min(2).max(1000).default(5), seed: z.number().int().min(0).max(2_147_483_647),
});
const multipleTestingSchema = z.object({ pValues: z.array(z.number().min(0).max(1)).min(2).max(10000), labels: z.array(z.string().min(1).max(100)).max(10000).optional(), alpha: z.number().positive().max(0.499).default(0.05) });
const multivariateStructureSchema = z.object({
  data: z.array(z.array(z.number()).min(2).max(100)).min(8).max(10000), featureNames: z.array(z.string().min(1).max(80)).max(100).optional(),
  nComponents: z.number().int().min(1).max(25).default(2), maxClusters: z.number().int().min(2).max(12).default(6), seed: z.number().int().min(0).max(2_147_483_647),
});
const bayesianNormalSchema = z.object({
  data: z.array(z.number()).min(5).max(50000), priorMean: z.number().default(0), priorKappa: z.number().positive().default(0.01),
  priorAlpha: z.number().positive().default(2), priorBeta: z.number().positive().default(1), confidence: z.number().min(0.5001).max(0.9999).default(0.95),
  draws: z.number().int().min(1000).max(20000).default(4000), seed: z.number().int().min(0).max(2_147_483_647),
});

const STATS_ROUTES = [
  { path: "normality", schema: normalitySchema },
  { path: "hypothesis-tests", schema: hypothesisTestSchema },
  { path: "correlation", schema: correlationSchema },
  { path: "partial-correlation", schema: partialCorrelationSchema },
  { path: "ols-diagnostics", schema: regressionWithCovSchema },
  { path: "gls", schema: glsSchema },
  { path: "logistic", schema: regressionSchema },
  { path: "probit", schema: regressionSchema },
  { path: "robust-regression", schema: robustRegressionSchema },
  { path: "influence-diagnostics", schema: regressionSchema },
  { path: "vif", schema: vifSchema },
  { path: "reset-test", schema: regressionSchema },
  { path: "autocorrelation-tests", schema: autocorrelationTestSchema },
  { path: "descriptive-diagnostics", schema: descriptiveDiagnosticsSchema },
  { path: "distribution-fit", schema: distributionFitSchema },
  { path: "professional-inference", schema: professionalInferenceSchema },
  { path: "seeded-resampling", schema: seededResamplingSchema },
  { path: "multiple-testing", schema: multipleTestingSchema },
  { path: "multivariate-structure", schema: multivariateStructureSchema },
  { path: "bayesian-normal", schema: bayesianNormalSchema },
] as const;

// ─── Econometrics (LIMURIA_ENGINES port plan Phase 2b, see python-service/econometrics.py) ───
const stringArraySchema = z.array(z.string().min(1).max(40)).min(3).max(5000);
const panelCovTypeSchema = z.enum(["unadjusted", "robust", "clustered", "kernel"]).default("unadjusted");
const panelOlsSchema = z.object({
  y: numArraySchema,
  x: z.array(numArraySchema).min(1).max(10),
  entityIds: stringArraySchema,
  timeIds: stringArraySchema,
  covType: panelCovTypeSchema,
  clusterVar: stringArraySchema.optional(),
  kernelMaxLags: z.number().int().min(0).max(200).optional(),
});
const mixedEffectsSchema = z.object({
  y: numArraySchema,
  x: z.array(numArraySchema).min(1).max(10),
  groups: stringArraySchema,
  randomSlopeIndex: z.number().int().min(0).max(9).optional(),
});
const iv2slsSchema = z.object({
  y: numArraySchema,
  endogenous: z.array(numArraySchema).min(1).max(5),
  instruments: z.array(numArraySchema).min(1).max(5),
  exogenous: z.array(numArraySchema).min(1).max(10).optional(),
});
const didSchema = z.object({ y: numArraySchema, treated: numArraySchema, post: numArraySchema });
const rdSchema = z.object({ y: numArraySchema, x: numArraySchema, cutoff: z.number() });
const timeSeriesDataSchema = z.array(numArraySchema).min(2).max(6);
const varSchema = z.object({
  seriesNames: z.array(z.string().min(1).max(40)).min(2).max(6),
  data: timeSeriesDataSchema,
  lags: z.number().int().min(1).max(20),
  irfHorizon: z.number().int().min(1).max(60),
});
const vecmSchema = z.object({
  seriesNames: z.array(z.string().min(1).max(40)).min(2).max(6),
  data: timeSeriesDataSchema,
  cointRank: z.number().int().min(1).max(5),
  lags: z.number().int().min(1).max(20),
});
const grangerSchema = z.object({ y: numArraySchema, x: numArraySchema, maxLags: z.number().int().min(1).max(20) });
const johansenSchema = z.object({
  seriesNames: z.array(z.string().min(1).max(40)).min(2).max(6),
  data: timeSeriesDataSchema,
  detOrder: z.number().int().min(-1).max(1),
  kArDiff: z.number().int().min(1).max(20),
});
const unitRootSchema = z.object({ series: numArraySchema });
const heteroskedasticitySchema = z.object({ residuals: numArraySchema, x: z.array(numArraySchema).min(1).max(10) });
const quantileRegressionSchema = z.object({
  y: numArraySchema,
  x: z.array(numArraySchema).min(1).max(10),
  quantile: z.number().min(0.01).max(0.99),
});
const surSchema = z.object({
  equations: z.array(z.object({
    name: z.string().min(1).max(40),
    y: numArraySchema,
    x: z.array(numArraySchema).min(1).max(10),
  })).min(2).max(6),
});

const ECONOMETRICS_ROUTES = [
  { path: "panel-ols", schema: panelOlsSchema },
  { path: "iv-2sls", schema: iv2slsSchema },
  { path: "did", schema: didSchema },
  { path: "rd", schema: rdSchema },
  { path: "var", schema: varSchema },
  { path: "vecm", schema: vecmSchema },
  { path: "granger", schema: grangerSchema },
  { path: "johansen", schema: johansenSchema },
  { path: "unit-root", schema: unitRootSchema },
  { path: "heteroskedasticity", schema: heteroskedasticitySchema },
  { path: "quantile-regression", schema: quantileRegressionSchema },
  { path: "sur", schema: surSchema },
  { path: "mixed-effects-panel", schema: mixedEffectsSchema },
] as const;

// ─── Options volatility (LIMURIA_ENGINES port plan Phase 3, see python-service/options_volatility.py) ───
const sabrCalibrateSchema = z.object({
  forward: z.number().positive(),
  expiryYears: z.number().positive().max(10),
  beta: z.number().min(0).max(1),
  strikes: z.array(z.number().positive()).min(3).max(500),
  marketVolsPct: z.array(z.number()).min(3).max(500),
});
const sabrSmileSchema = z.object({
  forward: z.number().positive(),
  expiryYears: z.number().positive().max(10),
  alpha: z.number().positive(),
  beta: z.number().min(0).max(1),
  rho: z.number().min(-0.999).max(0.999),
  nu: z.number().positive(),
  strikes: z.array(z.number().positive()).min(1).max(500),
});
const hestonCalibrateSchema = z.object({
  spot: z.number().positive(),
  riskFreeRatePct: z.number(),
  dividendYieldPct: z.number().default(0),
  quotes: z.array(z.object({
    strike: z.number().positive(),
    expiryYears: z.number().positive().max(10),
    marketVolPct: z.number().positive(),
  })).min(5).max(500),
  v0: z.number().positive().default(0.04),
  kappa: z.number().positive().default(2.0),
  theta: z.number().positive().default(0.04),
  sigma: z.number().positive().default(0.5),
  rho: z.number().min(-0.999).max(0.999).default(-0.5),
});
const hestonPriceSchema = z.object({
  spot: z.number().positive(),
  strike: z.number().positive(),
  expiryYears: z.number().positive().max(10),
  riskFreeRatePct: z.number(),
  dividendYieldPct: z.number().default(0),
  isCall: z.boolean().default(true),
  v0: z.number().positive(),
  kappa: z.number().positive(),
  theta: z.number().positive(),
  sigma: z.number().positive(),
  rho: z.number().min(-0.999).max(0.999),
});

const OPTIONS_VOL_ROUTES = [
  { path: "sabr-calibrate", schema: sabrCalibrateSchema },
  { path: "sabr-smile", schema: sabrSmileSchema },
  { path: "heston-calibrate", schema: hestonCalibrateSchema },
  { path: "heston-price", schema: hestonPriceSchema },
] as const;

// ─── Forecasting upgrade (LIMURIA_ENGINES port plan Phase 4, see python-service/forecasting.py) ───
const sarimaxSchema = z.object({
  series: numArraySchema.min(20).max(5000),
  order: z.tuple([z.number().int().min(0).max(10), z.number().int().min(0).max(3), z.number().int().min(0).max(10)]).default([1, 1, 1]),
  seasonalOrder: z.tuple([z.number().int().min(0).max(5), z.number().int().min(0).max(2), z.number().int().min(0).max(5), z.number().int().min(0).max(366)]).optional(),
  exog: z.array(numArraySchema).max(5000).optional(),
  exogForecast: z.array(numArraySchema).max(365).optional(),
  horizon: z.number().int().min(1).max(365).default(12),
  confidenceLevel: z.number().gt(0.5).lt(1).default(0.95),
});
const stlSchema = z.object({
  series: numArraySchema.min(20).max(5000),
  period: z.number().int().min(2).max(366),
  robust: z.boolean().default(true),
});
const changepointSchema = z.object({
  series: numArraySchema.min(20).max(5000),
  method: z.enum(["cusum", "pelt"]).default("pelt"),
  bootstrapIterations: z.number().int().min(200).max(5000).default(1000),
  confidenceThreshold: z.number().gt(0.5).lt(1).default(0.95),
  minSegmentLength: z.number().int().min(3).default(10),
  penalty: z.number().positive().optional(),
});
const garchSchema = z.object({
  returnsPct: numArraySchema.min(50).max(10000),
  p: z.number().int().min(1).max(5).default(1),
  q: z.number().int().min(1).max(5).default(1),
  vol: z.enum(["GARCH", "EGARCH"]).default("GARCH"),
  dist: z.enum(["normal", "t", "skewt"]).default("normal"),
});

const FORECASTING_ROUTES = [
  { path: "sarimax", schema: sarimaxSchema },
  { path: "stl", schema: stlSchema },
  { path: "changepoint", schema: changepointSchema },
  { path: "garch", schema: garchSchema },
] as const;

// ─── Economics & Policy cluster (LIMURIA_ENGINES port plan Phase 5, see python-service/economics_policy.py) ───
const leontiefSchema = z.object({
  ioMatrix: z.array(z.array(z.number())).min(2).max(200),
  finalDemand: z.array(z.number()).min(2).max(200),
});
const taylorRuleSchema = z.object({
  inflationPct: z.number(),
  inflationTargetPct: z.number().default(2.0),
  outputGapPct: z.number().default(0.0),
  neutralRealRatePct: z.number().default(2.0),
  inflationWeight: z.number().min(0).default(0.5),
  outputGapWeight: z.number().min(0).default(0.5),
});
const phillipsCurveSchema = z.object({
  unemploymentPct: z.array(z.number()).min(8).max(5000),
  inflationPct: z.array(z.number()).min(8).max(5000),
});
const giniSchema = z.object({
  income: z.array(z.number()).min(2).max(200000),
});
const taxBracketSchema = z.object({
  threshold: z.number().min(0),
  rate: z.number().min(0).max(1),
});
const incomeTaxMicrosimSchema = z.object({
  incomeDistribution: z.array(z.number()).min(10).max(200000),
  oldBrackets: z.array(taxBracketSchema).min(1).max(20),
  newBrackets: z.array(taxBracketSchema).min(1).max(20),
});
const carbonTaxDividendSchema = z.object({
  householdEnergySpendMonthly: z.array(z.number()).min(20).max(200000),
  householdIncomes: z.array(z.number()).min(20).max(200000),
  carbonTaxPerTon: z.number().positive().default(50.0),
  emissionFactorTonsPerDollar: z.number().positive().default(0.002),
});

const ECONOMICS_POLICY_ROUTES = [
  { path: "leontief-io", schema: leontiefSchema },
  { path: "taylor-rule", schema: taylorRuleSchema },
  { path: "phillips-curve", schema: phillipsCurveSchema },
  { path: "gini", schema: giniSchema },
  { path: "income-tax-microsim", schema: incomeTaxMicrosimSchema },
  { path: "carbon-tax-dividend", schema: carbonTaxDividendSchema },
] as const;

// ─── Machine Learning cluster (LIMURIA_ENGINES port plan Phase 7, see python-service/ml_cluster.py) ───
const featureMatrixSchema = z.array(z.array(z.number())).min(6).max(200000);
const classificationSchema = z.object({
  features: featureMatrixSchema,
  labels: z.array(z.number().int()).min(20).max(200000),
  modelType: z.enum(["random_forest", "gradient_boosting", "logistic"]).default("random_forest"),
  testSizeFraction: z.number().gt(0.05).lt(0.5).default(0.25),
  featureNames: z.array(z.string()).optional(),
});
const mlRegressionSchema = z.object({
  features: featureMatrixSchema,
  target: z.array(z.number()).min(20).max(200000),
  modelType: z.enum(["random_forest", "gradient_boosting", "linear"]).default("random_forest"),
  testSizeFraction: z.number().gt(0.05).lt(0.5).default(0.25),
  featureNames: z.array(z.string()).optional(),
});
const mlClusteringSchema = z.object({
  features: featureMatrixSchema,
  nClusters: z.number().int().min(2).max(20).default(3),
});
const anomalyDetectionSchema = z.object({
  features: featureMatrixSchema,
  contamination: z.number().gt(0).lte(0.5).default(0.05),
});

const ML_CLUSTER_ROUTES = [
  { path: "classification", schema: classificationSchema },
  { path: "regression", schema: mlRegressionSchema },
  { path: "clustering", schema: mlClusteringSchema },
  { path: "anomaly-detection", schema: anomalyDetectionSchema },
] as const;

// ─── Supply Chain domain (LIMURIA_ENGINES port plan Phase 8, see python-service/supply_chain.py) ───
const tspSchema = z.object({
  locationNames: z.array(z.string()).min(3).max(200),
  distanceMatrix: z.array(z.array(z.number())).min(3).max(200),
  maxIterations: z.number().int().min(10).max(5000).default(500),
});
const safetyStockSchema = z.object({
  serviceLevelPct: z.number().gt(50).lt(100).default(95.0),
  dailyDemandStdDev: z.number().positive(),
  echelonLeadTimesDays: z.array(z.number().positive()).min(1).max(10),
  echelonNames: z.array(z.string()).optional(),
});
const bullwhipSchema = z.object({
  retailDemandHistory: z.array(z.number()).min(10).max(10000),
  supplierOrdersHistory: z.array(z.number()).min(10).max(10000),
});
const networkEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  weight: z.number().positive(),
});
const networkAnalysisSchema = z.object({
  nodes: z.array(z.string()).min(2).max(1000),
  edges: z.array(networkEdgeSchema).min(1).max(10000),
  sourceNode: z.string().optional(),
  sinkNode: z.string().optional(),
});
const resilienceSchema = z.object({
  supplierNodesCount: z.number().int().positive(),
  singleSourceNodesCount: z.number().int().min(0),
  bufferInventoryDays: z.number().min(0),
});

const SUPPLY_CHAIN_ROUTES = [
  { path: "route-optimization", schema: tspSchema },
  { path: "safety-stock", schema: safetyStockSchema },
  { path: "bullwhip", schema: bullwhipSchema },
  { path: "network-analysis", schema: networkAnalysisSchema },
  { path: "resilience", schema: resilienceSchema },
] as const;

// ─── Environment & Sustainability domain (LIMURIA_ENGINES port plan Phase 9, see python-service/environment.py) ───
const climateTransitionRiskSchema = z.object({
  scope1EmissionsTons: z.number().min(0),
  scope2EmissionsTons: z.number().min(0),
  scope3EmissionsTons: z.number().min(0),
  ebitdaUsd: z.number().positive(),
  carbonPricePerTon: z.number().positive().default(100.0),
});
const carbonCreditMrvSchema = z.object({
  grossOffsetTons: z.number().positive(),
  permanenceRiskPct: z.number().min(0).lt(100).default(10.0),
  additionalityScore: z.number().min(0).max(1),
  marketPricePerTon: z.number().positive(),
});

const ENVIRONMENT_ROUTES = [
  { path: "climate-transition-risk", schema: climateTransitionRiskSchema },
  { path: "carbon-credit-mrv", schema: carbonCreditMrvSchema },
] as const;

// ─── Optimization engine (LIMURIA_ENGINES port plan, see python-service/optimization_engine.py) ───
// Real genetic algorithm / NSGA-II multi-objective search / stochastic
// gradient descent / Sobol sensitivity analysis, replacing four LIMURIA_ENGINES
// source functions that were literal stubs (hardcoded return values,
// ignored every input). See that file's module docstring for detail.
const boundsSchema = z.array(z.tuple([z.number(), z.number()])).min(1);

const geneticAlgorithmSchema = z.object({
  expression: z.string().min(1),
  bounds: boundsSchema,
  popSize: z.number().int().min(5).max(500).default(50),
  nGenerations: z.number().int().min(1).max(2000).default(100),
  seed: z.number().int().min(0).max(2147483647).default(42),
});

const stochasticOptimizationSchema = z.object({
  expression: z.string().min(1),
  x0: z.array(z.number()).min(1),
  nIter: z.number().int().min(1).max(20000).default(200),
  stepSize: z.number().positive().default(0.01),
  seed: z.number().int().min(0).max(2147483647).default(42),
});

const multiObjectiveSchema = z.object({
  expressions: z.array(z.string().min(1)).min(2),
  bounds: boundsSchema,
  popSize: z.number().int().min(10).max(500).default(60),
  nGenerations: z.number().int().min(1).max(2000).default(100),
  seed: z.number().int().min(0).max(2147483647).default(42),
});

const sensitivityAnalysisSchema = z.object({
  expression: z.string().min(1),
  paramNames: z.array(z.string().min(1)).min(1),
  paramRanges: z.array(z.tuple([z.number(), z.number()])).min(1),
  nSamples: z.number().int().min(64).max(8192).default(512),
  seed: z.number().int().min(0).max(2147483647).default(42),
});

const OPTIMIZATION_ROUTES = [
  { path: "genetic-algorithm", schema: geneticAlgorithmSchema },
  { path: "stochastic", schema: stochasticOptimizationSchema },
  { path: "multi-objective", schema: multiObjectiveSchema },
  { path: "sensitivity-analysis", schema: sensitivityAnalysisSchema },
] as const;

export function registerQuantRoutes(app: Express): void {
  app.post("/api/quant/risk/manual-original", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const { terminalArtifact, ...parameters } = req.body ?? {};
    const parsed = originalManualRiskRequestSchema.safeParse(parameters);
    if (!parsed.success) { res.status(400).json({ error: "Invalid original manual risk inputs.", issues: parsed.error.issues }); return; }
    try {
      const ctx = tenantContext(req.user!);
      const target = terminalArtifact === undefined ? null : terminalExecutionTargetSchema.parse(terminalArtifact);
      if (target) await validateTerminalExecutionTarget(ctx, target, new AbortController().signal);
      const execution = executeOriginalManualRisk(parsed.data, ctx.userId);
      if (!target) { res.json(execution.response); return; }
      const saved = await createTerminalArtifactEngineVersion(ctx, target, execution);
      res.json({ ...execution.response, terminalArtifact: { artifactId: saved.artifactId, baseVersion: target.baseVersion, version: saved.version, contentHash: saved.contentHash } });
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Original manual risk result was not retained." }); }
  });
  app.post("/api/quant/statistics/resampling", requireRole("internal_admin", "internal_analyst"), async (req, res) => {
    const { terminalArtifact, ...parameters } = req.body ?? {};
    const parsed = originalResamplingRequestSchema.safeParse(parameters);
    if (!parsed.success) { res.status(400).json({ error: "Invalid original resampling inputs.", issues: parsed.error.issues }); return; }
    try {
      const ctx = tenantContext(req.user!);
      const target = terminalArtifact === undefined ? null : terminalExecutionTargetSchema.parse(terminalArtifact);
      if (target) await validateTerminalExecutionTarget(ctx, target, new AbortController().signal);
      const execution = executeOriginalResampling(parsed.data, ctx.userId);
      if (!target) { res.json(execution.response); return; }
      const saved = await createTerminalArtifactEngineVersion(ctx, target, execution);
      res.json({ ...execution.response, terminalArtifact: { artifactId: saved.artifactId, baseVersion: target.baseVersion, version: saved.version, contentHash: saved.contentHash } });
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Original resampling result was not retained." }); }
  });
  app.get("/api/quant/registry", requireRole("internal_admin", "internal_analyst", "internal_compliance"), (req, res) => {
    const query = z.object({
      category: z.string().optional(),
      status: z.enum(["validated", "implemented", "experimental", "synthetic", "planned"]).optional(),
      program: z.enum(["quant_acceleration", "financial_modelling", "shared_foundation"]).optional(),
      search: z.string().trim().max(100).optional(),
    }).safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.issues[0]?.message ?? "Invalid registry filter." });
      return;
    }
    const search = query.data.search?.toLowerCase();
    const models = QUANT_MODEL_REGISTRY.filter((model) => (
      (!query.data.category || model.category === query.data.category)
      && (!query.data.status || model.status === query.data.status)
      && (!query.data.program || model.program === query.data.program)
      && (!search || [model.label, model.category, ...model.components].some((value) => value.toLowerCase().includes(search)))
    ));
    res.json({ models, summary: summarizeQuantRegistry(models), registryVersion: "1.0.0" });
  });

  app.get("/api/quant/registry/summary", requireRole("internal_admin", "internal_analyst", "internal_compliance"), (_req, res) => {
    res.json({ ...summarizeQuantRegistry(), registryVersion: "1.0.0" });
  });

  app.post("/api/quant/consensus-note", async (req, res) => {
    const parsed = consensusRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    try {
      const note = await getConsensusNote(parsed.data.question, parsed.data.methods);
      res.json({ note });
    } catch (err) {
      console.error("Model Consensus note generation failed:", err);
      res.status(502).json({ error: "AI note unavailable right now." });
    }
  });

  // "Challenge My Assumptions" (Consultant Copilot, reframed) -- same
  // internal-only reasoning as consensus-note above: an unmetered
  // per-request AI call with no credit metering.
  app.post("/api/quant/challenge-assumption", async (req, res) => {
    const parsed = challengeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    try {
      const note = await getAssumptionChallenge(parsed.data.assumptionLabel, parsed.data.assumptionValue, parsed.data.results);
      res.json({ note });
    } catch (err) {
      console.error("Challenge My Assumptions generation failed:", err);
      res.status(502).json({ error: "AI critique unavailable right now." });
    }
  });

  // First real port from LIMURIA_ENGINES's reference library into the
  // Python sidecar (see server/pythonService.ts) -- real QuantLib bond
  // pricing/duration/convexity instead of a hand-reimplemented TS
  // approximation. Zero AI, deterministic compute only.
  app.post("/api/quant/fixed-income/bond-price", async (req, res) => {
    const parsed = bondPriceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    try {
      if (req.body.terminalArtifact !== undefined) {
        res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, "/fixed-income/bond-price", "/api/quant/fixed-income/bond-price", parsed.data)); return;
      }
      const result = await callPythonService("/fixed-income/bond-price", parsed.data);
      res.json(result);
    } catch (err) {
      if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
      console.error("Bond pricing (Python sidecar) failed:", err);
      res.status(502).json({ error: "Bond pricing engine unavailable right now." });
    }
  });

  // Second Python-sidecar engine: real scipy.optimize constrained portfolio
  // construction (SLSQP for the mean-variance family, linprog for
  // Mean-CVaR) -- see python-service/portfolio_optimization.py for the
  // Rockafellar-Uryasev formulation used for Mean-CVaR, which the
  // LIMURIA_ENGINES source had as a literal mock. Zero AI, deterministic
  // compute only, same reasoning as fixed-income above for why these are
  // public-data-gated rather than internal-only (see routes.ts).
  for (const { path, schema } of PORTFOLIO_ROUTES) {
    app.post(`/api/quant/portfolio/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/portfolio/${path}`, `/api/quant/portfolio/${path}`, parsed.data)); return;
        }
        const result = await callPythonService(`/portfolio/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        console.error(`Portfolio optimization (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Portfolio optimizer unavailable right now." });
      }
    });
  }

  // Third Python-sidecar engine: Monte Carlo credit VaR (single-factor
  // Gaussian copula default simulation) and operational risk LDA (Poisson
  // frequency x lognormal severity) -- both need correlated/compound random
  // sampling, genuinely easier to get right with numpy than a hand-rolled
  // TS Cholesky + Box-Muller implementation. Zero AI, deterministic
  // (seeded) simulation only.
  app.post("/api/quant/credit/credit-var", async (req, res) => {
    const parsed = creditVarSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    try {
      if (req.body.terminalArtifact !== undefined) {
        res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, "/credit/credit-var", "/api/quant/credit/credit-var", parsed.data)); return;
      }
      const result = await callPythonService("/credit/credit-var", parsed.data);
      res.json(result);
    } catch (err) {
      if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
      console.error("Credit VaR (Python sidecar) failed:", err);
      res.status(502).json({ error: "Credit risk engine unavailable right now." });
    }
  });

  app.post("/api/quant/credit/operational-risk-lda", async (req, res) => {
    const parsed = operationalRiskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    try {
      if (req.body.terminalArtifact !== undefined) {
        res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, "/credit/operational-risk-lda", "/api/quant/credit/operational-risk-lda", parsed.data)); return;
      }
      const result = await callPythonService("/credit/operational-risk-lda", parsed.data);
      res.json(result);
    } catch (err) {
      if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
      console.error("Operational risk LDA (Python sidecar) failed:", err);
      res.status(502).json({ error: "Operational risk engine unavailable right now." });
    }
  });

  // Fourth Python-sidecar engine: statistics & econometrics foundation
  // (normality/hypothesis/correlation tests, full OLS/GLS/Logit/Probit
  // diagnostics) -- real scipy.stats/statsmodels, genuinely hard to
  // reproduce correctly by hand (Shapiro-Wilk's distribution, exact
  // Mann-Whitney/Wilcoxon critical values, proper regression standard
  // errors). Zero AI, deterministic compute only.
  for (const { path, schema } of STATS_ROUTES) {
    app.post(`/api/quant/stats/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/stats/${path}`, `/api/quant/stats/${path}`, parsed.data)); return;
        }
        const result = await callPythonService(`/stats/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          // A real, useful reason (e.g. "Singular matrix" on separated/
          // degenerate input) -- surface it rather than a blanket
          // "unavailable", which would wrongly suggest an infra problem.
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`Statistics (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Statistics engine unavailable right now." });
      }
    });
  }

  // Fifth Python-sidecar engine: econometrics (panel data, instrumental
  // variables, VAR/VECM, cointegration, unit root tests) via real
  // statsmodels/linearmodels -- Phase 2b of the LIMURIA_ENGINES port plan.
  // Zero AI, deterministic compute only.
  for (const { path, schema } of ECONOMETRICS_ROUTES) {
    app.post(`/api/quant/econometrics/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/econometrics/${path}`, `/api/quant/econometrics/${path}`, parsed.data)); return;
        }
        const result = await callPythonService(`/econometrics/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`Econometrics (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Econometrics engine unavailable right now." });
      }
    });
  }

  // Sixth Python-sidecar engine: SABR volatility-smile calibration and
  // Heston stochastic-volatility calibration/pricing (QuantLib), Phase 3 of
  // the LIMURIA_ENGINES port plan. Zero AI, deterministic compute only.
  for (const { path, schema } of OPTIONS_VOL_ROUTES) {
    app.post(`/api/quant/options/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/options/${path}`, `/api/quant/options/${path}`, parsed.data)); return;
        }
        const result = await callPythonService(`/options/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`Options volatility (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Options volatility engine unavailable right now." });
      }
    });
  }

  // Seventh Python-sidecar engine: forecasting upgrade -- real SARIMAX
  // (seasonal + exogenous regressors), STL trend/seasonal decomposition,
  // real changepoint detection (bootstrap CUSUM or PELT), and GARCH/EGARCH
  // via the `arch` package as a benchmark alongside the existing hand-rolled
  // TS GARCH. Phase 4 of the LIMURIA_ENGINES port plan. Zero AI,
  // deterministic compute only.
  for (const { path, schema } of FORECASTING_ROUTES) {
    app.post(`/api/quant/forecasting/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/forecasting/${path}`, `/api/quant/forecasting/${path}`, parsed.data)); return;
        }
        const result = await callPythonService(`/forecasting/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`Forecasting (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Forecasting engine unavailable right now." });
      }
    });
  }

  // Eighth Python-sidecar engine: Economics & Policy cluster -- Leontief
  // input-output inverse, Taylor Rule, Phillips Curve regression, Gini
  // coefficient + Lorenz curve, income tax bracket micro-simulation, carbon
  // tax & dividend distributional analysis. Phase 5 of the LIMURIA_ENGINES
  // port plan, directly serving the live Economics & Public Policy domain.
  // Zero AI, deterministic compute only.
  for (const { path, schema } of ECONOMICS_POLICY_ROUTES) {
    app.post(`/api/quant/economics/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/economics/${path}`, `/api/quant/economics/${path}`, parsed.data)); return;
        }
        const result = await callPythonService(`/economics/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`Economics & Policy (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Economics & Policy engine unavailable right now." });
      }
    });
  }

  // Ninth Python-sidecar engine: Machine Learning cluster -- real train/
  // test-split classification and regression (Random Forest, Gradient
  // Boosting, linear baseline), KMeans clustering with a real silhouette
  // score, IsolationForest anomaly detection. Phase 7 of the LIMURIA_ENGINES
  // port plan. Zero AI, deterministic compute only.
  for (const { path, schema } of ML_CLUSTER_ROUTES) {
    app.post(`/api/quant/ml/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/ml/${path}`, `/api/quant/ml/${path}`, parsed.data)); return;
        }
        const result = await callPythonService(`/ml/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`ML cluster (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "ML engine unavailable right now." });
      }
    });
  }

  // Tenth Python-sidecar engine: Supply Chain domain -- real 2-Opt TSP/VRP
  // route optimization, Clark-Scarf multi-echelon safety stock, Bullwhip
  // Effect index, network analysis (max-flow/critical path/centrality),
  // and a heuristic resilience index. Phase 8 of the LIMURIA_ENGINES port
  // plan. Zero AI, deterministic compute only.
  for (const { path, schema } of SUPPLY_CHAIN_ROUTES) {
    app.post(`/api/quant/supplychain/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body?.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/supplychain/${path}`, `/api/quant/supplychain/${path}`, parsed.data));
          return;
        }
        const result = await callPythonService(`/supplychain/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`Supply Chain (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Supply Chain engine unavailable right now." });
      }
    });
  }

  // Eleventh Python-sidecar engine: Environment & Sustainability domain --
  // real NGFS-style carbon transition risk exposure and carbon credit MRV
  // (Measurement, Reporting, Verification) valuation. Phase 9 of the
  // LIMURIA_ENGINES port plan. Zero AI, deterministic compute only.
  for (const { path, schema } of ENVIRONMENT_ROUTES) {
    app.post(`/api/quant/environment/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body?.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/environment/${path}`, `/api/quant/environment/${path}`, parsed.data));
          return;
        }
        const result = await callPythonService(`/environment/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`Environment (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Environment engine unavailable right now." });
      }
    });
  }

  // Twelfth Python-sidecar engine: general-purpose optimization -- real
  // genetic algorithm, stochastic gradient descent, NSGA-II multi-objective
  // Pareto search, and Sobol sensitivity analysis. Closes out the last four
  // stubbed functions from the LIMURIA_ENGINES source port.
  for (const { path, schema } of OPTIMIZATION_ROUTES) {
    app.post(`/api/quant/optimization/${path}`, async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      try {
        if (req.body.terminalArtifact !== undefined) {
          res.json(await executeOriginalTerminalQuant(tenantContext(req.user!), req.body.terminalArtifact, `/optimization/${path}`, `/api/quant/optimization/${path}`, parsed.data)); return;
        }
        const result = await callPythonService(`/optimization/${path}`, parsed.data);
        res.json(result);
      } catch (err) {
        if (err instanceof TerminalQuantTargetError) { res.status(err.status).json({ error: err.message }); return; }
        if (err instanceof PythonServiceDataError) {
          res.status(400).json({ error: err.detail });
          return;
        }
        console.error(`Optimization (${path}, Python sidecar) failed:`, err);
        res.status(502).json({ error: "Optimization engine unavailable right now." });
      }
    });
  }

  // Real industry beta/cost-of-capital reference data (Damodaran, NYU
  // Stern) -- gives the WACC/DCF panels a sourced default instead of
  // requiring the user to already know a reasonable industry beta. See
  // damodaranData.ts for the source and caching detail.
  app.get("/api/quant/damodaran/industries", async (_req, res) => {
    try {
      const benchmarks = await getDamodaranIndustryBenchmarks();
      res.json(benchmarks);
    } catch (err) {
      console.error("Damodaran industry benchmarks fetch failed:", err);
      res.status(502).json({ error: "Industry benchmark data unavailable right now." });
    }
  });

  app.get("/api/quant/damodaran/industries/:industry", async (req, res) => {
    try {
      const benchmark = await getDamodaranIndustryBenchmark(req.params.industry);
      if (!benchmark) {
        res.status(404).json({ error: "No matching industry found." });
        return;
      }
      res.json(benchmark);
    } catch (err) {
      console.error("Damodaran industry benchmark fetch failed:", err);
      res.status(502).json({ error: "Industry benchmark data unavailable right now." });
    }
  });
}
