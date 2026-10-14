export type ScenarioActionType = "hold" | "reduce" | "increase" | "hedge" | "defer";

export type ScenarioActionStatus = "feasible" | "rejected";

export interface ScenarioSource {
  status?: "manual" | "source" | "provider" | "private";
  source?: string;
  provider?: string;
  asOf?: string;
  period?: string;
  unit?: string;
}

export interface ScenarioNodeImpact extends ScenarioSource {
  node: string;
  change: number;
}

export interface ScenarioAssetImpact extends ScenarioSource {
  assetId: string;
  /** Scenario return/impact for one unit of portfolio weight. */
  scenarioImpact?: number;
  /** Alias accepted for observations supplied by scenario graph adapters. */
  impact?: number;
  /** Risk units for one unit of portfolio weight. Defaults to |scenarioImpact| when omitted. */
  riskImpact?: number;
  /** Alias accepted for risk observations. */
  risk?: number;
  /** Liquidity measure in the same units as constraints.minLiquidity. */
  liquidity?: number;
  /** Optional link to a scenario node. */
  node?: string;
}

export interface ScenarioExposure {
  assetId: string;
  weight?: number;
  exposure?: number;
}

export interface ScenarioActionAlternative {
  type: ScenarioActionType;
  label?: string;
  assetId?: string;
  /** Explicit target for the selected asset, or all assets when assetId is omitted. */
  targetWeight?: number;
  /** Explicit change for the selected asset, or all assets when assetId is omitted. */
  weightDelta?: number;
  /** Optional action-specific cost, in expected-impact units. */
  cost?: number;
  /** Optional multiplier used by hedge actions. */
  hedgeRatio?: number;
}

export interface ScenarioActionConstraints {
  maxWeight?: number | Record<string, number>;
  minLiquidity?: number;
  maxTurnover?: number;
  riskBudget?: number;
}

export interface ScenarioActionInput {
  /** Existing scenario graph output may be supplied under either name. */
  nodeImpacts?: ScenarioNodeImpact[] | Record<string, number>;
  scenarioNodeImpacts?: ScenarioNodeImpact[] | Record<string, number>;
  assetImpacts?: ScenarioAssetImpact[];
  assets?: ScenarioAssetImpact[];
  /** Existing decision-engine exposure input. */
  exposures?: ScenarioExposure[] | Record<string, number>;
  currentExposure?: Record<string, number>;
  currentWeights?: Record<string, number>;
  actionAlternatives?: ScenarioActionAlternative[] | ScenarioActionType[];
  actions?: ScenarioActionAlternative[] | ScenarioActionType[];
  constraints?: ScenarioActionConstraints;
  /** Costs are portfolio-impact units and are subtracted from expected impact. */
  costs?: Record<string, number>;
  source?: ScenarioSource;
}

export interface ScenarioConstraintViolation {
  constraint: "max_weight" | "min_liquidity" | "max_turnover" | "risk_budget" | "missing_evidence";
  message: string;
  actual: number | null;
  limit: number | null;
  assetId?: string;
}

export interface ScenarioRequiredEvidence extends ScenarioSource {
  requirement: string;
  assetId?: string;
}

export interface ScenarioActionCandidate {
  rank: number;
  type: ScenarioActionType;
  label: string;
  status: ScenarioActionStatus;
  approvalRequired: true;
  expectedImpact: number | null;
  netExpectedImpact: number | null;
  cost: number;
  residualRisk: number | null;
  turnover: number | null;
  targetWeights: Record<string, number | null>;
  constraintViolations: ScenarioConstraintViolation[];
  rationale: string;
  requiredEvidence: ScenarioRequiredEvidence[];
  source: ScenarioSource;
}

export interface ScenarioActionResult {
  candidates: ScenarioActionCandidate[];
  recommendedAction: string | null;
  approvalRequired: true;
  source: ScenarioSource;
  inputCoverage: {
    assets: number;
    assetsWithImpact: number;
    assetsWithExposure: number;
    complete: boolean;
  };
}

const ACTION_TYPES: ScenarioActionType[] = ["hold", "reduce", "increase", "hedge", "defer"];
const EPSILON = 1e-12;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanNumber(value: number): number {
  return Math.abs(value) < EPSILON ? 0 : Number(value.toFixed(12));
}

function asNodeMap(input: ScenarioActionInput): Map<string, ScenarioNodeImpact> {
  const source = input.nodeImpacts ?? input.scenarioNodeImpacts;
  const entries = Array.isArray(source)
    ? source.filter((item) => item && typeof item.node === "string" && finite(item.change))
    : Object.entries(source ?? {}).filter(([, value]) => finite(value)).map(([node, change]) => ({ node, change: change as number }));
  return new Map(entries.map((item) => [item.node, item]));
}

