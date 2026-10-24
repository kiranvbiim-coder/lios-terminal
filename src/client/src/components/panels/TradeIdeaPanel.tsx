import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { useQuotes, useNews, useMarketSentiment, useMarketGainers, useMarketLosers } from "@/lib/useFinance";
import type { Quote, NewsItem } from "@/lib/finance";
import { Lightbulb, Plus, X } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";

interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }

const DEFAULT_WATCHLIST = ["AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","JPM","BRK-B","GS","RELIANCE.NS","INFY.NS"];
const MIN_WATCHLIST = 3;
const MAX_WATCHLIST = 20;

type Setup = "LONG" | "SHORT" | "AVOID";

interface EvidenceRow {
  label: string;
  value: string;
  supports: boolean;
}

interface TradeIdea {
  setup: Setup;
  type: string;
  rationale: string[];
  price: number;
  target: number;
  stop: number;
  rr: number;
  evidence: EvidenceRow[];
  evidenceScore: number;
  evaluatedAt: string;
  method: string;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function findRelevantNews(q: Quote, news: NewsItem[]) {
  const companyToken = q.name?.trim().split(/\s+/)[0]?.toLowerCase();
  const symbol = q.symbol.toLowerCase();
  return news.filter((item) => {
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    return haystack.includes(symbol) || Boolean(companyToken && companyToken.length > 2 && haystack.includes(companyToken));
  });
}

function generateIdea(q: Quote, news: NewsItem[], sentiment: { score: number } | undefined): TradeIdea | null {
  if (!finite(q.price) || q.price <= 0 || !finite(q.changePercent)) return null;

  const price = q.price;
  const chg = q.changePercent;
  const pe = finite(q.pe) ? q.pe : null;
  const hi52 = finite(q.high52) && q.high52 > 0 ? q.high52 : null;
  const lo52 = finite(q.low52) && q.low52 > 0 ? q.low52 : null;
  const pctFrom52Hi = hi52 ? ((price / hi52) - 1) * 100 : null;
  const pctFrom52Lo = lo52 ? ((price / lo52) - 1) * 100 : null;
  const rvol = finite(q.volume) && finite(q.avgVolume) && q.avgVolume > 0 ? q.volume / q.avgVolume : null;
  const intradayRangePct = finite(q.dayHigh) && finite(q.dayLow) && q.dayHigh >= q.dayLow
    ? ((q.dayHigh - q.dayLow) / price) * 100
    : null;
  const relevantNews = findRelevantNews(q, news);
  const newsSent = relevantNews.filter((item) => item.sentiment === "positive").length - relevantNews.filter((item) => item.sentiment === "negative").length;
  const marketSentiment = finite(sentiment?.score) ? sentiment!.score : null;

  let setup: Setup = "AVOID";
  let type = "NO CLEAR SETUP";
  let rationale: string[] = [];
  let evidence: EvidenceRow[] = [];
  let method = "NO_MATCH";

  if (chg > 1.5 && pctFrom52Hi !== null && pctFrom52Hi >= -5 && pctFrom52Hi <= 5 && marketSentiment !== null && marketSentiment > 50) {
    setup = "LONG";
    type = "BREAKOUT MOMENTUM";
    method = "MOMENTUM_NEAR_52W_HIGH";
    evidence = [
      { label: "DAILY MOVE", value: `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`, supports: true },
      { label: "DIST 52W HIGH", value: `${pctFrom52Hi.toFixed(2)}%`, supports: true },
      { label: "MARKET SENT", value: marketSentiment.toFixed(0), supports: true },
      ...(rvol !== null ? [{ label: "REL VOLUME", value: `${rvol.toFixed(2)}x`, supports: rvol >= 1 }] : []),
    ];
    rationale = ["Positive daily momentum", "Price is within 5% of the observed 52-week high", "Market sentiment input is above neutral"];
  } else if (chg < -2 && pctFrom52Lo !== null && pctFrom52Lo < 15 && pe !== null && pe > 0 && pe < 30) {
    setup = "LONG";
    type = "VALUE DIP WATCH";
    method = "DIP_NEAR_52W_LOW_VALUE_FILTER";
    evidence = [
      { label: "DAILY MOVE", value: `${chg.toFixed(2)}%`, supports: true },
      { label: "DIST 52W LOW", value: `+${pctFrom52Lo.toFixed(2)}%`, supports: true },
      { label: "P/E", value: `${pe.toFixed(1)}x`, supports: true },
      ...(rvol !== null ? [{ label: "REL VOLUME", value: `${rvol.toFixed(2)}x`, supports: rvol >= 1 }] : []),
    ];
    rationale = ["Observed decline exceeds the rule threshold", "Price remains within 15% of the observed 52-week low", "Available P/E is positive and below 30x"];
  } else if (chg > 3 && pe !== null && pe > 40 && pctFrom52Hi !== null && Math.abs(pctFrom52Hi) <= 2) {
    setup = "SHORT";
    type = "EXTENDED NEAR HIGH";
    method = "EXTENSION_NEAR_52W_HIGH_VALUATION_FILTER";
    evidence = [
      { label: "DAILY MOVE", value: `+${chg.toFixed(2)}%`, supports: true },
      { label: "DIST 52W HIGH", value: `${pctFrom52Hi.toFixed(2)}%`, supports: true },
      { label: "P/E", value: `${pe.toFixed(1)}x`, supports: true },
      ...(rvol !== null ? [{ label: "REL VOLUME", value: `${rvol.toFixed(2)}x`, supports: rvol >= 1 }] : []),
    ];
    rationale = ["Daily extension exceeds 3%", "Price is within 2% of the observed 52-week high", "Available P/E exceeds the rule threshold of 40x"];
  } else if (newsSent > 1 && chg > 0) {
    setup = "LONG";
    type = "NEWS CATALYST WATCH";
    method = "POSITIVE_NEWS_WITH_PRICE_CONFIRMATION";
    evidence = [
      { label: "NEWS BALANCE", value: `+${newsSent}`, supports: true },
      { label: "MATCHED NEWS", value: String(relevantNews.length), supports: true },
      { label: "DAILY MOVE", value: `+${chg.toFixed(2)}%`, supports: true },
      ...(rvol !== null ? [{ label: "REL VOLUME", value: `${rvol.toFixed(2)}x`, supports: rvol >= 1 }] : []),
    ];
    rationale = ["Matched source-attributed news has a positive sentiment balance", "Observed price change is positive", "Treat as a watch condition, not a prediction"];
  } else {
    return null;
  }

  // Target/stop levels are transparent rule outputs, not forecasts. The policy
  // uses the larger of the observed intraday range or a fixed minimum risk band.
  const observedRange = intradayRangePct ?? 0;
  const stopPct = Math.max(2, observedRange);
  const targetPct = Math.max(3, stopPct * 2);
  const target = setup === "LONG" ? price * (1 + targetPct / 100) : price * (1 - targetPct / 100);
  const stop = setup === "LONG" ? price * (1 - stopPct / 100) : price * (1 + stopPct / 100);
  const rr = Math.abs(target - price) / Math.abs(stop - price);
  const evidenceScore = evidence.filter((row) => row.supports).length;

  return { setup, type, rationale, price, target, stop, rr, evidence, evidenceScore, evaluatedAt: new Date().toISOString(), method };
}

export default function TradeIdeaPanel({ onSymbol }: Props) {
  const [WATCHLIST, setWatchlist] = useTerminalArtifactState<string[]>("TradeIdeaPanel.WATCHLIST", DEFAULT_WATCHLIST);
  const [tickerInput, setTickerInput] = useTerminalArtifactState("TradeIdeaPanel.tickerInput", "");
  const addTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t && !WATCHLIST.includes(t) && WATCHLIST.length < MAX_WATCHLIST) {
      setWatchlist((prev) => [...prev, t]);
      setTickerInput("");
    }
  };
  const removeTicker = (sym: string) => {
    if (WATCHLIST.length <= MIN_WATCHLIST) return;
    setWatchlist((prev) => prev.filter((s) => s !== sym));
  };

  const { data: quotes = [] } = useQuotes(WATCHLIST);
  const { data: gainers = [] } = useMarketGainers("US");
  const { data: losers = [] } = useMarketLosers("US");
  const { data: news = [] } = useNews();
  const { data: sentiment } = useMarketSentiment();

  const ideas = useMemo(() => {
    const allQuotes = [...quotes, ...gainers.slice(0, 5), ...losers.slice(0, 5)];
    const seen = new Set<string>();
    return allQuotes
      .filter((q) => {
        if (!q || seen.has(q.symbol)) return false;
        seen.add(q.symbol);
        return true;
      })
      .map((q) => ({ symbol: q.symbol, name: q.name, idea: generateIdea(q, news, sentiment) }))
      .filter((row): row is { symbol: string; name: string; idea: TradeIdea } => Boolean(row.idea))
      .sort((a, b) => b.idea.evidenceScore - a.idea.evidenceScore || Math.abs(b.idea.rr) - Math.abs(a.idea.rr))
      .slice(0, 12);
  }, [quotes, gainers, losers, news, sentiment]);

  const setupColor = (setup: string) => setup === "LONG"
    ? "text-[hsl(142,71%,55%)] bg-[hsl(142,71%,8%)] border-[hsl(142,71%,20%)]"
    : "text-[hsl(0,80%,60%)] bg-[hsl(0,80%,8%)] border-[hsl(0,80%,20%)]";

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0" data-workstation-toolbar>
        <Lightbulb className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">DETERMINISTIC TRADE SETUP ENGINE</span>
        <span className="ml-1 font-terminal text-[8px] text-muted-foreground border border-border px-1">EXPERIMENTAL</span>
        <ProvenanceBadge compact details={{
          kind: "computed",
          method: "Transparent rule-stack screening",
          inputs: ["live/delayed quote fields", "52-week high/low", "P/E when available", "source-attributed news sentiment", "market sentiment input"],
          logic: "A setup is emitted only when its required observed fields exist and all named rule conditions pass. Target/stop bands use observed intraday range with explicit minimum rule bands.",
          limitations: ["Setup rules are heuristics, not forecasts", "No unavailable technical indicator is synthesized", "No confidence probability is claimed"],
        }} />
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">IDEA</span>
      </div>

      <div className="shrink-0 px-4 py-2 border-b border-border bg-[hsl(38,95%,5%)] font-terminal text-[8px] leading-relaxed text-[hsl(38,95%,58%)]">
        ⚠ Rule-based setup signals are for research and educational use only. Targets and stops are policy outputs, not predicted prices or financial advice.
      </div>

      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-[#060606] flex-wrap">
        <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">SCANNING:</span>
        {WATCHLIST.map((ticker) => (
          <div key={ticker} className="flex items-center gap-1 px-2 py-0.5 border border-border font-terminal text-[9px] text-muted-foreground">
            {ticker}
            {WATCHLIST.length > MIN_WATCHLIST && <button onClick={() => removeTicker(ticker)} className="hover:text-[hsl(0,80%,55%)]" aria-label={`Remove ${ticker}`}><X className="w-2.5 h-2.5" /></button>}
          </div>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <input value={tickerInput} onChange={(event) => setTickerInput(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && addTicker()} disabled={WATCHLIST.length >= MAX_WATCHLIST} placeholder={WATCHLIST.length >= MAX_WATCHLIST ? `MAX ${MAX_WATCHLIST}` : "ADD TICKER…"} className="w-24 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40" />
          <button onClick={addTicker} disabled={WATCHLIST.length >= MAX_WATCHLIST} className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"><Plus className="w-2.5 h-2.5" /> ADD</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {ideas.length === 0 ? (
          <div className="h-full grid place-items-center">
            <div className="w-full max-w-2xl border border-border bg-[#080808] p-5 text-center">
              <div className="font-terminal text-[11px] font-bold tracking-widest text-foreground">NO RULE STACK CURRENTLY PASSES</div>
              <div className="mt-2 font-terminal text-[9px] leading-relaxed text-muted-foreground">The engine will not manufacture a setup when required quote, valuation, 52-week, news or sentiment evidence is absent or fails the named thresholds.</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {ideas.map(({ symbol, name, idea }) => (
              <div key={symbol} className={`border p-4 cursor-pointer hover:brightness-110 transition-all space-y-3 ${idea.setup === "LONG" ? "border-[hsl(142,71%,20%)] bg-[hsl(142,71%,3%)]" : "border-[hsl(0,80%,20%)] bg-[hsl(0,80%,3%)]"}`} onClick={() => onSymbol(symbol)}>
                <div className="flex items-start justify-between gap-3">
                  <div><div className="font-terminal text-[12px] font-bold text-foreground">{symbol}</div><div className="font-terminal text-[8.5px] text-muted-foreground">{name?.slice(0, 32)}</div></div>
                  <div className="flex flex-col items-end gap-1"><span className={`px-2 py-0.5 font-terminal text-[9px] font-bold border ${setupColor(idea.setup)}`}>{idea.setup}</span><span className="px-1.5 py-0.5 font-terminal text-[7.5px] border border-cyan-500/30 text-cyan-300">EVIDENCE {idea.evidenceScore}/{idea.evidence.length}</span></div>
                </div>

                <div className={`font-terminal text-[9px] font-bold tracking-wider ${idea.setup === "LONG" ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{idea.type}</div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="border border-border bg-[#0a0a0a] p-1.5"><div className="font-terminal text-[7.5px] text-muted-foreground">ENTRY</div><div className="font-terminal text-[9px] tabular-nums">${idea.price.toFixed(2)}</div></div>
                  <div className={`border p-1.5 ${idea.setup === "LONG" ? "border-[hsl(142,71%,25%)]" : "border-[hsl(0,80%,25%)]"}`}><div className="font-terminal text-[7.5px] text-muted-foreground">RULE TARGET</div><div className={`font-terminal text-[9px] tabular-nums font-bold ${idea.setup === "LONG" ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>${idea.target.toFixed(2)}</div></div>
                  <div className="border border-[hsl(0,80%,20%)] p-1.5"><div className="font-terminal text-[7.5px] text-muted-foreground">INVALIDATION</div><div className="font-terminal text-[9px] tabular-nums text-[hsl(0,80%,55%)]">${idea.stop.toFixed(2)}</div></div>
                </div>

                <div className="flex items-center justify-between font-terminal text-[8.5px]"><span className="text-muted-foreground">Rule Risk:Reward</span><span className={`font-bold ${idea.rr >= 2 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(38,95%,55%)]"}`}>1 : {idea.rr.toFixed(2)}</span></div>

                <div className="grid grid-cols-2 gap-1.5">
                  {idea.evidence.map((row) => <div key={row.label} className="flex items-center justify-between border border-border/70 bg-black/20 px-2 py-1.5"><span className="font-terminal text-[7.5px] tracking-widest text-muted-foreground">{row.label}</span><span className={row.supports ? "font-terminal text-[8.5px] tabular-nums text-cyan-300" : "font-terminal text-[8.5px] tabular-nums text-muted-foreground"}>{row.value}</span></div>)}
                </div>

                <div className="space-y-1 border-t border-border/60 pt-2">{idea.rationale.map((line) => <div key={line} className="font-terminal text-[8.5px] leading-relaxed text-muted-foreground">• {line}</div>)}</div>
                <div className="flex items-center justify-between gap-2"><span className="font-terminal text-[7.5px] tracking-widest text-muted-foreground">{idea.method} · {new Date(idea.evaluatedAt).toLocaleTimeString()}</span><ProvenanceBadge compact details={{ kind: "model", method: idea.method, inputs: idea.evidence.map((row) => `${row.label}=${row.value}`), timestamp: idea.evaluatedAt, logic: idea.rationale.join(". "), limitations: "Deterministic heuristic setup; not a probability or forecast." }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
