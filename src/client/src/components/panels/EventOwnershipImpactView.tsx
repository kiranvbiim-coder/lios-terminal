import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ExternalLink, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLseDividends, useLseInsiderTrades, useLseOptionsFlowPage, useLseSplits, useLseStatus, useLseCot } from "@/lib/useLse";
import type { EdgarFilingSummary, EdgarInsiderTransaction } from "@/lib/useOfficialSources";
import type { ViewMode } from "@/lib/terminalTypes";
import { buildEventOwnershipTimeline, type EventOwnershipRecord } from "@/lib/eventOwnershipImpact";

interface EdgarPage<T> {
  rows: T[];
  page: number;
  limit: number;
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  from: string | null;
  to: string | null;
}

interface Props {
  symbol?: string;
  onSymbol?: (symbol: string) => void;
  onNav?: (view: ViewMode) => void;
  compact?: boolean;
}

const KIND_LABELS: Record<EventOwnershipRecord["kind"], string> = {
  insider_transaction: "OWNERSHIP",
  filing: "FILING",
  dividend: "DIVIDEND",
  split: "SPLIT",
  options_flow: "OPTIONS FLOW",
  cot_positioning: "COT",
};

const FLAG_LABELS: Record<string, string> = {
  open_market_buy: "OPEN-MARKET BUY",
  open_market_sell: "OPEN-MARKET SELL",
  ownership_change: "OWNERSHIP CHANGE",
  derivative_transaction: "DERIVATIVE",
  filing_cluster: "FILING CLUSTER",
  dividend: "DIVIDEND",
  split: "SPLIT",
  options_flow: "OPTIONS FLOW",
  cot_positioning: "COT POSITIONING",
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function statusClass(status: string): string {
  if (status === "AVAILABLE") return "text-emerald-300 border-emerald-400/30";
  if (status === "LOADING") return "text-amber-300 border-amber-400/30";
  return "text-muted-foreground border-border";
}

function EventRow({ row }: { row: EventOwnershipRecord }) {
  return (
    <article className="border-b border-border/70 p-3" data-testid={`event-row-${row.id}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="border border-amber-400/40 px-1.5 py-0.5 font-terminal text-[7px] uppercase text-amber-300">{KIND_LABELS[row.kind]}</span>
            <span className="border border-emerald-400/30 px-1.5 py-0.5 font-terminal text-[7px] uppercase text-emerald-300">{row.status}</span>
            <span className="font-mono text-[8px] text-muted-foreground">{formatDate(row.occurredAt)}</span>
            <span className="ml-auto font-terminal text-[7px] text-muted-foreground">AS-OF {formatDate(row.asOf)}</span>
          </div>
          <div className="mt-1 font-terminal text-[10px] leading-snug text-foreground">{row.title}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-terminal text-[7px] uppercase text-muted-foreground">
            <span>SOURCE {row.source}</span><span>PROVIDER {row.provider}</span><span>PERIOD {row.period || "NOT APPLICABLE"}</span><span>UNIT {row.unit || "NOT APPLICABLE"}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {row.flags.map((flag) => <span key={flag} className="border border-border px-1.5 py-0.5 font-terminal text-[7px] uppercase text-muted-foreground">{FLAG_LABELS[flag] || flag}</span>)}
          </div>
          <div className="mt-2 font-terminal text-[8px] text-muted-foreground">
            <span className="text-foreground">THESIS / METRIC CATEGORIES:</span> {row.categories.join(" · ") || "None mapped"}. Classification only; no causal or price-impact claim.
          </div>
        </div>
        {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open source for ${row.title}`} className="shrink-0 text-amber-300 hover:text-amber-200"><ExternalLink className="h-3.5 w-3.5" /></a>}
      </div>
    </article>
  );
}

