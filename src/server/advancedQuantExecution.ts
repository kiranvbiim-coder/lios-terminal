import crypto from "crypto";
import { z } from "zod";
import {
  advancedQuantRunReceiptSchema,
  resolveAdvancedQuantInputProvenance,
  type AdvancedQuantRunReceipt,
  type QuantModelRegistryEntry,
  type ResolvedAdvancedQuantInputProvenance,
} from "@shared/quantModelRegistry";
import { callPythonService } from "./pythonService";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";
import { QUANT_MODEL_REGISTRY } from "./quantModelRegistry";
import { runModelTournament, stressThesis, findDecisionBoundary, calculateReverseDcf } from "./decisionEngine";

export const ADVANCED_QUANT_PATHS = [
  "fixed-income/bootstrap-par-curve", "fixed-income/spread-analytics", "fixed-income/key-rate-risk", "fixed-income/immunize-duration",
  "fixed-income/callable-oas", "fixed-income/floating-rate-note", "fixed-income/inflation-linked-bond", "fixed-income/credit-spread-curve",
  "derivatives/black-scholes-greeks", "derivatives/implied-volatility", "derivatives/surface-arbitrage", "derivatives/exotic-monte-carlo", "derivatives/interest-rate-swap", "derivatives/black-swaption",
  "derivatives/local-volatility", "derivatives/portfolio-greeks", "derivatives/futures-basis", "derivatives/strategy-payoff",
  "portfolio/hrp", "portfolio/risk-budget", "portfolio/factor-risk", "portfolio/tracking-error", "portfolio/tax-aware-rebalance", "portfolio/stress-aware", "portfolio/regime-blend",
  "portfolio/black-litterman", "portfolio/bayesian-mean-shrinkage", "portfolio/ledoit-wolf-covariance",
  "valuation/probabilistic-dcf", "valuation/dcf-sensitivity", "valuation/reverse-dcf", "valuation/residual-income", "valuation/eva", "valuation/sotp", "valuation/merger-accretion",
  "valuation/real-option", "valuation/expectation-surface", "valuation/project-finance", "valuation/saas-cohort", "valuation/insurance-embedded-value",
  "credit/merton", "credit/rating-migration", "credit/creditmetrics", "credit/stress-pd", "credit/covenant-headroom",
  "econometrics/weak-instruments", "econometrics/event-study", "econometrics/synthetic-control", "econometrics/propensity-match", "econometrics/local-projections", "econometrics/bayesian-var",
  "forecasting/model-tournament", "forecasting/probabilistic-ar1", "forecasting/reconcile-hierarchy", "forecasting/nowcast", "forecasting/regime-conditioned",
  "risk/tail-report", "risk/liquidity-var", "risk/reverse-stress", "risk/correlation-breakdown",
  "supply-chain/facility-location", "supply-chain/stochastic-inventory", "supply-chain/supplier-portfolio", "supply-chain/disruption-simulation", "supply-chain/resilience-frontier",
  "climate/financed-emissions", "climate/climate-var", "climate/abatement-curve", "climate/transition-pathway",
  "macro/yield-curve-signals", "macro/financial-conditions-index", "macro/recession-probability", "macro/inflation-decomposition", "macro/company-transmission", "macro/fiscal-multiplier",
  "research/evidence-graph", "research/filing-diff", "research/consensus-divergence", "research/catalyst-monitor",
  "financial-modeling/three-statement",
  "decision/model-tournament", "decision/scenario-graph", "decision/uncertainty", "decision/value-of-information", "decision/mcda",
] as const;

export type AdvancedQuantPath = (typeof ADVANCED_QUANT_PATHS)[number];
const ADVANCED_QUANT_PATH_SET = new Set<string>(ADVANCED_QUANT_PATHS);
const bodySchema = z.record(z.unknown());

export type AdvancedQuantEngineCall = (
  routePath: string,
  body: unknown,
  options?: {
    signal?: AbortSignal;
    isolationMode?: "legacy-host" | "strict";
  },
) => Promise<unknown>;

export type AdvancedQuantExecution = {
  result: unknown;
  receipt: AdvancedQuantRunReceipt;
  response: ReturnType<typeof advancedQuantRunResponse>;
  headers: Record<string, string>;
};

const nativeExecutionOwners = new WeakMap<AdvancedQuantExecution, number>();
/** Only the real server runner can bind a completed native calculation to its current actor. */
export function isOwnedNativeAdvancedExecution(execution: AdvancedQuantExecution, userId: number): boolean {
  return nativeExecutionOwners.get(execution) === userId;
}

export class AdvancedQuantInputError extends Error {
  constructor(
    public readonly code: "invalid_body" | "invalid_provenance",
    message: string,
    public readonly issues: unknown[] = [],
  ) {
    super(message);
    this.name = "AdvancedQuantInputError";
  }
}

export function isAdvancedQuantPath(value: string): value is AdvancedQuantPath {
  return ADVANCED_QUANT_PATH_SET.has(value);
}

