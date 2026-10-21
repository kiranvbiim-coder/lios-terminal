import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useMemo, useState } from "react";
import { useMarketSentiment, useNews, useQuotes, useMarketGainers, useMarketLosers } from "@/lib/useFinance";
import { Activity, TrendingUp, TrendingDown, Minus, Plus, X } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import type { NewsItem } from "@/lib/finance";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";
import { appendSentimentObservation, summarizeSentimentHistory, type SentimentObservation } from "@/lib/sentimentHistory";

interface Props {
  onSymbol: (sym: string) => void;
  onNav: (view: ViewMode) => void;
}

const DEFAULT_SENTIMENT_ASSETS = [
  "AAPL","MSFT","NVDA","TSLA","GOOGL","AMZN","META","JPM","V","XOM",
  "RELIANCE.NS","TCS.NS","HDFCBANK.NS","BTC-USD","ETH-USD","SOL-USD","GC=F","CL=F","^NSEI","^GSPC",
];
const MIN_SENTIMENT_ASSETS = 4;
const MAX_SENTIMENT_ASSETS = 30;
const HISTORY_KEY = "lios.sentiment-history.v1";

function FearGreedGauge({ score }: { score: number }) {
  const clampedScore = Math.min(100, Math.max(0, score));
  const R = 70, cx = 100, cy = 90;
  const angle = Math.PI - (clampedScore / 100) * Math.PI;
  const needleX = cx + R * Math.cos(angle);
  const needleY = cy - R * Math.sin(angle);
  const label = clampedScore <= 20 ? "EXTREME FEAR" : clampedScore <= 40 ? "FEAR" : clampedScore <= 60 ? "NEUTRAL" : clampedScore <= 80 ? "GREED" : "EXTREME GREED";
  const needleColor = clampedScore <= 20 ? "hsl(0,80%,55%)" : clampedScore <= 40 ? "hsl(20,90%,55%)" : clampedScore <= 60 ? "hsl(38,95%,55%)" : clampedScore <= 80 ? "hsl(90,70%,50%)" : "hsl(142,71%,45%)";

  return (
    <div className="flex flex-col items-center">
      <svg width="200" height="110" viewBox="0 0 200 110" aria-label={`Sentiment score ${Math.round(clampedScore)} ${label}`}>
        {[0,20,40,60,80].map((start, index) => {
          const end = [20,40,60,80,100][index];
          const colors = ["hsl(0,80%,35%)","hsl(20,90%,35%)","hsl(38,95%,30%)","hsl(90,70%,30%)","hsl(142,71%,30%)"];
          const a1 = Math.PI - (start / 100) * Math.PI;
          const a2 = Math.PI - (end / 100) * Math.PI;
          const inner = R - 18;
          const x1 = cx + R * Math.cos(a1), y1 = cy - R * Math.sin(a1);
          const x2 = cx + R * Math.cos(a2), y2 = cy - R * Math.sin(a2);
          const ix1 = cx + inner * Math.cos(a1), iy1 = cy - inner * Math.sin(a1);
          const ix2 = cx + inner * Math.cos(a2), iy2 = cy - inner * Math.sin(a2);
          return <path key={start} d={`M ${ix1} ${iy1} A ${inner} ${inner} 0 0 1 ${ix2} ${iy2} L ${x2} ${y2} A ${R} ${R} 0 0 0 ${x1} ${y1} Z`} fill={colors[index]} opacity="0.8" />;
        })}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={needleColor} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill={needleColor} />
        <text x={cx} y={cy - 8} textAnchor="middle" fill="white" fontSize="22" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">{Math.round(clampedScore)}</text>
        <text x={cx} y={cy + 22} textAnchor="middle" fill={needleColor} fontSize="8" fontFamily="'JetBrains Mono', monospace" letterSpacing="2">{label}</text>
      </svg>
    </div>
  );
}

