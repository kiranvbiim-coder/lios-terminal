// Standard descriptive-statistics formulas for a numeric sample (e.g. daily
// returns). Skewness/kurtosis use the bias-adjusted Fisher-Pearson
// formulas (same convention as Excel's SKEW()/KURT()), not the population
// versions -- matches what analysts expect when they see these labels.

export interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  variance: number;
  skewness: number | null;
  kurtosis: number | null;
  min: number;
  max: number;
  p5: number; p25: number; p75: number; p95: number; p99: number;
  annualizedVol: number | null;
  annualizedReturn: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// `periodsPerYear`: 252 for daily returns, annualizes vol/return if provided.
export function computeDescriptiveStats(values: number[], periodsPerYear?: number): DescriptiveStats {
  const n = values.length;
  if (n === 0) {
    return { count: 0, mean: 0, median: 0, stdDev: 0, variance: 0, skewness: null, kurtosis: null, min: 0, max: 0, p5: 0, p25: 0, p75: 0, p95: 0, p99: 0, annualizedVol: null, annualizedReturn: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);

  let skewness: number | null = null;
  let kurtosis: number | null = null;
  if (n > 2 && stdDev > 0) {
    const m3 = values.reduce((s, v) => s + ((v - mean) / stdDev) ** 3, 0);
    skewness = (n / ((n - 1) * (n - 2))) * m3;
  }
  if (n > 3 && stdDev > 0) {
    const m4 = values.reduce((s, v) => s + ((v - mean) / stdDev) ** 4, 0);
    kurtosis = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * m4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  }

  return {
    count: n,
    mean,
    median: percentile(sorted, 50),
    stdDev,
    variance,
    skewness,
    kurtosis,
    min: sorted[0],
    max: sorted[n - 1],
    p5: percentile(sorted, 5),
    p25: percentile(sorted, 25),
    p75: percentile(sorted, 75),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    annualizedVol: periodsPerYear ? stdDev * Math.sqrt(periodsPerYear) : null,
    annualizedReturn: periodsPerYear ? mean * periodsPerYear : null,
  };
}

export interface HistogramBucket { label: string; from: number; to: number; count: number }

export function computeHistogram(values: number[], bucketCount = 20): HistogramBucket[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: min.toFixed(2), from: min, to: max, count: values.length }];
  const width = (max - min) / bucketCount;
  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const from = min + i * width;
    const to = from + width;
    return { label: from.toFixed(2), from, to, count: 0 };
  });
  for (const v of values) {
    const idx = Math.min(bucketCount - 1, Math.floor((v - min) / width));
    buckets[idx].count++;
  }
  return buckets;
}

// Daily close-to-close simple returns, as percentages.
export function computeDailyReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }
  return returns;
}

// Z-score of each observation against the sample's own mean/std dev --
// domain-agnostic anomaly detection: "this reading is N std devs from
// normal", the same method NASA/NOAA use for temperature-anomaly reporting.
export function zScoreSeries(values: number[]): (number | null)[] {
  const n = values.length;
  if (n < 2) return values.map(() => null);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  if (stdDev === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / stdDev);
}

// ── Resampling: bootstrap CI / permutation test (LIMURIA_ENGINES Phase 2a) ──
// Both stay native TS -- pure resampling on plain arrays, no library needed
// (unlike the parametric tests in python-service/statistics_econometrics.py,
// which genuinely need scipy/statsmodels' distribution machinery).

export interface BootstrapCIResult {
  estimate: number; // the statistic computed on the real (unresampled) data
  ciLow: number;
  ciHigh: number;
}

// Percentile bootstrap CI for the sample mean: resample with replacement
// `nBoot` times, take the 2.5th/97.5th percentile of the resampled means
// (for a 95% CI; `confidence` controls the width generally).
export function bootstrapMeanCI(data: number[], nBoot = 2000, confidence = 95): BootstrapCIResult {
  const n = data.length;
  const estimate = data.reduce((s, v) => s + v, 0) / n;
  if (n === 0) return { estimate: 0, ciLow: 0, ciHigh: 0 };
  const bootMeans: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += data[Math.floor(Math.random() * n)];
    bootMeans.push(sum / n);
  }
  bootMeans.sort((a, b) => a - b);
  const alpha = (100 - confidence) / 2;
  const lowIdx = Math.max(0, Math.floor((alpha / 100) * nBoot));
  const highIdx = Math.min(nBoot - 1, Math.ceil((1 - alpha / 100) * nBoot) - 1);
  return { estimate, ciLow: bootMeans[lowIdx], ciHigh: bootMeans[highIdx] };
}

export interface PermutationTestResult {
  observedDifference: number;
  pValue: number;
}

// Permutation test for a difference in means: shuffle the pooled data
// between the two groups `nPerm` times, and count how often the shuffled
// difference is at least as extreme as the real one -- a distribution-free
// significance test, no normality assumption needed (unlike the t-test).
export function permutationTestMeanDiff(group1: number[], group2: number[], nPerm = 5000): PermutationTestResult {
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const observedDifference = mean(group1) - mean(group2);
  const pooled = [...group1, ...group2];
  const n1 = group1.length;
  let countAtLeastAsExtreme = 0;
  for (let p = 0; p < nPerm; p++) {
    const shuffled = [...pooled];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const permDiff = mean(shuffled.slice(0, n1)) - mean(shuffled.slice(n1));
    if (Math.abs(permDiff) >= Math.abs(observedDifference)) countAtLeastAsExtreme++;
  }
  return { observedDifference, pValue: countAtLeastAsExtreme / nPerm };
}
