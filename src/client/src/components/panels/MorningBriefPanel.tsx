import { useMemo, useState } from "react";
import { useQuotes, useNews, useMarketSentiment, useMarketGainers, useMarketLosers, useEconomics, usePremarketBrief } from "@/lib/useFinance";
import { Brain, RefreshCw } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";

interface Props {
  magnetization?: number;
  onSymbol: (s: string) => void;
  onNav: (v: ViewMode) => void;
}

const MARKET_INDICES = ["^GSPC","^IXIC","^DJI","^NSEI","GC=F","CL=F","BTC-USD","^TNX"];

function formatMaybe(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

export default function MorningBriefPanel({ magnetization = 0, onSymbol, onNav }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: quotes = [], dataUpdatedAt: quoteUpdatedAt } = useQuotes(MARKET_INDICES);
  const { data: news = [] } = useNews();
  const { data: sentiment } = useMarketSentiment();
  const { data: gainers = [] } = useMarketGainers("US");
  const { data: losers = [] } = useMarketLosers("US");
  const { data: econ } = useEconomics();
  const { data: generatedBrief, refetch: refetchGeneratedBrief } = usePremarketBrief(refreshKey);

  const now = new Date();
  const greeting = now.getHours() < 12 ? "GOOD MORNING" : now.getHours() < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const qMap = useMemo(() => new Map(quotes.map((quote) => [quote.symbol, quote])), [quotes]);
  const sp500 = qMap.get("^GSPC");
  const nasdaq = qMap.get("^IXIC");
  const nifty = qMap.get("^NSEI");
  const gold = qMap.get("GC=F");
  const crude = qMap.get("CL=F");
  const btc = qMap.get("BTC-USD");
  const tnx = qMap.get("^TNX");

  const regime = useMemo(() => {
    const score = typeof sentiment?.score === "number" && Number.isFinite(sentiment.score) ? sentiment.score : null;
    const spMove = typeof sp500?.changePercent === "number" && Number.isFinite(sp500.changePercent) ? sp500.changePercent : null;
    if (magnetization > 0.35) return { label: "SOCIAL HERD BULLISH / RISK-ON", color: "hsl(142,71%,45%)", desc: `Observed model magnetization +${magnetization.toFixed(2)} exceeds +0.35.` };
    if (magnetization < -0.35) return { label: "PANIC HERD BEARISH / RISK-OFF", color: "hsl(0,80%,55%)", desc: `Observed model magnetization ${magnetization.toFixed(2)} is below -0.35.` };
    if (score !== null && spMove !== null) {
      if (score > 60 && spMove > 0.5) return { label: "RISK-ON / BULLISH", color: "hsl(142,71%,45%)", desc: `Sentiment ${score.toFixed(0)} and S&P 500 move ${spMove >= 0 ? "+" : ""}${spMove.toFixed(2)}% both pass the risk-on rule.` };
      if (score < 35 || spMove < -1) return { label: "RISK-OFF / BEARISH", color: "hsl(0,80%,55%)", desc: `At least one observed risk-off rule is active: sentiment <35 or S&P 500 move <-1%.` };
      if (Math.abs(spMove) < 0.3) return { label: "NEUTRAL / RANGE-BOUND", color: "hsl(38,95%,55%)", desc: `Observed S&P 500 move is inside ±0.30%.` };
      return { label: "MIXED SIGNALS", color: "hsl(270,60%,60%)", desc: "Observed sentiment and index move do not align with a stronger deterministic regime rule." };
    }
    return { label: "INSUFFICIENT INPUTS", color: "hsl(38,20%,55%)", desc: "Regime is withheld until required observed sentiment and S&P 500 inputs are available." };
  }, [sentiment?.score, sp500?.changePercent, magnetization]);

  const bullishNews = news.filter((item) => item.sentiment === "positive").length;
  const bearishNews = news.filter((item) => item.sentiment === "negative").length;

  const sourceSections = [
    {
      title: "OVERNIGHT MARKET WRAP",
      content: [
        sp500 && `S&P 500: ${sp500.changePercent >= 0 ? "UP" : "DOWN"} ${Math.abs(sp500.changePercent).toFixed(2)}%`,
        nasdaq && `NASDAQ: ${nasdaq.changePercent >= 0 ? "UP" : "DOWN"} ${Math.abs(nasdaq.changePercent).toFixed(2)}%`,
        nifty && `Nifty 50: ${nifty.changePercent >= 0 ? "UP" : "DOWN"} ${Math.abs(nifty.changePercent).toFixed(2)}%`,
        gold && `Gold: ${formatMaybe(gold.price, 0)} ${gold.changePercent >= 0 ? "UP" : "DOWN"} ${Math.abs(gold.changePercent).toFixed(2)}%`,
        crude && `Crude: ${formatMaybe(crude.price, 2)} ${crude.changePercent >= 0 ? "UP" : "DOWN"} ${Math.abs(crude.changePercent).toFixed(2)}%`,
        btc && `Bitcoin: ${formatMaybe(btc.price, 0)} ${btc.changePercent >= 0 ? "UP" : "DOWN"} ${Math.abs(btc.changePercent).toFixed(2)}%`,
        tnx && `10Y Treasury: ${formatMaybe(tnx.price, 2)}% yield`,
      ].filter(Boolean) as string[],
    },
    {
      title: "TOP MOVERS TODAY",
      content: ["BIGGEST GAINERS:", ...gainers.slice(0, 3).map((item) => `  ${item.symbol}: +${item.changePercent.toFixed(2)}% — ${item.price.toFixed(2)}`), "BIGGEST LOSERS:", ...losers.slice(0, 3).map((item) => `  ${item.symbol}: ${item.changePercent.toFixed(2)}% — ${item.price.toFixed(2)}`)],
    },
    { title: "KEY HEADLINES", content: news.slice(0, 5).map((item) => `- ${item.title}`) },
    {
      title: "MACRO CONTEXT",
      content: [`GDP Growth: ${formatMaybe(econ?.gdp?.value, 1)}%`, `CPI Inflation: ${formatMaybe(econ?.cpi?.value, 1)}%`, `Unemployment: ${formatMaybe(econ?.unemployment?.value, 1)}%`, `10Y Yield: ${formatMaybe(tnx?.price, 2)}%`],
    },
  ];

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0" data-workstation-toolbar>
        <Brain className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">LiOS INTELLIGENCE MORNING BRIEF</span>
        <button onClick={() => { setRefreshKey((key) => key + 1); void refetchGeneratedBrief(); }} className="ml-auto flex items-center gap-1.5 px-2.5 py-1 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground"><RefreshCw className="w-2.5 h-2.5" /> REFRESH</button>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">BRIEF</span>
      </div>

      <div className="shrink-0 px-6 py-4 border-b border-border bg-[#060606]" style={{ borderLeft: `3px solid ${regime.color}` }}>
        <div className="font-terminal text-[8px] text-muted-foreground tracking-widest">{greeting}</div>
        <div className="font-terminal text-[11px] text-foreground mt-0.5">{dateStr}</div>
        <div className="flex flex-wrap items-center gap-2 mt-1.5"><span className="font-terminal text-[9px] font-bold tracking-widest" style={{ color: regime.color }}>{regime.label}</span><ProvenanceBadge compact details={{ kind: "computed", method: "Market Regime Classifier", inputs: [sentiment?.score === undefined ? "sentiment unavailable" : `sentiment=${sentiment.score}`, sp500 ? `S&P move=${sp500.changePercent.toFixed(2)}%` : "S&P move unavailable", `magnetization=${magnetization.toFixed(2)}`], timestamp: quoteUpdatedAt ? new Date(quoteUpdatedAt).toISOString() : undefined, logic: regime.desc, limitations: "Classifier withholds a standard market regime when required observed inputs are unavailable." }} /></div>
        <div className="mt-1 font-terminal text-[8px] text-muted-foreground">{regime.desc}</div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {generatedBrief && (
          <section className="p-5 border-b border-border bg-[#080808]">
            <div className="flex flex-wrap items-center gap-2 mb-2"><div className="font-terminal text-[9px] text-[hsl(38,95%,55%)] tracking-widest font-bold">GENERATED PRE-MARKET BRIEF</div><ProvenanceBadge compact details={{ kind: "model", source: "Premarket brief API", method: "Server-generated briefing", timestamp: generatedBrief.generatedAt, inputs: ["movers/headlines", "forex", generatedBrief.macroStatus ? "economics snapshot" : "macro unavailable"], limitations: "The current API contract does not attest which AI/provider/model, if any, produced the summary. LiOS therefore does not label this output AI-assisted until provenance is explicit." }} /><div className="ml-auto font-terminal text-[8px] text-muted-foreground">{new Date(generatedBrief.generatedAt).toLocaleString()}</div></div>
            <div className="font-terminal text-[10px] text-foreground mb-3 leading-relaxed">{generatedBrief.summary}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3"><div><div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">MOVERS / HEADLINES</div>{generatedBrief.movers.slice(0, 3).map((item, index) => <a key={`${item.url}:${index}`} href={item.url} target="_blank" rel="noreferrer" className="block font-terminal text-[8.5px] text-muted-foreground hover:text-foreground truncate">{item.title}</a>)}</div><div><div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">FOREX</div>{generatedBrief.forexRate.slice(0, 4).map((fx) => <div key={fx.symbol} className="font-terminal text-[8.5px] text-muted-foreground">{fx.symbol}: {formatMaybe(fx.price, 4)} ({fx.changePercent !== null ? `${fx.changePercent >= 0 ? "+" : ""}${fx.changePercent.toFixed(2)}%` : "N/A"})</div>)}</div><div><div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">MACRO ATTACHMENT</div><div className="font-terminal text-[8.5px] text-muted-foreground">{generatedBrief.macroStatus ? "Economics snapshot attached" : "Economics snapshot unavailable"}</div></div></div>
          </section>
        )}

        <section className="grid grid-cols-1 gap-0 md:grid-cols-2">
          <div className="p-5 border-b border-r border-border/50">
            <div className="flex items-center gap-2 mb-3"><span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] tracking-widest font-bold">CURRENT MARKET REGIME</span><ProvenanceBadge compact details={{ kind: "computed", method: "Market Regime Classifier", logic: regime.desc }} /></div>
            <div className="space-y-1.5 font-terminal text-[9px] leading-relaxed text-muted-foreground"><div>Regime: <span style={{ color: regime.color }}>{regime.label}</span></div><div>{regime.desc}</div>{sentiment && <div>Market sentiment: {sentiment.score}/100 ({sentiment.sentiment})</div>}<div>Scored news bias: {bullishNews} bullish / {bearishNews} bearish</div></div>
          </div>
          <div className="p-5 border-b border-border/50">
            <div className="flex items-center gap-2 mb-3"><span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] tracking-widest font-bold">OBSERVED RISK FRAME</span><ProvenanceBadge compact details={{ kind: "computed", method: "Observed-input risk frame", inputs: [sp500 ? "S&P move" : "S&P unavailable", tnx ? "10Y yield" : "10Y unavailable", `${bullishNews}/${bearishNews} news labels`], limitations: "No VIX level, forecast, support/resistance target or allocation recommendation is inferred from unavailable data." }} /></div>
            <div className="space-y-1.5 font-terminal text-[9px] leading-relaxed text-muted-foreground"><div>S&P move: {sp500 ? `${sp500.changePercent >= 0 ? "+" : ""}${sp500.changePercent.toFixed(2)}%` : "N/A"}</div><div>10Y yield: {tnx ? `${tnx.price.toFixed(2)}%` : "N/A"}</div><div>News balance: {bullishNews - bearishNews >= 0 ? "+" : ""}{bullishNews - bearishNews}</div><div className="text-amber-300/80">No unavailable volatility index or predicted price level is manufactured.</div></div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
          {sourceSections.map((section, index) => <section key={section.title} className={`p-5 border-b border-r border-border/50 ${index % 2 === 1 ? "md:border-r-0" : ""}`}><div className="flex items-center gap-2 mb-3"><span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] tracking-widest font-bold">{section.title}</span><ProvenanceBadge compact details={{ kind: "source", source: "LiOS finance/economics feeds", timestamp: quoteUpdatedAt ? new Date(quoteUpdatedAt).toISOString() : undefined }} /></div><div className="space-y-1.5">{section.content.map((line, lineIndex) => <button key={`${section.title}-${lineIndex}`} type="button" onClick={() => { const match = /^\s*([A-Z^][A-Z0-9.\-^=]*)\s*:/.exec(line); if (match && qMap.has(match[1])) onSymbol(match[1]); }} className={`block w-full text-left font-terminal text-[9px] leading-relaxed ${line.startsWith("BIGGEST") ? "text-muted-foreground text-[8px] tracking-widest mt-1.5" : line.startsWith("  ") ? "text-foreground pl-3" : "text-muted-foreground"}`}>{line}</button>)}</div></section>)}
        </div>

        <div className="p-5 border-t border-border bg-[#060606]"><div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">QUICK NAVIGATE</div><div className="flex flex-wrap gap-2">{([["STRS","macrostress"],["SENT","sentiment"],["ECAL","ecalendar"],["YCRV","yieldcurve"],["HEAT","heatmap"],["SCRN","scanner"],["PORT","portfolio"],["COMP","peercomp"],["REGIME","regime"]] as [string,ViewMode][]).map(([label, view]) => <button key={label} onClick={() => onNav(view)} className="px-3 py-1 border border-border font-terminal text-[8px] text-muted-foreground hover:text-[hsl(38,95%,55%)] hover:border-[hsl(38,95%,30%)] transition-all">{label}</button>)}</div></div>
      </div>
    </div>
  );
}
