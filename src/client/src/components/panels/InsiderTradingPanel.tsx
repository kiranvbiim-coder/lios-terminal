import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserRoundSearch } from "lucide-react";
import { useLseStatus, useLseInsiderTrades } from "@/lib/useLse";
import { getCurrencySymbol } from "@/lib/finance";
import type { EdgarInsiderTransaction } from "@/lib/useOfficialSources";
import type { ViewMode } from "@/lib/terminalTypes";
import EventOwnershipImpactView from "./EventOwnershipImpactView";

interface EdgarInsiderPage {
  rows: EdgarInsiderTransaction[];
  page: number;
  limit: number;
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  from: string | null;
  to: string | null;
}
interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void }

const TYPE_FILTERS = [
  { value: "", label: "ALL TYPES" },
  { value: "P-Purchase", label: "OPEN MARKET BUY" },
  { value: "S-Sale", label: "SALE" },
];

function fmtMoney(v: number | null | undefined, curr: string) {
  if (v === undefined || v === null) return "—";
  return v >= 1_000_000 ? `${curr}${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `${curr}${(v / 1_000).toFixed(0)}K` : `${curr}${v.toFixed(0)}`;
}

function LseView({ onSymbol }: { onSymbol: (s: string) => void }) {
  const { data: status } = useLseStatus();
  const [symbol, setSymbol] = useState("");
  const [type, setType] = useState("");
  const { data: trades, isLoading } = useLseInsiderTrades(symbol || undefined, type || undefined);
  const configured = status?.configured ?? false;

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#060606] shrink-0">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="FILTER BY TICKER..."
          className="bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-36 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none"
        >
          {TYPE_FILTERS.map((t) => <option key={t.value} value={t.value} className="bg-[#0d0d0d]">{t.label}</option>)}
        </select>
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">Browse across many tickers at once — LSE-aggregated feed.</span>
      </div>

      {!configured ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center font-terminal text-[10px] text-muted-foreground border border-border px-4 py-3">
            NO LSE_API_KEY CONFIGURED — GET A FREE KEY AT LONDONSTRATEGICEDGE.COM/DATA. VALUES BELOW WILL POPULATE ONCE ONE IS SET. HONEST STATE, NOT A BUG.
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <div className="p-4 font-terminal text-[9px] text-muted-foreground">LOADING...</div>
          ) : !trades?.length ? (
            <div className="p-4 font-terminal text-[9px] text-muted-foreground">NO INSIDER TRADES FOUND FOR THIS FILTER.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#070707] z-10">
                <tr className="border-b border-border">
                  {["TICKER", "DATE", "INSIDER", "TYPE", "SHARES", "PRICE", "VALUE"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  const typeLabel = t.transaction_type || t.form_type || "—";
                  const isBuy = t.acquisition_or_disposition === "A" || typeLabel.toUpperCase().includes("PURCHASE");
                  const value = t.securities_transacted && t.price ? t.securities_transacted * t.price : null;
                  const curr = getCurrencySymbol(t.symbol);
                  return (
                    <tr key={`${t.symbol}-${t.transaction_date}-${i}`} className="border-b border-border/30 hover:bg-white/[1.5%] cursor-pointer" onClick={() => onSymbol(t.symbol)}>
                      <td className="px-3 py-2.5 font-terminal text-[10px] font-bold text-foreground">{t.symbol}</td>
                      <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums text-muted-foreground">{t.transaction_date}</td>
                      <td className="px-3 py-2.5 font-terminal text-[9px] text-foreground">{t.reporting_name ?? "—"}</td>
                      <td className={`px-3 py-2.5 font-terminal text-[8px] ${isBuy ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{typeLabel}</td>
                      <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{t.securities_transacted?.toLocaleString() ?? "—"}</td>
                      <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{t.price ? `${curr}${t.price.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums font-bold">{value !== null ? fmtMoney(value, curr) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

function EdgarView() {
  const [ticker, setTicker] = useState("AAPL");
  const [input, setInput] = useState("AAPL");
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const edgarQuery = useQuery<EdgarInsiderPage | EdgarInsiderTransaction[]>({
    queryKey: ["/api/edgar/insiders", ticker, page, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/edgar/insiders/${ticker}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch SEC EDGAR insider data");
      return res.json();
    },
    enabled: !!ticker,
  });
  const payload = edgarQuery.data;
  const rows = Array.isArray(payload) ? payload : payload?.rows ?? [];
  const isLoading = edgarQuery.isLoading;
  const pagedPayload = Array.isArray(payload) ? null : payload;
  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#060606] shrink-0 flex-wrap">
        <form onSubmit={(e) => { e.preventDefault(); setTicker(input.toUpperCase()); setPage(1); }} className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="TICKER..."
            className="bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
          />
        </form>
        <label className="font-terminal text-[8px] text-muted-foreground">FROM <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="ml-1 bg-black/30 border border-border px-1 py-1 text-[8px]" /></label>
        <label className="font-terminal text-[8px] text-muted-foreground">TO <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="ml-1 bg-black/30 border border-border px-1 py-1 text-[8px]" /></label>
        <button type="button" disabled={page === 1 || isLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="px-2 py-1 font-terminal text-[8px] border border-border disabled:opacity-30">PREV</button>
        <button type="button" disabled={page === 1 || !pagedPayload?.hasMore || isLoading} onClick={() => setPage((value) => value + 1)} className="px-2 py-1 font-terminal text-[8px] border border-border disabled:opacity-30">NEXT</button>
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">FORM 4 XML · PAGE {page} · {pagedPayload ? `${pagedPayload.returnedCount}/${pagedPayload.totalCount}` : `${rows.length}`}</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-4 font-terminal text-[9px] text-muted-foreground">LOADING...</div>
        ) : !rows?.length ? (
          <div className="p-4 font-terminal text-[9px] text-muted-foreground">NO RECENT FORM 4 FILINGS FOUND FOR {ticker}.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#070707] z-10">
              <tr className="border-b border-border">
                {["DATE", "FILER", "ROLE", "CODE", "SECURITY", "SHARES", "PRICE", "VALUE", "MARKET"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isBuy = r.acquiredDisposed === "A";
                const role = [r.isOfficer && "OFFICER", r.isDirector && "DIRECTOR", r.isTenPercentOwner && "10% OWNER"].filter(Boolean).join(", ") || "—";
                return (
                  <tr key={`${r.accessionNumber}-${i}`} className="border-b border-border/30 hover:bg-white/[1.5%] cursor-pointer" onClick={() => window.open(r.filingUrl, "_blank")}>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums text-muted-foreground whitespace-nowrap">{r.transactionDate}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] text-foreground whitespace-nowrap">{r.filerName}{r.filerTitle ? ` (${r.filerTitle})` : ""}</td>
                    <td className="px-3 py-2.5 font-terminal text-[7.5px] text-muted-foreground whitespace-nowrap">{role}</td>
                    <td className="px-3 py-2.5 font-terminal text-[8px] whitespace-nowrap">
                      <span className={r.isOpenMarket ? (isBuy ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]") : "text-muted-foreground"}>
                        {r.transactionCode} · {r.transactionCodeLabel}
                      </span>
                      {r.isOpenMarket && <span className="ml-1 text-[6.5px] border border-current px-1 py-0.5">OPEN MKT</span>}
                    </td>
                    <td className="px-3 py-2.5 font-terminal text-[8px] text-muted-foreground whitespace-nowrap">{r.securityTitle}{r.isDerivative ? " (deriv.)" : ""}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{r.shares?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{r.pricePerShare ? `$${r.pricePerShare.toFixed(2)}` : "—"}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums font-bold">{fmtMoney(r.value, "$")}</td>
                    <td className="px-3 py-2.5 font-terminal text-[8px]">{r.isOpenMarket ? (isBuy ? <span className="text-[hsl(142,71%,55%)]">BUY</span> : <span className="text-[hsl(0,80%,60%)]">SELL</span>) : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function InsiderTradingPanel({ onSymbol, onNav }: Props) {
  const [source, setSource] = useState<"lse" | "edgar" | "events">("edgar");

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <UserRoundSearch className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">INSIDER TRADING TRACKER</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">INST</span>
      </div>

      <div className="flex border-b border-border bg-[#060606] shrink-0">
        <button
          onClick={() => setSource("edgar")}
          className={`px-3 py-1.5 font-terminal text-[8px] tracking-wider border-r border-border/50 ${
            source === "edgar" ? "bg-[hsl(142,71%,45%)]/10 text-[hsl(142,71%,55%)] border-b-2 border-b-[hsl(142,71%,55%)]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          SEC EDGAR · OFFICIAL
        </button>
        <button
          onClick={() => setSource("lse")}
          className={`px-3 py-1.5 font-terminal text-[8px] tracking-wider border-r border-border/50 ${
            source === "lse" ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          LSE · MULTI-TICKER FEED
        </button>
        <button
          onClick={() => setSource("events")}
          className={`px-3 py-1.5 font-terminal text-[8px] tracking-wider ${
            source === "events" ? "bg-amber-400/10 text-amber-300 border-b-2 border-b-amber-300" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="event-impact-tab"
        >
          EVENT / OWNERSHIP IMPACT
        </button>
      </div>

      {source === "edgar" ? <EdgarView /> : source === "lse" ? <LseView onSymbol={onSymbol} /> : <EventOwnershipImpactView onSymbol={onSymbol} onNav={onNav} />}
    </div>
  );
}
