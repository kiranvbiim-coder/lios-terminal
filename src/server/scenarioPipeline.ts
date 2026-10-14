import { createHash } from "node:crypto";
import { z } from "zod";
import {
  runIntegratedFinancialModel,
  type IntegratedFinancialModelResult,
  type IntegratedModelAssumptions,
} from "@shared/integratedFinancialModel";
import type { PointInTimeDatasetSnapshot } from "@shared/pointInTimeData";
import {
  decomposeFactorRiskSnapshot,
  getFactorRiskSnapshot,
  type FactorRiskDecomposeResult,
  type FactorRiskSnapshot,
} from "./factorRiskModel";
import {
  calculateScenarioActionCandidates,
  type ScenarioActionAlternative,
  type ScenarioActionConstraints,
  type ScenarioActionInput,
  type ScenarioActionResult,
  type ScenarioActionType,
  type ScenarioAssetImpact,
  type ScenarioSource,
} from "./scenarioActionEngine";
import { getDatasetSnapshot } from "./pointInTimeDatasetStore";

const finite = z.number().finite();
const boundedMap = z.record(z.string().trim().min(1).max(160), finite).superRefine((value, ctx) => {
  if (Object.keys(value).length > 200) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "maps may contain at most 200 entries" });
});
const assumptionsSchema = z.object({
  projectionYears: z.number().int().min(1).max(10), revenueGrowth: z.number().finite().min(-0.9).max(5),
  usePriceVolumeDrivers: z.boolean(), priceGrowth: z.number().finite().min(-0.9).max(5), volumeGrowth: z.number().finite().min(-0.9).max(5),
  cogsPercentRevenue: z.number().finite().min(0).max(2), sgaPercentRevenue: z.number().finite().min(0).max(2), taxRate: z.number().finite().min(0).max(0.8),
  openingNol: z.number().finite().nonnegative(), nolUtilizationLimit: z.number().finite().min(0).max(1),
  dso: z.number().finite().min(0).max(730), dio: z.number().finite().min(0).max(730), dpo: z.number().finite().min(0).max(730),
  capexPercentRevenue: z.number().finite().min(0).max(2), depreciationPercentRevenue: z.number().finite().min(0).max(2), interestRate: z.number().finite().min(0).max(2),
  minimumCashPercentRevenue: z.number().finite().min(0).max(2), dividendPayout: z.number().finite().min(0).max(1),
  leaseAdditionsPercentRevenue: z.number().finite().min(0).max(2), leaseAssetAmortizationRate: z.number().finite().min(0).max(1), leaseInterestRate: z.number().finite().min(0).max(2), leasePrincipalRepaymentRate: z.number().finite().min(0).max(1),
  stockCompPercentRevenue: z.number().finite().min(0).max(2), stockCompDilutionPercent: z.number().finite().min(0).max(1), buybackPercentRevenue: z.number().finite().min(0).max(2),
  sharePrice: z.number().finite().positive(), sharePriceGrowth: z.number().finite().min(-0.9).max(5),
  circularMaxIterations: z.number().int().min(10).max(500), circularTolerance: z.number().finite().positive(),
}).partial().strict();
const alternativeSchema = z.object({
  type: z.enum(["hold", "reduce", "increase", "hedge", "defer"]), label: z.string().trim().min(1).max(160).optional(), assetId: z.string().trim().min(1).max(160).optional(),
  targetWeight: finite.optional(), weightDelta: finite.optional(), cost: finite.optional(), hedgeRatio: finite.optional(),
}).strict();
const sourceSchema = z.object({ status: z.enum(["manual", "source", "provider", "private"]).optional(), source: z.string().trim().max(500).optional(), provider: z.string().trim().max(200).optional(), asOf: z.string().trim().max(100).optional(), period: z.string().trim().max(100).optional(), unit: z.string().trim().max(100).optional() }).strict();
const constraintsSchema = z.object({ maxWeight: z.union([finite, boundedMap]).optional(), minLiquidity: finite.optional(), maxTurnover: finite.optional(), riskBudget: finite.optional() }).strict();
const valuationSchema = z.object({ discountRate: finite, terminalGrowth: finite, netDebt: finite, sharesOutstanding: finite.positive() }).strict().superRefine((value, ctx) => {
  if (value.discountRate <= value.terminalGrowth) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountRate"], message: "discountRate must exceed terminalGrowth" });
});