function ScoreBar({ label, value, description }: { label: string; value: number; description: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  const barColor = clamped >= 60 ? "bg-[hsl(142,71%,45%)]" : clamped <= 40 ? "bg-[hsl(0,80%,55%)]" : "bg-[hsl(38,95%,55%)]";
  const labelColor = clamped >= 60 ? "text-[hsl(142,71%,45%)]" : clamped <= 40 ? "text-[hsl(0,80%,55%)]" : "text-[hsl(38,95%,55%)]";
  return (
    <div className="bg-[#080808] border border-border p-3">
      <div className="flex items-center justify-between mb-2"><span className="font-terminal text-[9px] text-muted-foreground tracking-widest">{label}</span><span className={`font-terminal text-[11px] font-bold ${labelColor}`}>{Math.round(clamped)}</span></div>
      <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden mb-1.5"><div className={`h-full ${barColor} rounded-full`} style={{ width: `${clamped}%` }} /></div>
      <div className="font-terminal text-[8.5px] text-muted-foreground">{description}</div>
    </div>
  );
}

function HistorySparkline({ history }: { history: SentimentObservation[] }) {
  const points = history.slice(-80);
  if (points.length < 2) return <div className="font-terminal text-[8px] text-muted-foreground">HISTORY BUILDING · observations are stored locally as they are actually seen.</div>;
  const min = Math.min(...points.map((point) => point.score));
  const max = Math.max(...points.map((point) => point.score));
  const span = Math.max(1, max - min);
  const coordinates = points.map((point, index) => `${(index / Math.max(1, points.length - 1)) * 100},${36 - ((point.score - min) / span) * 32}`).join(" ");
  return <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-12 w-full" aria-label="Observed sentiment history"><polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" className="text-amber-300" /></svg>;
}

function loadHistory(): SentimentObservation[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function SentimentPanel({ onSymbol, onNav }: Props) {
  const [assets, setAssets] = useTerminalArtifactState<string[]>("SentimentPanel.assets", DEFAULT_SENTIMENT_ASSETS);
  const [assetInput, setAssetInput] = useTerminalArtifactState("SentimentPanel.assetInput", "");
  const [history, setHistory] = useState<SentimentObservation[]>(loadHistory);
  const { data: sentiment } = useMarketSentiment();
  const { data: news = [] } = useNews(undefined, "market");
  const { data: gainers = [] } = useMarketGainers("US");
  const { data: losers = [] } = useMarketLosers("US");
  const { data: assetQuotes = [], dataUpdatedAt } = useQuotes(assets);

  const addAsset = () => {
    const ticker = assetInput.trim().toUpperCase();
    if (ticker && !assets.includes(ticker) && assets.length < MAX_SENTIMENT_ASSETS) {
      setAssets((previous) => [...previous, ticker]);
      setAssetInput("");
    }
  };
  const removeAsset = (symbol: string) => {
    if (assets.length > MIN_SENTIMENT_ASSETS) setAssets((previous) => previous.filter((ticker) => ticker !== symbol));
  };

  const quoteMap = useMemo(() => new Map(assetQuotes.map((quote) => [quote.symbol, quote])), [assetQuotes]);
  const newsStats = useMemo(() => {
    const positive = news.filter((item) => item.sentiment === "positive").length;
    const negative = news.filter((item) => item.sentiment === "negative").length;
    return { positive, negative, scored: positive + negative };
  }, [news]);
  const newsScore = newsStats.scored ? (newsStats.positive / newsStats.scored) * 100 : null;
  const breadthCount = gainers.length + losers.length;
  const breadthScore = breadthCount ? (gainers.length / breadthCount) * 100 : null;
  const marketScore = typeof sentiment?.score === "number" && Number.isFinite(sentiment.score) ? sentiment.score : null;

  const components = useMemo(() => [
    marketScore === null ? null : { key: "market", label: "MARKET SENTIMENT", weight: 0.5, value: marketScore },
    newsScore === null ? null : { key: "news", label: "NEWS SENTIMENT", weight: 0.3, value: newsScore },
    breadthScore === null ? null : { key: "breadth", label: "MARKET BREADTH", weight: 0.2, value: breadthScore },
  ].filter((item): item is { key: string; label: string; weight: number; value: number } => item !== null), [breadthScore, marketScore, newsScore]);

  const fearGreedScore = useMemo(() => {
    const availableWeight = components.reduce((sum, component) => sum + component.weight, 0);
    if (!availableWeight) return null;
    return components.reduce((sum, component) => sum + component.value * component.weight, 0) / availableWeight;
  }, [components]);

  useEffect(() => {
    if (fearGreedScore === null) return;
    const observedAt = dataUpdatedAt || Date.now();
    setHistory((previous) => {
      const next = appendSentimentObservation(previous, { at: observedAt, score: fearGreedScore });
      const previousLast = previous[previous.length - 1];
      const nextLast = next[next.length - 1];
      const changed = next.length !== previous.length || nextLast?.at !== previousLast?.at || nextLast?.score !== previousLast?.score;
      if (!changed) return previous;
      try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* local persistence is best-effort */ }
      return next;
    });
  }, [fearGreedScore, dataUpdatedAt]);

  const historySummary = fearGreedScore === null ? null : summarizeSentimentHistory(history, { at: Date.now(), score: fearGreedScore });
  const assetTiles = assets.map((symbol) => {
    const quote = quoteMap.get(symbol);
    return { symbol, changePercent: quote?.changePercent ?? null, name: quote?.name ?? symbol };
  });
  const gold = quoteMap.get("GC=F");
  const oil = quoteMap.get("CL=F");

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-[#050505]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] sticky top-0 z-10" data-workstation-toolbar>
        <Activity className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">MARKET SENTIMENT & FEAR/GREED ENGINE</span>
        <ProvenanceBadge compact details={{ kind: "computed", method: "Weighted observed-input composite", inputs: components.map((component) => `${component.label} ${Math.round(component.weight * 100)}%`), timestamp: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined, logic: "Composite = available weighted inputs normalized by available weight. Market sentiment 50%, scored news sentiment 30%, gainers/losers breadth 20%.", limitations: ["History contains only observations recorded by this browser", "Missing components are not replaced with synthetic neutral values", "Gainers/losers lists are a proxy universe, not full-market breadth"] }} />
        <div className="flex items-center gap-1 ml-auto">
          <input value={assetInput} onChange={(event) => setAssetInput(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && addAsset()} disabled={assets.length >= MAX_SENTIMENT_ASSETS} placeholder="ADD TICKER…" className="w-24 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40" />
          <button onClick={addAsset} disabled={assets.length >= MAX_SENTIMENT_ASSETS} className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"><Plus className="w-2.5 h-2.5" /> ADD</button>
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">SENT</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="bg-[#080808] border border-border p-4">
          <div className="flex items-center justify-between mb-3"><span className="font-terminal text-[9px] tracking-widest text-muted-foreground">COMPOSITE FEAR/GREED INDEX</span><button onClick={() => onNav("macrostress")} className="font-terminal text-[8px] text-[hsl(38,95%,55%)] hover:underline">STRESS TEST →</button></div>
          {fearGreedScore === null ? <div className="py-12 text-center font-terminal text-[10px] text-muted-foreground">INSUFFICIENT OBSERVED INPUTS TO COMPUTE COMPOSITE</div> : (
            <div className="grid gap-5 xl:grid-cols-[220px_1fr_320px]">
              <FearGreedGauge score={fearGreedScore} />
              <div className="space-y-2">
                <div className="font-terminal text-[9px] text-muted-foreground tracking-widest">COMPOSITE BREAKDOWN</div>
                {components.map((component) => <div key={component.key} className="flex items-center gap-2"><span className="font-terminal text-[8.5px] text-muted-foreground w-44 shrink-0">{component.label} ({Math.round(component.weight * 100)}%)</span><div className="flex-1 h-1 bg-[#1a1a1a] rounded-full overflow-hidden"><div className={`h-full rounded-full ${component.value >= 60 ? "bg-[hsl(142,71%,45%)]" : component.value <= 40 ? "bg-[hsl(0,80%,55%)]" : "bg-[hsl(38,95%,55%)]"}`} style={{ width: `${component.value}%` }} /></div><span className="font-terminal text-[9px] tabular-nums w-8 text-right">{Math.round(component.value)}</span><span className="w-16 text-right font-terminal text-[8px] tabular-nums text-muted-foreground">{(component.value * component.weight).toFixed(1)} pts</span></div>)}
              </div>
              <div className="border-l border-border/70 pl-4">
                <div className="font-terminal text-[9px] tracking-widest text-muted-foreground">OBSERVED HISTORY</div>
                <div className="mt-2 grid grid-cols-5 gap-1">
                  {[
                    ["NOW", fearGreedScore], ["1D", historySummary?.dayAgo?.score ?? null], ["1W", historySummary?.weekAgo?.score ?? null], ["1M", historySummary?.monthAgo?.score ?? null], ["PCTL", historySummary?.percentile ?? null],
                  ].map(([label, value]) => <div key={String(label)} className="border border-border/70 bg-black/20 p-1.5 text-center"><div className="font-terminal text-[7px] text-muted-foreground">{label}</div><div className="mt-1 font-terminal text-[10px] font-bold tabular-nums text-foreground">{value === null ? "—" : Math.round(Number(value))}</div></div>)}
                </div>
                <div className="mt-2"><HistorySparkline history={history} /></div>
                <div className="font-terminal text-[8px] text-muted-foreground">7D Δ {historySummary?.sevenDayChange === null || historySummary?.sevenDayChange === undefined ? "—" : `${historySummary.sevenDayChange >= 0 ? "+" : ""}${historySummary.sevenDayChange.toFixed(1)} pts`}</div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2 px-0.5">OBSERVED SIGNAL INPUTS · NO SYNTHETIC VIX OR SAFE-HAVEN SCORES</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {breadthScore !== null && <ScoreBar label="MARKET BREADTH" value={breadthScore} description={`${gainers.length} GAINERS / ${losers.length} LOSERS`} />}
            {newsScore !== null && <ScoreBar label="NEWS SENTIMENT" value={newsScore} description={`${newsStats.positive} POS / ${newsStats.negative} NEG SCORED HEADLINES`} />}
            {marketScore !== null && <ScoreBar label="MARKET SENTIMENT FEED" value={marketScore} description={`${sentiment?.bullish ?? 0} BULLISH / ${sentiment?.bearish ?? 0} BEARISH`} />}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {gold && <div className="border border-border bg-[#080808] px-3 py-2 font-terminal text-[8.5px] text-muted-foreground">GOLD OBSERVED MOVE <span className={gold.changePercent >= 0 ? "text-up" : "text-down"}>{gold.changePercent >= 0 ? "+" : ""}{gold.changePercent.toFixed(2)}%</span></div>}
            {oil && <div className="border border-border bg-[#080808] px-3 py-2 font-terminal text-[8.5px] text-muted-foreground">CRUDE OBSERVED MOVE <span className={oil.changePercent >= 0 ? "text-up" : "text-down"}>{oil.changePercent >= 0 ? "+" : ""}{oil.changePercent.toFixed(2)}%</span></div>}
          </div>
        </div>

        <div>
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2 px-0.5">ASSET SENTIMENT HEATMAP — {assets.length} ASSETS</div>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-5">
            {assetTiles.map((asset) => {
              const isUp = asset.changePercent !== null && asset.changePercent > 0.1;
              const isDown = asset.changePercent !== null && asset.changePercent < -0.1;
              const bgClass = isUp ? "bg-[hsl(142,71%,10%)] border-[hsl(142,71%,25%)]" : isDown ? "bg-[hsl(0,80%,10%)] border-[hsl(0,80%,25%)]" : "bg-[#0a0a0a] border-border";
              const textClass = isUp ? "text-[hsl(142,71%,55%)]" : isDown ? "text-[hsl(0,80%,60%)]" : "text-muted-foreground";
              const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
              return <div key={asset.symbol} role="button" tabIndex={0} onClick={() => onSymbol(asset.symbol)} onKeyDown={(event) => event.key === "Enter" && onSymbol(asset.symbol)} className={`group relative p-2 border cursor-pointer hover:brightness-125 transition-all ${bgClass}`}>
                {assets.length > MIN_SENTIMENT_ASSETS && <button onClick={(event) => { event.stopPropagation(); removeAsset(asset.symbol); }} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,55%)]" aria-label={`Remove ${asset.symbol}`}><X className="w-2.5 h-2.5" /></button>}
                <div className="flex items-center justify-between mb-0.5"><span className="font-terminal text-[9px] font-bold text-[hsl(38,95%,55%)] truncate">{asset.symbol.split(".")[0].split("-")[0]}</span><Icon className={`w-2.5 h-2.5 ${textClass} group-hover:opacity-0`} /></div>
                <div className={`font-terminal text-[10px] font-bold tabular-nums ${textClass}`}>{asset.changePercent === null ? "—" : `${asset.changePercent >= 0 ? "+" : ""}${asset.changePercent.toFixed(2)}%`}</div>
              </div>;
            })}
          </div>
        </div>

        <div className="bg-[#080808] border border-border">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border"><span className="panel-label">LIVE SENTIMENT FEED</span><ProvenanceBadge compact details={{ kind: "source", source: "News feed + attached sentiment metadata", inputs: ["headline", "source", "sentiment label"], limitations: "Feed labels are displayed as received; neutral/unscored stories do not enter the positive/negative news ratio." }} /><span className="ml-auto font-terminal text-[8px] text-muted-foreground">{news.length} ARTICLES</span></div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin">
            {news.slice(0, 15).map((item: NewsItem) => {
              const sentColor = item.sentiment === "positive" ? "text-[hsl(142,71%,50%)]" : item.sentiment === "negative" ? "text-[hsl(0,80%,55%)]" : "text-[hsl(38,95%,50%)]";
              const sentLabel = item.sentiment === "positive" ? "BULL" : item.sentiment === "negative" ? "BEAR" : "NEUT";
              return <div key={`${item.url}-${item.publishedAt}`} className="flex items-start gap-2 px-3 py-2 border-b border-border/40 hover:bg-white/5 cursor-pointer" onClick={() => onNav("news")}><span className={`font-terminal text-[7px] font-bold shrink-0 mt-0.5 ${sentColor}`}>{sentLabel}</span><span className="font-terminal text-[9px] text-foreground leading-relaxed line-clamp-1">{item.title}</span><span className="font-terminal text-[8px] text-muted-foreground shrink-0">{item.source}</span></div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
