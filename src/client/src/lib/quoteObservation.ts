import type { Quote } from "./finance";

type QuoteLike = Partial<Pick<Quote, "price" | "quoteSource">> & { status?: { provider?: string } | null };

/**
 * The server keeps a row for every requested symbol and zero-fills numeric fields
 * when no selected source returned an observation. Those zeros are not prices; they
 * must never reach a panel. A quote is observed only when a source actually served it.
 */
export function isObservedQuote(quote: QuoteLike | null | undefined): boolean {
  if (!quote) return false;
  if (quote.quoteSource === "Unavailable" || quote.status?.provider === "unavailable") return false;
  return typeof quote.price === "number" && Number.isFinite(quote.price) && quote.price > 0;
}

export function observedQuotes<T extends QuoteLike>(quotes: readonly T[] | null | undefined): T[] {
  return Array.isArray(quotes) ? quotes.filter(isObservedQuote) : [];
}