export const scenarioPipelineRequestSchema = z.object({
  scenarioId: z.string().trim().min(1).max(160), scenarioName: z.string().trim().min(1).max(200),
  financialDatasetSnapshotId: z.string().uuid(), baseAssumptions: assumptionsSchema.optional(), scenarioAssumptions: assumptionsSchema,
  valuation: valuationSchema, factorRiskSnapshotId: z.string().trim().min(1).max(256), portfolioWeights: boundedMap,
  factorShocks: boundedMap, specificShocks: boundedMap.optional(),
  actionAlternatives: z.array(z.union([z.enum(["hold", "reduce", "increase", "hedge", "defer"]), alternativeSchema])).max(50).optional(),
  constraints: constraintsSchema.optional(), costs: boundedMap.optional(), source: sourceSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.scenarioAssumptions).length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarioAssumptions"], message: "scenarioAssumptions must contain at least one override" });
});

export interface ScenarioPipelineRequest {
  scenarioId: string;
  scenarioName: string;
  financialDatasetSnapshotId: string;
  baseAssumptions?: Partial<IntegratedModelAssumptions>;
  scenarioAssumptions: Partial<IntegratedModelAssumptions>;
  valuation: { discountRate: number; terminalGrowth: number; netDebt: number; sharesOutstanding: number };
  factorRiskSnapshotId: string;
  portfolioWeights: Record<string, number>;
  factorShocks: Record<string, number>;
  specificShocks?: Record<string, number>;
  actionAlternatives?: ScenarioActionAlternative[] | ScenarioActionType[];
  constraints?: ScenarioActionConstraints;
  costs?: Record<string, number>;
  source?: ScenarioSource;
}

export interface IntegratedValuation {
  enterpriseValue: number;
  equityValue: number;
  intrinsicValuePerShare: number;
  presentValueOfForecast: number;
  presentValueOfTerminalValue: number;
  terminalValue: number;
}

export class ScenarioPipelineError extends Error {
  constructor(public readonly statusCode: 404 | 422, message: string) { super(message); this.name = "ScenarioPipelineError"; }
}

function numberField(record: Record<string, number>, keys: string[], label: string): number {
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(record, key) && Number.isFinite(record[key])) return record[key];
  throw new ScenarioPipelineError(422, `Integrated forecast is missing ${label}.`);
}

function forecastField(period: IntegratedFinancialModelResult["forecast"][number], keys: string[], label: string): number {
  for (const statement of [period.income, period.cashflow, period.schedules]) {
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(statement, key) && Number.isFinite(statement[key])) return statement[key];
  }
  throw new ScenarioPipelineError(422, `Integrated forecast is missing ${label}.`);
}

/**
 * Values the integrated model's forecast using FCFF. Each forecast year's FCFF
 * is discounted at t=1..n; the terminal value is Gordon growth on the last
 * forecast FCFF. Inputs are deliberately explicit and never inferred.
 */
export function valueIntegratedForecast(result: IntegratedFinancialModelResult, input: { discountRate: number; terminalGrowth: number; netDebt: number; sharesOutstanding: number }): IntegratedValuation {
  if (![input.discountRate, input.terminalGrowth, input.netDebt, input.sharesOutstanding].every(Number.isFinite) || input.sharesOutstanding <= 0 || input.discountRate <= input.terminalGrowth || input.discountRate <= -1) throw new ScenarioPipelineError(422, "Valuation inputs are invalid: require finite values, positive shares, discountRate > terminalGrowth, and discountRate > -1.");
  if (!result.forecast.length || !Number.isFinite(result.assumptions.taxRate)) throw new ScenarioPipelineError(422, "Integrated forecast is empty or has no finite tax rate.");
  const fcff = result.forecast.map((period) => {
    const ebit = numberField(period.income, ["ebit"], "EBIT");
    const taxRate = result.assumptions.taxRate;
    const depreciationAndAmortization = forecastField(period, ["depreciationAndAmortization"], "depreciation and amortization");
    const leaseAssetAmortization = forecastField(period, ["leaseAssetAmortization"], "lease asset amortization");
    const intangibleAmortization = forecastField(period, ["intangibleAmortization"], "intangible amortization");
    const stockCompensation = forecastField(period, ["stockCompensation"], "stock compensation");
    const capitalExpenditure = forecastField(period, ["capitalExpenditure"], "capital expenditure");
    const changeInNetWorkingCapital = forecastField(period, ["changeInNetWorkingCapital"], "change in net working capital");
    return ebit * (1 - taxRate) + depreciationAndAmortization + leaseAssetAmortization + intangibleAmortization + stockCompensation - capitalExpenditure - changeInNetWorkingCapital;
  });
  if (fcff.some((value) => !Number.isFinite(value))) throw new ScenarioPipelineError(422, "Integrated forecast produced a non-finite FCFF.");
  const discount = (year: number) => (1 + input.discountRate) ** year;
  const presentValueOfForecast = fcff.reduce((sum, value, index) => sum + value / discount(index + 1), 0);
  const lastFcff = fcff.at(-1)!;
  const terminalValue = lastFcff * (1 + input.terminalGrowth) / (input.discountRate - input.terminalGrowth);
  const presentValueOfTerminalValue = terminalValue / discount(fcff.length);
  const enterpriseValue = presentValueOfForecast + presentValueOfTerminalValue;
  const equityValue = enterpriseValue - input.netDebt;
  const intrinsicValuePerShare = equityValue / input.sharesOutstanding;
  const outputs = { enterpriseValue, equityValue, intrinsicValuePerShare, presentValueOfForecast, presentValueOfTerminalValue, terminalValue };
  if (Object.values(outputs).some((value) => !Number.isFinite(value) || value < 0)) throw new ScenarioPipelineError(422, "Valuation produced a non-finite or negative output.");
  return outputs;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); }
  return value;
}

