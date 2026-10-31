import type { DirectoryEntry } from "./finance";

/**
 * What the Workbench may say about a symbol's price. A global-securities
 * catalog row carries names and identifiers only, so a symbol with no observed
 * quote is shown as "Reference only" — never as a price, a zero or a guess.
 */
export type InstrumentPriceState =
  | { kind: "checking" }
  | { kind: "live" }
  | { kind: "unavailable"; headline: string; detail: string }
  | { kind: "reference_only"; headline: string; detail: string; entry: DirectoryEntry }
  | { kind: "no_price"; headline: string; detail: string };

export const REFERENCE_ONLY_HEADLINE = "Reference only — no live price";
export const CONNECT_DATA_SOURCE_LABEL = "Connect a data source";

/** The catalog row for exactly this symbol (search is fuzzy; the Workbench is not). */
export function pickCatalogEntry(items: readonly DirectoryEntry[] | undefined, symbol: string): DirectoryEntry | null {
  const wanted = symbol.trim().toUpperCase();
  if (!wanted || !items) return null;
  const exact = items.filter(item => item.symbol.trim().toUpperCase() === wanted);
  if (exact.length === 0) return null;
  // Several venues may list one symbol; prefer the row the directory marks primary.
  return exact.find(item => item.isPrimaryListing) ?? exact[0];
}

export function resolveInstrumentPriceState(input: {
  symbol: string;
  hasQuote: boolean;
  quoteSettled: boolean;
  quoteFailed: boolean;
  catalogSettled: boolean;
  entry: DirectoryEntry | null;
}): InstrumentPriceState {
  if (input.hasQuote) return { kind: "live" };
  if (!input.quoteSettled) return { kind: "checking" };
  if (input.quoteFailed) {
    return {
      kind: "unavailable",
      headline: "Price unavailable right now",
      detail: `The price for ${input.symbol} could not be loaded. Check your connection; nothing has been estimated in its place.`,
    };
  }
  if (!input.catalogSettled) return { kind: "checking" };
  if (input.entry) {
    const where = [input.entry.exchange, input.entry.sector].filter(Boolean).join(" · ");
    return {
      kind: "reference_only",
      headline: REFERENCE_ONLY_HEADLINE,
      detail: `${input.entry.name}${where ? ` (${where})` : ""} is in the global securities catalog, which lists names and identifiers only. ` +
        "Connect a data source to see its price, chart and fundamentals.",
      entry: input.entry,
    };
  }
  return {
    kind: "no_price",
    headline: "No live price",
    detail: `No data source has returned a price for ${input.symbol}. Connect a data source to see its price, chart and fundamentals.`,
  };
}
