export interface KellyInput {
  winProbability: number;
  averageWinR: number;
  averageLossR: number;
}

export interface KellyResult {
  fraction: number;
  payoffRatio: number;
}

export function kellyAllocation(input: KellyInput): KellyResult | null {
  const { winProbability, averageWinR, averageLossR } = input;
  if (!Number.isFinite(winProbability) || winProbability < 0 || winProbability > 1) return null;
  if (!Number.isFinite(averageWinR) || averageWinR < 0) return null;
  if (!Number.isFinite(averageLossR) || averageLossR <= 0) return null;
  const payoffRatio = averageWinR / averageLossR;
  if (!(payoffRatio > 0) || !Number.isFinite(payoffRatio)) return null;
  const lossProbability = 1 - winProbability;
  const fraction = (winProbability * payoffRatio - lossProbability) / payoffRatio;
  return { fraction: Math.max(0, fraction), payoffRatio };
}
