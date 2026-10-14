import {
  analyticalFingerprint,
  type AnalyticalDiagnostic,
  type AnalyticalInput,
  type AnalyticalModelDefinition,
  type AnalyticalRunStatus,
} from "./analyticalCore";
import { analyticalModelRegistry, type AnalyticalModelRegistry } from "./analyticalRegistry";

export const QUANT_PCA_MODEL_ID = "quant.principal-component-analysis";

export type QuantPcaMode = "covariance" | "correlation";

export interface QuantPcaInput {
  observations: number[][];
  labels?: string[];
  mode?: QuantPcaMode;
  components?: number;
  source?: string;
  sourceAsOf?: string | null;
}

export interface QuantPcaComponent {
  index: number;
  eigenvalue: number;
  explainedVarianceRatio: number;
  cumulativeExplainedVarianceRatio: number;
  vector: number[];
  topLoadingLabel: string;
  topLoadingValue: number;
}

export interface QuantPcaResult {
  status: "ready" | "partial" | "blocked";
  mode: QuantPcaMode;
  observationCount: number;
  variableCount: number;
  labels: string[];
  means: number[];
  scales: number[];
  covarianceMatrix: number[][];
  components: QuantPcaComponent[];
  scores: number[][];
  totalVariance: number;
  effectiveRank: number;
  converged: boolean;
  sweeps: number;
  diagnostics: AnalyticalDiagnostic[];
}

const EPSILON = 1e-12;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function emptyResult(input: QuantPcaInput, diagnostics: AnalyticalDiagnostic[]): QuantPcaResult {
  const variableCount = input.observations[0]?.length ?? 0;
  return {
    status: "blocked",
    mode: input.mode ?? "covariance",
    observationCount: input.observations.length,
    variableCount,
    labels: input.labels?.slice() ?? Array.from({ length: variableCount }, (_, index) => `X${index + 1}`),
    means: [],
    scales: [],
    covarianceMatrix: [],
    components: [],
    scores: [],
    totalVariance: 0,
    effectiveRank: 0,
    converged: false,
    sweeps: 0,
    diagnostics,
  };
}

function identity(size: number): number[][] {
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => (row === column ? 1 : 0)));
}

interface SymmetricEigenResult {
  values: number[];
  vectors: number[][];
  converged: boolean;
  sweeps: number;
}

function symmetricJacobiEigen(matrix: number[][]): SymmetricEigenResult {
  const size = matrix.length;
  if (size === 0) return { values: [], vectors: [], converged: true, sweeps: 0 };
  if (size === 1) return { values: [matrix[0][0]], vectors: [[1]], converged: true, sweeps: 0 };

  const a = matrix.map((row) => row.slice());
  const vectors = identity(size);
  const maxSweeps = Math.max(32, size * size * 50);
  let sweeps = 0;
  let converged = false;

  for (; sweeps < maxSweeps; sweeps += 1) {
    let p = 0;
    let q = 1;
    let largest = Math.abs(a[p][q]);
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const candidate = Math.abs(a[row][column]);
        if (candidate > largest) {
          largest = candidate;
          p = row;
          q = column;
        }
      }
    }

    const diagonalScale = Math.max(1, ...a.map((row, index) => Math.abs(row[index])));
    if (largest <= EPSILON * diagonalScale) {
      converged = true;
      break;
    }

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let index = 0; index < size; index += 1) {
      if (index === p || index === q) continue;
      const aip = a[index][p];
      const aiq = a[index][q];
      const rotatedP = cosine * aip - sine * aiq;
      const rotatedQ = sine * aip + cosine * aiq;
      a[index][p] = rotatedP;
      a[p][index] = rotatedP;
      a[index][q] = rotatedQ;
      a[q][index] = rotatedQ;
    }

    a[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    a[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let row = 0; row < size; row += 1) {
      const vip = vectors[row][p];
      const viq = vectors[row][q];
      vectors[row][p] = cosine * vip - sine * viq;
      vectors[row][q] = sine * vip + cosine * viq;
    }
  }

  return {
    values: a.map((row, index) => row[index]),
    vectors,
    converged,
    sweeps,
  };
}

