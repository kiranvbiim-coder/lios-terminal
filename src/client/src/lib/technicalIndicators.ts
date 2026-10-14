// Classic technical-analysis indicators, computed client-side from OHLCV
// bars already on hand (no extra network round-trip). Kept separate from
// quantModels.ts, which is statistical/econometric (GARCH, HMM, factor
// models) rather than chartist technical analysis -- different audience,
// different literature, worth not mixing in one file.

export interface OHLCVPoint { close: number; high: number; low: number; open?: number }

export function computeSMA(data: OHLCVPoint[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
    return sum / period;
  });
}

// EMA seeds from the first `period` closes' SMA (standard convention), then
// recurses with the usual smoothing factor k = 2/(period+1).
export function computeEMA(data: OHLCVPoint[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < period) return result;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += data[i].close;
  let prev = seed / period;
  result[period - 1] = prev;
  for (let i = period; i < data.length; i++) {
    prev = data[i].close * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

export function computeRSI(data: OHLCVPoint[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  if (period < 1 || data.length < period + 1) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = data[i].close - data[i - 1].close;
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Wilder smoothing after the seed. This is the convention used by the
  // verified LSE/Brue indicator implementation and avoids a silent semantic
  // mismatch between chart indicators and strategy/backtest calculations.
  for (let i = period + 1; i < data.length; i++) {
    const delta = data[i].close - data[i - 1].close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export interface MACDResult { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] }

// Standard (12, 26, 9): MACD line = EMA12 - EMA26, signal = EMA9 of the MACD
// line itself, histogram = MACD - signal.
export function computeMACD(data: OHLCVPoint[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const emaFast = computeEMA(data, fast);
  const emaSlow = computeEMA(data, slow);
  const macd: (number | null)[] = data.map((_, i) => {
    const f = emaFast[i], s = emaSlow[i];
    return f !== null && s !== null ? f - s : null;
  });

  // EMA of the MACD line, seeded from the first `signalPeriod` non-null MACD
  // values (can't reuse computeEMA directly since it seeds from raw closes).
  const signal: (number | null)[] = new Array(data.length).fill(null);
  const firstValid = macd.findIndex((v) => v !== null);
  if (firstValid >= 0 && data.length - firstValid >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let seed = 0;
    for (let i = firstValid; i < firstValid + signalPeriod; i++) seed += macd[i] as number;
    let prev = seed / signalPeriod;
    signal[firstValid + signalPeriod - 1] = prev;
    for (let i = firstValid + signalPeriod; i < data.length; i++) {
      prev = (macd[i] as number) * k + prev * (1 - k);
      signal[i] = prev;
    }
  }

  const histogram = data.map((_, i) => {
    const m = macd[i], sg = signal[i];
    return m !== null && sg !== null ? m - sg : null;
  });

  return { macd, signal, histogram };
}

export interface BollingerBands { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] }

// Standard (20, 2sigma): middle = SMA20, bands = middle +/- 2 * rolling stdev.
export function computeBollingerBands(data: OHLCVPoint[], period = 20, numStdDev = 2): BollingerBands {
  const middle = computeSMA(data, period);
  const upper: (number | null)[] = new Array(data.length).fill(null);
  const lower: (number | null)[] = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    const mean = middle[i] as number;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (data[j].close - mean) ** 2;
    const stdDev = Math.sqrt(sumSq / period);
    upper[i] = mean + numStdDev * stdDev;
    lower[i] = mean - numStdDev * stdDev;
  }
  return { upper, middle, lower };
}

export interface ADXResult { adx: (number | null)[]; plusDI: (number | null)[]; minusDI: (number | null)[] }

// Wilder's Average Directional Index (14) -- trend STRENGTH, not direction:
// ADX > 25 conventionally reads as "trending" regardless of which way, < 20
// as "no trend / range-bound". +DI/-DI crossovers are the directional signal.
export function computeADX(data: OHLCVPoint[], period = 14): ADXResult {
  const n = data.length;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [0];
  for (let i = 1; i < n; i++) {
    const upMove = data[i].high - data[i - 1].high;
    const downMove = data[i - 1].low - data[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close),
    ));
  }

  // Wilder smoothing: first value is a plain sum over `period`, subsequent
  // values decay the prior smoothed value by 1/period and add the new raw one.
  const wilderSmooth = (values: number[]): (number | null)[] => {
    const out: (number | null)[] = new Array(n).fill(null);
    if (n <= period) return out;
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += values[i];
    out[period] = sum;
    for (let i = period + 1; i < n; i++) {
      sum = (out[i - 1] as number) - (out[i - 1] as number) / period + values[i];
      out[i] = sum;
    }
    return out;
  };

  const smoothTR = wilderSmooth(tr);
  const smoothPlusDM = wilderSmooth(plusDM);
  const smoothMinusDM = wilderSmooth(minusDM);

  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  const dx: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const trV = smoothTR[i], pDM = smoothPlusDM[i], mDM = smoothMinusDM[i];
    if (trV === null || pDM === null || mDM === null || trV === 0) continue;
    const pDI = (pDM / trV) * 100;
    const mDI = (mDM / trV) * 100;
    plusDI[i] = pDI;
    minusDI[i] = mDI;
    const sum = pDI + mDI;
    dx[i] = sum > 0 ? (Math.abs(pDI - mDI) / sum) * 100 : 0;
  }

  // ADX is itself a Wilder-smoothed (period-length) average of DX.
  const adx: (number | null)[] = new Array(n).fill(null);
  const firstDX = dx.findIndex((v) => v !== null);
  if (firstDX >= 0 && n - firstDX >= period) {
    let sum = 0;
    for (let i = firstDX; i < firstDX + period; i++) sum += dx[i] as number;
    let prev = sum / period;
    adx[firstDX + period - 1] = prev;
    for (let i = firstDX + period; i < n; i++) {
      prev = (prev * (period - 1) + (dx[i] as number)) / period;
      adx[i] = prev;
    }
  }

  return { adx, plusDI, minusDI };
}

