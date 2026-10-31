import type { ReactNode } from "react";
import { useMemo } from "react";
import { ArrowUpRight, BarChart3, BellRing, BookOpen, Calculator, CircleAlert, FileText, Gauge, GitCompare, Layers3, Radar, Scale, Search, ShieldAlert, Sparkles, Target, TrendingUp } from "lucide-react";
import { useFundamentals, useNews, useQuote } from "@/lib/useFinance";
import { ReferenceOnlyBanner, useInstrumentPriceState } from "@/components/data/ReferenceOnlyNotice";
import { useLseCompany } from "@/lib/useLse";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import { ENTITY_CAPABILITIES, capabilitiesForEntity, type EntityCapability, type EntityCapabilityGroup } from "@/lib/entityCapabilities";
import { useAudience } from "@/lib/audience";
import type { ViewMode } from "@/lib/terminalTypes";
import { buildAdaptiveCompanySections } from "@shared/waveCContracts";

interface Props {
  symbol: string;
  onNav: (view: ViewMode) => void;
  onSymbol: (symbol: string) => void;
  role: string;
}

const GROUP_ICONS: Record<EntityCapabilityGroup, typeof Gauge> = {
  overview: Gauge,
  markets: TrendingUp,
  business: Layers3,
  financials: FileText,
  valuation: Calculator,
  risk: ShieldAlert,
  research: BookOpen,
  consensus: Target,
  scenarios: GitCompare,
  decisions: Scale,
  monitor: Radar,
};

const CLIENT_RESTRICTED_VIEWS = new Set<ViewMode>(["brain", "decisionengine", "consensus", "filingintel"]);
const STATUS_STYLE = {
  available: "border-emerald-500/30 text-emerald-300",
  requires_data: "border-amber-500/30 text-amber-300",
  unavailable: "border-rose-500/30 text-rose-300",
} as const;

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function statusLabel(status: EntityCapability["status"]): string {
  if (status === "requires_data") return "REQUIRES DATA";
  if (status === "unavailable") return "UNAVAILABLE";
  return "AVAILABLE";
}

function OutputRow({ label, value, detail, view, onNav, tone = "text-foreground" }: { label: string; value: string; detail: string; view: ViewMode; onNav: (view: ViewMode) => void; tone?: string }) {
  return (
    <button onClick={() => onNav(view)} className="group flex w-full items-center gap-3 border-b border-border/70 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]">
      <span className="w-28 shrink-0 font-terminal text-[8px] tracking-widest text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate font-terminal text-[11px] font-bold tabular-nums ${tone}`}>{value}</span>
      <span className="hidden min-w-0 flex-1 truncate font-terminal text-[8px] text-muted-foreground sm:block">{detail}</span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-amber-300" />
    </button>
  );
}

function Section({ title, icon: Icon, children, className = "" }: { title: string; icon: typeof Gauge; children: ReactNode; className?: string }) {
  return (
    <section className={`border-b border-border ${className}`}>
      <header className="flex items-center gap-2 bg-[#080808] px-4 py-2.5">
        <Icon className="h-3.5 w-3.5 text-amber-300" />
        <span className="font-terminal text-[9px] font-bold tracking-widest text-foreground">{title}</span>
      </header>
      {children}
    </section>
  );
}

function CapabilityLine({ capability, onNav }: { capability: EntityCapability; onNav: (view: ViewMode) => void }) {
  const status = capability.status ?? "available";
  const disabled = status === "unavailable";
  return (
    <button disabled={disabled} onClick={() => onNav(capability.view)} className="group flex w-full items-center gap-3 border-b border-border/60 px-4 py-2 text-left hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50">
      <span className="min-w-0 flex-1 font-terminal text-[9px] text-foreground group-hover:text-amber-300">{capability.label}</span>
      <span className="hidden min-w-0 flex-1 truncate font-terminal text-[8px] text-muted-foreground md:block">{capability.description}</span>
      <span className={`shrink-0 border px-1.5 py-0.5 font-terminal text-[7px] tracking-wider ${STATUS_STYLE[status]}`}>{statusLabel(status)}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-amber-300" />
    </button>
  );
}