function normalizeComponentSign(vector: number[]): number[] {
  if (!vector.length) return vector;
  let anchor = 0;
  for (let index = 1; index < vector.length; index += 1) {
    if (Math.abs(vector[index]) > Math.abs(vector[anchor])) anchor = index;
  }
  if (vector[anchor] >= 0) return vector;
  return vector.map((value) => -value);
}

function dot(left: readonly number[], right: readonly number[]): number {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}

function blocked(id: string, label: string, detail: string): AnalyticalDiagnostic {
  return { id, label, severity: "critical", detail, blocking: true };
}

function stableVectorOrder(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return left.length - right.length;
}

export function runQuantPca(input: QuantPcaInput): QuantPcaResult {
  const mode = input.mode ?? "covariance";
  const observationCount = input.observations.length;
  if (observationCount < 2) return emptyResult(input, [blocked("insufficient-observations", "INSUFFICIENT OBSERVATIONS", "PCA requires at least two observations.")]);

  const variableCount = input.observations[0]?.length ?? 0;
  if (variableCount < 1) return emptyResult(input, [blocked("missing-variables", "NO VARIABLES", "PCA requires at least one variable.")]);
  if (input.observations.some((row) => row.length !== variableCount)) {
    return emptyResult(input, [blocked("ragged-matrix", "INCONSISTENT MATRIX WIDTH", "Every observation must contain the same number of variables.")]);
  }
  if (input.observations.some((row) => row.some((value) => !finite(value)))) {
    return emptyResult(input, [blocked("non-finite-observation", "NON-FINITE OBSERVATION", "Observation matrix contains NaN or infinite values.")]);
  }

  const diagnostics: AnalyticalDiagnostic[] = [];
  const labels = input.labels?.length === variableCount
    ? input.labels.slice()
    : Array.from({ length: variableCount }, (_, index) => `X${index + 1}`);
  if (input.labels && input.labels.length !== variableCount) {
    diagnostics.push({
      id: "label-count-mismatch",
      label: "LABEL COUNT MISMATCH",
      severity: "watch",
      detail: `Received ${input.labels.length} labels for ${variableCount} variables; generated stable fallback labels instead.`,
    });
  }

  const means = Array.from({ length: variableCount }, (_, column) => (
    input.observations.reduce((sum, row) => sum + row[column], 0) / observationCount
  ));
  const variances = Array.from({ length: variableCount }, (_, column) => (
    input.observations.reduce((sum, row) => {
      const centered = row[column] - means[column];
      return sum + centered * centered;
    }, 0) / (observationCount - 1)
  ));
  const standardDeviations = variances.map((variance) => Math.sqrt(Math.max(0, variance)));
  const zeroVarianceColumns = standardDeviations
    .map((scale, index) => ({ scale, index }))
    .filter(({ scale }) => scale <= EPSILON)
    .map(({ index }) => index);

  for (const index of zeroVarianceColumns) {
    diagnostics.push({
      id: `zero-variance-${index}`,
      label: "ZERO-VARIANCE VARIABLE",
      severity: "watch",
      detail: `${labels[index]} has no measurable sample variance and contributes no principal-component information.`,
      metric: 0,
    });
  }

  const scales = mode === "correlation"
    ? standardDeviations.map((scale) => (scale <= EPSILON ? 1 : scale))
    : Array.from({ length: variableCount }, () => 1);
  const transformed = input.observations.map((row) => row.map((value, column) => (value - means[column]) / scales[column]));
  const covarianceMatrix = Array.from({ length: variableCount }, (_, row) => Array.from({ length: variableCount }, (_, column) => {
    let sum = 0;
    for (let observation = 0; observation < observationCount; observation += 1) {
      sum += transformed[observation][row] * transformed[observation][column];
    }
    return sum / (observationCount - 1);
  }));

  const eigen = symmetricJacobiEigen(covarianceMatrix);
  if (!eigen.converged) {
    diagnostics.push({
      id: "eigensolver-convergence",
      label: "EIGENSOLVER DID NOT CONVERGE",
      severity: "critical",
      detail: `Jacobi eigensolver exceeded ${eigen.sweeps} rotations.`,
      blocking: true,
    });
  }

  const eigenPairs = eigen.values
    .map((rawValue, index) => ({
      value: rawValue < 0 && Math.abs(rawValue) <= EPSILON ? 0 : rawValue,
      vector: normalizeComponentSign(eigen.vectors.map((row) => row[index])),
    }))
    .sort((left, right) => right.value - left.value || stableVectorOrder(left.vector, right.vector));
  const totalVariance = eigenPairs.reduce((sum, pair) => sum + Math.max(0, pair.value), 0);
  if (totalVariance <= EPSILON) {
    diagnostics.push(blocked("no-variance", "NO EXPLAINABLE VARIANCE", "The transformed observation matrix has no variance to decompose."));
    return {
      status: "blocked",
      mode,
      observationCount,
      variableCount,
      labels,
      means,
      scales,
      covarianceMatrix,
      components: [],
      scores: [],
      totalVariance,
      effectiveRank: 0,
      converged: eigen.converged,
      sweeps: eigen.sweeps,
      diagnostics,
    };
  }

  const defaultComponentCount = Math.min(3, variableCount);
  const requestedComponents = input.components ?? defaultComponentCount;
  const requestedIsValid = Number.isFinite(requestedComponents) && requestedComponents >= 1;
  const componentCount = requestedIsValid
    ? Math.max(1, Math.min(variableCount, Math.floor(requestedComponents)))
    : defaultComponentCount;
  if (!requestedIsValid || requestedComponents > variableCount || requestedComponents !== Math.floor(requestedComponents)) {
    diagnostics.push({
      id: "component-count-adjusted",
      label: "COMPONENT COUNT ADJUSTED",
      severity: "watch",
      detail: `Requested ${String(requestedComponents)} components; using ${componentCount}.`,
      metric: componentCount,
    });
  }

  let cumulative = 0;
  const components = eigenPairs.slice(0, componentCount).map((pair, index): QuantPcaComponent => {
    const explainedVarianceRatio = Math.max(0, pair.value) / totalVariance;
    cumulative += explainedVarianceRatio;
    let topLoadingIndex = 0;
    for (let variable = 1; variable < pair.vector.length; variable += 1) {
      if (Math.abs(pair.vector[variable]) > Math.abs(pair.vector[topLoadingIndex])) topLoadingIndex = variable;
    }
    return {
      index: index + 1,
      eigenvalue: pair.value,
      explainedVarianceRatio,
      cumulativeExplainedVarianceRatio: cumulative,
      vector: pair.vector,
      topLoadingLabel: labels[topLoadingIndex],
      topLoadingValue: pair.vector[topLoadingIndex],
    };
  });
  const scores = transformed.map((row) => components.map((component) => dot(row, component.vector)));
  const rankTolerance = Math.max(EPSILON, Math.abs(eigenPairs[0]?.value ?? 0) * 1e-10);
  const effectiveRank = eigenPairs.filter((pair) => pair.value > rankTolerance).length;

  diagnostics.push({
    id: "effective-rank",
    label: "EFFECTIVE RANK",
    severity: effectiveRank < variableCount ? "info" : "ok",
    detail: `${effectiveRank} of ${variableCount} directions carry independent variance above tolerance.`,
    metric: effectiveRank,
  });
  diagnostics.push({
    id: "pc1-concentration",
    label: "PC1 VARIANCE CONCENTRATION",
    severity: components[0]?.explainedVarianceRatio >= 0.8 ? "info" : "ok",
    detail: "Share of total transformed variance explained by the first principal component.",
    metric: (components[0]?.explainedVarianceRatio ?? 0) * 100,
    unit: "%",
  });

  const hasCritical = diagnostics.some((diagnostic) => diagnostic.severity === "critical");
  const hasWatch = diagnostics.some((diagnostic) => diagnostic.severity === "watch");
  return {
    status: hasCritical ? "blocked" : hasWatch ? "partial" : "ready",
    mode,
    observationCount,
    variableCount,
    labels,
    means,
    scales,
    covarianceMatrix,
    components,
    scores,
    totalVariance,
    effectiveRank,
    converged: eigen.converged,
    sweeps: eigen.sweeps,
    diagnostics,
  };
}

