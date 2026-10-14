import type { FinancialMetricStatus } from "./financialMetricRegistry";

/**
 * Provenance attached to every user/provider supplied observation. `status`
 * deliberately reuses the financial metric vocabulary; calculated values use
 * `derived` and never masquerade as live or filed observations.
 */
export interface FactorProvenance {
  source: string;
  asOf: string;
  status?: FinancialMetricStatus;
  period?: string;
  units: string;
  currency?: string;
  sourceRef?: string;
  snapshotId?: string;
}

export interface FactorDefinition extends FactorProvenance {
  id: string;
  label?: string;
}

export interface FactorReturnInput extends FactorProvenance {
  factorId: string;
  value: number;
}

export interface SecurityFactorExposure extends FactorProvenance {
  securityId: string;
  /** Factor loadings keyed by FactorDefinition.id. Missing factors are zero. */
  exposures: Readonly<Record<string, number>>;
  /** Expected idiosyncratic return, in the same return units as factor returns. */
  specificReturn?: number;
  /** Idiosyncratic variance, in squared return units. */
  specificVariance?: number;
  sector?: string;
}

export type NumericMap = Readonly<Record<string, number>>;

export interface BrinsonInputs {
  /** Realized portfolio/security returns for the attribution period. */
  securityReturns: NumericMap;
  /** Realized benchmark/security returns for the attribution period. */
  benchmarkSecurityReturns: NumericMap;
  /** Sector classification for every security used in either portfolio. */
  sectorBySecurity: Readonly<Record<string, string>>;
}

export interface FactorScenario {
  id?: string;
  label?: string;
  /** Factor return shocks keyed by factor id, or in factor definition order. */
  factorShocks: NumericMap | readonly number[];
  /** Optional idiosyncratic return shocks keyed by security id. */
  specificShocks?: NumericMap;
  provenance?: FactorProvenance;
}

