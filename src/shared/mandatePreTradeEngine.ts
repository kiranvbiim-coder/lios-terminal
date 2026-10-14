export type MandatePreTradeSourceMode = "provider" | "manual" | "private";

export interface MandatePreTradeSourceMetadata {
  source: string;
  provider?: string;
  status: string;
  asOf: string;
  period: string;
  unit: string;
  snapshotId?: string;
  sourceReference?: string;
}

export interface MandatePreTradePosition {
  asset: string;
  quantity?: number;
  marketValue?: number;
  price?: number;
  currency?: string;
}

export interface MandatePreTradeLiquidity {
  /** Average daily traded value in the portfolio currency. */
  advValue?: number;
  /** Maximum fraction of ADV that may be traded. */
  maxParticipationRate?: number;
  /** Alternative bound when a portfolio value is not available. */
  maxTradeWeight?: number;
  /** Explicitly records why liquidity evidence is unavailable. */
  missing?: string;
}

export interface MandatePreTradeCost {
  /** Decimal rate, e.g. 0.0015 for 15 bps. */
  rate?: number;
  /** Basis points, used when rate is not supplied. */
  bps?: number;
  byAsset?: Record<string, number>;
  missing?: string;
}

export interface MandatePreTradeRiskBudget {
  current: number;
  proposed: number;
  limit?: number;
}

export interface MandatePreTradeTrackingError {
  benchmarkWeights: Record<string, number>;
  covarianceMatrix?: number[][];
  maxTrackingError?: number;
}

export interface MandatePreTradeInput {
  currentWeights: Record<string, number>;
  targetWeights: Record<string, number>;
  assets?: readonly string[];
  positions?: readonly MandatePreTradePosition[];
  portfolioValue?: number;
  minWeights?: Record<string, number>;
  maxWeights?: Record<string, number>;
  maxTurnover: number;
  liquidity?: Record<string, MandatePreTradeLiquidity>;
  /** Alias accepted for imported mandate JSON. */
  advByAsset?: Record<string, MandatePreTradeLiquidity>;
  transactionCost?: MandatePreTradeCost;
  taxCost?: MandatePreTradeCost;
  /** Aliases accepted for simple imported mandate JSON. */
  transactionCostRate?: number;
  taxCostRate?: number;
  restrictedAssets?: readonly string[];
  riskBudget?: MandatePreTradeRiskBudget;
  riskBudgetCurrent?: number;
  riskBudgetProposed?: number;
  benchmarkWeights?: Record<string, number>;
  trackingError?: MandatePreTradeTrackingError;
  trackingErrorBound?: number;
  sourceMode?: MandatePreTradeSourceMode;
  sourceMetadata: MandatePreTradeSourceMetadata;
}

export type MandatePreTradeViolationCode =
  | "max_weight"
  | "min_weight"
  | "max_turnover"
  | "liquidity"
  | "restricted_asset"
  | "risk_budget"
  | "tracking_error"
  | "invalid_input";

export interface MandatePreTradeViolation {
  code: MandatePreTradeViolationCode;
  asset?: string;
  message: string;
  observed?: number;
  limit?: number;
}

export interface MandatePreTradeTrade {
  id: string;
  asset: string;
  currentWeight: number;
  targetWeight: number;
  deltaWeight: number;
  direction: "buy" | "sell";
  notionalWeight: number;
  quantityDelta: number | null;
}

export interface MandatePreTradeResult {
  proposalId: string;
  inputSnapshotHash: string;
  status: "feasible" | "rejected" | "incomplete";
  feasible: boolean;
  approvalRequired: boolean;
  requiredEvidence: string[];
  violations: MandatePreTradeViolation[];
  liquidityViolations: MandatePreTradeViolation[];
  restrictedAssetViolations: MandatePreTradeViolation[];
  proposedRebalanceTrades: MandatePreTradeTrade[];
  resultingWeights: Record<string, number>;
  turnover: number;
  estimatedTransactionCost: number | null;
  estimatedTaxCost: number | null;
  totalEstimatedCost: number | null;
  riskBudgetDelta: number | null;
  trackingError: number | null;
  provenance: {
    sourceMode: MandatePreTradeSourceMode | "unknown";
    sourceMetadata: MandatePreTradeSourceMetadata | null;
    status: "complete" | "missing_evidence";
    requiredEvidence: string[];
  };
}

