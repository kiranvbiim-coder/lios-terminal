import type { FactorDefinition, SecurityFactorExposure } from "./factorAttribution";

export interface PeriodReturns {
  periodEnd: string;
  securityReturns: Readonly<Record<string, number>>;
}

export interface FactorReturnEstimationResult {
  factorReturnSeries: Array<{ periodEnd: string; returns: Readonly<Record<string, number>> }>;
  factorCovariance: number[][];
  factorCovarianceAnnualizationPeriodsPerYear: number;
  specificVariances: Readonly<Record<string, number>>;
  excludedFromSpecificVariance: Array<{ securityId: string; reason: string }>;
  periodsUsed: number;
  excludedPeriods: Array<{ periodEnd: string; reason: string }>;
  regressionRSquaredByPeriod: Readonly<Record<string, number>>;
}

const EPSILON = 1e-10;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function zeros(size: number): number[] {
  return Array.from({ length: size }, () => 0);
}

/**
 * Solves a dense linear system with Gaussian elimination and partial pivoting.
 * A singular/ill-conditioned design is rejected rather than silently applying
 * a pseudo-inverse that could manufacture factor returns from insufficient data.
 */
function solveLinearSystem(matrix: readonly (readonly number[])[], target: readonly number[]): number[] {
  const n = matrix.length;
  if (n === 0 || target.length !== n || matrix.some((row) => row.length !== n)) {
    throw new Error("OLS normal equations must be a non-empty square system.");
  }
  const augmented = matrix.map((row, rowIndex) => [...row, target[rowIndex]]);
  for (let column = 0; column < n; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row;
    }
    const pivot = augmented[pivotRow][column];
    if (!isFiniteNumber(pivot) || Math.abs(pivot) <= EPSILON) {
      throw new Error("OLS design matrix is singular or insufficiently identified.");
    }
    if (pivotRow !== column) [augmented[pivotRow], augmented[column]] = [augmented[column], augmented[pivotRow]];
    for (let row = column + 1; row < n; row += 1) {
      const multiplier = augmented[row][column] / augmented[column][column];
      if (Math.abs(multiplier) <= EPSILON) continue;
      for (let j = column; j <= n; j += 1) augmented[row][j] -= multiplier * augmented[column][j];
    }
  }
  const solution = zeros(n);
  for (let row = n - 1; row >= 0; row -= 1) {
    let value = augmented[row][n];
    for (let column = row + 1; column < n; column += 1) value -= augmented[row][column] * solution[column];
    const pivot = augmented[row][row];
    if (Math.abs(pivot) <= EPSILON) throw new Error("OLS design matrix is singular or insufficiently identified.");
    solution[row] = value / pivot;
  }
  if (solution.some((value) => !isFiniteNumber(value))) throw new Error("OLS produced a non-finite coefficient.");
  return solution;
}

export function ordinaryLeastSquares(
  designMatrix: readonly (readonly number[])[],
  targetVector: readonly number[],
): { coefficients: number[]; residuals: number[]; rSquared: number } {
  if (designMatrix.length === 0 || designMatrix.length !== targetVector.length) {
    throw new Error("OLS requires at least one design row and an equally sized target vector.");
  }
  const width = designMatrix[0].length;
  if (width === 0 || designMatrix.some((row) => row.length !== width || row.some((value) => !isFiniteNumber(value))) || targetVector.some((value) => !isFiniteNumber(value))) {
    throw new Error("OLS requires a rectangular finite design matrix and finite target values.");
  }
  const normalMatrix = Array.from({ length: width }, () => zeros(width));
  const normalTarget = zeros(width);
  for (let row = 0; row < designMatrix.length; row += 1) {
    const observation = designMatrix[row];
    for (let i = 0; i < width; i += 1) {
      normalTarget[i] += observation[i] * targetVector[row];
      for (let j = 0; j < width; j += 1) normalMatrix[i][j] += observation[i] * observation[j];
    }
  }
  const coefficients = solveLinearSystem(normalMatrix, normalTarget);
  const fitted = designMatrix.map((row) => row.reduce((sum, value, index) => sum + value * coefficients[index], 0));
  const meanTarget = targetVector.reduce((sum, value) => sum + value, 0) / targetVector.length;
  const residuals = targetVector.map((value, index) => value - fitted[index]);
  const residualSumSquares = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const totalSumSquares = targetVector.reduce((sum, value) => sum + (value - meanTarget) ** 2, 0);
  const rSquared = totalSumSquares <= EPSILON ? 0 : 1 - residualSumSquares / totalSumSquares;
  return { coefficients, residuals, rSquared: Number.isFinite(rSquared) ? rSquared : 0 };
}

