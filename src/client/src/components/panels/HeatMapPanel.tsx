import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutGrid, Plus, X } from "lucide-react";
import { useSemanticHues } from "@/lib/useSemanticHues";
import type { Quote } from "@/lib/finance";
import { computeHeatmapAnalytics, contributionForQuote, relativeVolumeForQuote } from "@/lib/heatmapAnalytics";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";

const REGION_COLORS: Record<string, string> = {
  US: "hsl(38,95%,55%)",
  IN: "hsl(142,71%,45%)",
  JP: "hsl(0,80%,55%)",
  HK: "hsl(186,80%,55%)",
};

function pctToColor(pct: number, upHue: number, downHue: number): string {
  const clamped = Math.max(-5, Math.min(5, pct));
  if (clamped > 0) {
    const intensity = clamped / 5;
    return `hsl(${upHue},${Math.round(50 + intensity * 25)}%,${Math.round(15 + intensity * 25)}%)`;
  }
  const intensity = Math.abs(clamped) / 5;
  return `hsl(${downHue},${Math.round(50 + intensity * 25)}%,${Math.round(15 + intensity * 25)}%)`;
}

function textColorForBg(pct: number): string {
  return Math.abs(pct) > 1.5 ? "hsl(0,0%,100%)" : "hsl(0,0%,85%)";
}

const REGION_UNIVERSE: Record<string, string[]> = {
  US: ["AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","BRK-B","JPM","V","MA","UNH","XOM","JNJ","WMT","BAC","PG","HD","CVX","ABBV","KO","MRK","PEP","LLY","AVGO","COST","TMO","DIS","ADBE","NFLX","CRM","CSCO","ACN","MCD","ABT","DHR","TXN","INTC","QCOM","MS","GS","BA","CAT","RTX","HON","IBM","ORCL","AMGN","BMY","GE"],
  IN: ["RELIANCE.NS","TCS.NS","HDFCBANK.NS","INFY.NS","HINDUNILVR.NS","ICICIBANK.NS","KOTAKBANK.NS","LT.NS","SBIN.NS","AXISBANK.NS","BAJFINANCE.NS","MARUTI.NS","TITAN.NS","WIPRO.NS","ASIANPAINT.NS","ULTRACEMCO.NS","SUNPHARMA.NS","DRREDDY.NS","POWERGRID.NS","NTPC.NS"],
  JP: ["7203.T","9984.T","6758.T","6861.T","6367.T","7974.T","8316.T","8411.T","4502.T","9432.T","6902.T","7267.T","6954.T","4519.T","8591.T"],
  HK: ["0700.HK","9988.HK","3690.HK","0941.HK","1299.HK","2318.HK","0388.HK","0883.HK","1398.HK","0005.HK","2628.HK","1177.HK","0175.HK","2020.HK"],
};

type SortBy = "marketcap" | "change" | "sector" | "volume" | "rvol" | "contribution" | "zscore";

const SORT_LABELS: Array<[SortBy, string]> = [
  ["marketcap", "MKT CAP"], ["change", "MOVE %"], ["sector", "SECTOR"], ["volume", "VOL"],
  ["rvol", "RVOL"], ["contribution", "IMPACT"], ["zscore", "Z-SCORE"],
];

