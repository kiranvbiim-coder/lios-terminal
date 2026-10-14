export type MarketDataInterval = "5m" | "15m" | "1h" | "1d";

export interface PricePointInput {
  timestamp: number;
  price: number;
  volume: number;
}

export interface OhlcvBarOutput {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function parseNumberish(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function formatCompactDate(raw: string | undefined): string {
  if (!raw || raw.length !== 8) return "";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function formatCompactTime(raw: string | undefined): string {
  if (!raw || raw.length !== 6) return "";
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
}

export function stripHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSearchQuery(query?: string): string {
  return query?.trim().toLowerCase() ?? "";
}

function intervalBucketMs(interval: MarketDataInterval): number {
  switch (interval) {
    case "5m": return 5 * 60_000;
    case "15m": return 15 * 60_000;
    case "1h": return 60 * 60_000;
    case "1d":
    default:
      return 24 * 60 * 60_000;
  }
}

export function aggregatePricePoints(points: PricePointInput[], interval: MarketDataInterval): OhlcvBarOutput[] {
  if (!points.length) return [];
  const bucketMs = intervalBucketMs(interval);
  const buckets = new Map<number, PricePointInput[]>();

  for (const point of points) {
    const bucketStart = Math.floor(point.timestamp / bucketMs) * bucketMs;
    const group = buckets.get(bucketStart) ?? [];
    group.push(point);
    buckets.set(bucketStart, group);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, bucketPoints]) => ({
      date: new Date(bucketStart).toISOString(),
      open: round(bucketPoints[0].price),
      high: round(Math.max(...bucketPoints.map((point) => point.price))),
      low: round(Math.min(...bucketPoints.map((point) => point.price))),
      close: round(bucketPoints.at(-1)?.price ?? bucketPoints[0].price),
      volume: Math.round(bucketPoints.reduce((sum, point) => sum + point.volume, 0)),
    }));
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function mapToStooqSymbol(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  if (upper === "^GSPC") return "^spx";
  if (upper === "^DJI") return "^dji";
  if (upper === "^IXIC") return "^ndq";
  if (upper === "^RUT") return "iwm.us";
  if (upper === "GC=F") return "gc.f";
  if (upper === "CL=F") return "cl.f";
  if (upper === "EURUSD") return "eurusd";
  if (upper === "GBPUSD") return "gbpusd";
  if (upper === "USDJPY") return "usdjpy";
  if (upper.endsWith("-USD")) return null;
  if (upper.startsWith("^")) return upper.toLowerCase();
  return `${upper.toLowerCase()}.us`;
}