export interface ScenarioPipelineTrace {
  schemaVersion: 1;
  scenario: { id: string; name: string; provenance: ScenarioSource; factorScenarioProvenance?: unknown };
  financialDataset: { snapshotId: string; contentHash: string; dataClass: string; payload: PointInTimeDatasetSnapshot["payload"] };
  models: { baseline: IntegratedFinancialModelResult; scenario: IntegratedFinancialModelResult; baselineChecks: IntegratedFinancialModelResult["checks"]; scenarioChecks: IntegratedFinancialModelResult["checks"] };
  valuation: { inputs: ScenarioPipelineRequest["valuation"]; baseline: IntegratedValuation; scenario: IntegratedValuation; delta: number };
  factorRisk: { snapshotId: string; contentHash: string; decomposition: FactorRiskDecomposeResult; derivedAssetImpacts: ScenarioAssetImpact[] };
  action: { input: ScenarioActionInput; result: ScenarioActionResult; coverage: ScenarioActionResult["inputCoverage"] };
  rankedCandidates: ScenarioActionResult["candidates"];
  recommendation: string | null;
  sourceBindings: Record<string, unknown>;
  limitations: string[];
  traceHash: string;
}

export interface ScenarioPipelineReceiptCalculation {
  name: "Scenario-to-action pipeline";
  deterministicRef: string;
  modelVersion: string;
  value: number;
  scenarioPipelineArtifact: ScenarioPipelineTrace;
}

export interface ScenarioPipelineResult { trace: ScenarioPipelineTrace; receiptCalculation: ScenarioPipelineReceiptCalculation; }

export interface ScenarioPipelineDependencies {
  getDatasetSnapshot: (id: string) => Promise<PointInTimeDatasetSnapshot | null>;
  runIntegratedFinancialModel: typeof runIntegratedFinancialModel;
  getFactorRiskSnapshot: (id: string) => Promise<FactorRiskSnapshot | null>;
  decomposeFactorRiskSnapshot: typeof decomposeFactorRiskSnapshot;
  calculateScenarioActionCandidates: typeof calculateScenarioActionCandidates;
}
const defaultDependencies: ScenarioPipelineDependencies = { getDatasetSnapshot, runIntegratedFinancialModel, getFactorRiskSnapshot, decomposeFactorRiskSnapshot, calculateScenarioActionCandidates };