function formatCap(value: number | null) {
  if (!value || !Number.isFinite(value)) return "—";
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(0)}B`;
  return `${(value / 1e6).toFixed(0)}M`;
}

export default function HeatMapPanel({ onSymbol }: { onSymbol?: (sym: string) => void }) {
  const [region, setRegion] = useTerminalArtifactState<"US" | "IN" | "JP" | "HK">("HeatMapPanel.region", "US");
  const [sortBy, setSortBy] = useTerminalArtifactState<SortBy>("HeatMapPanel.sortBy", "marketcap");
  const { upHue, downHue } = useSemanticHues();
  const [customTickers, setCustomTickers] = useTerminalArtifactState<Record<string, string[]>>("HeatMapPanel.customTickers", { US: [], IN: [], JP: [], HK: [] });
  const [removedTickers, setRemovedTickers] = useTerminalArtifactState<Record<string, string[]>>("HeatMapPanel.removedTickers", { US: [], IN: [], JP: [], HK: [] });
  const [tickerInput, setTickerInput] = useTerminalArtifactState("HeatMapPanel.tickerInput", "");

  const symbols = useMemo(() => {
    const base = REGION_UNIVERSE[region].filter((symbol) => !removedTickers[region].includes(symbol));
    return [...base, ...customTickers[region]];
  }, [region, customTickers, removedTickers]);

  const addTicker = () => {
    const ticker = tickerInput.trim().toUpperCase();
    if (ticker && !symbols.includes(ticker)) {
      setCustomTickers((previous) => ({ ...previous, [region]: [...previous[region], ticker] }));
      setTickerInput("");
    }
  };
  const removeTicker = (symbol: string) => {
    if (customTickers[region].includes(symbol)) {
      setCustomTickers((previous) => ({ ...previous, [region]: previous[region].filter((ticker) => ticker !== symbol) }));
    } else {
      setRemovedTickers((previous) => ({ ...previous, [region]: [...previous[region], symbol] }));
    }
  };

  const { data: quotes = [], isLoading, dataUpdatedAt } = useQuery<Quote[]>({
    queryKey: ["/api/finance/quotes", region, symbols.join(",")],
    queryFn: async () => {
      const response = await fetch(`/api/finance/quotes?symbols=${symbols.join(",")}`);
      if (!response.ok) throw new Error("Failed to fetch heatmap quotes");
      return response.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const validQuotes = useMemo(() => quotes.filter((quote) => Number.isFinite(quote.price) && quote.price > 0), [quotes]);
  const analytics = useMemo(() => computeHeatmapAnalytics(validQuotes), [validQuotes]);
  const zScoreMap = useMemo(() => new Map(analytics.moveZScore.map((row) => [row.symbol, row.value])), [analytics.moveZScore]);

  const cells = useMemo(() => {
    return [...validQuotes].sort((a, b) => {
      if (sortBy === "marketcap") return (b.marketCap ?? 0) - (a.marketCap ?? 0);
      if (sortBy === "change") return Math.abs(b.changePercent) - Math.abs(a.changePercent);
      if (sortBy === "sector") return (a.sector ?? "ZZZ").localeCompare(b.sector ?? "ZZZ") || (b.marketCap ?? 0) - (a.marketCap ?? 0);
      if (sortBy === "volume") return b.volume - a.volume;
      if (sortBy === "rvol") return (relativeVolumeForQuote(b) ?? -Infinity) - (relativeVolumeForQuote(a) ?? -Infinity);
      if (sortBy === "contribution") return Math.abs(contributionForQuote(b, analytics.totalMarketCap) ?? 0) - Math.abs(contributionForQuote(a, analytics.totalMarketCap) ?? 0);
      return Math.abs(zScoreMap.get(b.symbol) ?? 0) - Math.abs(zScoreMap.get(a.symbol) ?? 0);
    });
  }, [analytics.totalMarketCap, sortBy, validQuotes, zScoreMap]);

  const quoteMap = useMemo(() => new Map(validQuotes.map((quote) => [quote.symbol, quote])), [validQuotes]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0" data-workstation-toolbar>
        <LayoutGrid className="w-4 h-4 text-[hsl(265,70%,65%)]" />
        <span className="panel-label text-[hsl(265,70%,65%)]">MARKET HEAT MAP</span>
        <ProvenanceBadge compact details={{ kind: "computed", source: "Visible quote universe", method: "Cross-sectional market evidence", inputs: ["change %", "market cap", "volume", "average volume", "sector"], timestamp: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined, logic: "Breadth and averages use visible names. IMPACT is market-cap weight × observed change %. RVOL is volume ÷ average volume. Z-score is cross-sectional change z-score.", limitations: "Metrics describe only the visible regional basket; they are not full-market breadth." }} />

        <div className="flex items-center gap-px ml-2">
          {(["US","IN","JP","HK"] as const).map((item) => (
            <button key={item} onClick={() => setRegion(item)} className={`px-3 py-1 font-terminal text-[8px] tracking-widest border transition-colors rounded-sm ${region === item ? "bg-white/5" : "border-transparent text-muted-foreground hover:text-foreground"}`} style={region === item ? { borderColor: REGION_COLORS[item], color: REGION_COLORS[item] } : {}}>{item}</button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-3">
          <input value={tickerInput} onChange={(event) => setTickerInput(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && addTicker()} placeholder="ADD TICKER…" className="w-24 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(265,70%,50%)/50%]" />
          <button onClick={addTicker} className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1"><Plus className="w-2.5 h-2.5" /> ADD</button>
        </div>

        <div className="flex items-center gap-px ml-auto overflow-x-auto scrollbar-none">
          <span className="font-terminal text-[8px] text-muted-foreground mr-1">SORT</span>
          {SORT_LABELS.map(([value, label]) => <button key={value} onClick={() => setSortBy(value)} className={`px-2 py-1 font-terminal text-[8px] border whitespace-nowrap transition-colors ${sortBy === value ? "border-white/20 text-foreground bg-white/5" : "border-transparent text-muted-foreground"}`}>{label}</button>)}
        </div>
      </div>

      <div className="flex items-center gap-4 px-4 py-2 bg-[#060606] border-b border-border/50 shrink-0">
        <div className="flex items-center gap-1.5"><span className="font-terminal text-[8px] text-muted-foreground">ADVANCING</span><span className="font-terminal text-[10px] font-bold text-up">{analytics.advances}</span></div>
        <div className="flex items-center gap-1.5"><span className="font-terminal text-[8px] text-muted-foreground">DECLINING</span><span className="font-terminal text-[10px] font-bold text-down">{analytics.declines}</span></div>
        <div className="flex items-center gap-1.5"><span className="font-terminal text-[8px] text-muted-foreground">FLAT</span><span className="font-terminal text-[10px] font-bold text-muted-foreground">{analytics.flat}</span></div>
        <div className="flex items-center gap-1.5 ml-auto"><span className="font-terminal text-[8px] text-muted-foreground">AVG MOVE</span><span className={`font-terminal text-[10px] font-bold tabular-nums ${analytics.averageMove >= 0 ? "text-up" : "text-down"}`}>{analytics.averageMove >= 0 ? "+" : ""}{analytics.averageMove.toFixed(2)}%</span></div>
        <div className="flex items-center gap-1 ml-4">{[-5,-3,-1,0,1,3,5].map((value) => <div key={value} className="w-5 h-3 rounded-sm" style={{ background: pctToColor(value, upHue, downHue) }} title={`${value}%`} />)}<span className="font-terminal text-[8px] text-muted-foreground ml-1">-5% → +5%</span></div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-3">
        {isLoading ? (
          <div className="grid grid-cols-6 gap-1">{Array(30).fill(0).map((_, index) => <Skeleton key={index} className="h-16 bg-border rounded-sm" />)}</div>
        ) : (
          <>
            <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))" }} data-analytical-role="evidence">
              {cells.map((cell) => {
                const bg = pctToColor(cell.changePercent, upHue, downHue);
                const fg = textColorForBg(cell.changePercent);
                const rvol = relativeVolumeForQuote(cell);
                return (
                  <div key={cell.symbol} role="button" tabIndex={0} onClick={() => onSymbol?.(cell.symbol)} onKeyDown={(event) => event.key === "Enter" && onSymbol?.(cell.symbol)} className="group flex flex-col justify-between p-2 rounded-sm border border-white/5 hover:border-white/20 transition-all hover:brightness-110 relative min-h-[72px] cursor-pointer" style={{ background: bg }} title={`${cell.name}: ${cell.changePercent >= 0 ? "+" : ""}${cell.changePercent.toFixed(2)}%`}>
                    <button onClick={(event) => { event.stopPropagation(); removeTicker(cell.symbol); }} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm hover:bg-black/30 p-0.5" style={{ color: fg }} aria-label={`Remove ${cell.symbol}`}><X className="w-2.5 h-2.5" /></button>
                    <div className="font-terminal text-[9px] font-bold truncate" style={{ color: fg }}>{cell.symbol.replace(/\.(NS|BO|T|HK)$/, "")}</div>
                    <div><div className="font-terminal text-[11px] font-bold tabular-nums" style={{ color: fg }}>{cell.changePercent >= 0 ? "▲" : "▼"} {Math.abs(cell.changePercent).toFixed(2)}%</div><div className="flex gap-1 font-terminal text-[7px] opacity-75" style={{ color: fg }}><span>{formatCap(cell.marketCap)}</span>{rvol !== null && <span>· {rvol.toFixed(1)}xV</span>}</div></div>
                  </div>
                );
              })}
            </div>

            <section className="grid grid-cols-1 gap-2 xl:grid-cols-4" aria-label="Heatmap secondary evidence">
              <div className="border border-border bg-[#080808] p-3">
                <div className="font-terminal text-[9px] font-bold tracking-widest text-foreground">BREADTH · VISIBLE UNIVERSE</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div><div className="font-terminal text-lg font-bold text-up">{analytics.advances}</div><div className="font-terminal text-[8px] text-muted-foreground">ADV</div></div><div><div className="font-terminal text-lg font-bold text-down">{analytics.declines}</div><div className="font-terminal text-[8px] text-muted-foreground">DEC</div></div><div><div className="font-terminal text-lg font-bold text-muted-foreground">{analytics.flat}</div><div className="font-terminal text-[8px] text-muted-foreground">FLAT</div></div></div>
                <div className="mt-3 font-terminal text-[8.5px] leading-relaxed text-muted-foreground">{validQuotes.length} valid quote records · equal-weight average move {analytics.averageMove >= 0 ? "+" : ""}{analytics.averageMove.toFixed(2)}%</div>
              </div>

              <div className="border border-border bg-[#080808] p-3">
                <div className="font-terminal text-[9px] font-bold tracking-widest text-foreground">SECTOR ATTRIBUTION</div>
                <div className="mt-2 space-y-1.5">{analytics.sectors.slice(0, 5).map((sector) => <div key={sector.sector} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-terminal text-[8.5px] text-muted-foreground">{sector.sector}</span><span className="font-terminal text-[8px] text-muted-foreground">{sector.advances}/{sector.declines}</span><span className={`w-14 text-right font-terminal text-[8.5px] tabular-nums ${(sector.weightedMove ?? 0) >= 0 ? "text-up" : "text-down"}`}>{sector.weightedMove === null ? "—" : `${sector.weightedMove >= 0 ? "+" : ""}${sector.weightedMove.toFixed(2)}%`}</span></div>)}</div>
                <div className="mt-2 font-terminal text-[7.5px] text-muted-foreground">Market-cap weighted within each visible sector.</div>
              </div>

              <div className="border border-border bg-[#080808] p-3">
                <div className="font-terminal text-[9px] font-bold tracking-widest text-foreground">UNUSUAL ACTIVITY · RVOL</div>
                <div className="mt-2 space-y-1.5">{analytics.relativeVolume.slice(0, 5).map((row) => <button key={row.symbol} onClick={() => onSymbol?.(row.symbol)} className="flex w-full items-center gap-2 text-left hover:bg-white/[0.03]"><span className="flex-1 font-terminal text-[8.5px] text-foreground">{row.symbol}</span><span className={`font-terminal text-[9px] font-bold tabular-nums ${row.value >= 1.5 ? "text-amber-300" : "text-muted-foreground"}`}>{row.value.toFixed(2)}x</span></button>)}</div>
                {!analytics.relativeVolume.length && <div className="mt-3 font-terminal text-[8.5px] text-muted-foreground">Average-volume fields unavailable for this basket.</div>}
              </div>

              <div className="border border-border bg-[#080808] p-3">
                <div className="font-terminal text-[9px] font-bold tracking-widest text-foreground">MARKET IMPACT · MKT-CAP WEIGHTED</div>
                <div className="mt-2 space-y-1.5">{analytics.contribution.slice(0, 5).map((row) => <button key={row.symbol} onClick={() => onSymbol?.(row.symbol)} className="flex w-full items-center gap-2 text-left hover:bg-white/[0.03]"><span className="flex-1 font-terminal text-[8.5px] text-foreground">{row.symbol}</span><span className="font-terminal text-[8px] text-muted-foreground">{quoteMap.get(row.symbol)?.changePercent.toFixed(2)}%</span><span className={`w-16 text-right font-terminal text-[9px] font-bold tabular-nums ${row.value >= 0 ? "text-up" : "text-down"}`}>{row.value >= 0 ? "+" : ""}{row.value.toFixed(3)}pp</span></button>)}</div>
                <div className="mt-2 font-terminal text-[7.5px] text-muted-foreground">Contribution = visible-universe market-cap weight × observed move.</div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