export interface FactorAttributionInput {
  factors: readonly FactorDefinition[];
  factorReturns: NumericMap | readonly FactorReturnInput[];
  /** Optional provenance for map-form factor returns. */
  factorReturnProvenance?: Readonly<Record<string, FactorProvenance>>;
  /** Symmetric factor covariance matrix in factors order. */
  factorCovariance: readonly (readonly number[])[];
  factorCovarianceProvenance?: FactorProvenance;
  securities: readonly SecurityFactorExposure[];
  /** Portfolio weights keyed by security id. They must sum to one. */
  portfolioWeights: NumericMap;
  portfolioWeightsProvenance?: FactorProvenance;
  /** Optional benchmark weights; if supplied they must sum to one. */
  /** Optional vector form of specific variance, keyed by security id. */
  specificVariances?: NumericMap;
  specificVarianceProvenance?: FactorProvenance;
  benchmarkWeights?: NumericMap;
  benchmarkWeightsProvenance?: FactorProvenance;
  /** Optional realized returns and sectors enable Brinson-like attribution. */
  brinson?: BrinsonInputs;
  /** Convenience aliases for callers that keep these fields at top level. */
  securityReturns?: NumericMap;
  benchmarkSecurityReturns?: NumericMap;
  sectorBySecurity?: Readonly<Record<string, string>>;
  scenario?: FactorScenario;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class FactorAttributionValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid factor attribution input: ${issues.join("; ")}`);
    this.name = "FactorAttributionValidationError";
    this.issues = [...issues];
  }
}

export interface FactorContribution {
  factorId: string;
  exposure: number;
  factorReturn: number;
  expectedContribution: number;
  varianceContribution: number;
}

export interface SecurityContribution {
  securityId: string;
  weight: number;
  exposure: Readonly<Record<string, number>>;
  factorReturn: number;
  specificReturn: number;
  expectedReturn: number;
  specificVariance: number;
  specificVarianceContribution: number;
}

export interface RiskSummary {
  factorVariance: number;
  specificVariance: number;
  totalVariance: number;
  volatility: number;
  /** Contributions are e_i * (Σe)_i and sum to factorVariance. */
  factorVarianceContributions: Readonly<Record<string, number>>;
  securitySpecificVarianceContributions: Readonly<Record<string, number>>;
}

export interface ActiveRiskSummary extends RiskSummary {
  activeExposure: Readonly<Record<string, number>>;
  activeExpectedReturn: number;
}

export interface BrinsonSectorAttribution {
  sector: string;
  portfolioWeight: number;
  benchmarkWeight: number;
  portfolioReturn: number;
  benchmarkReturn: number;
  allocation: number;
  selection: number;
  interaction: number;
  total: number;
}

export interface BrinsonAttribution {
  sectors: readonly BrinsonSectorAttribution[];
  total: { allocation: number; selection: number; interaction: number; total: number };
}

export interface ScenarioSecurityPnl {
  securityId: string;
  factorPnl: number;
  specificPnl: number;
  totalPnl: number;
}

export interface ScenarioPnl {
  id?: string;
  label?: string;
  factorShocks: Readonly<Record<string, number>>;
  securities: readonly ScenarioSecurityPnl[];
  portfolioPnl: number;
  benchmarkPnl?: number;
  activePnl?: number;
  provenance: FactorProvenance;
}

export interface FactorAttributionResult {
  engineId: "factor-attribution";
  engineVersion: "1.0";
  provenance: FactorProvenance;
  /** Input lineage is retained separately from the model-derived output passport. */
  inputProvenance: readonly FactorProvenance[];
  portfolioExposure: Readonly<Record<string, number>>;
  expectedReturn: number;
  factorContributions: readonly FactorContribution[];
  securityContributions: readonly SecurityContribution[];
  specificContribution: number;
  totalExpectedReturn: number;
  risk: RiskSummary;
  benchmark?: {
    exposure: Readonly<Record<string, number>>;
    expectedReturn: number;
    factorContributions: readonly FactorContribution[];
    specificContribution: number;
    totalExpectedReturn: number;
    risk: RiskSummary;
  }
  active?: ActiveRiskSummary;
  brinsonAttribution?: BrinsonAttribution;
  scenario?: ScenarioPnl;
}
function isFactorReturnArray(value: NumericMap | readonly FactorReturnInput[]): value is readonly FactorReturnInput[] {
  return Array.isArray(value);
}

function isNumberArray(value: NumericMap | readonly number[]): value is readonly number[] {
  return Array.isArray(value);
}

const EPSILON = 1e-9;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function issue(errors: string[], message: string): void {
  errors.push(message);
}

function valueMap(values: NumericMap | readonly FactorReturnInput[], factors: readonly FactorDefinition[], errors: string[], name: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (isFactorReturnArray(values)) {
    if (values.length !== factors.length) issue(errors, `${name} dimension ${values.length} does not match factor dimension ${factors.length}`);
    for (const item of values) {
      if (!item || typeof item.factorId !== "string") { issue(errors, `${name} contains an invalid factor observation`); continue; }
      if (!factors.some(factor => factor.id === item.factorId)) issue(errors, `${name} contains unknown factor ${item.factorId}`);
      if (Object.prototype.hasOwnProperty.call(result, item.factorId)) issue(errors, `${name} contains duplicate factor ${item.factorId}`);
      if (!finite(item.value)) issue(errors, `${name} ${item.factorId} must be finite`);
      result[item.factorId] = item.value;
    }
  } else {
    for (const factor of factors) {
      if (!Object.prototype.hasOwnProperty.call(values, factor.id)) issue(errors, `${name} is missing factor ${factor.id}`);
      else {
        result[factor.id] = values[factor.id];
        if (!finite(values[factor.id])) issue(errors, `${name} ${factor.id} must be finite`);
      }
    }
    for (const id of Object.keys(values)) if (!factors.some(factor => factor.id === id)) issue(errors, `${name} contains unknown factor ${id}`);
  }
  for (const factor of factors) if (!Object.prototype.hasOwnProperty.call(result, factor.id)) result[factor.id] = NaN;
  return result;
}

function validateMatrix(matrix: readonly (readonly number[])[], dimension: number, errors: string[]): void {
  if (matrix.length !== dimension) { issue(errors, `factor covariance dimension ${matrix.length} does not match factor dimension ${dimension}`); return; }
  for (let row = 0; row < matrix.length; row += 1) {
    if (matrix[row].length !== dimension) { issue(errors, `factor covariance row ${row} dimension ${matrix[row].length} does not match ${dimension}`); continue; }
    for (let col = 0; col < matrix[row].length; col += 1) {
      if (!finite(matrix[row][col])) issue(errors, `factor covariance [${row},${col}] must be finite`);
      if (row < col && finite(matrix[row][col]) && finite(matrix[col]?.[row]) && Math.abs(matrix[row][col] - matrix[col][row]) > EPSILON) issue(errors, `factor covariance must be symmetric at [${row},${col}]`);
    }
  }
  // A covariance matrix must be positive semidefinite. Jacobi eigenvalue
  // iteration avoids relying on a numerical package in the shared layer.
  if (errors.some(error => error.includes("factor covariance"))) return;
  const a = matrix.map(row => [...row]);
  for (let iteration = 0; iteration < 100 * Math.max(1, dimension * dimension); iteration += 1) {
    let p = 0; let q = 0; let largest = 0;
    for (let row = 0; row < dimension; row += 1) for (let col = row + 1; col < dimension; col += 1) {
      if (Math.abs(a[row][col]) > largest) { largest = Math.abs(a[row][col]); p = row; q = col; }
    }
    if (largest <= 1e-12) break;
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[p][p] - a[q][q]);
    const cosine = Math.cos(theta); const sine = Math.sin(theta);
    for (let row = 0; row < dimension; row += 1) {
      const ap = a[row][p]; const aq = a[row][q];
      a[row][p] = cosine * ap - sine * aq; a[row][q] = sine * ap + cosine * aq;
    }
    for (let col = 0; col < dimension; col += 1) {
      const ap = a[p][col]; const aq = a[q][col];
      a[p][col] = cosine * ap - sine * aq; a[q][col] = sine * ap + cosine * aq;
    }
  }
  for (let index = 0; index < dimension; index += 1) if (a[index][index] < -1e-8) issue(errors, `factor covariance is not positive semidefinite (eigenvalue ${a[index][index]})`);
}

export function validateFactorAttributionInput(input: FactorAttributionInput): ValidationResult {
  const errors: string[] = [];
  if (!input || !Array.isArray(input.factors) || input.factors.length === 0) issue(errors, "at least one factor is required");
  const factors = input?.factors ?? [];
  const factorIds = new Set<string>();
  for (const factor of factors) {
    if (!factor || typeof factor.id !== "string" || !factor.id.trim()) issue(errors, "factor ids must be non-empty");
    else if (factorIds.has(factor.id)) issue(errors, `duplicate factor id ${factor.id}`);
    else factorIds.add(factor.id);
    if (!factor?.units?.trim()) issue(errors, `factor ${factor?.id ?? "?"} must declare units`);
    if (!factor?.source?.trim()) issue(errors, `factor ${factor?.id ?? "?"} must declare source`);
    if (!factor?.asOf?.trim()) issue(errors, `factor ${factor?.id ?? "?"} must declare asOf`);
  }
  const factorReturnValues = input?.factorReturns ?? {};
  valueMap(factorReturnValues, factors, errors, "factorReturns");
  for (const [factorId, provenance] of Object.entries(input?.factorReturnProvenance ?? {})) {
    if (!factorIds.has(factorId)) issue(errors, `factorReturnProvenance contains unknown factor ${factorId}`);
    if (!provenance?.units?.trim() || !provenance?.source?.trim() || !provenance?.asOf?.trim()) issue(errors, `factorReturnProvenance ${factorId} must declare units, source and asOf`);
  }
  validateMatrix(input?.factorCovariance ?? [], factors.length, errors);
  if (!Array.isArray(input?.securities) || input.securities.length === 0) issue(errors, "at least one security is required");
  const securityIds = new Set<string>();
  for (const security of input?.securities ?? []) {
    if (!security || typeof security.securityId !== "string" || !security.securityId.trim()) issue(errors, "security ids must be non-empty");
    else if (securityIds.has(security.securityId)) issue(errors, `duplicate security id ${security.securityId}`);
    else securityIds.add(security.securityId);
    if (!security?.units?.trim()) issue(errors, `security ${security?.securityId ?? "?"} must declare units`);
    if (!security?.source?.trim()) issue(errors, `security ${security?.securityId ?? "?"} must declare source`);
    if (!security?.asOf?.trim()) issue(errors, `security ${security?.securityId ?? "?"} must declare asOf`);
    for (const [factorId, exposure] of Object.entries(security?.exposures ?? {})) {
      if (!factorIds.has(factorId)) issue(errors, `security ${security.securityId} contains unknown factor ${factorId}`);
      if (!finite(exposure)) issue(errors, `exposure ${security.securityId}/${factorId} must be finite`);
    }
    if (security?.specificReturn !== undefined && !finite(security.specificReturn)) issue(errors, `specific return ${security.securityId} must be finite`);
    if (security?.specificVariance !== undefined && (!finite(security.specificVariance) || security.specificVariance < -EPSILON)) issue(errors, `specific variance ${security.securityId} must be finite and non-negative`);
  }
  for (const [securityId, variance] of Object.entries(input?.specificVariances ?? {})) {
    if (!securityIds.has(securityId)) issue(errors, `specificVariances contains unknown security ${securityId}`);
    if (!finite(variance) || variance < -EPSILON) issue(errors, `specific variance ${securityId} must be finite and non-negative`);
  }
  if (input?.specificVarianceProvenance && (!input.specificVarianceProvenance.units?.trim() || !input.specificVarianceProvenance.source?.trim() || !input.specificVarianceProvenance.asOf?.trim())) issue(errors, "specificVarianceProvenance must declare units, source and asOf");
  const validateWeights = (weights: NumericMap | undefined, name: string) => {
    if (!weights) return;
    let sum = 0;
    for (const [securityId, weight] of Object.entries(weights)) {
      if (!securityIds.has(securityId)) issue(errors, `${name} contains unknown security ${securityId}`);
      if (!finite(weight)) issue(errors, `${name} ${securityId} must be finite`);
      else {
        sum += weight;
        if (weight < -EPSILON) issue(errors, `${name} cannot contain negative weight`);
      }
    }
    if (Math.abs(sum - 1) > EPSILON) issue(errors, `${name} must sum to one (got ${sum})`);
  };
  validateWeights(input?.portfolioWeights, "portfolioWeights");
  validateWeights(input?.benchmarkWeights, "benchmarkWeights");
  if (!input?.portfolioWeights) issue(errors, "portfolioWeights are required");
  return { valid: errors.length === 0, errors };
}

function weightsFor(securityIds: readonly string[], weights: NumericMap): number[] { return securityIds.map(id => weights[id] ?? 0); }
function specificVarianceFor(input: FactorAttributionInput, security: SecurityFactorExposure): number {
  return input.specificVariances?.[security.securityId] ?? security.specificVariance ?? 0;
}
function dot(left: readonly number[], right: readonly number[]): number { return left.reduce((sum, value, index) => sum + value * right[index], 0); }
function matrixVector(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] { return matrix.map(row => dot(row, vector)); }
function portfolioExposure(factors: readonly FactorDefinition[], securities: readonly SecurityFactorExposure[], weights: NumericMap): Record<string, number> {
  return Object.fromEntries(factors.map((factor, index) => [factor.id, securities.reduce((sum, security) => sum + (weights[security.securityId] ?? 0) * (security.exposures[factor.id] ?? 0), 0)]));
}
function mapFactorReturns(input: NumericMap | readonly FactorReturnInput[], factors: readonly FactorDefinition[]): Record<string, number> {
  if (isFactorReturnArray(input)) return Object.fromEntries(input.map(item => [item.factorId, item.value]));
  return Object.fromEntries(factors.map(factor => [factor.id, input[factor.id]]));
}
function makeRisk(exposure: readonly number[], covariance: readonly (readonly number[])[], securities: readonly SecurityFactorExposure[], weights: readonly number[], factors: readonly FactorDefinition[], specificVariances?: readonly number[]): RiskSummary {
  const covarianceExposure = matrixVector(covariance, exposure);
  const factorVarianceContributions = Object.fromEntries(factors.map((factor, index) => [factor.id, exposure[index] * covarianceExposure[index]]));
  const factorVariance = dot(exposure, covarianceExposure);
  const specificVarianceContributions = Object.fromEntries(securities.map((security, index) => [security.securityId, weights[index] ** 2 * (specificVariances?.[index] ?? security.specificVariance ?? 0)]));
  const specificVariance = Object.values(specificVarianceContributions).reduce((sum, value) => sum + value, 0);
  const totalVariance = factorVariance + specificVariance;
  return { factorVariance, specificVariance, totalVariance, volatility: Math.sqrt(Math.max(0, totalVariance)), factorVarianceContributions, securitySpecificVarianceContributions: specificVarianceContributions };
}
function makeContributions(factors: readonly FactorDefinition[], exposure: Readonly<Record<string, number>>, returns: NumericMap, covariance: readonly (readonly number[])[]): FactorContribution[] {
  const vector = factors.map(factor => exposure[factor.id]);
  const covarianceExposure = matrixVector(covariance, vector);
  return factors.map((factor, index) => ({ factorId: factor.id, exposure: vector[index], factorReturn: returns[factor.id], expectedContribution: vector[index] * returns[factor.id], varianceContribution: vector[index] * covarianceExposure[index] }));
}
function derivedProvenance(input: FactorAttributionInput): FactorProvenance {
  const sourceObservations = [...input.factors, ...input.securities];
  const asOfs = sourceObservations.map(item => item.asOf).filter(Boolean).sort();
  const periods = sourceObservations.map(item => item.period).filter((period): period is string => Boolean(period));
  const currencies = sourceObservations.map(item => item.currency).filter((currency): currency is string => Boolean(currency));
  return {
    source: "factor-attribution-engine",
    asOf: asOfs.at(-1) ?? "",
    status: "derived",
    period: periods.length > 0 && periods.every(period => period === periods[0]) ? periods[0] : undefined,
    currency: currencies.length > 0 && currencies.every(currency => currency === currencies[0]) ? currencies[0] : undefined,
    units: "return/variance",
  };
}

function inputLineage(input: FactorAttributionInput): FactorProvenance[] {
  const lineage: FactorProvenance[] = [...input.factors];
  if (isFactorReturnArray(input.factorReturns)) lineage.push(...input.factorReturns);
  else lineage.push(...Object.values(input.factorReturnProvenance ?? {}));
  lineage.push(...input.securities);
  if (input.factorCovarianceProvenance) lineage.push(input.factorCovarianceProvenance);
  if (input.specificVarianceProvenance) lineage.push(input.specificVarianceProvenance);
  if (input.portfolioWeightsProvenance) lineage.push(input.portfolioWeightsProvenance);
  if (input.benchmarkWeightsProvenance) lineage.push(input.benchmarkWeightsProvenance);
  return lineage;
}

export function calculateScenarioPnl(input: FactorAttributionInput, scenario: FactorScenario): ScenarioPnl {
  const validation = validateFactorAttributionInput(input);
  if (!validation.valid) throw new FactorAttributionValidationError(validation.errors);
  const shocks: Record<string, number> = {};
  const factorShocks = scenario.factorShocks;
  if (isNumberArray(factorShocks)) {
    if (factorShocks.length !== input.factors.length) throw new FactorAttributionValidationError([`factor shocks dimension ${factorShocks.length} does not match factor dimension ${input.factors.length}`]);
    input.factors.forEach((factor, index) => { shocks[factor.id] = factorShocks[index]; });
  } else {
    for (const factor of input.factors) {
      const shock = factorShocks[factor.id];
      if (!finite(shock)) throw new FactorAttributionValidationError([`factor shock ${factor.id} must be finite`]);
      shocks[factor.id] = shock;
    }
    for (const factorId of Object.keys(factorShocks)) if (!input.factors.some(factor => factor.id === factorId)) throw new FactorAttributionValidationError([`factor shocks contains unknown factor ${factorId}`]);
  }
  for (const shock of Object.values(shocks)) if (!finite(shock)) throw new FactorAttributionValidationError(["factor shocks must be finite"]);
  const securityIds = input.securities.map(security => security.securityId);
  for (const securityId of Object.keys(scenario.specificShocks ?? {})) if (!securityIds.includes(securityId)) throw new FactorAttributionValidationError([`specific shocks contains unknown security ${securityId}`]);
  const rows = input.securities.map(security => {
    const factorPnl = input.factors.reduce((sum, factor) => sum + (security.exposures[factor.id] ?? 0) * shocks[factor.id], 0);
    const specificPnl = scenario.specificShocks?.[security.securityId] ?? 0;
    if (!finite(specificPnl)) throw new FactorAttributionValidationError([`specific shock ${security.securityId} must be finite`]);
    return { securityId: security.securityId, factorPnl, specificPnl, totalPnl: factorPnl + specificPnl };
  });
  const weights = weightsFor(securityIds, input.portfolioWeights);
  const benchmarkWeights = input.benchmarkWeights ? weightsFor(securityIds, input.benchmarkWeights) : undefined;
  const portfolioPnl = dot(weights, rows.map(row => row.totalPnl));
  const benchmarkPnl = benchmarkWeights ? dot(benchmarkWeights, rows.map(row => row.totalPnl)) : undefined;
  return { id: scenario.id, label: scenario.label, factorShocks: shocks, securities: rows, portfolioPnl, benchmarkPnl, activePnl: benchmarkPnl === undefined ? undefined : portfolioPnl - benchmarkPnl, provenance: scenario.provenance ?? { source: "factor-attribution-scenario", asOf: derivedProvenance(input).asOf, status: "derived", units: "return" } };
}

function brinsonAttribution(input: FactorAttributionInput, portfolioWeights: NumericMap, benchmarkWeights: NumericMap): BrinsonAttribution | undefined {
  const brinson = input.brinson ?? (input.securityReturns && input.benchmarkSecurityReturns && input.sectorBySecurity ? { securityReturns: input.securityReturns, benchmarkSecurityReturns: input.benchmarkSecurityReturns, sectorBySecurity: input.sectorBySecurity } : undefined);
  if (!brinson) return undefined;
  const ids = input.securities.map(security => security.securityId);
  if (ids.some(id => !finite(brinson.securityReturns[id]) || !finite(brinson.benchmarkSecurityReturns[id]) || typeof brinson.sectorBySecurity[id] !== "string")) return undefined;
  const sectors = [...new Set(ids.map(id => brinson.sectorBySecurity[id]))].sort();
  const benchmarkTotal = ids.reduce((sum, id) => sum + (benchmarkWeights[id] ?? 0) * brinson.benchmarkSecurityReturns[id], 0);
  const rows = sectors.map(sector => {
    const sectorIds = ids.filter(id => brinson.sectorBySecurity[id] === sector);
    const portfolioWeight = sectorIds.reduce((sum, id) => sum + (portfolioWeights[id] ?? 0), 0);
    const benchmarkWeight = sectorIds.reduce((sum, id) => sum + (benchmarkWeights[id] ?? 0), 0);
    const portfolioReturn = portfolioWeight === 0 ? 0 : sectorIds.reduce((sum, id) => sum + (portfolioWeights[id] ?? 0) * brinson.securityReturns[id], 0) / portfolioWeight;
    const benchmarkReturn = benchmarkWeight === 0 ? 0 : sectorIds.reduce((sum, id) => sum + (benchmarkWeights[id] ?? 0) * brinson.benchmarkSecurityReturns[id], 0) / benchmarkWeight;
    const allocation = (portfolioWeight - benchmarkWeight) * (benchmarkReturn - benchmarkTotal);
    const selection = benchmarkWeight * (portfolioReturn - benchmarkReturn);
    const interaction = (portfolioWeight - benchmarkWeight) * (portfolioReturn - benchmarkReturn);
    return { sector, portfolioWeight, benchmarkWeight, portfolioReturn, benchmarkReturn, allocation, selection, interaction, total: allocation + selection + interaction };
  });
  const total = rows.reduce((result, row) => ({ allocation: result.allocation + row.allocation, selection: result.selection + row.selection, interaction: result.interaction + row.interaction, total: result.total + row.total }), { allocation: 0, selection: 0, interaction: 0, total: 0 });
  return { sectors: rows, total };
}

export function calculateFactorAttribution(input: FactorAttributionInput): FactorAttributionResult {
  const validation = validateFactorAttributionInput(input);
  if (!validation.valid) throw new FactorAttributionValidationError(validation.errors);
  const factors = input.factors;
  const securities = input.securities;
  const returns = mapFactorReturns(input.factorReturns, factors);
  const ids = securities.map(security => security.securityId);
  const weights = weightsFor(ids, input.portfolioWeights);
  const specificVariances = securities.map(security => specificVarianceFor(input, security));
  const exposure = portfolioExposure(factors, securities, input.portfolioWeights);
  const exposureVector = factors.map(factor => exposure[factor.id]);
  const contributions = makeContributions(factors, exposure, returns, input.factorCovariance);
  const specificContribution = securities.reduce((sum, security, index) => sum + weights[index] * (security.specificReturn ?? 0), 0);
  const expectedReturn = contributions.reduce((sum, contribution) => sum + contribution.expectedContribution, 0);
  const securityContributions = securities.map((security, index) => {
    const factorReturn = factors.reduce((sum, factor) => sum + (security.exposures[factor.id] ?? 0) * returns[factor.id], 0);
    const specificReturn = security.specificReturn ?? 0;
    return { securityId: security.securityId, weight: weights[index], exposure: security.exposures, factorReturn, specificReturn, expectedReturn: factorReturn + specificReturn, specificVariance: specificVariances[index], specificVarianceContribution: weights[index] ** 2 * specificVariances[index] };
  });
  const risk = makeRisk(exposureVector, input.factorCovariance, securities, weights, factors, specificVariances);
  const result: FactorAttributionResult = { engineId: "factor-attribution", engineVersion: "1.0", provenance: derivedProvenance(input), inputProvenance: inputLineage(input), portfolioExposure: exposure, expectedReturn, factorContributions: contributions, specificContribution, totalExpectedReturn: expectedReturn + specificContribution, securityContributions, risk };
  if (input.benchmarkWeights) {
    const benchmarkWeights = weightsFor(ids, input.benchmarkWeights);
    const benchmarkExposure = portfolioExposure(factors, securities, input.benchmarkWeights);
    const benchmarkContributions = makeContributions(factors, benchmarkExposure, returns, input.factorCovariance);
    const benchmarkSpecificContribution = securities.reduce((sum, security, index) => sum + benchmarkWeights[index] * (security.specificReturn ?? 0), 0);
    const benchmarkFactorReturn = benchmarkContributions.reduce((sum, contribution) => sum + contribution.expectedContribution, 0);
    const benchmarkRisk = makeRisk(factors.map(factor => benchmarkExposure[factor.id]), input.factorCovariance, securities, benchmarkWeights, factors, specificVariances);
    const activeExposure = Object.fromEntries(factors.map(factor => [factor.id, exposure[factor.id] - benchmarkExposure[factor.id]]));
    const activeWeights = weights.map((weight, index) => weight - benchmarkWeights[index]);
    const activeRisk = makeRisk(factors.map(factor => activeExposure[factor.id]), input.factorCovariance, securities, activeWeights, factors, specificVariances);
    result.benchmark = { exposure: benchmarkExposure, expectedReturn: benchmarkFactorReturn, factorContributions: benchmarkContributions, specificContribution: benchmarkSpecificContribution, totalExpectedReturn: benchmarkFactorReturn + benchmarkSpecificContribution, risk: benchmarkRisk };
    result.active = { ...activeRisk, activeExposure, activeExpectedReturn: result.totalExpectedReturn - result.benchmark.totalExpectedReturn };
    result.brinsonAttribution = brinsonAttribution(input, input.portfolioWeights, input.benchmarkWeights);
  }
  if (input.scenario) result.scenario = calculateScenarioPnl(input, input.scenario);
  return result;
}

/** Explicit alias for callers that name analytical engines with `run`. */
export const runFactorAttribution = calculateFactorAttribution;
