import type { OHLCVBar } from "./finance";

export interface ReturnObservation {
  date: string;
  value: number;
}

export interface PairCorrelation {
  value: number | null;
  observations: number;
  startDate: string | null;
  endDate: string | null;
}

export interface CorrelationMatrixResult {
  matrix: PairCorrelation[][];
  minPairObservations: number;
  maxPairObservations: number;
}

export function dailyReturnsFromBars(bars: OHLCVBar[], maxObservations = 90): ReturnObservation[] {
  const clean = bars
    .filter((bar) => Boolean(bar.date) && Number.isFinite(bar.close) && bar.close > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const returns: ReturnObservation[] = [];
  for (let index = 1; index < clean.length; index += 1) {
    const previous = clean[index - 1].close;
    const current = clean[index].close;
    if (!(previous > 0) || !(current > 0)) continue;
    const value = current / previous - 1;
    if (Number.isFinite(value)) returns.push({ date: clean[index].date, value });
  }
  return returns.slice(-Math.max(1, maxObservations));
}

export function pearsonCorrelation(
  left: ReturnObservation[],
  right: ReturnObservation[],
  minimumObservations = 20,
): PairCorrelation {
  const rightByDate = new Map(right.map((point) => [point.date, point.value]));
  const paired = left
    .flatMap((point) => {
      const other = rightByDate.get(point.date);
      return Number.isFinite(other) ? [{ date: point.date, x: point.value, y: other as number }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const observations = paired.length;
  const startDate = paired[0]?.date ?? null;
  const endDate = paired[paired.length - 1]?.date ?? null;
  if (observations < minimumObservations) return { value: null, observations, startDate, endDate };

  const meanX = paired.reduce((sum, point) => sum + point.x, 0) / observations;
  const meanY = paired.reduce((sum, point) => sum + point.y, 0) / observations;
  let covariance = 0;
  let sumSqX = 0;
  let sumSqY = 0;
  for (const point of paired) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    covariance += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }
  const denominator = Math.sqrt(sumSqX * sumSqY);
  if (!(denominator > 0)) return { value: null, observations, startDate, endDate };

  const value = Math.max(-1, Math.min(1, covariance / denominator));
  return { value, observations, startDate, endDate };
}

export function buildCorrelationMatrix(
  series: ReturnObservation[][],
  minimumObservations = 20,
): CorrelationMatrixResult {
  const matrix = series.map((left, rowIndex) => series.map((right, columnIndex) => {
    if (rowIndex === columnIndex) {
      const observations = left.length;
      return {
        value: observations >= minimumObservations ? 1 : null,
        observations,
        startDate: left[0]?.date ?? null,
        endDate: left[left.length - 1]?.date ?? null,
      };
    }
    return pearsonCorrelation(left, right, minimumObservations);
  }));

  const offDiagonal = matrix.flatMap((row, rowIndex) => row.filter((_, columnIndex) => rowIndex !== columnIndex));
  const counts = offDiagonal.map((cell) => cell.observations);
  return {
    matrix,
    minPairObservations: counts.length ? Math.min(...counts) : 0,
    maxPairObservations: counts.length ? Math.max(...counts) : 0,
  };
}