function asExposureMap(input: ScenarioActionInput): Map<string, number> {
  const result = new Map<string, number>();
  if (Array.isArray(input.exposures)) {
    for (const item of input.exposures) {
      if (!item || typeof item.assetId !== "string") continue;
      const value = item.weight ?? item.exposure;
      if (finite(value)) result.set(item.assetId, value);
    }
  } else if (input.exposures) {
    for (const [assetId, value] of Object.entries(input.exposures)) if (finite(value)) result.set(assetId, value);
  }
  for (const [assetId, value] of Object.entries(input.currentExposure ?? {})) if (finite(value)) result.set(assetId, value);
  for (const [assetId, value] of Object.entries(input.currentWeights ?? {})) if (finite(value)) result.set(assetId, value);
  return result;
}

function asActions(input: ScenarioActionInput): ScenarioActionAlternative[] {
  const actions = input.actionAlternatives ?? input.actions ?? ACTION_TYPES;
  return actions.map((action) => typeof action === "string" ? { type: action } : action)
    .filter((action): action is ScenarioActionAlternative => ACTION_TYPES.includes(action.type));
}

function costFor(costs: Record<string, number> | undefined, action: ScenarioActionAlternative): number {
  const value = action.cost ?? costs?.[action.label ?? ""] ?? costs?.[action.type] ?? 0;
  return finite(value) ? value : 0;
}

function sourceFor(input: ScenarioActionInput, asset?: ScenarioAssetImpact): ScenarioSource {
  const source = { ...(input.source ?? {}), ...(asset ?? {}) };
  return {
    status: source.status ?? (source.provider || source.source ? "source" : "manual"),
    source: source.source,
    provider: source.provider,
    asOf: source.asOf,
    period: source.period,
    unit: source.unit,
  };
}

function actionTarget(action: ScenarioActionAlternative, current: number, impact: number | null): number {
  if (finite(action.targetWeight)) return action.targetWeight;
  if (finite(action.weightDelta)) return current + action.weightDelta;
  if (action.type === "hold" || action.type === "defer") return current;
  if (action.type === "reduce") return 0;
  if (action.type === "increase") return current + (Math.sign(current) || 1) * Math.abs(current);
  if (action.type === "hedge") {
    if (impact === null || impact === 0) return current;
    const ratio = finite(action.hedgeRatio) ? action.hedgeRatio : 1;
    return Math.sign(impact) * Math.abs(current) * ratio;
  }
  return current;
}

function maxWeightFor(constraint: number | Record<string, number> | undefined, assetId: string): number | null {
  if (finite(constraint)) return constraint;
  if (constraint && finite(constraint[assetId])) return constraint[assetId];
  return null;
}

/**
 * Calculates review-only action candidates. No order, broker or execution side effect exists here.
 * All ranking and constraint calculations are deterministic for the supplied observations.
 */
