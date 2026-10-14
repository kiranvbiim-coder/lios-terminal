import { useState, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useQuotes } from "@/lib/useFinance";
import { Globe2, TrendingUp, TrendingDown } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import type { OHLCVSeries } from "@/lib/finance";

interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }

// Sector ETFs
const SECTORS = [
  { label: "TECHNOLOGY",    sym: "XLK",  icon: "💻" },
  { label: "FINANCIALS",    sym: "XLF",  icon: "🏦" },
  { label: "HEALTHCARE",    sym: "XLV",  icon: "🏥" },
  { label: "ENERGY",        sym: "XLE",  icon: "⚡" },
  { label: "CONSUMER DISC", sym: "XLY",  icon: "🛍️" },
  { label: "INDUSTRIALS",   sym: "XLI",  icon: "🏭" },
  { label: "UTILITIES",     sym: "XLU",  icon: "💡" },
  { label: "MATERIALS",     sym: "XLB",  icon: "⚗️" },
  { label: "REAL ESTATE",   sym: "XLRE", icon: "🏢" },
  { label: "CONS. STAPLES", sym: "XLP",  icon: "🛒" },
  { label: "COMMUNICATION", sym: "XLC",  icon: "📡" },
];

// Business cycle phases and which sectors perform best
const CYCLE_PHASES = [
  {
    phase: "EARLY EXPANSION",
    color: "hsl(142,71%,45%)",
    leaders: ["XLY","XLF","XLK"],
    laggards: ["XLU","XLP"],
    desc: "Credit loosening, rising earnings estimates, strong job growth",
    duration: "12–24 months",
  },
  {
    phase: "LATE EXPANSION",
    color: "hsl(38,95%,55%)",
    leaders: ["XLE","XLB","XLI"],
    laggards: ["XLRE","XLU"],
    desc: "Capacity constraints, rising wages & commodities, margin pressure",
    duration: "6–18 months",
  },
  {
    phase: "RECESSION",
    color: "hsl(0,80%,55%)",
    leaders: ["XLU","XLP","XLV"],
    laggards: ["XLY","XLF","XLE"],
    desc: "Falling demand, credit tightening, defensive rotation",
    duration: "3–12 months",
  },
  {
    phase: "EARLY RECOVERY",
    color: "hsl(270,60%,60%)",
    leaders: ["XLK","XLY","XLRE"],
    laggards: ["XLE","XLB"],
    desc: "Rate cuts, stimulus, consumer confidence rebounding",
    duration: "6–18 months",
  },
];

// Timeframes for momentum
const FRAMES = ["1W", "1M", "3M", "6M", "YTD"] as const;
type Frame = typeof FRAMES[number];

// Approximate trading days back for each timeframe (used against 1Y of daily
// bars); YTD is computed separately since it's a calendar boundary, not a
// fixed lookback.
const FRAME_TRADING_DAYS: Record<Exclude<Frame, "YTD">, number> = {
  "1W": 5, "1M": 21, "3M": 63, "6M": 126,
};

function periodReturn(bars: { date: string; close: number }[], frame: Frame): number {
  if (bars.length < 2) return 0;
  const latest = bars[bars.length - 1].close;
  let base: number;
  if (frame === "YTD") {
    const year = new Date(bars[bars.length - 1].date).getFullYear();
    const yearStart = bars.find((b) => new Date(b.date).getFullYear() === year);
    base = yearStart ? yearStart.close : bars[0].close;
  } else {
    const idx = Math.max(0, bars.length - 1 - FRAME_TRADING_DAYS[frame]);
    base = bars[idx].close;
  }
  return base > 0 ? ((latest - base) / base) * 100 : 0;
}

