import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import { useFundamentals, useQuote, useQuoteStatic } from "@/lib/useFinance";
import { useLseFinancials } from "@/lib/useLse";
import { assessLegacyValuationReadiness } from "@/lib/valuationLegacyReadiness";
import CompanyFundamentalsPanel from "../CompanyFundamentalsPanel";
import FinancialStatementsPanel from "../FinancialStatementsPanel";
import InstitutionalValuationPanel from "../InstitutionalValuationPanel";
import PeerCompPanel from "../PeerCompPanel";
import ValuationPanel from "../ValuationPanel";
import { InstitutionalWorkspaceShell, MethodologyCard, WorkstationOverview } from "./InstitutionalWorkspaceShell";
import { WORKSTATION_DEFINITIONS } from "./workstationDefinitions";

type Section = "overview" | "financials" | "fundamentals" | "dcf" | "comps" | "advanced" | "methodology";

interface Props {
  symbol: string;
  onSymbol: (symbol: string) => void;
  onNav: (view: ViewMode) => void;
}

const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export default function ValuationWorkspacePanel({ symbol, onSymbol, onNav }: Props) {
  const [section, setSection] = useState<Section>("overview");
  const quote = useQuote(symbol);
  const quoteStatic = useQuoteStatic(symbol);
  const fundamentals = useFundamentals(symbol);
  const income = useLseFinancials(symbol, "income");
  const balance = useLseFinancials(symbol, "balance");
  const cashflow = useLseFinancials(symbol, "cashflow");

  const readiness = useMemo(() => {
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
    return assessLegacyValuationReadiness({
      spot,
      marketCap,
      revenue,
      sharesOutstanding: positive(fundamentals.data?.sharesOutstanding) ? fundamentals.data!.sharesOutstanding : null,
      balanceSheetAvailable: Boolean(balance.data?.length),
    });
  }, [balance.data, fundamentals.data, quote.data, quoteStatic.data]);

  const sourceRows = [
    { label: "MARKET PRICE", ok: positive(quote.data?.price), detail: positive(quote.data?.price) ? "Observed quote" : "Unavailable" },
    { label: "MARKET CAP", ok: positive(quoteStatic.data?.marketCap) || positive(quote.data?.marketCap) || positive(fundamentals.data?.marketCap), detail: "Quote/static/fundamentals source" },
    { label: "INCOME STATEMENT", ok: Boolean(income.data?.length), detail: income.data?.length ? `${income.data.length} period(s)` : "No normalized filing rows" },
    { label: "BALANCE SHEET", ok: Boolean(balance.data?.length), detail: balance.data?.length ? `${balance.data.length} period(s)` : "Required for source-gated advanced models" },
    { label: "CASH FLOW", ok: Boolean(cashflow.data?.length), detail: cashflow.data?.length ? `${cashflow.data.length} period(s)` : "Manual/model assumptions may be required" },
  ];

  const definition = WORKSTATION_DEFINITIONS.valuation;
  const loading = quote.isLoading || quoteStatic.isLoading || fundamentals.isLoading || income.isLoading || balance.isLoading || cashflow.isLoading;
  const status = loading
    ? { label: "CHECKING SOURCES", tone: "watch" as const }
    : readiness.canRun
      ? { label: "SOURCE-GATED ADVANCED READY", tone: "ok" as const }
      : { label: "PRIMARY READY · ADVANCED BLOCKED", tone: "watch" as const };

  let body: ReactNode;
  if (section === "financials") body = <FinancialStatementsPanel symbol={symbol} />;
  else if (section === "fundamentals") body = <CompanyFundamentalsPanel symbol={symbol} />;
  else if (section === "dcf") body = <InstitutionalValuationPanel symbol={symbol} />;
  else if (section === "comps") body = <PeerCompPanel symbol={symbol} onSymbol={onSymbol} onNav={onNav} />;
  else if (section === "advanced") body = <ValuationPanel symbol={symbol} />;
  else if (section === "methodology") {
    body = (
      <div className="h-full overflow-y-auto scrollbar-thin p-4">
        <div className="mx-auto max-w-6xl space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {sourceRows.map((row) => (
              <div key={row.label} className={`border p-3 ${row.ok ? "border-emerald-500/20 bg-emerald-500/[0.025]" : "border-amber-500/25 bg-amber-500/[0.025]"}`}>
                <div className="flex items-center gap-2 font-terminal text-[8px] font-bold tracking-widest">
                  {row.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />}{row.label}
                </div>
                <div className="mt-2 font-terminal text-[7.5px] leading-4 text-muted-foreground">{row.detail}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <MethodologyCard title="PRIMARY MODEL HIERARCHY" detail="The workstation puts the institutional DCF first, peer comparison second, then source-gated advanced methods. Deterministic engines remain authoritative; the workspace only organizes them and exposes source readiness." note="Advanced models no longer require users to discover the nested ADVANCED tab inside another panel." />
            <MethodologyCard title="DCF DISCOUNTING" formula="PV(FCFₜ) = FCFₜ / (1 + r)^t  ·  TV = FCFₙ₊₁ / (r − g)" detail="The institutional DCF supports explicit cash-flow mode, discount timing, terminal-value method, editable capital-cost inputs, Bear/Base/Bull scenarios, diagnostics, and sensitivity. The production engine owns the actual values." />
            <MethodologyCard title="EV → EQUITY BRIDGE" formula="Equity Value = Enterprise Value − Net Debt − Other Claims + Non-operating Assets" detail="Bridge items must be observed, normalized, or explicitly entered as assumptions. Missing values are not presented as sourced facts." />
            <MethodologyCard title="RELATIVE VALUE" formula="Implied Equity Value ≈ Selected Peer Multiple × Company Metric ± EV/Equity Bridge" detail="Comps are an independent benchmark, not a hidden input into DCF. Peer selection and metric coverage must remain visible." />
            <MethodologyCard title="ADVANCED MODEL FAMILY" detail="The source-gated advanced surface preserves DDM, residual income, EVA, reverse DCF, LBO/carry, synthetic credit/quality diagnostics, model agreement, and related specialist methods without making their historical heuristics look like observed inputs." />
            <MethodologyCard title="MODEL AGREEMENT" detail="Agreement across DCF, relative value, and alternative models is evidence about model dispersion—not proof of correctness. Shared source errors or shared assumptions can make models agree for the wrong reason." />
          </div>

          {!readiness.canRun ? (
            <div className="border border-amber-500/30 bg-amber-500/[0.035] p-3">
              <div className="flex items-center gap-2 font-terminal text-[8px] font-bold tracking-widest text-amber-300"><ShieldCheck className="h-3.5 w-3.5" /> ADVANCED SOURCE GATE</div>
              <div className="mt-2 font-terminal text-[8px] leading-4 text-muted-foreground">The primary DCF may still use explicit analyst assumptions, but the advanced engine is blocked until the following observed inputs are available:</div>
              <div className="mt-2 space-y-1">{readiness.blockers.map((item) => <div key={item} className="font-terminal text-[7.5px] text-amber-200">• {item}</div>)}</div>
            </div>
          ) : null}
        </div>
      </div>
    );
  } else {
    body = (
      <WorkstationOverview
        definition={definition}
        onSection={(next) => setSection(next as Section)}
        headline="One professional valuation journey instead of a collection of hidden tabs."
        description="Start by validating the financial inputs, move into the primary institutional DCF, compare against peers, open alternative valuation/quality models directly, then inspect methodology and source readiness. Advanced valuation capability is now first-class, but its public entry prevents silent market-input fallbacks from masquerading as observations."
        trustItems={[
          "No new valuation engine is introduced; existing deterministic models remain authoritative.",
          "The advanced model surface is blocked when observed price, market cap, revenue, share basis, or normalized balance-sheet data are incomplete.",
          "Scenario assumptions remain assumptions; they are not relabeled as historical or provider-observed data.",
          "Comps and alternative models are independent benchmarks, not hidden DCF inputs.",
        ]}
      />
    );
  }

  return <InstitutionalWorkspaceShell definition={definition} activeSection={section} onSection={(next) => setSection(next as Section)} symbol={symbol} status={status}>{body}</InstitutionalWorkspaceShell>;
}
