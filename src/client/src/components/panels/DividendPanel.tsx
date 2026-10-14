import { useMemo, useState } from "react";
import { useQuotes } from "@/lib/useFinance";
import { useScreener } from "@/lib/useFinance";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import { DollarSign, Plus, X } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }

// High-dividend stocks
const DEFAULT_DIV_STOCKS = ["JNJ","KO","PEP","PG","MMM","T","VZ","MO","PM","CVX","XOM","ABT","MCD","WMT","ABBV","O","SPG","D","NEE","SO"];
const MIN_DIV_STOCKS = 3;
const MAX_DIV_STOCKS = 30;

// Ex-dividend calendar (approximate static dates for demo)
const EX_DIV_CALENDAR: Record<string, { exDate: string; amount: number; freq: string; streak: number }> = {
  "JNJ":  { exDate: "2025-08-19", amount: 1.24, freq: "Quarterly", streak: 62 },
  "KO":   { exDate: "2025-09-12", amount: 0.485,freq: "Quarterly", streak: 62 },
  "PEP":  { exDate: "2025-09-03", amount: 1.355,freq: "Quarterly", streak: 52 },
  "PG":   { exDate: "2025-07-18", amount: 0.9913,freq:"Quarterly", streak: 67 },
  "MMM":  { exDate: "2025-08-18", amount: 0.70, freq: "Quarterly", streak: 65 },
  "T":    { exDate: "2025-07-09", amount: 0.2775,freq:"Quarterly", streak: 0  },
  "VZ":   { exDate: "2025-07-08", amount: 0.665, freq:"Quarterly", streak: 18 },
  "MO":   { exDate: "2025-09-12", amount: 0.94,  freq:"Quarterly", streak: 54 },
  "PM":   { exDate: "2025-09-19", amount: 1.35,  freq:"Quarterly", streak: 16 },
  "CVX":  { exDate: "2025-08-18", amount: 1.63,  freq:"Quarterly", streak: 37 },
  "XOM":  { exDate: "2025-08-14", amount: 0.99,  freq:"Quarterly", streak: 42 },
  "ABT":  { exDate: "2025-07-15", amount: 0.59,  freq:"Quarterly", streak: 52 },
  "MCD":  { exDate: "2025-08-30", amount: 1.77,  freq:"Quarterly", streak: 48 },
  "WMT":  { exDate: "2025-12-05", amount: 0.235, freq:"Quarterly", streak: 51 },
  "ABBV": { exDate: "2025-07-11", amount: 1.64,  freq:"Quarterly", streak: 12 },
  "O":    { exDate: "2025-08-01", amount: 0.264, freq:"Monthly",   streak: 30 },
  "SPG":  { exDate: "2025-09-12", amount: 2.05,  freq:"Quarterly", streak: 12 },
  "D":    { exDate: "2025-09-08", amount: 0.6675,freq:"Quarterly", streak: 1  },
  "NEE":  { exDate: "2025-08-29", amount: 0.5415,freq:"Quarterly", streak: 28 },
  "SO":   { exDate: "2025-08-19", amount: 0.72,  freq:"Quarterly", streak: 23 },
};

function daysUntil(d: string) { return Math.round((new Date(d).getTime() - Date.now()) / 86400000); }

