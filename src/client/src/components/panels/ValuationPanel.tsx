import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useFundamentals, useQuote, useQuoteStatic } from "@/lib/useFinance";
import { useLseFinancials } from "@/lib/useLse";
import { assessLegacyValuationReadiness } from "@/lib/valuationLegacyReadiness";
import ValuationLegacyPanel from "./ValuationLegacyPanel";

interface Props { symbol: string; }

const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export default function ValuationPanel({ symbol }: Props) {
  const quote = useQuote(symbol);
  const quoteStatic = useQuoteStatic(symbol);
  const fundamentals = useFundamentals(symbol);
  const balance = useLseFinancials(symbol, "balance");

  const spot = positive(quote.data?.price) ? quote.data!.price : null;
  const marketCap = positive(quoteStatic.data?.marketCap)
    ? quoteStatic.data!.marketCap
    : positive(quote.data?.marketCap)
      ? quote.data!.marketCap
      : positive(fundamentals.data?.marketCap)
        ? fundamentals.data!.marketCap
        : null;
  const revenue = positive(quote.data?.revenue)
    ? quote.data!.revenue
    : positive(fundamentals.data?.totalRevenue)
      ? fundamentals.data!.totalRevenue
      : null;
  const sharesOutstanding = positive(fundamentals.data?.sharesOutstanding) ? fundamentals.data!.sharesOutstanding : null;

  const loading = quote.isLoading || quoteStatic.isLoading || fundamentals.isLoading || balance.isLoading;
  const readiness = assessLegacyValuationReadiness({
    spot,
    marketCap,
    revenue,
    sharesOutstanding,
    balanceSheetAvailable: Boolean(balance.data?.length),
  });

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#050505] px-6">
        <div className="border border-border bg-[#080808] px-5 py-4 font-terminal text-[9px] tracking-widest text-muted-foreground">VERIFYING OBSERVED VALUATION INPUTS...</div>
      </div>
    );
  }

  if (!readiness.canRun) {
    return (
      <div className="h-full overflow-y-auto bg-[#050505] p-4 md:p-6">
        <div className="mx-auto max-w-3xl border border-red-500/30 bg-red-500/[0.035] p-4">
          <div className="flex items-center gap-2 font-terminal text-[9px] font-bold tracking-widest text-red-300"><AlertTriangle className="h-4 w-4" /> ADVANCED VALUATION BLOCKED — OBSERVED INPUTS INCOMPLETE</div>
          <div className="mt-3 font-terminal text-[8.5px] leading-5 text-muted-foreground">
            The inherited advanced valuation engine contains historical heuristic fallbacks for missing market and balance-sheet inputs. LIOS will no longer let those fallbacks silently appear as observed data. Use the primary institutional DCF, connect/normalize the missing source data, or supply the required inputs through the supported manual controls before using this advanced surface.
          </div>
          <div className="mt-4 space-y-2">
            {readiness.blockers.map((blocker) => (
              <div key={blocker} className="border border-red-500/20 bg-black/20 px-3 py-2 font-terminal text-[8px] leading-4 text-red-200">• {blocker}</div>
            ))}
          </div>
          <div className="mt-4 border-t border-red-500/20 pt-3 font-terminal text-[7.5px] leading-4 text-muted-foreground">
            Explicitly rejected silent substitutions include the legacy $100 spot, $50B market-cap proxy, percentage-of-market-cap net-debt proxy, and balance-sheet heuristics that depend on those values.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#050505]">
      <div className="shrink-0 border-b border-cyan-500/20 bg-cyan-500/[0.025] px-3 py-2" data-valuation-source-gate>
        <div className="flex flex-wrap items-center gap-2 font-terminal text-[7.5px] leading-4 text-cyan-200/90">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="font-bold tracking-widest">SOURCE GATE PASSED</span>
          <span className="text-muted-foreground" data-valuation-source-detail>Observed spot, market cap, revenue, and normalized balance-sheet data are present.</span>
          <span className="ml-auto text-muted-foreground" data-valuation-share-source>SHARES: {readiness.sharesSource === "reported" ? "REPORTED" : "DERIVED MCAP ÷ SPOT"}</span>
        </div>
        {readiness.warnings.map((warning) => <div key={warning} className="mt-1 font-terminal text-[7px] text-amber-300/90">{warning}</div>)}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden"><ValuationLegacyPanel symbol={symbol} /></div>
    </div>
  );
}