export default function SectorRotationPanel({ onSymbol, onNav }: Props) {
  const [activeFrame, setActiveFrame] = useState<Frame>("1M");
  const [activeCycle, setActiveCycle] = useState(0);

  const syms = SECTORS.map(s => s.sym);
  const { data: quotes = [], isLoading } = useQuotes(syms);
  const qMap = useMemo(() => new Map(quotes.map(q => [q.symbol, q])), [quotes]);

  // 1Y of daily history per sector so the timeframe buttons compute a real
  // period return instead of always showing today's change regardless of
  // which button is selected.
  const historyResults = useQueries({
    queries: SECTORS.map((s) => ({
      queryKey: ["/api/finance/ohlcv", s.sym, "1Y", "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol: s.sym, range: "1Y", interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to fetch ${s.sym}`);
        return res.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60_000,
    })),
  });
  const historyLoading = historyResults.some((r) => r.isLoading);

  // Rank sectors by the selected timeframe's actual period return.
  const ranked = useMemo(() => {
    return SECTORS.map((s, i) => {
      const q = qMap.get(s.sym);
      const bars = historyResults[i]?.data?.bars ?? [];
      const chg = bars.length >= 2 ? periodReturn(bars, activeFrame) : (q?.changePercent ?? 0);
      return { ...s, quote: q, chg, price: q?.price ?? 0 };
    }).sort((a, b) => b.chg - a.chg);
  }, [qMap, historyResults, activeFrame]);

  const cycle = CYCLE_PHASES[activeCycle];
  const maxChg = Math.max(...ranked.map(r => Math.abs(r.chg)));
  const rankedMap = useMemo(() => new Map(ranked.map((r) => [r.sym, r])), [ranked]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Globe2 className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">SECTOR ROTATION & BUSINESS CYCLE MODEL</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">ROT</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Sector ranking */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
          {/* Timeframe selector */}
          <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-border bg-[#060606]">
            <span className="font-terminal text-[8px] text-muted-foreground mr-2">MOMENTUM:</span>
            {FRAMES.map(f => (
              <button key={f} onClick={() => setActiveFrame(f)}
                className={`px-2.5 py-0.5 font-terminal text-[8px] border transition-all ${activeFrame === f ? "border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)/10%] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground hover:text-foreground"}`}>{f}</button>
            ))}
          </div>

          {/* Sector performance bars */}
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-2">
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-3">SECTOR PERFORMANCE RANKING ({activeFrame})</div>
            {ranked.map((s, rank) => {
              const isLeader  = cycle.leaders.includes(s.sym);
              const isLaggard = cycle.laggards.includes(s.sym);
              const pct = maxChg > 0 ? (Math.abs(s.chg) / maxChg) * 100 : 0;
              const isUp = s.chg >= 0;
              return (
                <div key={s.sym} className={`p-2.5 border cursor-pointer hover:brightness-125 transition-all ${
                  isLeader  ? "border-[hsl(142,71%,25%)] bg-[hsl(142,71%,5%)]" :
                  isLaggard ? "border-[hsl(0,80%,20%)] bg-[hsl(0,80%,4%)]" :
                  "border-border bg-[#080808]"
                }`} onClick={() => onSymbol(s.sym)}>
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="font-terminal text-[8px] text-muted-foreground w-5 tabular-nums">#{rank+1}</span>
                    <span className="text-base">{s.icon}</span>
                    <span className="font-terminal text-[9px] text-foreground flex-1">{s.label}</span>
                    <span className="font-terminal text-[8px] text-muted-foreground">{s.sym}</span>
                    {isLeader  && <span className="font-terminal text-[7px] text-[hsl(142,71%,55%)] border border-[hsl(142,71%,25%)] px-1">LEADER</span>}
                    {isLaggard && <span className="font-terminal text-[7px] text-[hsl(0,80%,55%)] border border-[hsl(0,80%,25%)] px-1">LAGGARD</span>}
                    <span className={`font-terminal text-[11px] font-bold tabular-nums w-14 text-right ${isUp ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                      {isUp ? "+" : ""}{s.chg.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#111]">
                      <div className="h-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: isUp ? "hsl(142,71%,45%)" : "hsl(0,80%,55%)" }} />
                    </div>
                    <span className="font-terminal text-[8px] text-muted-foreground tabular-nums">${s.price.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Business cycle model */}
        <div className="w-72 shrink-0 bg-[#060606] overflow-y-auto scrollbar-thin p-4 space-y-4">
          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">BUSINESS CYCLE PHASE</div>
            <div className="grid grid-cols-2 gap-1.5">
              {CYCLE_PHASES.map((p, i) => (
                <button key={i} onClick={() => setActiveCycle(i)}
                  className={`p-2.5 border text-left transition-all ${activeCycle === i ? "border-opacity-80" : "border-border"}`}
                  style={{ borderColor: activeCycle === i ? p.color : undefined, backgroundColor: activeCycle === i ? `${p.color}18` : undefined }}>
                  <div className="font-terminal text-[8px] font-bold" style={{ color: activeCycle === i ? p.color : "hsl(0,0%,55%)" }}>{p.phase}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Active cycle detail */}
          <div className="border p-3 space-y-3" style={{ borderColor: `${cycle.color}40`, backgroundColor: `${cycle.color}08` }}>
            <div className="font-terminal text-[10px] font-bold" style={{ color: cycle.color }}>{cycle.phase}</div>
            <div className="font-terminal text-[8px] text-muted-foreground leading-relaxed">{cycle.desc}</div>
            <div className="font-terminal text-[7.5px] text-muted-foreground">Avg duration: {cycle.duration}</div>

            <div>
              <div className="font-terminal text-[7.5px] text-muted-foreground tracking-widest mb-1.5">OUTPERFORMING SECTORS</div>
              <div className="space-y-1">
                {cycle.leaders.map(sym => {
                  const sec = SECTORS.find(s => s.sym === sym);
                  const r   = rankedMap.get(sym);
                  return (
                    <div key={sym} className="flex items-center justify-between cursor-pointer hover:opacity-80" onClick={() => onSymbol(sym)}>
                      <span className="font-terminal text-[9px] text-[hsl(142,71%,55%)]">{sec?.icon} {sym}</span>
                      <span className="font-terminal text-[9px] tabular-nums text-foreground">{r ? `${r.chg >= 0 ? "+" : ""}${r.chg.toFixed(2)}%` : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="font-terminal text-[7.5px] text-muted-foreground tracking-widest mb-1.5">UNDERPERFORMING SECTORS</div>
              <div className="space-y-1">
                {cycle.laggards.map(sym => {
                  const sec = SECTORS.find(s => s.sym === sym);
                  const r   = rankedMap.get(sym);
                  return (
                    <div key={sym} className="flex items-center justify-between cursor-pointer hover:opacity-80" onClick={() => onSymbol(sym)}>
                      <span className="font-terminal text-[9px] text-[hsl(0,80%,60%)]">{sec?.icon} {sym}</span>
                      <span className="font-terminal text-[9px] tabular-nums text-foreground">{r ? `${r.chg >= 0 ? "+" : ""}${r.chg.toFixed(2)}%` : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="font-terminal text-[7.5px] text-muted-foreground border border-border/30 p-2 leading-relaxed">
            Sector rotation follows the business cycle with a 6–12 month lead. Current phase selection is manual — use macro data from ECON and STRS to calibrate.
          </div>
        </div>
      </div>
    </div>
  );
}