export default function EntityWorkspacePanel({ symbol, onNav, onSymbol, role }: Props) {
  const isInternal = useAudience() === "internal";
  const isClient = useAudience() === "client";
  const quote = useQuote(symbol).data;
  const priceState = useInstrumentPriceState(symbol);
  const catalogEntry = priceState.kind === "reference_only" ? priceState.entry : null;
  const noPrice = priceState.kind === "reference_only" || priceState.kind === "no_price";
  const fundamentals = useFundamentals(symbol).data;
  const company = useLseCompany(symbol).data;
  const { data: news = [], isLoading: newsLoading } = useNews(symbol);
  const capabilities = useMemo(() => capabilitiesForEntity().map((capability) => !isInternal && CLIENT_RESTRICTED_VIEWS.has(capability.view) ? { ...capability, status: "unavailable" as const, description: `${capability.description} Available in the internal research build.` } : capability), []);
  const profile = company?.profile;
  const displayName = profile?.company_name ?? quote?.name ?? catalogEntry?.name ?? symbol;
  const currency = quote?.currency ?? "USD";
  const currencyPrefix = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : `${currency} `;
  const investigationView: ViewMode = isInternal ? "brain" : "advisory";
  const decisionView: ViewMode = isInternal ? "decisionengine" : "advisory";
  const groupedCapabilities = useMemo(() => {
    const groups = new Map<EntityCapabilityGroup, EntityCapability[]>();
    for (const capability of capabilities) {
      const current = groups.get(capability.group) ?? [];
      current.push(capability);
      groups.set(capability.group, current);
    }
    return groups;
  }, [capabilities]);
  const adaptiveSections = useMemo(() => {
    const available = [
      "company.ticker", "company.name",
      quote?.exchange ? "company.exchange" : null,
      profile?.country ? "company.country" : null,
      profile?.sector || quote?.sector ? "company.sector" : null,
      quote ? "market_data.price" : null,
      quote?.marketCap ? "market_data.marketCap" : null,
      quote?.volume ? "market_data.volume" : null,
      quote?.pe !== null && quote?.pe !== undefined ? "metric.pe" : null,
      quote?.eps !== null && quote?.eps !== undefined ? "financial_statements.eps" : null,
      fundamentals?.returnOnEquity != null ? "metric.roe" : null,
      fundamentals?.profitMargins != null ? "metric.netMargin" : null,
      fundamentals?.totalRevenue != null ? "financial_statements.revenue" : null,
    ].filter((value): value is string => Boolean(value));
    return buildAdaptiveCompanySections(available);
  }, [fundamentals, profile, quote]);
  const newsHeadline = newsLoading ? "Loading latest stories..." : news.length ? `${news.length} source-attributed stories available` : "No source-attributed stories available";

  if (isClient) {
    const tabs: readonly { label: string; view: ViewMode }[] = [
      { label: "Overview", view: "entity" },
      { label: "Financials", view: "financialstatements" },
      { label: "Valuation", view: "valuation" },
      { label: "Peers", view: "peercomp" },
      { label: "Risk", view: "advancedrisk" },
      { label: "Research", view: "news" },
    ];
    const statusNeedsAttention = Boolean(quote?.status?.isFallback || (quote?.status && quote.status.freshness !== "current"));

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#050505]" data-testid="entity-workspace" data-audience="retail">
        <header className="shrink-0 border-b border-border bg-[#090909]">
          <div className="flex flex-wrap items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-terminal text-lg font-bold tracking-widest text-amber-300">{symbol}</span>
                <span className="truncate font-ui text-[11px] font-semibold text-foreground">{displayName}</span>
                {statusNeedsAttention && <DataStatusBadge status={quote?.status} compact />}
              </div>
              <div className="mt-1 font-ui text-[8px] text-muted-foreground">
                {[profile?.sector ?? quote?.sector ?? catalogEntry?.sector, quote?.exchange ?? profile?.exchange ?? catalogEntry?.exchange].filter(Boolean).join(" · ") || "Company"}
              </div>
            </div>
            <div className="text-right">
              <div className={`font-terminal tabular-nums ${noPrice ? "text-[11px] font-semibold text-amber-200" : "text-xl font-bold text-foreground"}`} data-testid="entity-price">
                {quote ? `${currencyPrefix}${quote.price.toFixed(2)}` : noPrice ? "Reference only" : "—"}
              </div>
              <div className={`font-terminal text-[9px] tabular-nums ${(quote?.changePercent ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {quote ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%` : ""}
              </div>
            </div>
          </div>
          <nav className="flex overflow-x-auto border-t border-border/70 px-2" aria-label="Company analysis">
            {tabs.map((tab) => (
              <button
                key={tab.label}
                type="button"
                onClick={() => tab.view !== "entity" && onNav(tab.view)}
                aria-current={tab.view === "entity" ? "page" : undefined}
                className={`shrink-0 border-b-2 px-3 py-2.5 font-ui text-[8px] font-semibold ${tab.view === "entity" ? "border-amber-300 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </header>
        <ReferenceOnlyBanner state={priceState} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
            {[
              ["MARKET CAP", quote?.marketCap ? `${currencyPrefix}${formatNumber(quote.marketCap)}` : "—"],
              ["P/E", quote?.pe !== null && quote?.pe !== undefined ? quote.pe.toFixed(2) : "—"],
              ["EPS", quote?.eps !== null && quote?.eps !== undefined ? `${currencyPrefix}${quote.eps.toFixed(2)}` : "—"],
              ["REVENUE", quote?.revenue ? `${currencyPrefix}${formatNumber(quote.revenue)}` : fundamentals?.totalRevenue ? `${currencyPrefix}${formatNumber(fundamentals.totalRevenue)}` : "—"],
            ].map(([label, value]) => (
              <div key={label} className="bg-[#080808] px-3 py-3">
                <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
                <div className="mt-1 font-terminal text-[11px] font-bold tabular-nums text-foreground">{value}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-px border-b border-border bg-border md:grid-cols-3">
            <button type="button" onClick={() => onNav("chart")} className="bg-[#080808] p-4 text-left hover:bg-white/[0.04]">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">PRICE</div>
              <div className="mt-2 font-ui text-[10px] font-semibold text-foreground">Open chart</div>
            </button>
            <button type="button" onClick={() => onNav("financialstatements")} className="bg-[#080808] p-4 text-left hover:bg-white/[0.04]">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">FINANCIALS</div>
              <div className="mt-2 font-ui text-[10px] font-semibold text-foreground">Statements & trends</div>
            </button>
            <button type="button" onClick={() => onNav("valuation")} className="bg-[#080808] p-4 text-left hover:bg-white/[0.04]">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">VALUATION</div>
              <div className="mt-2 font-ui text-[10px] font-semibold text-foreground">DCF & assumptions</div>
            </button>
          </section>

          <section className="border-b border-border">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="font-ui text-[10px] font-semibold text-foreground">Latest research</div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onNav("alerts")} className="border border-border px-2.5 py-1.5 font-terminal text-[7px] text-muted-foreground hover:text-foreground">MONITOR</button>
                <button type="button" onClick={() => onNav("news")} className="border border-border px-2.5 py-1.5 font-terminal text-[7px] text-muted-foreground hover:text-foreground">VIEW ALL</button>
              </div>
            </div>
            {newsLoading ? (
              <div className="px-4 pb-4 font-ui text-[8px] text-muted-foreground">Loading…</div>
            ) : news.slice(0, 4).map((item) => (
              <a key={`${item.url}-${item.publishedAt}`} href={item.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 border-t border-border/60 px-4 py-3 hover:bg-white/[0.035]">
                <span className="min-w-0 flex-1">
                  <span className="block font-ui text-[9px] font-medium text-foreground">{item.title}</span>
                  <span className="mt-1 block font-ui text-[7px] text-muted-foreground">{item.source} · {new Date(item.publishedAt).toLocaleDateString()}</span>
                </span>
                <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              </a>
            ))}
            {!newsLoading && news.length === 0 && <div className="px-4 pb-4 font-ui text-[8px] text-muted-foreground">No current stories.</div>}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#050505]" data-testid="entity-workspace">
      <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-[#090909] px-4 py-3 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-terminal text-xl font-bold tracking-widest text-amber-300">{symbol}</span>
              <span className="border border-border px-1.5 py-0.5 font-terminal text-[8px] text-muted-foreground">{quote?.exchange ?? profile?.exchange ?? catalogEntry?.exchange ?? "LISTING"}</span>
              {quote?.status && <DataStatusBadge status={quote.status} compact showProvider />}
            </div>
            <div className="mt-1 truncate font-terminal text-[11px] text-foreground">{displayName}</div>
            <div className="mt-1 font-terminal text-[8px] text-muted-foreground">{profile?.sector ?? quote?.sector ?? catalogEntry?.sector ?? "Ticker intelligence workspace"}</div>
          </div>
          <div className="text-right">
            <div className={`font-terminal font-bold tabular-nums ${noPrice ? "text-sm text-amber-200" : "text-2xl text-foreground"}`} data-testid="entity-price">{quote ? `${currencyPrefix}${quote.price.toFixed(2)}` : noPrice ? "REFERENCE ONLY" : "—"}</div>
            <div className={`font-terminal text-[10px] tabular-nums ${(quote?.changePercent ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{quote ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%` : noPrice ? "NO LIVE PRICE" : priceState.kind === "unavailable" ? "PRICE UNAVAILABLE" : "QUOTE LOADING"}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="flex items-center gap-1.5 border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 font-terminal text-[8px] font-bold tracking-wider text-amber-300 hover:bg-amber-500/20" onClick={() => onNav("valuation")}><Calculator className="h-3 w-3" /> OPEN DCF</button>
          <button className="flex items-center gap-1.5 border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 font-terminal text-[8px] font-bold tracking-wider text-cyan-300 hover:bg-cyan-500/20" onClick={() => onNav(investigationView)}><Sparkles className="h-3 w-3" /> {isInternal ? "INVESTIGATE" : "REQUEST ANALYSIS"}</button>
          <button className="flex items-center gap-1.5 border border-border px-3 py-1.5 font-terminal text-[8px] tracking-wider text-muted-foreground hover:border-foreground/50 hover:text-foreground" onClick={() => onNav(decisionView)}><Scale className="h-3 w-3" /> {isInternal ? "OPEN DECISION" : "REQUEST DECISION"}</button>
          <button className="flex items-center gap-1.5 border border-border px-3 py-1.5 font-terminal text-[8px] tracking-wider text-muted-foreground hover:border-foreground/50 hover:text-foreground" onClick={() => onNav("alerts")}><BellRing className="h-3 w-3" /> MONITOR</button>
        </div>
      </header>
      <ReferenceOnlyBanner state={priceState} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4 xl:grid-cols-8">
          {[
            ["MARKET CAP", quote?.marketCap ? `${currencyPrefix}${formatNumber(quote.marketCap)}` : "—"],
            ["P/E", quote?.pe !== null && quote?.pe !== undefined ? quote.pe.toFixed(2) : "—"],
            ["EPS", quote?.eps !== null && quote?.eps !== undefined ? `${currencyPrefix}${quote.eps.toFixed(2)}` : "—"],
            ["REVENUE", quote?.revenue ? `${currencyPrefix}${formatNumber(quote.revenue)}` : fundamentals?.totalRevenue ? `${currencyPrefix}${formatNumber(fundamentals.totalRevenue)}` : "—"],
            ["VOLUME", quote?.volume ? formatNumber(quote.volume) : "—"],
            ["52W HIGH", quote?.high52 ? `${currencyPrefix}${quote.high52.toFixed(2)}` : "—"],
            ["52W LOW", quote?.low52 ? `${currencyPrefix}${quote.low52.toFixed(2)}` : "—"],
            ["NEWS", newsLoading ? "…" : String(news.length)],
          ].map(([label, value]) => <div key={label} className="bg-[#080808] px-3 py-2"><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div><div className="mt-1 font-terminal text-[10px] font-bold tabular-nums text-foreground">{value}</div></div>)}
        </section>

        <Section title="DATA-ADAPTIVE COMPANY VIEW · CONNECTED FIELDS" icon={Gauge}>
          <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
            {adaptiveSections.map((section) => <div key={section.id} className="bg-[#080808] px-3 py-2.5"><div className="flex items-center justify-between gap-2"><span className="font-terminal text-[8px] tracking-widest text-foreground">{section.label.toUpperCase()}</span><span className={`font-terminal text-[6px] ${section.state === "ready" ? "text-emerald-300" : "text-amber-300"}`}>{section.state.toUpperCase()}</span></div><div className="mt-1.5 flex flex-wrap gap-1">{section.fields.map((fieldId) => <span key={fieldId} className="border border-border/70 px-1.5 py-0.5 font-mono text-[6.5px] text-muted-foreground">{fieldId}</span>)}</div></div>)}
            {!adaptiveSections.length && <div className="bg-[#080808] px-3 py-3 font-terminal text-[8px] text-muted-foreground">NO CONNECTED COMPANY FIELDS. SELECT AN ATTRIBUTED DATA SOURCE TO CONTINUE.</div>}
          </div>
        </Section>

        <Section title="LIOS VIEW · WHAT MATTERS NOW" icon={Gauge}>
          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            <OutputRow label="PRICE" value={quote ? `${currencyPrefix}${quote.price.toFixed(2)}` : "—"} detail={quote ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}% today` : "Awaiting quote"} view="chart" onNav={onNav} tone={quote && quote.changePercent >= 0 ? "text-emerald-300" : "text-rose-300"} />
            <OutputRow label="BUSINESS" value={fundamentals ? "AVAILABLE" : "REQUIRES DATA"} detail="Operating and quality metrics" view="companyfundamentals" onNav={onNav} />
            <OutputRow label="VALUATION" value="OPEN DCF" detail="Deterministic assumptions and scenarios" view="valuation" onNav={onNav} tone="text-amber-300" />
            <OutputRow label="NEWS" value={newsLoading ? "LOADING" : String(news.length)} detail={newsHeadline} view="news" onNav={onNav} />
          </div>
        </Section>

        <Section title="ANALYTICAL OUTPUTS · CLICK TO OPEN ORIGINAL ENGINE" icon={BarChart3}>
          <div className="divide-y divide-border">
            <OutputRow label="QUOTE" value={quote ? `${currencyPrefix}${quote.price.toFixed(2)}` : "—"} detail="Full quote, peers, statistics, and company snapshot" view="quote" onNav={onNav} />
            <OutputRow label="CHART" value="PRICE / VOLUME" detail="Technical indicators, comparisons, and event markers" view="chart" onNav={onNav} />
            <OutputRow label="DCF" value="DCF / FCF" detail="Intrinsic value, WACC, scenarios, and sensitivity" view="valuation" onNav={onNav} tone="text-amber-300" />
            <OutputRow label="OPTIONS" value="PRICING ENGINE" detail="Greeks, volatility, probability, and payoff analysis" view="options" onNav={onNav} />
            <OutputRow label="STATEMENTS" value={fundamentals ? "AVAILABLE" : "REQUIRES DATA"} detail="Income statement, balance sheet, and cash flow history" view="financialstatements" onNav={onNav} />
            <OutputRow label="CONSENSUS" value="EXPECTATIONS" detail="Estimates, revisions, dispersion, and blind spots" view="consensus" onNav={onNav} />
            <OutputRow label="RISK" value="QUALITY / STRESS" detail="Quality checks, downside, and stress scenarios" view="advancedrisk" onNav={onNav} />
          </div>
        </Section>

        <Section title="RESEARCH STREAM · NEWS, FILINGS, AND EVENTS" icon={Search}>
          <div className="border-b border-border bg-[#070707] px-4 py-2 font-terminal text-[8px] text-muted-foreground">{newsHeadline}</div>
          {newsLoading ? <div className="p-4 font-terminal text-[9px] text-muted-foreground">LOADING SOURCE-ATTRIBUTED NEWS...</div> : news.slice(0, 6).map((item) => (
            <a key={`${item.url}-${item.publishedAt}`} href={item.url} target="_blank" rel="noreferrer" className="group flex items-start gap-3 border-b border-border/60 px-4 py-3 hover:bg-white/[0.04]">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${item.sentiment === "positive" ? "bg-emerald-400" : item.sentiment === "negative" ? "bg-rose-400" : "bg-cyan-400"}`} />
              <span className="min-w-0 flex-1"><span className="block font-terminal text-[10px] text-foreground group-hover:text-amber-300">{item.title}</span><span className="mt-1 block line-clamp-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">{item.summary}</span><span className="mt-1 block font-terminal text-[7px] uppercase tracking-widest text-muted-foreground">{item.source} · {new Date(item.publishedAt).toLocaleString()}</span></span>
              <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-amber-300" />
            </a>
          ))}
          {!newsLoading && news.length === 0 && <div className="p-4 font-terminal text-[9px] text-muted-foreground">No source-attributed news is available for this ticker.</div>}
        </Section>

        <Section title="EVIDENCE PASSPORT · SOURCE AND DATA STATE" icon={CircleAlert}>
          <div className="divide-y divide-border">
            {[
              ["QUOTE", quote?.status?.provider ?? "AWAITING SOURCE", quote?.status?.delayLabel ?? "UNKNOWN"],
              ["FUNDAMENTALS", fundamentals ? "AVAILABLE" : "NOT AVAILABLE", "SOURCE-DEPENDENT"],
              ["COMPANY PROFILE", profile ? "AVAILABLE" : "NOT AVAILABLE", "SOURCE-DEPENDENT"],
              ["NEWS", newsLoading ? "LOADING" : news.length ? "AVAILABLE" : "NOT AVAILABLE", "SOURCE-ATTRIBUTED"],
            ].map(([label, value, detail]) => <div key={label} className="flex items-center gap-3 px-4 py-2.5 font-terminal text-[8px]"><span className="w-32 tracking-widest text-muted-foreground">{label}</span><span className="font-bold text-foreground">{value}</span><span className="ml-auto text-muted-foreground">{detail}</span></div>)}
          </div>
        </Section>

        <Section title="ALL TICKER CAPABILITIES · ONE-CLICK ENGINE ACCESS" icon={Layers3}>
          <div className="divide-y divide-border">
            {Array.from(groupedCapabilities.entries()).map(([group, groupCapabilities]) => {
              const Icon = GROUP_ICONS[group];
              return <div key={group}><div className="flex items-center gap-2 bg-[#070707] px-4 py-2"><Icon className="h-3 w-3 text-cyan-300" /><span className="font-terminal text-[8px] tracking-widest text-cyan-300">{group.toUpperCase()}</span></div>{groupCapabilities.map((capability) => <CapabilityLine key={capability.id} capability={capability} onNav={onNav} />)}</div>;
            })}
          </div>
        </Section>

        <Section title="DECISION AND MONITORING ACTIONS" icon={Scale}>
          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <button onClick={() => onNav(decisionView)} className="flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04]"><Scale className="h-4 w-4 text-amber-300" /><span><span className="block font-terminal text-[9px] text-foreground">OPEN DECISION ROOM</span><span className="mt-1 block font-terminal text-[8px] text-muted-foreground">Challenge assumptions and create a governed decision.</span></span></button>
            <button onClick={() => onNav("alerts")} className="flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04]"><BellRing className="h-4 w-4 text-cyan-300" /><span><span className="block font-terminal text-[9px] text-foreground">CREATE THESIS MONITOR</span><span className="mt-1 block font-terminal text-[8px] text-muted-foreground">Track price, evidence, and risk conditions over time.</span></span></button>
          </div>
        </Section>
      </div>
    </div>
  );
}