export default function DividendPanel({ onSymbol }: Props) {
  const [DIV_STOCKS, setDivStocks] = useState<string[]>(DEFAULT_DIV_STOCKS);
  const [tickerInput, setTickerInput] = useState("");
  const addStock = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t && !DIV_STOCKS.includes(t) && DIV_STOCKS.length < MAX_DIV_STOCKS) {
      setDivStocks((prev) => [...prev, t]);
      setTickerInput("");
    }
  };
  const removeStock = (sym: string) => {
    if (DIV_STOCKS.length <= MIN_DIV_STOCKS) return;
    setDivStocks((prev) => prev.filter((s) => s !== sym));
  };

  const { data: quotes = [] } = useQuotes(DIV_STOCKS);
  const qMap = useMemo(() => new Map(quotes.map(q => [q.symbol, q])), [quotes]);

  const enriched = useMemo(() => DIV_STOCKS.map(sym => {
    const q   = qMap.get(sym);
    const cal = EX_DIV_CALENDAR[sym];
    const price = q?.price ?? 0;
    const annualDiv = cal ? cal.amount * (cal.freq === "Monthly" ? 12 : 4) : 0;
    const yield_ = price > 0 ? (annualDiv / price) * 100 : 0;
    const fcfPayout = q?.pe ? Math.min(100, annualDiv / (price / (q.pe || 20)) * 100) : null;
    const dtu = cal ? daysUntil(cal.exDate) : null;
    const aristocrat = (cal?.streak ?? 0) >= 25;
    const king        = (cal?.streak ?? 0) >= 50;
    return { sym, price, yield_, annualDiv, fcfPayout, dtu, ...cal, aristocrat, king };
  }).sort((a,b) => b.yield_ - a.yield_), [qMap]);

  const upcoming = enriched.filter(e => e.dtu !== null && e.dtu >= 0 && e.dtu <= 30).sort((a,b) => (a.dtu??99) - (b.dtu??99));
  const kings = enriched.filter(e => e.king);
  const aristocrats = enriched.filter(e => e.aristocrat && !e.king);

  const yieldBuckets = [
    { name: "0-1%", count: enriched.filter(e => e.yield_ < 1).length },
    { name: "1-2%", count: enriched.filter(e => e.yield_ >= 1 && e.yield_ < 2).length },
    { name: "2-4%", count: enriched.filter(e => e.yield_ >= 2 && e.yield_ < 4).length },
    { name: "4-6%", count: enriched.filter(e => e.yield_ >= 4 && e.yield_ < 6).length },
    { name: "6%+",  count: enriched.filter(e => e.yield_ >= 6).length },
  ];

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <DollarSign className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">DIVIDEND INTELLIGENCE DASHBOARD</span>
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && addStock()}
            disabled={DIV_STOCKS.length >= MAX_DIV_STOCKS}
            placeholder="ADD TICKER…"
            className="w-24 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40"
          />
          <button
            onClick={addStock}
            disabled={DIV_STOCKS.length >= MAX_DIV_STOCKS}
            className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-2.5 h-2.5" /> ADD
          </button>
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">DIV</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: main table */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Upcoming ex-dates */}
          <div className="p-3 border-b border-border">
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">⏰ UPCOMING EX-DIVIDEND DATES (NEXT 30 DAYS)</div>
            <div className="flex gap-2 flex-wrap">
              {upcoming.length === 0 ? (
                <span className="font-terminal text-[9px] text-muted-foreground">No ex-dates in next 30 days for tracked stocks</span>
              ) : upcoming.map(e => (
                <div key={e.sym} onClick={() => onSymbol(e.sym)} className="border border-[hsl(38,95%,25%)] bg-[hsl(38,95%,5%)] px-2.5 py-1.5 cursor-pointer hover:brightness-125 transition-all">
                  <div className="font-terminal text-[9px] font-bold text-[hsl(38,95%,55%)]">{e.sym}</div>
                  <div className="font-terminal text-[7.5px] text-muted-foreground">Ex: T+{e.dtu}d · ${e.amount}/sh</div>
                </div>
              ))}
            </div>
          </div>

          {/* Main table */}
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#070707] z-10">
              <tr className="border-b border-border">
                {["TICKER","PRICE","YIELD","ANNUAL DIV","PAYOUT EST","EX-DATE","STREAK","BADGE"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enriched.map(e => {
                const yieldCls = e.yield_ >= 5 ? "text-[hsl(142,71%,55%)]" : e.yield_ >= 3 ? "text-foreground" : "text-muted-foreground";
                return (
                  <tr key={e.sym} className="border-b border-border/30 hover:bg-white/[1.5%] cursor-pointer" onClick={() => onSymbol(e.sym)}>
                    <td className="group px-3 py-2.5 font-terminal text-[10px] font-bold text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {DIV_STOCKS.length > MIN_DIV_STOCKS && (
                          <button onClick={(ev) => { ev.stopPropagation(); removeStock(e.sym); }} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-[hsl(0,80%,55%)]"><X className="w-2.5 h-2.5" /></button>
                        )}
                        {e.sym}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">${e.price.toFixed(2)}</td>
                    <td className={`px-3 py-2.5 font-terminal text-[10px] font-bold tabular-nums ${yieldCls}`}>{e.yield_.toFixed(2)}%</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">${e.annualDiv.toFixed(2)}</td>
                    <td className="px-3 py-2.5 font-terminal text-[8px] tabular-nums text-muted-foreground">
                      {e.fcfPayout !== null ? (
                        <span className={e.fcfPayout > 80 ? "text-[hsl(0,80%,55%)]" : e.fcfPayout > 60 ? "text-[hsl(38,95%,55%)]" : "text-[hsl(142,71%,55%)]"}>
                          {e.fcfPayout.toFixed(0)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {e.exDate ? (
                        <div>
                          <div className="font-terminal text-[8px] text-foreground">{new Date(e.exDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                          {e.dtu !== null && <div className={`font-terminal text-[7px] ${e.dtu <= 14 ? "text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>{e.dtu >= 0 ? `T+${e.dtu}d` : "Passed"}</div>}
                        </div>
                      ) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{e.streak ?? 0}yr</td>
                    <td className="px-3 py-2.5">
                      {e.king && <span className="font-terminal text-[7px] bg-[hsl(38,95%,10%)] border border-[hsl(38,95%,30%)] text-[hsl(38,95%,65%)] px-1.5 py-0.5">👑 KING</span>}
                      {!e.king && e.aristocrat && <span className="font-terminal text-[7px] bg-[hsl(270,50%,10%)] border border-[hsl(270,50%,30%)] text-[hsl(270,50%,65%)] px-1.5 py-0.5">🏅 ARISTOCRAT</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right: yield distribution + kings */}
        <div className="w-64 shrink-0 border-l border-border bg-[#060606] p-4 space-y-4 overflow-y-auto scrollbar-thin">
          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">YIELD DISTRIBUTION</div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yieldBuckets} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
                  <XAxis dataKey="name" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,50%)" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,50%)" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                  <Bar dataKey="count" fill="hsl(38,95%,40%)" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Dividend Kings */}
          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">👑 DIVIDEND KINGS (50+ yrs)</div>
            {kings.map(k => (
              <div key={k.sym} className="py-2 border-b border-border/30 cursor-pointer hover:bg-white/[1%] flex items-center justify-between" onClick={() => onSymbol(k.sym)}>
                <div>
                  <span className="font-terminal text-[9px] font-bold text-[hsl(38,95%,55%)]">{k.sym}</span>
                  <span className="font-terminal text-[7.5px] text-muted-foreground ml-2">{k.streak}yr streak</span>
                </div>
                <span className="font-terminal text-[9px] font-bold text-[hsl(142,71%,55%)]">{k.yield_.toFixed(2)}%</span>
              </div>
            ))}
          </div>

          <div className="font-terminal text-[7.5px] text-muted-foreground/70 border border-border/30 p-2 leading-relaxed">
            Payout ratio estimated from P/E. Yield &gt;7% may signal cut risk. DRIP (dividend reinvestment) compounds returns significantly over time.
          </div>
        </div>
      </div>
    </div>
  );
}
