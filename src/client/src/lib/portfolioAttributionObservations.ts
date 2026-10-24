import type { Quote, OHLCVSeries } from "./finance";
import { brinsonAttribution, type BrinsonRow } from "./quantModels";

export interface AttributionHolding { symbol: string; weight: number }

export type AttributionPreparation =
  | { state: "ready"; rows: BrinsonRow[]; startDate: string; endDate: string; commonObservations: number; priceSources: string[]; fallbackSymbols: string[] }
  | { state: "unavailable"; message: string; symbols: string[] };

/** Weights are relative positive units, not automatically percentages. Invalid
 * or duplicate holdings must never disappear silently and change the benchmark. */
export function parseAttributionHoldings(raw: string): { holdings: AttributionHolding[]; error: string | null } {
  const tokens = raw.split(",").map((entry) => entry.trim());
  if (tokens.some((entry) => !entry)) return { holdings: [], error: "Holdings must be non-empty SYMBOL:WEIGHT pairs separated by commas." };
  const parsed: AttributionHolding[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const pair = token.split(":");
    if (pair.length !== 2) return { holdings: [], error: `Invalid holding "${token}": use SYMBOL:WEIGHT.` };
    const symbol = pair[0].trim().toUpperCase();
    const value = pair[1].trim();
    const weight = Number(value);
    if (!/^[A-Z^][A-Z0-9.^=_-]{0,24}$/.test(symbol) || !value || !Number.isFinite(weight) || weight <= 0) {
      return { holdings: [], error: `Invalid holding "${token}": a listed-looking symbol and positive finite relative weight are required.` };
    }
    if (seen.has(symbol)) return { holdings: [], error: `Duplicate holding ${symbol}. Combine its weight before applying.` };
    seen.add(symbol);
    parsed.push({ symbol, weight });
  }
  const total = parsed.reduce((sum, holding) => sum + holding.weight, 0);
  if (!Number.isFinite(total) || total <= 0) return { holdings: [], error: "Total holding weight must be positive and finite." };
  return { holdings: parsed.map((holding) => ({ ...holding, weight: holding.weight / total })), error: null };
}

const missing = (message: string, symbols: string[] = []): AttributionPreparation => ({ state: "unavailable", message, symbols });

/** Client comparison only. Neither OHLCV nor quote lookup is an immutable
 * signed dataset receipt, and price changes omit distributions/FX effects. */
export function computeObservedBrinsonAttribution(
  actual: readonly AttributionHolding[],
  benchmark: readonly AttributionHolding[],
  quotes: readonly Pick<Quote, "symbol" | "sector" | "status">[],
  histories: Readonly<Record<string, OHLCVSeries | undefined>>,
): AttributionPreparation {
  if (!actual.length || !benchmark.length) return missing("Apply non-empty weights for both portfolios.");
  const symbols = [...new Set([...actual, ...benchmark].map((holding) => holding.symbol))];
  if ([...actual, ...benchmark].some(({ symbol, weight }) => !symbol || !Number.isFinite(weight) || weight <= 0)) {
    return missing("Holdings contain invalid weights or symbols; no attribution was calculated.");
  }
  const sectorBySymbol = new Map(quotes.filter((quote) =>
    typeof quote.sector === "string" && quote.sector.trim()
  ).map((quote) => [quote.symbol.toUpperCase(), quote.sector!.trim()]));
  const missingSectors = symbols.filter((symbol) => !sectorBySymbol.has(symbol));
  if (missingSectors.length) return missing("Observed quote-sector classification unavailable. Sector attribution cannot assume 'Other' or invent sector returns.", missingSectors);

  const closeBySymbol = new Map<string, Map<string, number>>();
  for (const symbol of symbols) {
    const history = histories[symbol];
    if (!history || !Array.isArray(history.bars)) return missing("Observed daily price series unavailable; missing history is not a zero return.", [symbol]);
    const dates = new Map<string, number>();
    for (const bar of history.bars) {
      if (typeof bar?.date !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(bar.date.slice(0, 10))) continue;
      if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
      const day = bar.date.slice(0, 10);
      if (dates.has(day)) return missing("Ambiguous duplicate daily close for a holding; no attribution was calculated.", [symbol]);
      dates.set(day, bar.close);
    }
    if (dates.size < 2) return missing("Two positive observed daily closes are required for every holding; no zero-price substitution.", [symbol]);
    closeBySymbol.set(symbol, dates);
  }
  const first = closeBySymbol.get(symbols[0])!;
  const commonDates = [...first.keys()].filter((day) => symbols.every((symbol) => closeBySymbol.get(symbol)?.has(day))).sort();
  if (commonDates.length < 2) return missing("No pair of common daily close dates across all holdings. Different date windows cannot be mixed.", symbols);
  const startDate = commonDates[0], endDate = commonDates[commonDates.length - 1];
  const periodReturn = new Map(symbols.map((symbol) => {
    const prices = closeBySymbol.get(symbol)!;
    return [symbol, (prices.get(endDate)! / prices.get(startDate)! - 1) * 100] as const;
  }));
  if ([...periodReturn.values()].some((value) => !Number.isFinite(value))) {
    return missing("Computed percentage price return was not finite; no attribution was calculated.");
  }

  const bySector = new Map<string, { wp: number; wb: number; wpReturnSum: number; wbReturnSum: number }>();
  const add = (items: readonly AttributionHolding[], side: "a" | "b") => {
    for (const holding of items) {
      const sector = sectorBySymbol.get(holding.symbol)!;
      const rate = periodReturn.get(holding.symbol)!;
      const value = bySector.get(sector) ?? { wp: 0, wb: 0, wpReturnSum: 0, wbReturnSum: 0 };
      if (side === "a") { value.wp += holding.weight; value.wpReturnSum += holding.weight * rate; }
      else { value.wb += holding.weight; value.wbReturnSum += holding.weight * rate; }
      bySector.set(sector, value);
    }
  };
  add(actual, "a");
  add(benchmark, "b");
  const inputs = [...bySector.entries()].map(([segment, v]) => {
    // For absent-side sectors use the present side as the rate reference: no
    // 0% missing-return invention, and selection stays zero for that sector.
    const reference = v.wp > 0 ? v.wpReturnSum / v.wp : v.wbReturnSum / v.wb;
    return { segment, wp: v.wp, wb: v.wb, rp: v.wp > 0 ? v.wpReturnSum / v.wp : reference, rb: v.wb > 0 ? v.wbReturnSum / v.wb : reference };
  });
  const priceSources = [...new Set(symbols.map((symbol) => histories[symbol]?.status?.delayLabel).filter((item): item is string => Boolean(item)))];
  const fallbackSymbols = symbols.filter((symbol) => histories[symbol]?.status?.isFallback || quotes.find((quote) => quote.symbol.toUpperCase() === symbol)?.status?.isFallback);
  return { state: "ready", rows: brinsonAttribution(inputs), startDate, endDate, commonObservations: commonDates.length, priceSources, fallbackSymbols };
}