function pcaInputs(input: QuantPcaInput): AnalyticalInput[] {
  const variableCount = input.observations[0]?.length ?? 0;
  return [
    {
      id: "datasetFingerprint",
      label: "DATASET FINGERPRINT",
      value: analyticalFingerprint({ observations: input.observations, labels: input.labels ?? null }),
      kind: "observed",
      source: input.source ?? "LiOS quantitative workspace",
      asOf: input.sourceAsOf,
    },
    { id: "observationCount", label: "OBSERVATIONS", value: input.observations.length, kind: "observed" },
    { id: "variableCount", label: "VARIABLES", value: variableCount, kind: "observed" },
    { id: "mode", label: "PCA MODE", value: input.mode ?? "covariance", kind: "assumption" },
    { id: "components", label: "REQUESTED COMPONENTS", value: input.components ?? Math.min(3, variableCount), kind: "assumption" },
  ];
}

function pcaStatus(status: QuantPcaResult["status"]): AnalyticalRunStatus {
  return status === "ready" ? "success" : status === "partial" ? "partial" : "blocked";
}

export const QUANT_PCA_ANALYTICAL_MODEL: AnalyticalModelDefinition<QuantPcaInput> = {
  id: QUANT_PCA_MODEL_ID,
  label: "Principal Component Analysis",
  domain: "quant",
  version: "1.0.0",
  determinism: "deterministic",
  description: "Deterministic covariance/correlation PCA with Jacobi symmetric eigendecomposition, stable component orientation and health diagnostics.",
  describeInputs: (input) => pcaInputs(input),
  execute: (input) => {
    const result = runQuantPca(input);
    const selectedCumulative = result.components.at(-1)?.cumulativeExplainedVarianceRatio ?? null;
    return {
      status: pcaStatus(result.status),
      outputs: [
        { id: "pc1ExplainedVariancePct", label: "PC1 EXPLAINED VARIANCE", value: result.components[0] ? result.components[0].explainedVarianceRatio * 100 : null, unit: "%", role: "primary" },
        { id: "selectedCumulativeVariancePct", label: "SELECTED CUMULATIVE VARIANCE", value: selectedCumulative === null ? null : selectedCumulative * 100, unit: "%", role: "primary" },
        { id: "effectiveRank", label: "EFFECTIVE RANK", value: result.effectiveRank, role: "diagnostic" },
        { id: "totalVariance", label: "TOTAL TRANSFORMED VARIANCE", value: result.totalVariance, role: "secondary" },
        { id: "componentsUsed", label: "COMPONENTS USED", value: result.components.length, role: "secondary" },
        ...result.components.flatMap((component) => [
          { id: `pc${component.index}.eigenvalue`, label: `PC${component.index} EIGENVALUE`, value: component.eigenvalue, role: "secondary" as const },
          { id: `pc${component.index}.explainedVariancePct`, label: `PC${component.index} EXPLAINED VARIANCE`, value: component.explainedVarianceRatio * 100, unit: "%", role: "secondary" as const },
          { id: `pc${component.index}.topLoading`, label: `PC${component.index} TOP LOADING`, value: component.topLoadingLabel, role: "diagnostic" as const },
        ]),
      ],
      diagnostics: result.diagnostics,
      evidence: input.source
        ? [{ id: "quant-source", label: "PCA INPUT DATASET", source: input.source, asOf: input.sourceAsOf }]
        : [],
      dependencies: [
        { id: "quant.sample-covariance", kind: "model", label: "Sample covariance/correlation transform", version: "1.0.0" },
        { id: "quant.symmetric-jacobi-eigen", kind: "model", label: "Symmetric Jacobi eigensolver", version: "1.0.0" },
      ],
      metadata: {
        mode: result.mode,
        labels: result.labels,
        means: result.means,
        scales: result.scales,
        covarianceMatrix: result.covarianceMatrix,
        components: result.components,
        scores: result.scores,
        converged: result.converged,
        sweeps: result.sweeps,
      },
    };
  },
};

export function registerQuantPcaAnalyticalModel(registry: AnalyticalModelRegistry = analyticalModelRegistry): AnalyticalModelRegistry {
  if (!registry.has(QUANT_PCA_MODEL_ID)) registry.register(QUANT_PCA_ANALYTICAL_MODEL);
  return registry;
}