export function calculateScenarioActionCandidates(input: ScenarioActionInput): ScenarioActionResult {
  const nodeMap = asNodeMap(input);
  const exposureMap = asExposureMap(input);
  const assets = (input.assetImpacts ?? input.assets ?? []).filter((asset) => asset && typeof asset.assetId === "string");
  const assetIds = [...new Set([...assets.map((asset) => asset.assetId), ...exposureMap.keys()])].sort();
  const byAsset = new Map(assets.map((asset) => [asset.assetId, asset]));
  const constraints = input.constraints ?? {};
  const alternatives = asActions(input);
  const requiredBase: ScenarioRequiredEvidence[] = [];
  if (assetIds.length === 0) requiredBase.push({ requirement: "At least one asset impact and exposure observation", ...sourceFor(input) });
  const normalizedAssets = assetIds.map((assetId) => {
    const asset = byAsset.get(assetId);
    const current = exposureMap.get(assetId) ?? null;
    const node = asset?.node ? nodeMap.get(asset.node) : undefined;
    const impact = finite(asset?.scenarioImpact) ? asset!.scenarioImpact! : finite(asset?.impact) ? asset!.impact! : finite(node?.change) ? node!.change : null;
    if (impact === null) requiredBase.push({ requirement: "Scenario impact observation", assetId, ...sourceFor(input, asset) });
    if (current === null) requiredBase.push({ requirement: "Current exposure or weight", assetId, ...sourceFor(input, asset) });
    const riskImpact = finite(asset?.riskImpact) ? asset!.riskImpact! : finite(asset?.risk) ? asset!.risk! : impact === null ? null : Math.abs(impact);
    return { assetId, asset, current, impact, riskImpact };
  });

  const candidates = alternatives.map((action) => {
    const targetWeights: Record<string, number | null> = {};
    const requiredEvidence = [...requiredBase];
    for (const item of normalizedAssets) {
      if (item.current === null) {
        targetWeights[item.assetId] = null;
        continue;
      }
      const targeted = !action.assetId || action.assetId === item.assetId;
      targetWeights[item.assetId] = cleanNumber(targeted ? actionTarget(action, item.current, item.impact) : item.current);
    }
    const violations: ScenarioConstraintViolation[] = [];
    let expectedImpact = 0;
    let residualRisk = 0;
    let turnover = 0;
    let complete = normalizedAssets.length > 0;
    let exposureComplete = normalizedAssets.length > 0;
    for (const item of normalizedAssets) {
      const target = targetWeights[item.assetId];
      if (target === null || item.current === null) {
        complete = false;
        exposureComplete = false;
        continue;
      }
      const delta = target - item.current;
      turnover += Math.abs(delta);
      if (item.impact === null) complete = false;
      else expectedImpact += target * item.impact;
      if (item.riskImpact === null) complete = false;
      else residualRisk += Math.abs(target * item.riskImpact);
      const maxWeight = maxWeightFor(constraints.maxWeight, item.assetId);
      if (maxWeight !== null && Math.abs(target) > maxWeight + EPSILON) violations.push({ constraint: "max_weight", message: `${item.assetId} target weight exceeds maximum`, actual: Math.abs(target), limit: maxWeight, assetId: item.assetId });
      if (constraints.minLiquidity !== undefined && target !== 0) {
        const liquidity = item.asset?.liquidity;
        if (!finite(liquidity)) {
          complete = false;
          violations.push({ constraint: "min_liquidity", message: `${item.assetId} liquidity evidence is unavailable`, actual: null, limit: constraints.minLiquidity, assetId: item.assetId });
          requiredEvidence.push({ requirement: "Liquidity observation", assetId: item.assetId, ...sourceFor(input, item.asset) });
        } else if (liquidity < constraints.minLiquidity) violations.push({ constraint: "min_liquidity", message: `${item.assetId} liquidity is below minimum`, actual: liquidity, limit: constraints.minLiquidity, assetId: item.assetId });
      }
    }
    turnover = exposureComplete ? cleanNumber(turnover) : 0;
    if (constraints.maxTurnover !== undefined && exposureComplete && turnover > constraints.maxTurnover + EPSILON) violations.push({ constraint: "max_turnover", message: "Target turnover exceeds maximum", actual: turnover, limit: constraints.maxTurnover });
    residualRisk = complete ? cleanNumber(residualRisk) : 0;
    if (constraints.riskBudget !== undefined && complete && residualRisk > constraints.riskBudget + EPSILON) violations.push({ constraint: "risk_budget", message: "Residual risk exceeds budget", actual: residualRisk, limit: constraints.riskBudget });
    if (!complete) violations.push({ constraint: "missing_evidence", message: "Candidate cannot be approved until required observations are supplied", actual: null, limit: null });
    const cost = cleanNumber(costFor(input.costs, action));
    const netExpectedImpact = complete ? cleanNumber(expectedImpact - cost) : null;
    const label = action.label ?? action.type.toUpperCase();
    const status: ScenarioActionStatus = violations.length ? "rejected" : "feasible";
    const rationale = complete
      ? `${label}: expected scenario impact ${cleanNumber(expectedImpact)}, residual risk ${residualRisk}, turnover ${turnover}, cost ${cost}. ${status === "feasible" ? "Within supplied constraints." : "Rejected by supplied constraints."}`
      : `${label}: required scenario or exposure observations are missing; no approval recommendation is possible.`;
    return {
      rank: 0,
      type: action.type,
      label,
      status,
      approvalRequired: true as const,
      expectedImpact: complete ? cleanNumber(expectedImpact) : null,
      netExpectedImpact,
      cost,
      turnover: exposureComplete ? turnover : null,
      residualRisk: complete ? residualRisk : null,
      targetWeights,
      constraintViolations: violations,
      rationale,
      requiredEvidence,
      source: sourceFor(input),
    } satisfies ScenarioActionCandidate;
  });

  candidates.sort((a, b) => {
    if (a.status !== b.status) return a.status === "feasible" ? -1 : 1;
    const impactA = a.netExpectedImpact ?? Number.NEGATIVE_INFINITY;
    const impactB = b.netExpectedImpact ?? Number.NEGATIVE_INFINITY;
    if (impactA !== impactB) return impactB - impactA;
    const riskA = a.residualRisk ?? Number.POSITIVE_INFINITY;
    const riskB = b.residualRisk ?? Number.POSITIVE_INFINITY;
    if (riskA !== riskB) return riskA - riskB;
    return `${a.type}:${a.label}`.localeCompare(`${b.type}:${b.label}`);
  });
  candidates.forEach((candidate, index) => { candidate.rank = index + 1; });
  const recommended = candidates.find((candidate) => candidate.status === "feasible");
  return {
    candidates,
    recommendedAction: recommended?.label ?? null,
    approvalRequired: true,
    source: sourceFor(input),
    inputCoverage: {
      assets: assetIds.length,
      assetsWithImpact: normalizedAssets.filter((asset) => asset.impact !== null).length,
      assetsWithExposure: normalizedAssets.filter((asset) => exposureMap.has(asset.assetId)).length,
      complete: assetIds.length > 0 && normalizedAssets.every((asset) => asset.impact !== null && exposureMap.has(asset.assetId)),
    },
  };
}

export const buildScenarioActionCandidates = calculateScenarioActionCandidates;
export default calculateScenarioActionCandidates;