export async function runScenarioPipeline(rawRequest: ScenarioPipelineRequest, injected: Partial<ScenarioPipelineDependencies> = {}): Promise<ScenarioPipelineResult> {
  const parsed = scenarioPipelineRequestSchema.safeParse(rawRequest);
  if (!parsed.success) throw new ScenarioPipelineError(422, parsed.error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; "));
  const request = parsed.data as ScenarioPipelineRequest;
  const deps = { ...defaultDependencies, ...injected };
  const dataset = await deps.getDatasetSnapshot(request.financialDatasetSnapshotId);
  if (!dataset || dataset.dataClass !== "financial_statements") throw new ScenarioPipelineError(404, "Financial dataset snapshot not found.");
  const payload = freeze(structuredClone(dataset.payload));
  let baseline: IntegratedFinancialModelResult;
  let scenario: IntegratedFinancialModelResult;
  try {
    baseline = deps.runIntegratedFinancialModel({ datasetSnapshotId: dataset.id, payload, assumptions: request.baseAssumptions });
    scenario = deps.runIntegratedFinancialModel({ datasetSnapshotId: dataset.id, payload, assumptions: request.scenarioAssumptions });
  } catch (error) { throw new ScenarioPipelineError(422, `Integrated financial model failed: ${error instanceof Error ? error.message : "invalid calculation"}`); }
  if (!baseline.checks.passed || !scenario.checks.passed) throw new ScenarioPipelineError(422, "Integrated financial model checks did not pass for both baseline and scenario.");
  const baselineValuation = valueIntegratedForecast(baseline, request.valuation);
  const scenarioValuation = valueIntegratedForecast(scenario, request.valuation);
  const factorSnapshot = await deps.getFactorRiskSnapshot(request.factorRiskSnapshotId);
  if (!factorSnapshot) throw new ScenarioPipelineError(404, "Factor-risk snapshot not found or expired.");
  let decomposition: FactorRiskDecomposeResult;
  try {
    decomposition = await deps.decomposeFactorRiskSnapshot(request.factorRiskSnapshotId, { portfolioWeights: request.portfolioWeights, scenario: { id: request.scenarioId, label: request.scenarioName, factorShocks: request.factorShocks, specificShocks: request.specificShocks, provenance: request.source as never } });
  } catch (error) { throw new ScenarioPipelineError(422, `Factor-risk decomposition failed: ${error instanceof Error ? error.message : "invalid calculation"}`); }
  const scenarioPnl = decomposition.result.scenario;
  if (!scenarioPnl || scenarioPnl.securities.length !== factorSnapshot.securities.length) throw new ScenarioPipelineError(422, "Factor-risk decomposition did not return complete per-security scenario P&L.");
  const source: ScenarioSource = { ...request.source, status: "provider", source: `factor-risk-snapshot:${factorSnapshot.snapshotId}:${factorSnapshot.contentHash}`, provider: "factorRiskModel", asOf: factorSnapshot.request.asOf, period: factorSnapshot.capturedAt, unit: "return" };
  const derivedAssetImpacts: ScenarioAssetImpact[] = scenarioPnl.securities.map((security) => ({ assetId: security.securityId, scenarioImpact: security.totalPnl, riskImpact: Math.abs(security.totalPnl), ...source }));
  const actionInput: ScenarioActionInput = { assetImpacts: derivedAssetImpacts, currentWeights: { ...request.portfolioWeights }, actionAlternatives: request.actionAlternatives, constraints: request.constraints, costs: request.costs, source };
  const actionResult = deps.calculateScenarioActionCandidates(actionInput);
  const traceWithoutHash = { schemaVersion: 1 as const, scenario: { id: request.scenarioId, name: request.scenarioName, provenance: request.source ?? {}, factorScenarioProvenance: (request.source ?? null) }, financialDataset: { snapshotId: dataset.id, contentHash: dataset.contentHash, dataClass: dataset.dataClass, payload }, models: { baseline, scenario, baselineChecks: baseline.checks, scenarioChecks: scenario.checks }, valuation: { inputs: request.valuation, baseline: baselineValuation, scenario: scenarioValuation, delta: scenarioValuation.intrinsicValuePerShare - baselineValuation.intrinsicValuePerShare }, factorRisk: { snapshotId: factorSnapshot.snapshotId, contentHash: factorSnapshot.contentHash, decomposition, derivedAssetImpacts }, action: { input: actionInput, result: actionResult, coverage: actionResult.inputCoverage }, rankedCandidates: actionResult.candidates, recommendation: actionResult.recommendedAction, sourceBindings: { financialDatasetSnapshot: { id: dataset.id, contentHash: dataset.contentHash, provider: dataset.provider }, factorRiskSnapshot: { id: factorSnapshot.snapshotId, contentHash: factorSnapshot.contentHash, asOf: factorSnapshot.request.asOf }, model: { baseline: baseline.modelVersion, scenario: scenario.modelVersion }, scenario: { id: request.scenarioId, source: request.source ?? null } }, limitations: ["Static assumptions are applied to the full forecast; no point-in-time estimate history is inferred.", "Valuation uses explicit scenario discount/growth/net debt/share inputs; those remain source-bound only when caller supplies authoritative snapshot-bound values.", "Factor P&L uses provider factor snapshot's estimated exposures/covariance and supplied factor shocks; no action is executed.", "Existing decision approval/monitor routes govern the returned receiptCalculation after attachment; preview itself is not an approval."] };
  const traceHash = hash(traceWithoutHash);
  const trace = freeze({ ...traceWithoutHash, traceHash }) as ScenarioPipelineTrace;
  const receiptCalculation: ScenarioPipelineReceiptCalculation = { name: "Scenario-to-action pipeline", deterministicRef: `scenario-pipeline:${traceHash}`, modelVersion: "scenario-pipeline-v1", value: trace.valuation.delta, scenarioPipelineArtifact: trace };
  return freeze({ trace, receiptCalculation });
}

export const runScenarioToActionPipeline = runScenarioPipeline;