function sampleCovariance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  return left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0) / (left.length - 1);
}

function sampleVariance(values: readonly number[]): number {
  return sampleCovariance(values, values);
}

export function estimateFactorReturns(
  factors: readonly FactorDefinition[],
  securities: readonly SecurityFactorExposure[],
  periods: readonly PeriodReturns[],
  periodsPerYear: number,
): FactorReturnEstimationResult {
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) throw new Error("periodsPerYear must be a finite positive number.");
  if (factors.length === 0) throw new Error("At least one factor is required.");
  const minSecurities = factors.length + 5;
  const factorReturnSeries: Array<{ periodEnd: string; returns: Readonly<Record<string, number>> }> = [];
  const regressionRSquaredByPeriod: Record<string, number> = {};
  const excludedPeriods: Array<{ periodEnd: string; reason: string }> = [];
  const residualsBySecurity = new Map<string, number[]>();
  const factorVectors: number[][] = [];
  const factorIds = factors.map((factor) => factor.id);

  for (const period of periods) {
    const observations = securities.filter((security) => {
      const realized = period.securityReturns[security.securityId];
      return isFiniteNumber(realized) && factorIds.every((factorId) => isFiniteNumber(security.exposures[factorId] ?? 0));
    });
    if (observations.length < minSecurities) {
      excludedPeriods.push({ periodEnd: period.periodEnd, reason: `requires at least ${minSecurities} securities with finite returns and exposures, got ${observations.length}` });
      continue;
    }
    const design = observations.map((security) => factorIds.map((factorId) => security.exposures[factorId] ?? 0));
    const target = observations.map((security) => period.securityReturns[security.securityId]);
    let regression: { coefficients: number[]; residuals: number[]; rSquared: number };
    try {
      regression = ordinaryLeastSquares(design, target);
    } catch (error) {
      excludedPeriods.push({ periodEnd: period.periodEnd, reason: error instanceof Error ? error.message : "OLS regression failed" });
      continue;
    }
    const returns = Object.fromEntries(factorIds.map((factorId, index) => [factorId, regression.coefficients[index]]));
    factorReturnSeries.push({ periodEnd: period.periodEnd, returns });
    factorVectors.push(regression.coefficients);
    regressionRSquaredByPeriod[period.periodEnd] = regression.rSquared;
    observations.forEach((security, index) => {
      const existing = residualsBySecurity.get(security.securityId) ?? [];
      existing.push(regression.residuals[index]);
      residualsBySecurity.set(security.securityId, existing);
    });
  }

  const factorCovariance = factors.map((_, row) => factors.map((__, column) => {
    const left = factorVectors.map((vector) => vector[row]);
    const right = factorVectors.map((vector) => vector[column]);
    return sampleCovariance(left, right) * periodsPerYear;
  }));
  const specificVariances: Record<string, number> = {};
  const excludedFromSpecificVariance: Array<{ securityId: string; reason: string }> = [];
  for (const security of securities) {
    const residuals = residualsBySecurity.get(security.securityId) ?? [];
    if (residuals.length < 6) {
      excludedFromSpecificVariance.push({ securityId: security.securityId, reason: `requires >=6 usable regression residuals, got ${residuals.length}` });
      continue;
    }
    specificVariances[security.securityId] = sampleVariance(residuals) * periodsPerYear;
  }

  return {
    factorReturnSeries,
    factorCovariance,
    factorCovarianceAnnualizationPeriodsPerYear: periodsPerYear,
    specificVariances,
    excludedFromSpecificVariance,
    periodsUsed: factorReturnSeries.length,
    excludedPeriods,
    regressionRSquaredByPeriod,
  };
}
