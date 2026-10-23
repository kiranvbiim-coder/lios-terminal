import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { useQuotes, usePeers, useFundamentalsMany } from "@/lib/useFinance";
import { formatPrice, getCurrencySymbol } from "@/lib/finance";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { GitCompare, Plus, X } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import { summarizePeerMetric } from "@shared/financialAnalysis";
import { buildDynamicAnalyticsCatalog, type DynamicAnalyticsField } from "@shared/waveCContracts";

interface Props { symbol: string; onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }

interface PeerComparable {
  symbol: string;
  price?: number | null;
  pe?: number | null;
  eps?: number | null;
  marketCap?: number | null;
  revenue?: number | null;
  priceToBook?: number | null;
  revenueGrowth?: number | null;
  netMargin?: number | null;
  roe?: number | null;
  dividendYield?: number | null;
  fiftyTwoWeekHigh?: number | null;
  beta?: number | null;
  enterpriseToEbitda?: number | null;
  quickRatio?: number | null;
  currentRatio?: number | null;
}

interface PeerMetricDefinition {
  key: string;
  label: string;
  fmt: (v: number, q: Pick<PeerComparable, "symbol">) => string;
  extract: (q: PeerComparable | undefined) => number | null;
  higherIsBetter?: boolean;
}

const DEFAULT_PEERS = ["AAPL","MSFT","GOOGL","AMZN","META"];

const METRICS: PeerMetricDefinition[] = [
  { key: "price",    label: "PRICE",       fmt: (v,q) => `${getCurrencySymbol(q.symbol)}${formatPrice(v)}`, extract: q => q?.price ?? null },
  { key: "pe",       label: "P/E RATIO",   fmt: v => v.toFixed(1)+"x",  extract: q => q?.pe ?? null, higherIsBetter: false },
  { key: "ps",       label: "P/S RATIO",   fmt: v => v.toFixed(1)+"x",  extract: q => q?.marketCap && q.revenue ? q.marketCap/q.revenue : null, higherIsBetter: false },
  { key: "ev_ebitda",label: "EV/EBITDA",   fmt: v => v.toFixed(1)+"x",  extract: q => q?.enterpriseToEbitda ?? null, higherIsBetter: false },
  { key: "revGrowth",label: "REV GROWTH",  fmt: v => v.toFixed(1)+"%",  extract: q => q?.revenueGrowth ?? null },
  { key: "margin",   label: "NET MARGIN",  fmt: v => v.toFixed(1)+"%",  extract: q => q?.netMargin ?? null },
  { key: "roe",      label: "ROE",         fmt: v => v.toFixed(1)+"%",  extract: q => q?.roe ?? null },
  { key: "mktcap",   label: "MKT CAP",     fmt: v => v >= 1e12 ? `$${(v/1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v/1e9).toFixed(0)}B` : `$${(v/1e6).toFixed(0)}M`, extract: q => q?.marketCap ?? null },
  { key: "divYield", label: "DIV YIELD",   fmt: v => v.toFixed(2)+"%",  extract: q => q?.dividendYield ?? null },
  { key: "52wHigh",  label: "VS 52W HIGH", fmt: v => v.toFixed(1)+"%",  extract: q => q?.fiftyTwoWeekHigh && q.price ? ((q.price / q.fiftyTwoWeekHigh) - 1)*100 : null },
  { key: "eps",      label: "EPS (TTM)",   fmt: (v,q) => `${getCurrencySymbol(q.symbol)}${v.toFixed(2)}`, extract: q => q?.eps ?? null },
  { key: "beta",     label: "BETA",        fmt: v => v.toFixed(2)+"x",  extract: q => q?.beta ?? null, higherIsBetter: false },
  { key: "pb",       label: "P/B RATIO",   fmt: v => v.toFixed(2)+"x",  extract: q => q?.priceToBook ?? null, higherIsBetter: false },
  { key: "currentRatio", label: "CURRENT RATIO", fmt: v => v.toFixed(2)+"x", extract: q => q?.currentRatio ?? null },
  { key: "quickRatio", label: "QUICK RATIO", fmt: v => v.toFixed(2)+"x", extract: q => q?.quickRatio ?? null },
];

// The comparison picker is catalog-driven. These bindings connect the
// fields currently present in the peer response to the canonical field
// vocabulary; fields without a loaded observation remain visibly unavailable
// instead of being filled with a guessed value.
const DYNAMIC_PEER_BINDINGS: Record<string, string> = {
  "market_data.price": "price",
  "market_data.marketCap": "marketCap",
  "metric.pe": "pe",
  "financial_statements.eps": "eps",
  "metric.epsBasic": "eps",
  "market_data.beta": "beta",
  "metric.roe": "roe",
  "metric.revenueGrowth": "revGrowth",
  "metric.dividendYield": "divYield",
  "metric.currentRatio": "currentRatio",
  "metric.quickRatio": "quickRatio",
  "metric.evEbitda": "ev_ebitda",
  "metric.pb": "pb",
};