const EPSILON = 1e-10;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanNumber(value: number): number {
  return Math.abs(value) < EPSILON ? 0 : Number(value.toFixed(12));
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableValue((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function stableHash(value: unknown): string {
  // FNV-1a over canonical JSON keeps IDs deterministic in browser and server runtimes.
  let hash = 2166136261;
  for (const character of stableValue(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function vectorAssets(input: MandatePreTradeInput): string[] {
  const names = new Set<string>([
    ...(input.assets ?? []),
    ...Object.keys(input.currentWeights ?? {}),
    ...Object.keys(input.targetWeights ?? {}),
    ...Object.keys(input.minWeights ?? {}),
    ...Object.keys(input.maxWeights ?? {}),
    ...(input.positions ?? []).map((position) => position.asset),
  ]);
  return [...names].filter((asset) => asset.trim().length > 0).sort();
}

function covarianceTrackingError(weights: Record<string, number>, benchmark: Record<string, number>, covariance: number[][], assets: string[]): number | null {
  if (covariance.length !== assets.length || covariance.some((row) => row.length !== assets.length || row.some((value) => !finite(value)))) return null;
  const active = assets.map((asset) => weights[asset] - (benchmark[asset] ?? 0));
  let variance = 0;
  for (let i = 0; i < assets.length; i += 1) for (let j = 0; j < assets.length; j += 1) variance += active[i] * covariance[i][j] * active[j];
  return cleanNumber(Math.sqrt(Math.max(0, variance)));
}

function sourceIsValid(metadata: unknown): metadata is MandatePreTradeSourceMetadata {
  if (!metadata || typeof metadata !== "object") return false;
  const value = metadata as Record<string, unknown>;
  return ["source", "status", "asOf", "period", "unit"].every((key) => typeof value[key] === "string" && (value[key] as string).trim().length > 0);
}

function costRate(cost: MandatePreTradeCost | undefined, alias: number | undefined, asset: string): number | null {
  const value = cost?.byAsset?.[asset] ?? cost?.rate ?? (finite(cost?.bps) ? cost!.bps! / 10_000 : alias);
  return finite(value) && value >= 0 ? value : null;
}

/**
 * Evaluates a mandate against an already-selected optimizer target. This is
 * deliberately a proposal calculator: it never submits orders or fills absent
 * prices, ADV, tax, risk, or benchmark evidence.
 */
export function evaluateMandatePreTrade(input: MandatePreTradeInput): MandatePreTradeResult {
  const assets = vectorAssets(input);
  const requiredEvidence: string[] = [];
  const violations: MandatePreTradeViolation[] = [];
  const current = input.currentWeights ?? {};
  const target = input.targetWeights ?? {};
  const sourceMetadata = sourceIsValid(input.sourceMetadata) ? input.sourceMetadata : null;
  const sourceMode = input.sourceMode ?? (sourceMetadata?.status === "provider" ? "provider" : sourceMetadata?.status === "private" ? "private" : sourceMetadata ? "manual" : "unknown");
  if (!sourceMetadata) requiredEvidence.push("sourceMetadata.source/status/asOf/period/unit");
  if (assets.length === 0) requiredEvidence.push("assets or currentWeights/targetWeights");
  if (!finite(input.maxTurnover) || input.maxTurnover < 0) violations.push({ code: "invalid_input", message: "maxTurnover must be a finite non-negative decimal weight." });

  const invalidWeights = assets.filter((asset) => !finite(current[asset]) || !finite(target[asset]));
  if (invalidWeights.length > 0) requiredEvidence.push(`finite current and target weights for: ${invalidWeights.join(", ")}`);
  const currentTotal = assets.reduce((sum, asset) => sum + (finite(current[asset]) ? current[asset] : 0), 0);
  const targetTotal = assets.reduce((sum, asset) => sum + (finite(target[asset]) ? target[asset] : 0), 0);
  if (assets.length > 0 && Math.abs(currentTotal - 1) > 1e-8) violations.push({ code: "invalid_input", message: `Current weights must sum to 1 (observed ${currentTotal}).`, observed: currentTotal, limit: 1 });
  if (assets.length > 0 && Math.abs(targetTotal - 1) > 1e-8) violations.push({ code: "invalid_input", message: `Target weights must sum to 1 (observed ${targetTotal}).`, observed: targetTotal, limit: 1 });

  const resultingWeights: Record<string, number> = {};
  const trades: MandatePreTradeTrade[] = [];
  for (const asset of assets) {
    const currentWeight = finite(current[asset]) ? current[asset] : 0;
    const targetWeight = finite(target[asset]) ? target[asset] : 0;
    const deltaWeight = cleanNumber(targetWeight - currentWeight);
    resultingWeights[asset] = cleanNumber(targetWeight);
    if (Math.abs(deltaWeight) > EPSILON) {
      const position = (input.positions ?? []).find((candidate) => candidate.asset === asset);
      trades.push({
        id: `mandate-trade:${asset}:${deltaWeight >= 0 ? "buy" : "sell"}`,
        asset,
        currentWeight: cleanNumber(currentWeight),
        targetWeight: cleanNumber(targetWeight),
        deltaWeight,
        direction: deltaWeight > 0 ? "buy" : "sell",
        notionalWeight: cleanNumber(Math.abs(deltaWeight)),
        quantityDelta: finite(position?.price) && finite(position?.marketValue) && position!.price !== 0
          ? cleanNumber((deltaWeight * (input.portfolioValue ?? 0)) / position!.price)
          : null,
      });
    }
  }
  const turnover = cleanNumber(trades.reduce((sum, trade) => sum + Math.abs(trade.deltaWeight), 0) / 2);
  if (finite(input.maxTurnover) && turnover > input.maxTurnover + EPSILON) violations.push({ code: "max_turnover", message: `Turnover ${turnover} exceeds mandate maximum ${input.maxTurnover}.`, observed: turnover, limit: input.maxTurnover });

  for (const asset of assets) {
    const weight = resultingWeights[asset] ?? 0;
    const max = input.maxWeights?.[asset];
    const min = input.minWeights?.[asset];
    if (finite(max) && weight > max + EPSILON) violations.push({ code: "max_weight", asset, message: `${asset} target weight ${weight} exceeds maximum ${max}.`, observed: weight, limit: max });
    if (finite(min) && weight < min - EPSILON) violations.push({ code: "min_weight", asset, message: `${asset} target weight ${weight} is below minimum ${min}.`, observed: weight, limit: min });
  }

  const restricted = new Set(input.restrictedAssets ?? []);
  const restrictedAssetViolations = trades.filter((trade) => restricted.has(trade.asset)).map((trade) => ({ code: "restricted_asset" as const, asset: trade.asset, message: `${trade.asset} is restricted and has a proposed ${trade.direction} trade.`, observed: Math.abs(trade.deltaWeight) }));
  violations.push(...restrictedAssetViolations);

  const liquidityViolations: MandatePreTradeViolation[] = [];
  const liquidityByAsset = input.liquidity ?? input.advByAsset ?? {};
  for (const trade of trades) {
    const evidence = liquidityByAsset[trade.asset];
    if (!evidence || evidence.missing) {
      requiredEvidence.push(`liquidity/ADV for ${trade.asset} (or explicit missing reason)`);
      continue;
    }
    if (finite(evidence.maxTradeWeight)) {
      if (trade.notionalWeight > evidence.maxTradeWeight + EPSILON) liquidityViolations.push({ code: "liquidity", asset: trade.asset, message: `${trade.asset} trade weight ${trade.notionalWeight} exceeds liquidity bound ${evidence.maxTradeWeight}.`, observed: trade.notionalWeight, limit: evidence.maxTradeWeight });
      continue;
    }
    if (!finite(evidence.advValue) || evidence.advValue <= 0) {
      requiredEvidence.push(`positive ADV value for ${trade.asset}`);
      continue;
    }
    if (!finite(evidence.maxParticipationRate) || evidence.maxParticipationRate < 0) {
      requiredEvidence.push(`maximum ADV participation rate for ${trade.asset}`);
      continue;
    }
    if (!finite(input.portfolioValue) || input.portfolioValue <= 0) {
      requiredEvidence.push("portfolioValue to convert weight trades to ADV notional");
      continue;
    }
    const participation = trade.notionalWeight * input.portfolioValue / evidence.advValue;
    if (participation > evidence.maxParticipationRate + EPSILON) liquidityViolations.push({ code: "liquidity", asset: trade.asset, message: `${trade.asset} participation ${(participation * 100).toFixed(4)}% exceeds maximum ${(evidence.maxParticipationRate * 100).toFixed(4)}%.`, observed: participation, limit: evidence.maxParticipationRate });
  }
  violations.push(...liquidityViolations);

  const transactionCost = trades.length === 0 ? 0 : trades.reduce((sum, trade) => {
    const rate = costRate(input.transactionCost, input.transactionCostRate, trade.asset);
    if (rate === null) return sum;
    return sum + trade.notionalWeight * rate;
  }, 0);
  if (trades.length > 0 && transactionCost === 0 && !input.transactionCost && !finite(input.transactionCostRate)) requiredEvidence.push("transaction cost rate/bps");
  const taxCost = trades.length === 0 ? 0 : trades.reduce((sum, trade) => {
    const rate = costRate(input.taxCost, input.taxCostRate, trade.asset);
    if (rate === null) return sum;
    return sum + (trade.direction === "sell" ? trade.notionalWeight * rate : 0);
  }, 0);
  if (trades.some((trade) => trade.direction === "sell") && taxCost === 0 && !input.taxCost && !finite(input.taxCostRate)) requiredEvidence.push("tax cost rate/lots (or explicit tax cost missing reason)");

  let riskBudgetDelta: number | null = null;
  const riskBudget = input.riskBudget ?? (finite(input.riskBudgetCurrent) && finite(input.riskBudgetProposed) ? { current: input.riskBudgetCurrent!, proposed: input.riskBudgetProposed! } : undefined);
  if (riskBudget) {
    if (!finite(riskBudget.current) || !finite(riskBudget.proposed)) requiredEvidence.push("finite current and proposed risk budget");
    else {
      riskBudgetDelta = cleanNumber(riskBudget.proposed - riskBudget.current);
      if (finite(riskBudget.limit) && riskBudget.proposed > riskBudget.limit + EPSILON) violations.push({ code: "risk_budget", message: `Proposed risk budget ${riskBudget.proposed} exceeds limit ${riskBudget.limit}.`, observed: riskBudget.proposed, limit: riskBudget.limit });
    }
  }

  const tracking = input.trackingError ?? (input.benchmarkWeights ? { benchmarkWeights: input.benchmarkWeights, maxTrackingError: input.trackingErrorBound } : undefined);
  let trackingError: number | null = null;
  if (tracking) {
    const benchmark = tracking.benchmarkWeights;
    if (!benchmark || !tracking.covarianceMatrix) requiredEvidence.push("benchmark weights and covariance matrix for tracking error");
    else {
      trackingError = covarianceTrackingError(resultingWeights, benchmark, tracking.covarianceMatrix, assets);
      if (trackingError === null) requiredEvidence.push("square finite tracking-error covariance matrix");
      else if (finite(tracking.maxTrackingError) && trackingError > tracking.maxTrackingError + EPSILON) violations.push({ code: "tracking_error", message: `Tracking error ${trackingError} exceeds bound ${tracking.maxTrackingError}.`, observed: trackingError, limit: tracking.maxTrackingError });
    }
  }

  const evidence = [...new Set(requiredEvidence)].sort();
  const status: MandatePreTradeResult["status"] = evidence.length > 0 ? "incomplete" : violations.length > 0 ? "rejected" : "feasible";
  const snapshot = { ...input, assets, resultingWeights, turnover, trades };
  const inputSnapshotHash = stableHash(snapshot);
  return {
    proposalId: `mandate-pre-trade:${inputSnapshotHash}`,
    inputSnapshotHash,
    status,
    feasible: status === "feasible",
    approvalRequired: trades.length > 0,
    requiredEvidence: evidence,
    violations,
    liquidityViolations,
    restrictedAssetViolations,
    proposedRebalanceTrades: trades,
    resultingWeights,
    turnover,
    estimatedTransactionCost: evidence.includes("transaction cost rate/bps") ? null : cleanNumber(transactionCost),
    estimatedTaxCost: evidence.includes("tax cost rate/lots (or explicit tax cost missing reason)") ? null : cleanNumber(taxCost),
    totalEstimatedCost: evidence.length > 0 ? null : cleanNumber(transactionCost + taxCost),
    riskBudgetDelta,
    trackingError,
    provenance: { sourceMode, sourceMetadata, status: evidence.length > 0 ? "missing_evidence" : "complete", requiredEvidence: evidence },
  };
}

export const buildMandatePreTradeProposal = evaluateMandatePreTrade;
export const evaluateMandatePreTradeProposal = evaluateMandatePreTrade;