export function parseAdvancedQuantRunRequest(body: Record<string, unknown>) {
  const { inputProvenance, ...parameters } = body;
  const resolved = resolveAdvancedQuantInputProvenance(parameters, inputProvenance);
  if (!resolved.success) return resolved;
  return { success: true as const, data: { parameters, inputProvenance: resolved.data } };
}

export function advancedQuantReceiptHeaders(receipt: AdvancedQuantRunReceipt): Record<string, string> {
  return {
    "X-LIOS-Model-Path": receipt.modelPath,
    "X-LIOS-Model-Id": receipt.modelId,
    "X-LIOS-Model-Version": receipt.modelVersion,
    "X-LIOS-Validation-Level": receipt.validationLevel,
    "X-LIOS-Input-Hash": receipt.inputSnapshotHash,
    "X-LIOS-Output-Hash": receipt.outputSnapshotHash,
    "X-LIOS-Data-Classification": receipt.dataClassification,
  };
}

export function advancedQuantRunResponse(result: unknown, receipt: AdvancedQuantRunReceipt) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), receipt };
  }
  return { result, receipt };
}

export function buildAdvancedQuantRunReceipt(input: {
  path: string;
  registryEntry?: QuantModelRegistryEntry;
  parameters: Record<string, unknown>;
  inputProvenance: ResolvedAdvancedQuantInputProvenance;
  result: unknown;
  runId?: string;
  calculatedAt?: string;
}): AdvancedQuantRunReceipt {
  const modelId = input.registryEntry?.id ?? `python.advanced.${input.path.replaceAll("/", ".")}`;
  const modelVersion = input.registryEntry?.version ?? "unknown";
  const sourceBindings = input.inputProvenance.sourceBindings ?? [];
  const sourceAsOf = [...new Set(sourceBindings.map((binding) => binding.asOf))];
  const inputSnapshotHash = stableSnapshotHash({
    modelId,
    modelVersion,
    parameters: input.parameters,
    inputProvenance: input.inputProvenance,
  });
  return advancedQuantRunReceiptSchema.parse({
    modelPath: input.path,
    modelId,
    modelVersion,
    validationLevel: input.registryEntry?.validationLevel ?? "benchmark_required",
    runId: input.runId ?? `aqr_${crypto.randomUUID()}`,
    inputSnapshotHash,
    outputSnapshotHash: stableSnapshotHash(input.result),
    datasetSnapshotIds: [...new Set(sourceBindings.map((binding) => binding.snapshot.id))],
    effectiveAt: sourceAsOf.length === 1 ? sourceAsOf[0] : null,
    calculatedAt: input.calculatedAt ?? new Date().toISOString(),
    seed: typeof input.parameters.seed === "number" && Number.isInteger(input.parameters.seed) ? input.parameters.seed : null,
    parameters: input.parameters,
    diagnostics: {
      provenanceDeclaration: input.inputProvenance.declaration,
      sourceBindingCount: sourceBindings.length,
    },
    warnings: input.inputProvenance.declaration === "legacy_default"
      ? ["No inputProvenance was supplied; this run is classified as manual."]
      : [],
    result: input.result,
    dataClassification: input.inputProvenance.dataClassification,
    inputProvenance: input.inputProvenance,
    sourceBindings,
    transformations: input.inputProvenance.transformations,
    auditEventType: "advanced_quant_run",
  });
}

export function advancedQuantCatalog() {
  const grouped: Record<string, string[]> = {};
  for (const path of ADVANCED_QUANT_PATHS) {
    const [family, model] = path.split("/");
    (grouped[family] ??= []).push(model);
  }
  return {
    count: ADVANCED_QUANT_PATHS.length,
    families: grouped,
    paths: [...ADVANCED_QUANT_PATHS],
    computeBoundary: "python-pydantic",
    aiCalculates: false,
  };
}

export async function executeAdvancedQuant(
  path: AdvancedQuantPath,
  body: unknown,
  options: {
    signal?: AbortSignal;
    userId?: number;
    isolationMode?: "legacy-host" | "strict";
    callEngine?: AdvancedQuantEngineCall;
    runId?: string;
    calculatedAt?: string;
  } = {},
): Promise<AdvancedQuantExecution> {
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    throw new AdvancedQuantInputError(
      "invalid_body",
      "Advanced quant input must be a JSON object.",
      parsedBody.error.issues,
    );
  }

  const runRequest = parseAdvancedQuantRunRequest(parsedBody.data);
  if (!runRequest.success) {
    throw new AdvancedQuantInputError(
      "invalid_provenance",
      "Invalid advanced quant input provenance.",
      runRequest.error.issues,
    );
  }

  const callEngine: AdvancedQuantEngineCall = options.callEngine ?? callPythonService;
  const result = await callEngine(
    `/advanced/${path}`,
    runRequest.data.parameters,
    {
      signal: options.signal,
      isolationMode: options.isolationMode,
    },
  );
  const registryEntry = QUANT_MODEL_REGISTRY.find((entry) => entry.apiEndpoint === `/api/quant/advanced/${path}`);
  const receipt = buildAdvancedQuantRunReceipt({
    path,
    registryEntry,
    parameters: runRequest.data.parameters,
    inputProvenance: runRequest.data.inputProvenance,
    result,
    runId: options.runId,
    calculatedAt: options.calculatedAt,
  });

  const execution = {
    result,
    receipt,
    response: advancedQuantRunResponse(result, receipt),
    headers: advancedQuantReceiptHeaders(receipt),
  };
  if (options.userId !== undefined && options.callEngine === undefined) nativeExecutionOwners.set(execution, options.userId);
  return execution;
}