const DYNAMIC_COMPARISON_FIELDS = buildDynamicAnalyticsCatalog().filter((field) => field.numeric && (field.id.startsWith("metric.") || field.id.startsWith("market_data.")));

export default function PeerCompPanel({ symbol, onSymbol, onNav }: Props) {
  const [tickers, setTickers] = useTerminalArtifactState<string[]>("PeerCompPanel.tickers", [symbol, ...DEFAULT_PEERS.filter(s => s !== symbol).slice(0, 4)]);
  const [input, setInput] = useTerminalArtifactState("PeerCompPanel.input", "");
  const [activeMetric, setActiveMetric] = useTerminalArtifactState("PeerCompPanel.activeMetric", "pe");
  const [dynamicMetricId, setDynamicMetricId] = useTerminalArtifactState("PeerCompPanel.dynamicMetricId", DYNAMIC_COMPARISON_FIELDS[0]?.id ?? "metric.pe");
  const [dynamicMetricIds, setDynamicMetricIds] = useTerminalArtifactState<string[]>("PeerCompPanel.dynamicMetricIds", []);

  const { data: peerData = [] } = usePeers(symbol);
  const { data: quotes = [] } = useQuotes(tickers);
  // Quote objects only ever carry price/pe/eps/marketCap from the small
  // static reference catalog -- revGrowth/margin/ROE/dividend/52w-high/beta
  // don't exist on Quote at all, so this table showed "—" for six of its
  // twelve rows unconditionally, for every ticker, regardless of catalog
  // coverage. Live fundamentals (small, fixed-size peer list, so a per-
  // symbol fetch is cheap) fill in the real numbers.
  const { map: fundamentalsMap, isLoading: isFundamentalsLoading } = useFundamentalsMany(tickers);
  // These three ratios do not currently have an approved provider in the
  // connector-neutral finance surface. Keep them visibly unavailable rather
  // than inventing values or depending on a removed provider.
  const PROVIDER_GAP_METRIC_KEYS = new Set(["ev_ebitda", "currentRatio", "quickRatio"]);

  const addTicker = () => {
    const t = input.trim().toUpperCase();
    if (t && !tickers.includes(t) && tickers.length < 10) {
      setTickers(prev => [...prev, t]);
      setInput("");
    }
  };

  const removeTicker = (t: string) => setTickers(prev => prev.filter(x => x !== t));

  // Merge each ticker's quote with its live fundamentals into one object per
  // symbol, so METRICS extractors can read either source through one field
  // name without caring where it came from. yfinance reports margin/ROE/
  // revenue-growth as fractions (0.276) -- scaled to percent (27.6) to match
  // how every other percent metric here is already formatted.
  const quoteMap = useMemo(() => {
    const merged = new Map<string, PeerComparable>();
    for (const q of quotes) {
      const f = fundamentalsMap.get(q.symbol);
      merged.set(q.symbol, {
        ...q,
        pe: q.pe ?? f?.trailingPE ?? null,
        eps: q.eps ?? f?.trailingEps ?? null,
        marketCap: q.marketCap ?? f?.marketCap ?? null,
        priceToBook: f?.priceToBook ?? null,
        revenueGrowth: f?.revenueGrowth != null ? f.revenueGrowth * 100 : null,
        netMargin: f?.profitMargins != null ? f.profitMargins * 100 : null,
        roe: f?.returnOnEquity != null ? f.returnOnEquity * 100 : null,
        dividendYield: f?.dividendYield ?? null,
        fiftyTwoWeekHigh: f?.fiftyTwoWeekHigh ?? null,
        beta: f?.beta ?? null,
        enterpriseToEbitda: null,
        currentRatio: null,
        quickRatio: null,
      });
    }
    return merged;
  }, [quotes, fundamentalsMap]);

  const dynamicMetricDefs = useMemo<PeerMetricDefinition[]>(() => dynamicMetricIds.flatMap((fieldId) => {
    const field = DYNAMIC_COMPARISON_FIELDS.find((candidate) => candidate.id === fieldId);
    if (!field) return [];
    const binding = DYNAMIC_PEER_BINDINGS[field.id];
    const base = typeof binding === "string" && !binding.includes(".") ? METRICS.find((metric) => metric.key === binding) : undefined;
    return [{
      key: `dynamic:${field.id}`,
      label: field.label.toUpperCase(),
      fmt: base?.fmt ?? ((value: number) => `${value.toFixed(2)}${field.unit === "percent" ? "%" : field.unit === "multiple" ? "x" : ""}`),
      extract: (q: PeerComparable | undefined) => base ? base.extract(q) : (binding && q ? q[binding as keyof PeerComparable] as number | null : null),
      higherIsBetter: base?.higherIsBetter,
    } satisfies PeerMetricDefinition];
  }), [dynamicMetricIds]);
  const comparisonMetrics = useMemo(() => [...METRICS, ...dynamicMetricDefs], [dynamicMetricDefs]);

  // For a given metric, find min/max for color scaling
  const metricRange = useMemo(() => {
    const m = comparisonMetrics.find(m => m.key === activeMetric);
    if (!m) return { min: 0, max: 1 };
    const vals = tickers.map(t => { const q = quoteMap.get(t); return q ? m.extract(q) : null; }).filter((v): v is number => v !== null);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [activeMetric, comparisonMetrics, tickers, quoteMap]);

  const chartData = useMemo(() => {
    const m = comparisonMetrics.find(m => m.key === activeMetric);
    if (!m) return [];
    return tickers.map(t => {
      const q = quoteMap.get(t);
      const val = q ? m.extract(q) : null;
      return { ticker: t, value: val ?? 0, hasData: val !== null };
    });
  }, [activeMetric, comparisonMetrics, tickers, quoteMap]);

  const activeMetricDef = comparisonMetrics.find(m => m.key === activeMetric);
  const peerSummary = useMemo(() => {
    if (!activeMetricDef) return null;
    return summarizePeerMetric(
      tickers.map((ticker) => ({ symbol: ticker, value: activeMetricDef.extract(quoteMap.get(ticker)) })),
      symbol,
      activeMetricDef.higherIsBetter ?? true,
    );
  }, [activeMetricDef, tickers, quoteMap, symbol]);

  const addDynamicMetric = () => {
    if (!dynamicMetricId || dynamicMetricIds.includes(dynamicMetricId)) return;
    const next = [...dynamicMetricIds, dynamicMetricId];
    setDynamicMetricIds(next);
    setActiveMetric(`dynamic:${dynamicMetricId}`);
  };

  const barColor = (val: number, isHighGood = true) => {
    const range = metricRange.max - metricRange.min;
    if (range === 0) return "hsl(38,95%,55%)";
    const norm = (val - metricRange.min) / range;
    const score = isHighGood ? norm : 1 - norm;
    if (score > 0.66) return "hsl(142,71%,45%)";
    if (score > 0.33) return "hsl(38,95%,55%)";
    return "hsl(0,80%,55%)";
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <GitCompare className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">PEER COMPARISON ENGINE</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">COMP</span>
      </div>

      {/* Ticker pills + add input */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-[#060606] flex-wrap">
        {tickers.map(t => (
          <div key={t} className={`flex items-center gap-1 px-2 py-0.5 border font-terminal text-[9px] cursor-pointer transition-all ${t === symbol ? "border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)/10%] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground hover:border-[hsl(38,95%,30%)]"}`}
            onClick={() => onSymbol(t)}>
            {t}
            {t !== symbol && <button onClick={e => { e.stopPropagation(); removeTicker(t); }} className="hover:text-[hsl(0,80%,55%)]"><X className="w-2.5 h-2.5" /></button>}
          </div>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <input value={input} onChange={e => setInput(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && addTicker()}
            placeholder="ADD TICKER…" className="w-28 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]" />
          <button onClick={addTicker} className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Plus className="w-2.5 h-2.5" /> ADD
          </button>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border/70 bg-[#060606] flex-wrap">
        <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">METRIC CATALOG</span>
        <select value={dynamicMetricId} onChange={(event) => setDynamicMetricId(event.target.value)} aria-label="Dynamic comparison metric" className="h-7 max-w-[250px] border border-border bg-black px-2 font-terminal text-[8px] outline-none">
          {DYNAMIC_COMPARISON_FIELDS.map((field: DynamicAnalyticsField) => <option key={field.id} value={field.id}>{field.label.toUpperCase()} · {field.id}</option>)}
        </select>
        <button type="button" onClick={addDynamicMetric} className="h-7 border border-cyan-400/35 px-2 font-terminal text-[8px] text-cyan-300 hover:bg-cyan-400/10"><Plus className="mr-1 inline h-3 w-3" />ADD METRIC</button>
        <span className="font-terminal text-[7px] text-muted-foreground">Unknown/unavailable observations stay —</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: metric grid */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-[#070707]">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 font-terminal text-[8px] text-muted-foreground tracking-wider w-36">METRIC</th>
                {tickers.map(t => (
                  <th key={t} className={`px-2 py-2 font-terminal text-[9px] tracking-wider text-center min-w-[80px] cursor-pointer ${t === symbol ? "text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => onSymbol(t)}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonMetrics.map(m => {
                const vals = tickers.map(t => quoteMap.get(t)).map(q => q ? m.extract(q) : null);
                const numVals = vals.filter((v): v is number => v !== null);
                const range = numVals.length > 1 ? { min: Math.min(...numVals), max: Math.max(...numVals) } : null;
                const isBest = (val: number | null) => range && val !== null && (m.higherIsBetter === false ? val === range.min : val === range.max);
                return (
                  <tr key={m.key} className={`border-b border-border/30 hover:bg-white/[2%] cursor-pointer ${activeMetric === m.key ? "bg-[hsl(38,95%,50%)/5%]" : ""}`}
                    onClick={() => setActiveMetric(m.key)}>
                    <td className={`px-4 py-2 font-terminal text-[9px] ${activeMetric === m.key ? "text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>{m.label}</td>
                    {tickers.map((t) => {
                      const q = quoteMap.get(t);
                      const val = q ? m.extract(q) : null;
                      const best = isBest(val);
                      // "price"/"pe"/"eps"/"mktcap" resolve from useQuotes,
                      // which is effectively instant (small static catalog);
                      // Fundamentals-backed fields may still be loading. The
                      // provider-gap ratios intentionally render unavailable
                      // until an approved connector supplies them.
                      const stillLoading = val === null && !PROVIDER_GAP_METRIC_KEYS.has(m.key) && isFundamentalsLoading;
                      return (
                        <td key={t} className="px-2 py-2 text-center">
                          <span className={`font-terminal text-[9px] tabular-nums ${val === null ? "text-muted-foreground/40" : best ? "text-[hsl(142,71%,55%)] font-bold" : "text-foreground"}`}>
                            {val !== null ? m.fmt(val, q ?? { symbol: t }) : stillLoading ? "···" : "—"}
                            {best && " ★"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right: bar chart for active metric */}
        <div className="w-64 shrink-0 border-l border-border bg-[#060606] p-4 space-y-3 overflow-y-auto scrollbar-thin">
          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-1">COMPARING</div>
            <div className="font-terminal text-[11px] font-bold text-[hsl(38,95%,55%)]">{activeMetricDef?.label ?? activeMetric}</div>
            <div className="font-terminal text-[7.5px] text-muted-foreground">Click any row to change metric</div>
            {peerSummary && peerSummary.count > 0 && activeMetricDef && (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {[
                  ["MEDIAN", peerSummary.median !== null ? activeMetricDef.fmt(peerSummary.median, { symbol }) : "—"],
                  ["MEAN", peerSummary.mean !== null ? activeMetricDef.fmt(peerSummary.mean, { symbol }) : "—"],
                  ["TARGET RANK", peerSummary.targetRank ? `${peerSummary.targetRank}/${peerSummary.count}` : "—"],
                  ["PERCENTILE", peerSummary.targetPercentile !== null ? `${peerSummary.targetPercentile.toFixed(0)}th` : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="border border-border/60 bg-[#080808] p-1.5">
                    <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest">{label}</div>
                    <div className="font-terminal text-[9px] text-foreground tabular-nums">{value}</div>
                  </div>
                ))}
                <div className="col-span-2 border border-border/60 bg-[#080808] p-1.5">
                  <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest">VS PEER MEDIAN</div>
                  <div className="font-terminal text-[9px] text-foreground tabular-nums">
                    {peerSummary.targetPremiumDiscountToMedian !== null ? `${(peerSummary.targetPremiumDiscountToMedian * 100).toFixed(1)}%` : "—"}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 24 }}>
                <XAxis type="number" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="ticker" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,55%)" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                <Bar dataKey="value" radius={[0, 2, 2, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.hasData ? barColor(entry.value, activeMetricDef?.higherIsBetter ?? true) : "hsl(0,0%,15%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Peer suggestions */}
          {peerData.length > 0 && (
            <div>
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-1.5">SUGGESTED PEERS FOR {symbol}</div>
              <div className="flex flex-wrap gap-1">
                {peerData.slice(0, 6).map(p => (
                  <button key={p.symbol} onClick={() => { if (!tickers.includes(p.symbol)) setTickers(prev => [...prev.slice(0,9), p.symbol]); }}
                    className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-[hsl(38,95%,55%)] hover:border-[hsl(38,95%,30%)] transition-all">
                    {p.symbol}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
