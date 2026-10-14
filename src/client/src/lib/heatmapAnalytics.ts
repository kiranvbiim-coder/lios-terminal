import type { Quote } from "./finance";

export interface HeatmapMetricRow {
  symbol: string;
  value: number;
}

export interface HeatmapSectorSummary {
  sector: string;
  count: number;
  advances: number;
  declines: number;
  flat: number;
  marketCap: number;
  weightedMove: number | null;
}

export interface HeatmapAnalytics {
  advances: number;
  declines: number;
  flat: number;
  averageMove: number;
  totalMarketCap: number;
  sectors: HeatmapSectorSummary[];
  relativeVolume: HeatmapMetricRow[];
  contribution: HeatmapMetricRow[];
  moveZScore: HeatmapMetricRow[];
  extremes: HeatmapMetricRow[];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function relativeVolumeForQuote(quote: Pick<Quote, "volume" | "avgVolume">): number | null {
  if (!finite(quote.volume) || !finite(quote.avgVolume) || quote.avgVolume <= 0) return null;
  return quote.volume / quote.avgVolume;
}

export function contributionForQuote(quote: Pick<Quote, "marketCap" | "changePercent">, totalMarketCap: number): number | null {
  if (!finite(quote.marketCap) || quote.marketCap <= 0 || !finite(quote.changePercent) || totalMarketCap <= 0) return null;
  return (quote.marketCap / totalMarketCap) * quote.changePercent;
}

export function computeMoveZScores(quotes: Pick<Quote, "symbol" | "changePercent">[]): HeatmapMetricRow[] {
  const rows = quotes.filter((quote) => finite(quote.changePercent));
  if (!rows.length) return [];
  const mean = rows.reduce((sum, quote) => sum + quote.changePercent, 0) / rows.length;
  const variance = rows.reduce((sum, quote) => sum + (quote.changePercent - mean) ** 2, 0) / rows.length;
  const sd = Math.sqrt(variance);
  return rows.map((quote) => ({ symbol: quote.symbol, value: sd > 0 ? (quote.changePercent - mean) / sd : 0 }));
}

export function computeHeatmapAnalytics(quotes: Quote[]): HeatmapAnalytics {
  const validMoves = quotes.filter((quote) => finite(quote.changePercent));
  const advances = validMoves.filter((quote) => quote.changePercent > 0).length;
  const declines = validMoves.filter((quote) => quote.changePercent < 0).length;
  const flat = validMoves.length - advances - declines;
  const averageMove = validMoves.length ? validMoves.reduce((sum, quote) => sum + quote.changePercent, 0) / validMoves.length : 0;
  const totalMarketCap = quotes.reduce((sum, quote) => sum + (finite(quote.marketCap) && quote.marketCap > 0 ? quote.marketCap : 0), 0);

  const sectorMap = new Map<string, Quote[]>();
  for (const quote of quotes) {
    const sector = quote.sector?.trim() || "UNCLASSIFIED";
    const bucket = sectorMap.get(sector) ?? [];
    bucket.push(quote);
    sectorMap.set(sector, bucket);
  }
  const sectors = Array.from(sectorMap.entries()).map(([sector, members]) => {
    const cap = members.reduce((sum, quote) => sum + (finite(quote.marketCap) && quote.marketCap > 0 ? quote.marketCap : 0), 0);
    const weightedNumerator = members.reduce((sum, quote) => sum + (finite(quote.marketCap) && quote.marketCap > 0 && finite(quote.changePercent) ? quote.marketCap * quote.changePercent : 0), 0);
    const valid = members.filter((quote) => finite(quote.changePercent));
    return {
      sector,
      count: members.length,
      advances: valid.filter((quote) => quote.changePercent > 0).length,
      declines: valid.filter((quote) => quote.changePercent < 0).length,
      flat: valid.filter((quote) => quote.changePercent === 0).length,
      marketCap: cap,
      weightedMove: cap > 0 ? weightedNumerator / cap : null,
    };
  }).sort((a, b) => b.marketCap - a.marketCap || a.sector.localeCompare(b.sector));

  const relativeVolume = quotes
    .map((quote) => ({ symbol: quote.symbol, value: relativeVolumeForQuote(quote) }))
    .filter((row): row is HeatmapMetricRow => row.value !== null)
    .sort((a, b) => b.value - a.value);

  const contribution = quotes
    .map((quote) => ({ symbol: quote.symbol, value: contributionForQuote(quote, totalMarketCap) }))
    .filter((row): row is HeatmapMetricRow => row.value !== null)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const moveZScore = computeMoveZScores(quotes).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const extremes = validMoves.map((quote) => ({ symbol: quote.symbol, value: quote.changePercent })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return { advances, declines, flat, averageMove, totalMarketCap, sectors, relativeVolume, contribution, moveZScore, extremes };
}