export default function EventOwnershipImpactView({ symbol, onSymbol, onNav, compact = false }: Props) {
  const [ticker, setTicker] = useState((symbol || "").toUpperCase());
  const [input, setInput] = useState((symbol || "").toUpperCase());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<"all" | EventOwnershipRecord["kind"]>("all");
  const [page, setPage] = useState(1);
  const [cotCode, setCotCode] = useState("");
  const lseStatus = useLseStatus();
  const lseInsiders = useLseInsiderTrades(ticker || undefined);
  const dividends = useLseDividends(ticker);
  const splits = useLseSplits(ticker);
  const optionsFlow = useLseOptionsFlowPage({ underlying: ticker || undefined, order: "desc", limit: 50, page, mode: "page" });
  const cot = useLseCot(cotCode);

  const secInsiders = useQuery<EdgarPage<EdgarInsiderTransaction> | EdgarInsiderTransaction[]>({
    queryKey: ["/api/edgar/insiders", ticker, page, from, to, "event-impact"],
    enabled: !!ticker,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/edgar/insiders/${encodeURIComponent(ticker)}?${params}`);
      if (!response.ok) throw new Error("SEC insider event data unavailable");
      return response.json();
    },
  });
  const secFilings = useQuery<EdgarPage<EdgarFilingSummary> | EdgarFilingSummary[]>({
    queryKey: ["/api/edgar/filings", ticker, page, from, to, "event-impact"],
    enabled: !!ticker,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/edgar/filings/${encodeURIComponent(ticker)}?${params}`);
      if (!response.ok) throw new Error("SEC filing event data unavailable");
      return response.json();
    },
  });

  const insiderPayload = secInsiders.data;
  const filingPayload = secFilings.data;
  const insiderRows = Array.isArray(insiderPayload) ? insiderPayload : insiderPayload?.rows ?? [];
  const filingRows = Array.isArray(filingPayload) ? filingPayload : filingPayload?.rows ?? [];
  const sourceHasMore = (!Array.isArray(insiderPayload) && !!insiderPayload?.hasMore)
    || (!Array.isArray(filingPayload) && !!filingPayload?.hasMore)
    || !!optionsFlow.data?.hasMore;
  const timeline = useMemo(() => buildEventOwnershipTimeline({
    ticker,
    secInsiders: insiderRows,
    secFilings: filingRows,
    lseInsiders: lseInsiders.data,
    dividends: dividends.data,
    splits: splits.data,
    optionsFlow: optionsFlow.data?.rows,
    cot: cot.data,
    from,
    to,
    page: 1,
    limit: 500,
  }), [ticker, insiderRows, filingRows, lseInsiders.data, dividends.data, splits.data, optionsFlow.data?.rows, cot.data, from, to]);
  const rows = useMemo(() => kind === "all" ? timeline.rows : timeline.rows.filter((row) => row.kind === kind), [kind, timeline.rows]);
  const anyLoading = secInsiders.isLoading || secFilings.isLoading || lseInsiders.isLoading || dividends.isLoading || splits.isLoading || optionsFlow.isLoading;
  const sourceStatuses = [
    { provider: "SEC EDGAR", status: secInsiders.isError || secFilings.isError ? "UNAVAILABLE" : anyLoading ? "LOADING" : "AVAILABLE" },
    { provider: "London Strategic Edge", status: lseStatus.data?.configured === false ? "UNAVAILABLE" : lseInsiders.isError || dividends.isError || splits.isError || optionsFlow.isError ? "UNAVAILABLE" : anyLoading ? "LOADING" : "AVAILABLE" },
    { provider: "CFTC / LSE COT", status: cotCode && cot.isError ? "UNAVAILABLE" : cotCode && cot.data ? "AVAILABLE" : "NOT REQUESTED" },
  ];

  const submitTicker = (event: React.FormEvent) => {
    event.preventDefault();
    const next = input.trim().toUpperCase();
    setTicker(next);
    setPage(1);
    onSymbol?.(next);
  };
  const changeDate = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <section className={`flex min-h-0 flex-1 flex-col bg-[#060606] ${compact ? "" : "overflow-hidden"}`} aria-label="Event and ownership impact">
      <div className="shrink-0 border-b border-border bg-[#070707] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="h-4 w-4 text-amber-300" />
          <div className="font-terminal text-[10px] uppercase tracking-[0.14em]">EVENT / OWNERSHIP IMPACT</div>
          <span className="font-terminal text-[8px] text-muted-foreground">Chronology and classifications, not causality or recommendations</span>
        </div>
        <form onSubmit={submitTicker} className="mt-2 flex flex-wrap items-center gap-2" data-testid="event-impact-filters">
          <input value={input} onChange={(event) => setInput(event.target.value.toUpperCase())} placeholder="TICKER" aria-label="Event ticker" className="h-8 w-24 border border-border bg-black px-2 font-terminal text-[9px] uppercase outline-none focus:border-amber-400/50" />
          <button type="submit" className="h-8 border border-amber-400/40 px-2 font-terminal text-[8px] uppercase text-amber-300">LOAD</button>
          <label className="font-terminal text-[8px] text-muted-foreground">FROM <input type="date" value={from} onChange={(event) => changeDate(setFrom, event.target.value)} className="ml-1 h-8 border border-border bg-black px-1 text-[8px]" /></label>
          <label className="font-terminal text-[8px] text-muted-foreground">TO <input type="date" value={to} onChange={(event) => changeDate(setTo, event.target.value)} className="ml-1 h-8 border border-border bg-black px-1 text-[8px]" /></label>
          <select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPage(1); }} aria-label="Filter event type" className="h-8 border border-border bg-black px-2 font-terminal text-[8px] uppercase outline-none">
            <option value="all">ALL EVENTS</option><option value="insider_transaction">OWNERSHIP</option><option value="filing">FILINGS</option><option value="dividend">DIVIDENDS</option><option value="split">SPLITS</option><option value="options_flow">OPTIONS FLOW</option><option value="cot_positioning">COT</option>
          </select>
          <label className="font-terminal text-[8px] text-muted-foreground">COT CODE <input value={cotCode} onChange={(event) => { setCotCode(event.target.value.toUpperCase()); setPage(1); }} placeholder="OPTIONAL" aria-label="Optional COT code" className="ml-1 h-8 w-20 border border-border bg-black px-2 text-[8px] uppercase" /></label>
          <button type="button" onClick={() => { void secInsiders.refetch(); void secFilings.refetch(); void optionsFlow.refetch(); }} aria-label="Refresh event data" className="ml-auto h-8 w-8 border border-border text-muted-foreground hover:text-amber-300"><RefreshCw className="mx-auto h-3.5 w-3.5" /></button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Event data provider status">
          {sourceStatuses.map((source) => <span key={source.provider} className={`border px-1.5 py-0.5 font-terminal text-[7px] uppercase ${statusClass(source.status)}`}>{source.provider} / {source.status}</span>)}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {!ticker ? <div className="p-8 text-center font-terminal text-[9px] text-muted-foreground">ENTER A TICKER TO LOAD REAL EVENT ROWS.</div>
          : rows.length === 0 && !anyLoading ? <div className="p-8 text-center font-terminal text-[9px] text-muted-foreground">NO EVENTS RETURNED FOR THIS FILTER. NO VALUES WERE FABRICATED.</div>
          : anyLoading && rows.length === 0 ? <div className="p-8 text-center font-terminal text-[9px] text-muted-foreground">LOADING EVENT SOURCES...</div>
          : rows.map((row) => <EventRow key={row.id} row={row} />)}
        {ticker && <div className="flex items-center justify-between border-t border-border p-3">
          <span className="font-terminal text-[8px] text-muted-foreground">PAGE {page} · {rows.length} EVENTS SHOWN · SOURCE PAGES ARE INDEPENDENT</span>
          <div className="flex gap-2">
            <button type="button" disabled={page === 1 || anyLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-8 border border-border px-2 font-terminal text-[8px] uppercase disabled:opacity-30">PREV</button>
            <button type="button" disabled={!sourceHasMore || anyLoading} onClick={() => setPage((value) => value + 1)} className="h-8 border border-amber-400/40 px-2 font-terminal text-[8px] uppercase text-amber-300 disabled:opacity-30" data-testid="event-load-more">LOAD MORE</button>
          </div>
        </div>}
      </div>

      <div className="shrink-0 border-t border-border bg-[#070707] p-3">
        <div className="font-terminal text-[8px] uppercase text-muted-foreground">WORKFLOW PROMPT</div>
        <div className="mt-1 text-[10px] leading-relaxed">Review the linked source and map the flagged category to an existing thesis or metric. This view does not estimate price impact, infer intent, or make a trade recommendation.</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {onNav ? <>
            <button type="button" onClick={() => onNav("research")} className="flex h-8 items-center gap-1 border border-amber-400/40 px-2 font-terminal text-[8px] uppercase text-amber-300">OPEN RESEARCH LEDGER <ArrowRight className="h-3 w-3" /></button>
            <button type="button" onClick={() => onNav("decisionengine")} className="flex h-8 items-center gap-1 border border-border px-2 font-terminal text-[8px] uppercase text-muted-foreground hover:text-foreground">REVIEW DECISION WORKFLOW <ArrowRight className="h-3 w-3" /></button>
          </> : <span className="font-terminal text-[8px] text-muted-foreground">CURRENT WORKFLOW: RESEARCH LEDGER</span>}
        </div>
      </div>
    </section>
  );
}
