import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Clock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getCurrencySymbol } from "@/lib/finance";

interface EarningsEvent {
  symbol: string;
  name: string;
  date: string;
  time: "before" | "after" | "unknown";
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  quarter: string;
  region: "US" | "IN" | "JP" | "HK";
}

function formatRevenue(n: number | null, symbol: string): string {
  if (n === null) return "—";
  const cur = getCurrencySymbol(symbol);
  if (n >= 1e12) return `${cur}${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `${cur}${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `${cur}${(n / 1e6).toFixed(2)}M`;
  return `${cur}${n.toFixed(2)}`;
}

function epsSurprise(estimate: number | null, actual: number | null): JSX.Element | null {
  if (estimate === null || actual === null) return null;
  const diff = actual - estimate;
  const pct = estimate !== 0 ? (diff / Math.abs(estimate)) * 100 : 0;
  const isUp = diff >= 0;
  return (
    <span className={`font-terminal text-[8px] px-1 py-0.5 rounded ${isUp ? "bg-[hsl(142,71%,25%)] text-[hsl(142,71%,55%)]" : "bg-[hsl(0,80%,20%)] text-[hsl(0,80%,55%)]"}`}>
      {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% BEAT
    </span>
  );
}

function daysFromNow(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function DateBadge({ dateStr, days }: { dateStr: string; days: number }) {
  const color =
    days < 0 ? "text-muted-foreground" :
    days === 0 ? "text-[hsl(38,95%,55%)]" :
    days <= 3 ? "text-[hsl(0,80%,60%)]" :
    days <= 7 ? "text-[hsl(38,95%,55%)]" :
    "text-muted-foreground";

  const label =
    days < 0 ? `${Math.abs(days)}d ago` :
    days === 0 ? "TODAY" :
    days === 1 ? "TOMORROW" :
    `in ${days}d`;

  return (
    <div className="flex flex-col items-end">
      <span className={`font-terminal text-[9px] tabular-nums ${color}`}>{dateStr}</span>
      <span className={`font-terminal text-[8px] font-bold ${color}`}>{label}</span>
    </div>
  );
}

const REGION_COLORS: Record<string, string> = {
  US: "hsl(38,95%,55%)",
  IN: "hsl(142,71%,45%)",
  JP: "hsl(0,80%,55%)",
  HK: "hsl(186,80%,55%)",
};

export default function EarningsPanel({ onSymbol }: { onSymbol?: (sym: string) => void }) {
  const [regionFilter, setRegionFilter] = useState<"ALL" | "US" | "IN" | "JP" | "HK">("ALL");
  const [showReported, setShowReported] = useState(false);

  const { data: events, isLoading } = useQuery<EarningsEvent[]>({
    queryKey: ["/api/finance/earnings"],
    queryFn: async () => {
      const res = await fetch("/api/finance/earnings");
      if (!res.ok) throw new Error("Failed to fetch earnings");
      return res.json();
    },
    refetchInterval: 300_000,
    staleTime: 120_000,
  });

  const filtered = (events || [])
    .filter((e) => regionFilter === "ALL" || e.region === regionFilter)
    .filter((e) => {
      const days = daysFromNow(e.date);
      return showReported ? days < 0 : days >= 0;
    });

  const upcoming = (events || []).filter((e) => daysFromNow(e.date) >= 0);
  const reported = (events || []).filter((e) => daysFromNow(e.date) < 0);
  const todayCount = (events || []).filter((e) => daysFromNow(e.date) === 0).length;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <CalendarDays className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">EARNINGS CALENDAR</span>
        {todayCount > 0 && (
          <span className="font-terminal text-[8px] px-2 py-0.5 bg-[hsl(38,95%,50%)/15%] border border-[hsl(38,95%,50%)/40%] text-[hsl(38,95%,55%)] animate-pulse">
            {todayCount} REPORTING TODAY
          </span>
        )}
      </div>

      {/* Sub-controls */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-[#060606] shrink-0 flex-wrap">
        {/* Region filter */}
        <div className="flex items-center gap-px">
          {(["ALL","US","IN","JP","HK"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRegionFilter(r)}
              className={`px-2.5 py-1 font-terminal text-[8px] tracking-widest border transition-colors ${
                regionFilter === r
                  ? "bg-white/5 text-foreground border-white/20"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              style={regionFilter === r && r !== "ALL" ? { color: REGION_COLORS[r] } : {}}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Upcoming / Reported toggle */}
        <div className="flex items-center gap-px ml-auto">
          <button
            onClick={() => setShowReported(false)}
            className={`px-3 py-1 font-terminal text-[8px] border transition-colors ${
              !showReported ? "border-[hsl(142,71%,40%)/50%] text-[hsl(142,71%,50%)] bg-[hsl(142,71%,40%)/8%]" : "border-transparent text-muted-foreground"
            }`}
          >
            UPCOMING ({upcoming.length})
          </button>
          <button
            onClick={() => setShowReported(true)}
            className={`px-3 py-1 font-terminal text-[8px] border transition-colors ${
              showReported ? "border-muted-foreground/30 text-muted-foreground bg-white/5" : "border-transparent text-muted-foreground"
            }`}
          >
            REPORTED ({reported.length})
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[3fr_2fr_1.5fr_1.5fr_2fr_1.5fr_2fr] gap-px px-4 py-1.5 bg-[#0a0a0a] border-b border-border shrink-0">
        {["COMPANY","QUARTER","EPS EST","EPS ACT","REVENUE EST","TIME","DATE"].map((h) => (
          <span key={h} className="font-terminal text-[7px] tracking-widest text-muted-foreground text-right first:text-left">{h}</span>
        ))}
      </div>

      {/* Event rows */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading
          ? Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-12 mx-4 my-1 bg-border" />)
          : filtered.length === 0
          ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <CalendarDays className="w-8 h-8 text-muted-foreground/30" />
              <span className="font-terminal text-xs text-muted-foreground">NO VERIFIED EARNINGS COVERAGE</span>
              <span className="font-terminal text-[8px] text-muted-foreground/70">LICENSED PROVIDER NOT CONFIGURED</span>
            </div>
          )
          : filtered.map((ev) => {
              const days = daysFromNow(ev.date);
              const isReported = days < 0;
              const cur = getCurrencySymbol(ev.symbol);
              const hasActual = ev.epsActual !== null;
              const epsDiff = hasActual && ev.epsEstimate !== null ? ev.epsActual! - ev.epsEstimate! : null;
              const epsBeat = epsDiff !== null ? epsDiff >= 0 : null;
              const shortSym = ev.symbol.replace(/\.(NS|BO|T|HK)$/, "");

              return (
                <div
                  key={`${ev.symbol}-${ev.date}`}
                  onClick={() => onSymbol?.(ev.symbol)}
                  className={`grid grid-cols-[3fr_2fr_1.5fr_1.5fr_2fr_1.5fr_2fr] gap-px px-4 py-3 border-b border-border/40 items-center cursor-pointer transition-colors hover:bg-white/5 ${
                    days === 0 ? "bg-[hsl(38,95%,50%)/5%]" : isReported ? "opacity-60" : ""
                  }`}
                >
                  {/* Company */}
                  <div>
                    <div
                      className="font-terminal text-[10px] font-bold"
                      style={{ color: REGION_COLORS[ev.region] ?? "hsl(38,95%,55%)" }}
                    >
                      {shortSym}
                    </div>
                    <div className="font-terminal text-[8px] text-muted-foreground truncate">{ev.name}</div>
                  </div>
                  {/* Quarter */}
                  <div className="text-right font-terminal text-[9px] text-muted-foreground">{ev.quarter}</div>
                  {/* EPS Est */}
                  <div className="text-right font-terminal text-[10px] tabular-nums">
                    {ev.epsEstimate !== null ? `${cur}${ev.epsEstimate.toFixed(2)}` : "—"}
                  </div>
                  {/* EPS Actual */}
                  <div className="text-right">
                    {hasActual ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`font-terminal text-[10px] tabular-nums font-bold ${epsBeat ? "text-[hsl(142,71%,45%)]" : "text-[hsl(0,80%,55%)]"}`}>
                          {cur}{ev.epsActual!.toFixed(2)}
                        </span>
                        {epsSurprise(ev.epsEstimate, ev.epsActual)}
                      </div>
                    ) : (
                      <span className="font-terminal text-[9px] text-muted-foreground">PENDING</span>
                    )}
                  </div>
                  {/* Revenue Est */}
                  <div className="text-right font-terminal text-[9px] tabular-nums text-muted-foreground">
                    {formatRevenue(ev.revenueEstimate, ev.symbol)}
                  </div>
                  {/* Time */}
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                      <span className="font-terminal text-[8px] text-muted-foreground uppercase">
                        {ev.time === "before" ? "PRE-MKT" : ev.time === "after" ? "POST-MKT" : "TBD"}
                      </span>
                    </div>
                  </div>
                  {/* Date */}
                  <div className="text-right">
                    <DateBadge dateStr={ev.date} days={days} />
                  </div>
                </div>
              );
            })
        }
      </div>

      {/* Footer legend */}
      <div className="shrink-0 border-t border-border bg-[#060606] px-4 py-2 flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[hsl(142,71%,45%)]" />
          <span className="font-terminal text-[8px] text-muted-foreground">EPS BEAT</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[hsl(0,80%,55%)]" />
          <span className="font-terminal text-[8px] text-muted-foreground">EPS MISS</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[hsl(38,95%,55%)]" />
          <span className="font-terminal text-[8px] text-muted-foreground">REPORTING TODAY</span>
        </div>
        <span className="font-terminal text-[7px] text-muted-foreground ml-auto">DATA: LIMURIA INTELLIGENCE</span>
      </div>
    </div>
  );
}
