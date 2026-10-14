import { useState, useMemo } from "react";
import { useMarketGainers, useQuotes } from "@/lib/useFinance";
import { BarChart2, AlertTriangle, Plus, X } from "lucide-react";
import { BarChart, Bar, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }

// Synthetic short interest data (in production: fetch from Quandl/FINRA)
const SHORT_DATA: Record<string, { shortFloat: number; dtc: number; borrowRate: number; shortTrend: "rising"|"falling"|"flat" }> = {
  "GME":  { shortFloat: 18.5, dtc: 4.2, borrowRate: 35.5, shortTrend: "falling" },
  "AMC":  { shortFloat: 24.1, dtc: 6.8, borrowRate: 48.2, shortTrend: "rising"  },
  "BBBY": { shortFloat: 32.0, dtc: 8.5, borrowRate: 120,  shortTrend: "rising"  },
  "TSLA": { shortFloat: 3.1,  dtc: 1.2, borrowRate: 0.8,  shortTrend: "flat"    },
  "NVDA": { shortFloat: 1.8,  dtc: 0.5, borrowRate: 0.3,  shortTrend: "falling" },
  "AAPL": { shortFloat: 0.9,  dtc: 0.3, borrowRate: 0.3,  shortTrend: "flat"    },
  "META": { shortFloat: 2.1,  dtc: 0.7, borrowRate: 0.4,  shortTrend: "flat"    },
  "PLTR": { shortFloat: 6.8,  dtc: 2.1, borrowRate: 2.5,  shortTrend: "rising"  },
  "COIN": { shortFloat: 9.2,  dtc: 3.4, borrowRate: 8.5,  shortTrend: "falling" },
  "RIVN": { shortFloat: 14.6, dtc: 4.9, borrowRate: 12.0, shortTrend: "rising"  },
  "LCID": { shortFloat: 22.3, dtc: 7.2, borrowRate: 28.0, shortTrend: "rising"  },
  "SMCI": { shortFloat: 11.5, dtc: 3.8, borrowRate: 6.5,  shortTrend: "flat"    },
};

const BASE_SYMS = Object.keys(SHORT_DATA);
const MAX_CUSTOM_SHORT = 15;

function squeezeScore(sf: number, dtc: number, br: number, trend: string, chgPct: number) {
  let score = 0;
  if (sf > 20)  score += 30;
  else if (sf > 10) score += 15;
  else if (sf > 5)  score += 5;
  if (dtc > 5) score += 25;
  else if (dtc > 2) score += 10;
  if (br > 50) score += 20;
  else if (br > 10) score += 10;
  if (trend === "rising") score += 15;
  if (chgPct > 5) score += 10;
  return Math.min(100, score);
}