export interface DonchianChannel { upper: (number | null)[]; lower: (number | null)[] }

// Rolling N-day high/low channel -- a breakout is "today's close pierces the
// channel formed by the PRIOR N days" (excludes today's own bar, otherwise
// the channel trivially contains every close and no breakout could ever register).
export function computeDonchianChannel(data: OHLCVPoint[], period = 20): DonchianChannel {
  const upper: (number | null)[] = new Array(data.length).fill(null);
  const lower: (number | null)[] = new Array(data.length).fill(null);
  for (let i = period; i < data.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period; j < i; j++) {
      if (data[j].high > hi) hi = data[j].high;
      if (data[j].low < lo) lo = data[j].low;
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}

export interface BreakoutSignal { index: number; date: string; direction: "up" | "down"; close: number; level: number }

// Flags days where the close crosses outside the PRIOR period's Donchian
// channel -- a simple, standard breakout definition (not a prediction).
export function detectBreakouts(
  data: (OHLCVPoint & { date: string })[],
  period = 20,
): BreakoutSignal[] {
  const channel = computeDonchianChannel(data, period);
  const signals: BreakoutSignal[] = [];
  for (let i = period; i < data.length; i++) {
    const upper = channel.upper[i], lower = channel.lower[i];
    if (upper !== null && data[i].close > upper) {
      signals.push({ index: i, date: data[i].date, direction: "up", close: data[i].close, level: upper });
    } else if (lower !== null && data[i].close < lower) {
      signals.push({ index: i, date: data[i].date, direction: "down", close: data[i].close, level: lower });
    }
  }
  return signals;
}

export interface PivotLevel { price: number; type: "support" | "resistance"; strength: number }

// Support/resistance via local-extrema pivots (a pivot high/low is the max/min
// within a +/- `lookaround` window), then clusters nearby pivots (within
// `clusterPct` of each other) into a single level -- a level several pivots
// cluster around is a stronger, more standard support/resistance read than
// any single touch. Returns the strongest few levels, most-touched first.
export function detectSupportResistance(
  data: OHLCVPoint[],
  lookaround = 5,
  clusterPct = 0.015,
  maxLevels = 4,
): PivotLevel[] {
  const pivots: { price: number; type: "support" | "resistance" }[] = [];
  for (let i = lookaround; i < data.length - lookaround; i++) {
    const windowSlice = data.slice(i - lookaround, i + lookaround + 1);
    const isHigh = windowSlice.every((p) => p.high <= data[i].high);
    const isLow = windowSlice.every((p) => p.low >= data[i].low);
    if (isHigh) pivots.push({ price: data[i].high, type: "resistance" });
    if (isLow) pivots.push({ price: data[i].low, type: "support" });
  }

  const clusters: { prices: number[]; type: "support" | "resistance" }[] = [];
  for (const pivot of pivots) {
    const cluster = clusters.find(
      (c) => c.type === pivot.type && Math.abs(c.prices[0] - pivot.price) / pivot.price < clusterPct,
    );
    if (cluster) cluster.prices.push(pivot.price);
    else clusters.push({ prices: [pivot.price], type: pivot.type });
  }

  return clusters
    .map((c) => ({
      price: c.prices.reduce((s, p) => s + p, 0) / c.prices.length,
      type: c.type,
      strength: c.prices.length,
    }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, maxLevels);
}