/** Existing registered base-model execution, retained only when explicitly requested by its original UI. */
export async function executeRegisteredPythonQuant(route: string, apiEndpoint: string, parameters: Record<string, unknown>, userId: number, signal?: AbortSignal): Promise<AdvancedQuantExecution> {
  const registryEntry = QUANT_MODEL_REGISTRY.find(entry => entry.engine === "python_sidecar" && entry.engineEndpoint === route && entry.apiEndpoint === apiEndpoint && entry.status !== "planned");
  if (!registryEntry) throw new Error("Original numerical route has no executable canonical registry entry.");
  const provenance = resolveAdvancedQuantInputProvenance(parameters, { dataClassification: "manual", manualInputs: parameters });
  if (!provenance.success) throw new AdvancedQuantInputError("invalid_provenance", "Original numerical inputs are invalid.");
  let result = await callPythonService<Record<string, unknown>>(route, parameters, { signal });
  if (route === "/stats/ols-diagnostics" || route === "/stats/gls") {
    const diagnostics: Array<{ key: string; route: string; parameters: Record<string, unknown> }> = [
      { key: "heteroskedasticity", route: "/econometrics/heteroskedasticity", parameters: { residuals: result.residuals, x: parameters.x } },
      { key: "influence", route: "/stats/influence-diagnostics", parameters: { y: parameters.y, x: parameters.x } },
      { key: "reset", route: "/stats/reset-test", parameters: { y: parameters.y, x: parameters.x } },
      { key: "autocorrelation", route: "/stats/autocorrelation-tests", parameters: { y: parameters.y, x: parameters.x, lags: 4 } },
    ];
    if (Array.isArray(parameters.x) && parameters.x.length >= 2) diagnostics.push({ key: "vif", route: "/stats/vif", parameters: { x: parameters.x } });
    const outputs = await Promise.all(diagnostics.map(async diagnostic => {
      try { return [diagnostic.key, await callPythonService(diagnostic.route, diagnostic.parameters, { signal })] as const; }
      catch (error) { if (signal?.aborted) throw error; return [diagnostic.key, { error: error instanceof Error ? error.message : "Original diagnostic unavailable." }] as const; }
    }));
    result = { ...result, diagnostics: Object.fromEntries(outputs) };
  }
  const receipt = buildAdvancedQuantRunReceipt({ path: route, registryEntry, parameters, inputProvenance: provenance.data, result });
  const execution = { result, receipt, response: advancedQuantRunResponse(result, receipt), headers: advancedQuantReceiptHeaders(receipt) };
  nativeExecutionOwners.set(execution, userId);
  return execution;
}

type DecisionAnalysisInput = Parameters<typeof stressThesis>[0] & {
  models: Parameters<typeof runModelTournament>[0];
  boundary?: { points: Parameters<typeof findDecisionBoundary>[0]; threshold: number };
};
function ownedDecisionExecution(modelId: string, parameters: Record<string, unknown>, result: unknown, userId: number): AdvancedQuantExecution {
  const registryEntry = QUANT_MODEL_REGISTRY.find(entry => entry.id === modelId && entry.engine === "typescript");
  if (!registryEntry) throw new Error("Original decision calculation is not registered.");
  const provenance = resolveAdvancedQuantInputProvenance(parameters, { dataClassification: "manual", manualInputs: parameters });
  if (!provenance.success) throw new Error("Original decision inputs are not valid manual parameters.");
  const receipt = buildAdvancedQuantRunReceipt({ path: registryEntry.apiEndpoint!, registryEntry, parameters, inputProvenance: provenance.data, result });
  const execution = { result, receipt, response: advancedQuantRunResponse(result, receipt), headers: advancedQuantReceiptHeaders(receipt) };
  nativeExecutionOwners.set(execution, userId);
  return execution;
}
export async function executeOriginalDecisionAnalysis(input: DecisionAnalysisInput, userId: number): Promise<AdvancedQuantExecution> {
  const result = { tournament: runModelTournament(input.models), thesisStress: stressThesis(input),
    decisionBoundary: input.boundary ? findDecisionBoundary(input.boundary.points, input.boundary.threshold) : null };
  return ownedDecisionExecution("typescript.decision-analysis", { ...input }, result, userId);
}
export async function executeOriginalDecisionReverseDcf(input: Parameters<typeof calculateReverseDcf>[0], userId: number): Promise<AdvancedQuantExecution> {
  return ownedDecisionExecution("typescript.decision-reverse-dcf", { ...input }, calculateReverseDcf(input), userId);
}
