import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState } from "react";
import { observedQuotes } from "@/lib/quoteObservation";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Globe, Plus, X } from "lucide-react";
import { useQuotes } from "@/lib/useFinance";

const MAX_CUSTOM_PAIRS = 10;

// Commodity strip
const COMMODITIES = [
  { label: "GOLD",    symbol: "GC=F",    unit: "$/oz"  },
  { label: "OIL WTI", symbol: "CL=F",   unit: "$/bbl" },
  { label: "SILVER",  symbol: "SI=F",    unit: "$/oz"  },
  { label: "COPPER",  symbol: "HG=F",    unit: "$/lb"  },
];

export default function ForexPanel() {
  const [filterRegion, setFilterRegion] = useTerminalArtifactState<"ALL" | "MAJOR" | "ASIA" | "EM">("ForexPanel.filterRegion", "ALL");

  // The main grid below is limited to the 10 pairs the server tracks
  // (FX_PAIRS_DEF); custom pairs bypass that and fetch any Yahoo-recognized
  // FX symbol live through the general quotes endpoint, the same one every
  // equity quote already uses.
  const [customPairs, setCustomPairs] = useTerminalArtifactState<string[]>("ForexPanel.customPairs", []);
  const [customInput, setCustomInput] = useTerminalArtifactState("ForexPanel.customInput", "");
  const addCustomPair = () => {
    const raw = customInput.trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (raw.length !== 6) return;
    if (!customPairs.includes(raw) && customPairs.length < MAX_CUSTOM_PAIRS) {
      setCustomPairs((prev) => [...prev, raw]);
      setCustomInput("");
    }
  };
  const removeCustomPair = (p: string) => setCustomPairs((prev) => prev.filter((x) => x !== p));
  const { data: customQuotes = [] } = useQuotes(customPairs.map((p) => `${p}=X`));
  const customQuoteMap = new Map(customQuotes.map((q) => [q.symbol.replace("=X", ""), q]));

  const { data: pairs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/finance/forex"],
    queryFn: async () => {
      const res = await fetch("/api/finance/forex");
      if (!res.ok) throw new Error("Failed to fetch forex");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: commodityQuotes } = useQuery<any[]>({
    queryKey: ["/api/finance/quotes", COMMODITIES.map((c) => c.symbol).join(",")],
    queryFn: async () => {
      const symbols = COMMODITIES.map((c) => c.symbol).join(",");
      const res = await fetch(`/api/finance/quotes?symbols=${symbols}`);
      return observedQuotes<any>(await res.json());
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const commodityMap = new Map((commodityQuotes || []).map((q: any) => [q.symbol, q]));

  const regionFilters: Record<string, string[]> = {
    ALL:   ["EURUSD=X","GBPUSD=X","USDJPY=X","USDINR=X","AUDUSD=X","USDCNY=X","GBPINR=X","EURINR=X","USDSGD=X","USDHKD=X"],
    MAJOR: ["EURUSD=X","GBPUSD=X","USDJPY=X","AUDUSD=X","USDCNY=X"],
    ASIA:  ["USDJPY=X","USDINR=X","USDCNY=X","USDSGD=X","USDHKD=X"],
    EM:    ["USDINR=X","GBPINR=X","EURINR=X","USDCNY=X"],
  };

  const visiblePairs = (pairs || []).filter((p: any) =>
    regionFilters[filterRegion]?.includes(p.pair)
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Globe className="w-4 h-4 text-[hsl(186,80%,55%)]" />
        <span className="panel-label text-[hsl(186,80%,55%)]">FOREX  /  FX MARKETS</span>
        <div className="flex items-center gap-1.5 ml-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[hsl(142,71%,45%)] animate-pulse" />
          <span className="font-terminal text-[8px] text-[hsl(142,71%,45%)]">LIVE</span>
        </div>
        {/* Add a custom pair -- any Yahoo-recognized FX symbol, not just the 10 tracked below */}
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && addCustomPair()}
            disabled={customPairs.length >= MAX_CUSTOM_PAIRS}
            placeholder="ADD PAIR e.g. USDCAD"
            maxLength={6}
            className="w-32 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(186,80%,50%)/50%] disabled:opacity-40"
          />
          <button
            onClick={addCustomPair}
            disabled={customPairs.length >= MAX_CUSTOM_PAIRS}
            className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-2.5 h-2.5" /> ADD
          </button>
        </div>
        {/* Region filter */}
        <div className="flex items-center gap-px">
          {(["ALL", "MAJOR", "ASIA", "EM"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setFilterRegion(r)}
              className={`px-2.5 py-1 font-terminal text-[8px] tracking-widest border transition-colors ${
                filterRegion === r
                  ? "border-[hsl(186,80%,55%)/50%] bg-[hsl(186,80%,55%)/10%] text-[hsl(186,80%,55%)]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Main FX Grid */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Column headers */}
        <div className="grid grid-cols-[2fr_2fr_1.5fr_1.5fr_1.5fr] gap-px px-4 py-1.5 border-b border-border bg-[#0a0a0a] sticky top-0 z-10">
          {["PAIR", "RATE", "24H CHG", "HIGH", "LOW"].map((h) => (
            <span key={h} className="font-terminal text-[8px] tracking-widest text-muted-foreground text-right first:text-left">{h}</span>
          ))}
        </div>

        {customPairs.length > 0 && (
          <>
            <div className="px-4 py-1 font-terminal text-[8px] tracking-widest text-muted-foreground bg-[#080808]">CUSTOM PAIRS</div>
            {customPairs.map((p) => {
              const q = customQuoteMap.get(p);
              const isUp = (q?.changePercent ?? 0) >= 0;
              return (
                <div
                  key={p}
                  className="grid grid-cols-[2fr_2fr_1.5fr_1.5fr_1.5fr] gap-px px-4 py-2.5 border-b border-border/40 hover:bg-white/5 items-center transition-colors group"
                >
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => removeCustomPair(p)} className="text-muted-foreground hover:text-[hsl(0,80%,55%)]"><X className="w-3 h-3" /></button>
                    <div>
                      <div className="font-terminal text-[11px] font-bold text-[hsl(186,80%,55%)]">{p}</div>
                      <div className="font-terminal text-[8px] text-muted-foreground">{p.slice(0, 3)} → {p.slice(3, 6)}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-terminal text-[13px] font-bold tabular-nums text-foreground">
                      {q ? (q.price >= 10 ? q.price.toFixed(4) : q.price.toFixed(5)) : "—"}
                    </div>
                  </div>
                  <div className={`text-right font-terminal text-[10px] font-semibold tabular-nums flex flex-col items-end ${isUp ? "text-[hsl(142,71%,45%)]" : "text-[hsl(0,80%,55%)]"}`}>
                    {q && (
                      <div className="flex items-center gap-1">
                        {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {isUp ? "+" : ""}{q.changePercent.toFixed(3)}%
                      </div>
                    )}
                  </div>
                  <div className="text-right font-terminal text-[9px] tabular-nums text-muted-foreground">
                    {q ? (q.dayHigh >= 10 ? q.dayHigh.toFixed(4) : q.dayHigh.toFixed(5)) : "—"}
                  </div>
                  <div className="text-right font-terminal text-[9px] tabular-nums text-muted-foreground">
                    {q ? (q.dayLow >= 10 ? q.dayLow.toFixed(4) : q.dayLow.toFixed(5)) : "—"}
                  </div>
                </div>
              );
            })}
            <div className="px-4 py-1 font-terminal text-[8px] tracking-widest text-muted-foreground bg-[#080808]">TRACKED PAIRS</div>
          </>
        )}

        {isLoading
          ? Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-14 mx-4 my-1 bg-border" />)
          : visiblePairs.map((pair: any) => {
              const unavailable = pair.rate === null || pair.rate === undefined;
              const isUp = !unavailable && pair.changePercent >= 0;
              const fmt = (value: number | null | undefined) =>
                value === null || value === undefined ? "—" : value >= 10 ? value.toFixed(4) : value.toFixed(5);
              return (
                <div
                  key={pair.pair}
                  className="grid grid-cols-[2fr_2fr_1.5fr_1.5fr_1.5fr] gap-px px-4 py-2.5 border-b border-border/40 hover:bg-white/5 items-center transition-colors group"
                >
                  <div>
                    <div className="font-terminal text-[11px] font-bold text-[hsl(186,80%,55%)]">{pair.label}</div>
                    <div className="font-terminal text-[8px] text-muted-foreground">{pair.base} → {pair.quote}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-terminal text-[13px] font-bold tabular-nums text-foreground">
                      {fmt(pair.rate)}
                    </div>
                  </div>
                  <div className={`text-right font-terminal text-[10px] font-semibold tabular-nums flex flex-col items-end ${unavailable ? "text-muted-foreground" : isUp ? "text-[hsl(142,71%,45%)]" : "text-[hsl(0,80%,55%)]"}`}>
                    {unavailable ? (
                      <span>—</span>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {isUp ? "+" : ""}{pair.changePercent.toFixed(3)}%
                        </div>
                        <div className="text-[8px] opacity-70">{isUp ? "+" : ""}{fmt(pair.change)}</div>
                      </>
                    )}
                  </div>
                  <div className="text-right font-terminal text-[9px] tabular-nums text-muted-foreground">
                    {fmt(pair.high)}
                  </div>
                  <div className="text-right font-terminal text-[9px] tabular-nums text-muted-foreground">
                    {fmt(pair.low)}
                  </div>
                </div>
              );
            })
        }
      </div>

      {/* Commodity Footer Strip */}
      <div className="shrink-0 border-t border-border bg-[#060606]">
        <div className="px-4 py-1 font-terminal text-[8px] tracking-widest text-muted-foreground border-b border-border/50">COMMODITIES</div>
        <div className="flex items-stretch divide-x divide-border/50">
          {COMMODITIES.map((com) => {
            const q = commodityMap.get(com.symbol);
            const isUp = (q?.changePercent ?? 0) >= 0;
            return (
              <div key={com.symbol} className="flex-1 flex flex-col gap-0.5 px-3 py-2">
                <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">{com.label}</div>
                <div className="font-terminal text-[11px] font-bold tabular-nums text-foreground">
                  {q ? `$${q.price.toFixed(2)}` : "—"}
                </div>
                <div className={`font-terminal text-[8px] tabular-nums ${isUp ? "text-[hsl(142,71%,45%)]" : "text-[hsl(0,80%,55%)]"}`}>
                  {q ? `${isUp ? "+" : ""}${q.changePercent.toFixed(2)}%` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
