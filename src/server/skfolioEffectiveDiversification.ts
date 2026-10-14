/**
 * Source-pinned skfolio effective number of assets (inverse Herfindahl),
 * adapted to existing LiOS read-only portfolio analytics. BSD-3-Clause.
 * skfolio/skfolio@eb73a4cfe3136d5615a6047060705695d4462588
 * src/skfolio/measures/_measures.py, blob 6451c83f92b80af50cdc9f8eca275da4bd635af4.
 *
 * P11 remains authoritative for portfolio accounting/trading. This does not
 * fetch prices, model correlations, assume a cash position, or perform
 * optimization. Only long, complete positive finite recorded exposures can
 * produce an effective-asset count; leverage/shorts fail closed.
 */

/** Exact inverse sum of squared normalized non-negative investment exposures. */
export function effectiveAssetCount(exposures: readonly number[]): number | null {
  if (exposures.length === 0 || exposures.length > 10_000) return null;
  if (exposures.some(x => !Number.isFinite(x) || x < 0)) return null;
  const max = Math.max(...exposures);
  if (!Number.isFinite(max) || max <= 0) return null;
  const scaled = exposures.map(x => x / max);
  const total = scaled.reduce((sum, x) => sum + x, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const squares = scaled.reduce((sum, x) => sum + (x / total) ** 2, 0);
  const result = 1 / squares;
  return Number.isFinite(result) && result >= 1 - 1e-10 && result <= exposures.length + 1e-8
    ? Math.max(1, result) : null;
}

export interface RecordedConcentrationInput {
  positions: readonly { symbol: string; shares: number }[];
  histories: Readonly<Record<string, readonly { date: string; close: number }[]>>;
  asOfDate: string;
}

/** Refuse to carry a stale quotation forward for concentration scoring. */
export function effectiveAssetCountAtRecordedDate(input: RecordedConcentrationInput): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate) || !input.positions.length || input.positions.length > 10_000) return null;
  const holdings = new Map<string, number>();
  for (const item of input.positions) {
    if (!item.symbol || !Number.isFinite(item.shares) || item.shares < 0) return null;
    if (item.shares === 0) continue;
    const observations = input.histories[item.symbol];
    if (!observations) return null;
    const matches = observations.filter(point => point.date === input.asOfDate);
    if (matches.length !== 1 || !Number.isFinite(matches[0].close) || matches[0].close <= 0) return null;
    const exposure = matches[0].close * item.shares;
    if (!Number.isFinite(exposure)) return null;
    const sum = (holdings.get(item.symbol) ?? 0) + exposure;
    if (!Number.isFinite(sum)) return null;
    holdings.set(item.symbol, sum);
  }
  return effectiveAssetCount([...holdings.values()]);
}
