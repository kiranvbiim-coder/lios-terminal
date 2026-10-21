import { apiRequest } from "@/lib/queryClient";

export type AdvancedRiskReceipt = {
  dataClassification: string;
  modelPath: string;
  modelId: string;
  modelVersion: string;
  validationLevel: string;
  runId: string;
  inputSnapshotHash: string;
  outputSnapshotHash: string;
  datasetSnapshotIds: string[];
  effectiveAt: string | null;
  calculatedAt: string;
  seed: number | null;
  sourceBindings: Array<{ field: string; connectorId: string; provider: string; sourceReference: string; asOf: string; retrievedAt: string; freshness: string; snapshot: { id: string; contentHash: string } }>;
  transformations: string[];
  warnings: string[];
};

export type AdvancedRiskResponse<T> = T & { receipt: AdvancedRiskReceipt };

export function withManualProvenance<T extends Record<string, unknown>>(parameters: T, transformations: readonly string[] = []) {
  return {
    ...parameters,
    inputProvenance: {
      dataClassification: "manual" as const,
      manualInputs: parameters,
      transformations: [...transformations],
    },
  };
}

export async function runAdvancedPortfolioRisk<T extends Record<string, unknown>>(path: string, parameters: Record<string, unknown>, transformations: readonly string[] = []): Promise<AdvancedRiskResponse<T>> {
  const response = await apiRequest("POST", `/api/quant/advanced/${path}`, withManualProvenance(parameters, transformations));
  return response.json() as Promise<AdvancedRiskResponse<T>>;
}

export function parseNumberList(value: string, label: string, minimum = 1): number[] {
  const numbers = value.split(",").map((item) => Number(item.trim()));
  if (numbers.length < minimum || numbers.some((item) => !Number.isFinite(item))) throw new Error(`${label} requires ${minimum} or more finite comma-separated numbers.`);
  return numbers;
}

export function parseJson<T>(value: string, label: string): T {
  try { return JSON.parse(value) as T; } catch { throw new Error(`${label} must be valid JSON.`); }
}

export function assertWeights(weights: number[], length: number, label: string) {
  if (weights.length !== length || weights.some((weight) => !Number.isFinite(weight)) || Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-6) {
    throw new Error(`${label} must contain ${length} finite values that sum to 1.`);
  }
}

export function assertSquareMatrix(matrix: number[][], size: number, label: string, positiveDefinite = false) {
  if (matrix.length !== size || matrix.some((row) => row.length !== size || row.some((value) => !Number.isFinite(value)))) throw new Error(`${label} must be a ${size} × ${size} finite matrix.`);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) if (Math.abs(matrix[row][column] - matrix[column][row]) > 1e-8) throw new Error(`${label} must be symmetric.`);
  if (positiveDefinite && matrix.some((row, index) => row[index] <= 0)) throw new Error(`${label} must have positive diagonal values.`);
}
