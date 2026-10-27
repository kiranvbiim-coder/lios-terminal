/**
 * Normalize authenticated News HTTP requests without trusting Express query
 * objects, arrays, invalid dates or unbounded RSS page/window parameters.
 * Older consumers receive the legacy array unless they explicitly request
 * paging or date-window metadata. No new endpoint or provider is added.
 */
import type { NewsPageOptions } from "./marketData";

export interface ParsedNewsRequest {
  symbol?: string;
  query?: string;
  /** `false` preserves older useNews() array response shape. */
  paged: boolean;
  options: NewsPageOptions;
}

export class InvalidNewsRequest extends Error {}

function single(raw: unknown, name: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new InvalidNewsRequest(name + " must occur once as text.");
  return raw.trim();
}
function boundedInteger(raw: unknown, name: string, fallback: number, min: number, max: number): number {
  const value = single(raw, name);
  if (!value) return fallback;
  if (!/^\d{1,4}$/.test(value)) throw new InvalidNewsRequest(name + " must be an integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new InvalidNewsRequest(name + " must be between " + min + " and " + max + ".");
  }
  return parsed;
}
function validDate(raw: unknown, name: string): string | undefined {
  const value = single(raw, name);
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidNewsRequest(name + " must be YYYY-MM-DD.");
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidNewsRequest(name + " is not a real calendar date.");
  }
  return value;
}

export function parseNewsPageRequest(raw: Record<string, unknown>): ParsedNewsRequest {
  const symbol = single(raw.symbol, "symbol")?.toUpperCase();
  const query = single(raw.query, "query");
  if (symbol && (symbol.length > 40 || !/^[A-Z0-9.^_=-]+$/.test(symbol))) {
    throw new InvalidNewsRequest("Invalid ticker symbol.");
  }
  if (query && query.length > 160) throw new InvalidNewsRequest("News search exceeds 160 characters.");
  const paged = ["page", "limit", "from", "to", "windowDays"].some(key => raw[key] !== undefined);
  const page = boundedInteger(raw.page, "page", 1, 1, 52);
  const limit = boundedInteger(raw.limit, "limit", 20, 1, 100);
  const windowDays = boundedInteger(raw.windowDays, "windowDays", 7, 1, 366);
  const from = validDate(raw.from, "from");
  const to = validDate(raw.to, "to");
  if (from && to && from > to) throw new InvalidNewsRequest("from cannot be later than to.");
  return {
    ...(symbol ? { symbol } : {}),
    ...(query ? { query } : {}),
    paged,
    options: { page, limit, windowDays, ...(from ? { from } : {}), ...(to ? { to } : {}) },
  };
}
