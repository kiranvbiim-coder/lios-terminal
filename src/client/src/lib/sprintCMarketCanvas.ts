import type { MarketBreadthResult } from "./useFinance";

type BreadthPoint = MarketBreadthResult["series"][number];
type LatestBreadth = NonNullable<MarketBreadthResult["latest"]>;

export interface RecordedBreadthRow {
  date: string;
  advances: number;
  declines: number;
  net: number;
}

function count(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function actualIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function percentages(advances: number, declines: number, unchanged: number, netAdvances?: number) {
  if (![advances, declines, unchanged].every(count)) return null;
  const total = advances + declines + unchanged;
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  if (netAdvances !== undefined && (!Number.isFinite(netAdvances) || Math.abs(netAdvances) > total)) return null;
  return {
    advances: advances / total * 100,
    declines: declines / total * 100,
    unchanged: unchanged / total * 100,
    net: netAdvances === undefined ? null : netAdvances / total * 100,
  };
}

/** A chart row is displayed only when a recorded, finite observation is usable. */
export function recordedBreadthRows(points: readonly BreadthPoint[], limit: number): RecordedBreadthRow[] {
  const bound = Number.isFinite(limit) ? Math.max(0, Math.min(90, Math.trunc(limit))) : 0;
  return points.slice(-bound || points.length).filter((point): point is BreadthPoint => Boolean(point))
    .flatMap(point => {
      const values = percentages(point.advances, point.declines, point.unchanged, point.netAdvances);
      if (!values || values.net === null || typeof point.date !== "string" || !actualIsoDate(point.date)) return [];
      return [{ date: point.date, advances: values.advances, declines: -values.declines, net: values.net }];
    }).slice(-bound);
}

export function recordedLatestBreadth(latest: LatestBreadth | null | undefined) {
  if (!latest) return null;
  return percentages(latest.advances, latest.declines, latest.unchanged);
}

/** Escape arbitrary provider dates from local parser surprises; presentation only. */
export function shortRecordedMarketDate(date: string): string {
  if (!actualIsoDate(date)) return date;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return date;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}
