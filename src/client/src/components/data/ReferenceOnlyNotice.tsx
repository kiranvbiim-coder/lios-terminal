import { CircleAlert } from "lucide-react";
import { openEnvironmentCenter } from "@/lib/appShellEvents";
import { CONNECT_DATA_SOURCE_LABEL, resolveInstrumentPriceState, type InstrumentPriceState } from "@/lib/referenceOnlyInstrument";
import { useCatalogEntry, useQuote } from "@/lib/useFinance";

/** The one place that decides whether a symbol has a live price, is catalog-only, or has nothing. */
export function useInstrumentPriceState(symbol: string): InstrumentPriceState & { quoteSettled: boolean } {
  const quoteQuery = useQuote(symbol);
  const catalogQuery = useCatalogEntry(symbol);
  const state = resolveInstrumentPriceState({
    symbol,
    hasQuote: Boolean(quoteQuery.data),
    quoteSettled: quoteQuery.isFetched,
    quoteFailed: quoteQuery.isError,
    catalogSettled: catalogQuery.isFetched || catalogQuery.isError,
    entry: catalogQuery.data ?? null,
  });
  return { ...state, quoteSettled: quoteQuery.isFetched };
}

/**
 * Explicit "no price" state: a catalog-only symbol is never shown with a price,
 * zero or estimate, and the way forward (connect a data source) is one click.
 */
export function ReferenceOnlyBanner({ state }: { state: InstrumentPriceState }) {
  if (state.kind !== "reference_only" && state.kind !== "no_price") return null;
  return (
    <section role="status" data-testid="reference-only-notice" data-price-state={state.kind} className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
      <CircleAlert className="h-4 w-4 shrink-0 text-amber-300" />
      <div className="min-w-0 flex-1">
        <div className="font-ui text-[10px] font-semibold text-amber-200">{state.headline}</div>
        <div className="mt-0.5 font-ui text-[9px] leading-relaxed text-muted-foreground">{state.detail}</div>
      </div>
      <button type="button" onClick={openEnvironmentCenter} data-testid="reference-only-connect" className="shrink-0 border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 font-ui text-[9px] font-semibold text-amber-200 hover:bg-amber-500/20">
        {CONNECT_DATA_SOURCE_LABEL}
      </button>
    </section>
  );
}

export default function ReferenceOnlyNotice({ symbol }: { symbol: string }) {
  return <ReferenceOnlyBanner state={useInstrumentPriceState(symbol)} />;
}