export default function ShortInterestPanel({ onSymbol }: Props) {
  const [customSyms, setCustomSyms] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState("");
  const ALL_SYMS = useMemo(() => [...BASE_SYMS, ...customSyms], [customSyms]);

  const addTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t && !ALL_SYMS.includes(t) && customSyms.length < MAX_CUSTOM_SHORT) {
      setCustomSyms((prev) => [...prev, t]);
      setTickerInput("");
    }
  };
  const removeTicker = (sym: string) => setCustomSyms((prev) => prev.filter((s) => s !== sym));

  const { data: quotes = [] } = useQuotes(ALL_SYMS);
  const [sortBy, setSortBy] = useState<"squeeze"|"shortFloat"|"dtc">("squeeze");

  const qMap = useMemo(() => new Map(quotes.map(q => [q.symbol, q])), [quotes]);

  // Tickers outside SHORT_DATA (the synthetic short-interest table -- see
  // comment above; there's no live FINRA/Quandl feed here) get real price
  // data but honestly show "no short data" rather than fabricating numbers.
  const data = useMemo(() => {
    return ALL_SYMS.map(sym => {
      const q = qMap.get(sym);
      const s = SHORT_DATA[sym];
      const score = s ? squeezeScore(s.shortFloat, s.dtc, s.borrowRate, s.shortTrend, q?.changePercent ?? 0) : null;
      return {
        sym,
        shortFloat: s?.shortFloat ?? null,
        dtc: s?.dtc ?? null,
        borrowRate: s?.borrowRate ?? null,
        shortTrend: s?.shortTrend ?? null,
        price: q?.price ?? 0,
        chg: q?.changePercent ?? 0,
        score,
        isCustom: !s,
      };
    }).sort((a, b) => {
      if (sortBy === "squeeze")    return (b.score ?? -1) - (a.score ?? -1);
      if (sortBy === "shortFloat") return (b.shortFloat ?? -1) - (a.shortFloat ?? -1);
      return (b.dtc ?? -1) - (a.dtc ?? -1);
    });
  }, [qMap, sortBy, ALL_SYMS]);

  const squeezeColor = (score: number | null) =>
    score === null ? "hsl(0,0%,30%)" : score >= 70 ? "hsl(0,80%,55%)" : score >= 40 ? "hsl(38,95%,55%)" : "hsl(142,71%,45%)";

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <BarChart2 className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">SHORT INTEREST & SQUEEZE PROBABILITY MONITOR</span>
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && addTicker()}
            disabled={customSyms.length >= MAX_CUSTOM_SHORT}
            placeholder="TRACK TICKER…"
            className="w-24 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40"
          />
          <button
            onClick={addTicker}
            disabled={customSyms.length >= MAX_CUSTOM_SHORT}
            className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-2.5 h-2.5" /> ADD
          </button>
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">SHRT</span>
      </div>

      {/* Sort controls */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-border bg-[#060606]">
        <span className="font-terminal text-[8px] text-muted-foreground mr-2">SORT BY:</span>
        {([["squeeze","SQUEEZE SCORE"],["shortFloat","SHORT FLOAT %"],["dtc","DAYS-TO-COVER"]] as const).map(([k,l]) => (
          <button key={k} onClick={() => setSortBy(k as any)}
            className={`px-2.5 py-0.5 font-terminal text-[8px] border transition-all ${sortBy === k ? "border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)/10%] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground hover:text-foreground"}`}>{l}</button>
        ))}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main table */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#070707] z-10">
              <tr className="border-b border-border">
                {["TICKER","PRICE","TODAY","SHORT FLOAT","DAYS-TO-COVER","BORROW RATE","TREND","SQUEEZE SCORE"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map(d => {
                const sqColor = squeezeColor(d.score);
                const trendCls = d.shortTrend === "rising" ? "text-[hsl(0,80%,60%)]" : d.shortTrend === "falling" ? "text-[hsl(142,71%,55%)]" : "text-muted-foreground";
                const trendLabel = d.shortTrend === "rising" ? "▲ RISING" : d.shortTrend === "falling" ? "▼ FALLING" : d.shortTrend === "flat" ? "→ FLAT" : "—";
                return (
                  <tr key={d.sym} className="group border-b border-border/30 hover:bg-white/[1.5%] cursor-pointer" onClick={() => onSymbol(d.sym)}>
                    <td className="px-3 py-2.5 font-terminal text-[10px] font-bold text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {d.isCustom && (
                          <button onClick={(e) => { e.stopPropagation(); removeTicker(d.sym); }} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-[hsl(0,80%,55%)]"><X className="w-2.5 h-2.5" /></button>
                        )}
                        {d.sym}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">${d.price.toFixed(2)}</td>
                    <td className={`px-3 py-2.5 font-terminal text-[9px] tabular-nums font-bold ${d.chg >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{d.chg >= 0 ? "+" : ""}{d.chg.toFixed(2)}%</td>
                    <td className="px-3 py-2.5">
                      {d.shortFloat !== null ? (
                        <>
                          <div className="font-terminal text-[9px] tabular-nums">{d.shortFloat.toFixed(1)}%</div>
                          <div className="h-1 bg-[#111] mt-0.5 w-20">
                            <div className="h-full" style={{ width: `${Math.min(100, d.shortFloat * 3)}%`, backgroundColor: d.shortFloat > 20 ? "hsl(0,80%,55%)" : d.shortFloat > 10 ? "hsl(38,95%,55%)" : "hsl(142,71%,45%)" }} />
                          </div>
                        </>
                      ) : <span className="font-terminal text-[9px] text-muted-foreground/40">no data</span>}
                    </td>
                    <td className={`px-3 py-2.5 font-terminal text-[9px] tabular-nums ${d.dtc !== null && d.dtc > 5 ? "text-[hsl(0,80%,60%)]" : d.dtc !== null && d.dtc > 2 ? "text-[hsl(38,95%,55%)]" : "text-foreground"}`}>{d.dtc !== null ? `${d.dtc.toFixed(1)}d` : "—"}</td>
                    <td className={`px-3 py-2.5 font-terminal text-[9px] tabular-nums ${d.borrowRate !== null && d.borrowRate > 20 ? "text-[hsl(0,80%,60%)]" : ""}`}>{d.borrowRate !== null ? `${d.borrowRate.toFixed(1)}%` : "—"}</td>
                    <td className={`px-3 py-2.5 font-terminal text-[9px] ${trendCls}`}>{trendLabel}</td>
                    <td className="px-3 py-2.5">
                      {d.score !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-[#111]">
                            <div className="h-full" style={{ width: `${d.score}%`, backgroundColor: sqColor }} />
                          </div>
                          <span className="font-terminal text-[10px] font-bold tabular-nums" style={{ color: sqColor }}>{d.score}</span>
                        </div>
                      ) : <span className="font-terminal text-[9px] text-muted-foreground/40">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right: bar chart */}
        <div className="w-64 shrink-0 border-l border-border bg-[#060606] p-4 space-y-4 overflow-y-auto scrollbar-thin">
          <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">SQUEEZE SCORES</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 28 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,40%)" }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="sym" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,55%)" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                <Bar dataKey="score" radius={[0, 2, 2, 0]}>
                  {data.map((d, i) => <Cell key={i} fill={squeezeColor(d.score)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Methodology */}
          <div className="border border-border p-2.5 font-terminal text-[7.5px] text-muted-foreground space-y-1.5">
            <div className="text-foreground font-bold tracking-widest">SQUEEZE SCORE METHODOLOGY</div>
            <div><span className="text-[hsl(0,80%,55%)]">Short Float &gt;20%:</span> +30pts</div>
            <div><span className="text-[hsl(38,95%,55%)]">Days-to-Cover &gt;5:</span> +25pts</div>
            <div><span className="text-[hsl(270,60%,60%)]">Borrow Rate &gt;50%:</span> +20pts</div>
            <div><span className="text-[hsl(200,80%,55%)]">Rising Short Trend:</span> +15pts</div>
            <div><span className="text-[hsl(142,71%,55%)]">70+ = HIGH SQUEEZE RISK</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
