import { useState, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChartScatter, Plus, X, Info } from "lucide-react";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
} from "recharts";
import type { OHLCVSeries } from "@/lib/finance";
import { computeDailyReturns, computeDescriptiveStats } from "@/lib/statistics";
import { useRiskFreeRate } from "@/lib/useEconomics";

// Only indices this app can actually fetch real price history for (confirmed
// wired through the OHLCV pipeline). NOT total-return/dividend-reinvested --
// this app has no TRI data source anywhere, so these are plain price
// indices, labeled honestly rather than passed off as TRI.
const BENCHMARKS = [
  { symbol: "NONE", label: "None (zero / origin)" },
  { symbol: "^NSEI", label: "Nifty 50" },
  { symbol: "^BSESN", label: "BSE Sensex" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^DJI", label: "Dow Jones" },
  { symbol: "^IXIC", label: "Nasdaq" },
  { symbol: "^N225", label: "Nikkei 225" },
  { symbol: "^FTSE", label: "FTSE 100" },
];

const TIMEFRAMES = [
  { key: "1Y", label: "1 YEAR" },
  { key: "3Y", label: "3 YEARS" },
  { key: "5Y", label: "5 YEARS" },
] as const;
type Timeframe = (typeof TIMEFRAMES)[number]["key"];

const MIN_OBSERVATIONS = 20; // below this, stats are too noisy to plot honestly

interface Holding { symbol: string; weight: number }
interface DataPointDef {
  id: string;
  label: string;
  kind: "single" | "portfolio";
  holdings: Holding[];
}

const DEFAULT_POINTS: DataPointDef[] = [
  { id: "d1", label: "AAPL", kind: "single", holdings: [{ symbol: "AAPL", weight: 1 }] },
  { id: "d2", label: "TLT", kind: "single", holdings: [{ symbol: "TLT", weight: 1 }] },
  { id: "d3", label: "GLD", kind: "single", holdings: [{ symbol: "GLD", weight: 1 }] },
];

interface PlottedPoint {
  id: string;
  label: string;
  kind: "single" | "portfolio" | "benchmark";
  risk: number;   // annualized stdDev, %
  return: number; // annualized mean return, %
  sharpe: number;
  n: number;
}

function useManySymbols(symbols: string[], range: string) {
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["/api/finance/ohlcv", symbol, range, "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol, range, interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to fetch ${symbol}`);
        return res.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60000,
      enabled: !!symbol,
    })),
  });
}

// Weighted portfolio daily-return series, aligned across every holding's OWN
// trading dates (inner join across all N symbols), not a weighted average of
// each symbol's independently-computed mean/stdDev -- averaging pre-computed
// stats would silently discard the correlation/diversification effect between
// holdings, which is the entire point of measuring a portfolio's own risk.
function computePortfolioReturns(holdings: Holding[], barsBySymbol: Map<string, { date: string; close: number }[]>): number[] {
  const totalWeight = holdings.reduce((s, h) => s + h.weight, 0) || 1;
  const returnMaps = holdings.map((h) => {
    const bars = barsBySymbol.get(h.symbol) ?? [];
    const rets = computeDailyReturns(bars.map((b) => b.close));
    const dates = bars.slice(1).map((b) => b.date);
    const m = new Map<string, number>();
    dates.forEach((d, i) => m.set(d, rets[i]));
    return { weight: h.weight / totalWeight, map: m };
  });
  if (!returnMaps.length || returnMaps.some((r) => r.map.size === 0)) return [];
  const [first, ...rest] = returnMaps;
  const commonDates = Array.from(first.map.keys()).filter((d) => rest.every((r) => r.map.has(d)));
  return commonDates.map((d) => returnMaps.reduce((sum, r) => sum + r.weight * (r.map.get(d) ?? 0), 0));
}

function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

export default function RiskReturnScatterPanel() {
  const [benchmark, setBenchmark] = useState("^NSEI");
  const [customBenchmark, setCustomBenchmark] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [riskFreeRate, setRiskFreeRate] = useState(4.0);
  const riskFreeRateLive = useRiskFreeRate();
  const [dataPoints, setDataPoints] = useState<DataPointDef[]>(DEFAULT_POINTS);

  const [singleInput, setSingleInput] = useState("");
  const [builderName, setBuilderName] = useState("");
  const [builderHoldings, setBuilderHoldings] = useState<Holding[]>([]);
  const [builderSymbol, setBuilderSymbol] = useState("");
  const [builderWeight, setBuilderWeight] = useState("");
  const [mode, setMode] = useState<"single" | "portfolio">("single");

  const activeBenchmark = customBenchmark.trim() ? customBenchmark.trim().toUpperCase() : benchmark;
  const benchmarkIsNone = activeBenchmark === "NONE";

  const allSymbols = useMemo(() => {
    const set = new Set<string>();
    dataPoints.forEach((dp) => dp.holdings.forEach((h) => set.add(h.symbol)));
    if (!benchmarkIsNone) set.add(activeBenchmark);
    return Array.from(set);
  }, [dataPoints, activeBenchmark, benchmarkIsNone]);

  const results = useManySymbols(allSymbols, timeframe);
  const isLoading = results.some((r) => r.isLoading);

  const barsBySymbol = useMemo(() => {
    const map = new Map<string, { date: string; close: number }[]>();
    allSymbols.forEach((sym, i) => {
      const bars = results[i]?.data?.bars ?? [];
      map.set(sym, bars.map((b) => ({ date: b.date, close: b.close })));
    });
    return map;
  }, [allSymbols, results]);

  const { plotted, failed, benchmarkPoint } = useMemo(() => {
    const rf = riskFreeRate / 100;
    const plotted: PlottedPoint[] = [];
    const failed: string[] = [];

    for (const dp of dataPoints) {
      const rets = computePortfolioReturns(dp.holdings, barsBySymbol);
      if (rets.length < MIN_OBSERVATIONS) { failed.push(dp.label); continue; }
      const stats = computeDescriptiveStats(rets, 252);
      const riskPct = (stats.annualizedVol ?? 0);
      const returnPct = (stats.annualizedReturn ?? 0);
      const sharpe = riskPct > 0 ? (returnPct / 100 - rf) / (riskPct / 100) : 0;
      plotted.push({ id: dp.id, label: dp.label, kind: dp.kind, risk: riskPct, return: returnPct, sharpe, n: rets.length });
    }

    let benchmarkPoint: PlottedPoint | null = null;
    if (benchmarkIsNone) {
      benchmarkPoint = { id: "bench", label: "ORIGIN", kind: "benchmark", risk: 0, return: 0, sharpe: 0, n: 0 };
    } else {
      const bars = barsBySymbol.get(activeBenchmark) ?? [];
      const rets = computeDailyReturns(bars.map((b) => b.close));
      if (rets.length >= MIN_OBSERVATIONS) {
        const stats = computeDescriptiveStats(rets, 252);
        const riskPct = stats.annualizedVol ?? 0;
        const returnPct = stats.annualizedReturn ?? 0;
        const sharpe = riskPct > 0 ? (returnPct / 100 - rf) / (riskPct / 100) : 0;
        const label = BENCHMARKS.find((b) => b.symbol === activeBenchmark)?.label ?? activeBenchmark;
        benchmarkPoint = { id: "bench", label, kind: "benchmark", risk: riskPct, return: returnPct, sharpe, n: rets.length };
      }
    }

    return { plotted, failed, benchmarkPoint };
  }, [dataPoints, barsBySymbol, benchmarkIsNone, activeBenchmark, riskFreeRate]);

  const singlePoints = plotted.filter((p) => p.kind === "single");
  const portfolioPoints = plotted.filter((p) => p.kind === "portfolio");
  const tableRows = [...plotted, ...(benchmarkPoint ? [benchmarkPoint] : [])].sort((a, b) => b.sharpe - a.sharpe);

  const addSingle = () => {
    const sym = singleInput.trim().toUpperCase();
    if (!sym || dataPoints.some((d) => d.id === sym)) return;
    setDataPoints((prev) => [...prev, { id: sym, label: sym, kind: "single", holdings: [{ symbol: sym, weight: 1 }] }]);
    setSingleInput("");
  };

  const removePoint = (id: string) => setDataPoints((prev) => prev.filter((d) => d.id !== id));

  const addHoldingToBuilder = () => {
    const sym = builderSymbol.trim().toUpperCase();
    if (!sym || builderHoldings.some((h) => h.symbol === sym)) return;
    const w = builderWeight.trim() ? Number(builderWeight) : 1;
    if (!Number.isFinite(w) || w <= 0) return;
    setBuilderHoldings((prev) => [...prev, { symbol: sym, weight: w }]);
    setBuilderSymbol("");
    setBuilderWeight("");
  };

  const removeHoldingFromBuilder = (sym: string) => setBuilderHoldings((prev) => prev.filter((h) => h.symbol !== sym));

  const commitPortfolio = () => {
    if (!builderName.trim() || builderHoldings.length === 0) return;
    const id = `port-${Date.now()}`;
    setDataPoints((prev) => [...prev, { id, label: builderName.trim(), kind: "portfolio", holdings: builderHoldings }]);
    setBuilderName("");
    setBuilderHoldings([]);
  };

  // Fixed shape renderer: always returns a valid element (never null), which
  // avoids the "Element | null not assignable to Element" TS error recharts'
  // Scatter `shape` typing produces when a custom shape function can bail out
  // with null (a real, pre-existing bug elsewhere in this codebase).
  const pointShape = (color: string) => (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return <g />;
    const isBenchmark = payload.kind === "benchmark";
    const r = isBenchmark ? 6 : payload.kind === "portfolio" ? 5.5 : 4.5;
    return (
      <g>
        {isBenchmark ? (
          <path
            d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`}
            fill={color} stroke="white" strokeWidth={1}
          />
        ) : (
          <circle cx={cx} cy={cy} r={r} fill={color} stroke="white" strokeWidth={payload.kind === "portfolio" ? 1.2 : 0.8} />
        )}
        <text x={cx + r + 3} y={cy + 3} fill={color} fontSize={8} fontFamily="'JetBrains Mono', monospace" fontWeight="bold">
          {payload.label}
        </text>
      </g>
    );
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <ChartScatter className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">RISK–RETURN SCATTER</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">RRSC</span>
      </div>

      {/* Controls */}
      <div className="shrink-0 flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-border bg-[#060606] font-terminal text-[9px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground uppercase tracking-widest">Benchmark</span>
          <select
            value={benchmark}
            onChange={(e) => { setBenchmark(e.target.value); setCustomBenchmark(""); }}
            className="bg-[#0c0c0c] border border-border px-2 py-1 text-foreground focus:outline-none"
          >
            {BENCHMARKS.map((b) => <option key={b.symbol} value={b.symbol}>{b.label}</option>)}
          </select>
          <input
            value={customBenchmark}
            onChange={(e) => setCustomBenchmark(e.target.value.toUpperCase())}
            placeholder="OR CUSTOM SYMBOL..."
            className="w-32 bg-[#0c0c0c] border border-border px-2 py-1 text-foreground placeholder-muted-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
          />
        </div>

        <div className="flex border border-border">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.key}
              onClick={() => setTimeframe(t.key)}
              className={`px-2.5 py-1 tracking-wider border-r border-border last:border-r-0 ${timeframe === t.key ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground uppercase tracking-widest">Risk-Free Rate</span>
          <input
            type="number" step={0.25} value={riskFreeRate}
            onChange={(e) => setRiskFreeRate(Number(e.target.value))}
            className="w-14 bg-[#0c0c0c] border border-border px-2 py-1 text-foreground focus:outline-none"
          />
          <span className="text-muted-foreground">%</span>
          {riskFreeRateLive.isLive && riskFreeRateLive.ratePercent !== null && (
            <button
              type="button"
              onClick={() => setRiskFreeRate(Number(riskFreeRateLive.ratePercent!.toFixed(2)))}
              title={`3-Month US Treasury Bill (FRED DGS3MO), as of ${riskFreeRateLive.asOf}`}
              className="px-1.5 py-1 border border-[hsl(38,95%,50%)]/30 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10 tracking-wider"
            >
              USE LIVE ({riskFreeRateLive.ratePercent.toFixed(2)}%)
            </button>
          )}
        </div>
      </div>

      {/* Data point builders */}
      <div className="shrink-0 flex flex-wrap items-start gap-4 px-4 py-2.5 border-b border-border bg-[#060606] font-terminal text-[9px]">
        <div className="flex border border-border">
          <button onClick={() => setMode("single")} className={`px-2.5 py-1 tracking-wider ${mode === "single" ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>STOCK / FUND</button>
          <button onClick={() => setMode("portfolio")} className={`px-2.5 py-1 tracking-wider border-l border-border ${mode === "portfolio" ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>PORTFOLIO</button>
        </div>

        {mode === "single" ? (
          <form onSubmit={(e) => { e.preventDefault(); addSingle(); }} className="flex items-center gap-1.5">
            <input
              value={singleInput}
              onChange={(e) => setSingleInput(e.target.value.toUpperCase())}
              placeholder="TICKER (STOCK OR FUND)..."
              className="w-44 bg-[#0c0c0c] border border-border px-2 py-1 text-foreground placeholder-muted-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
            />
            <button type="submit" className="px-2.5 py-1 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] text-muted-foreground flex items-center gap-1">
              <Plus className="w-3 h-3" /> ADD
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <input
                value={builderName}
                onChange={(e) => setBuilderName(e.target.value)}
                placeholder="PORTFOLIO NAME..."
                className="w-40 bg-[#0c0c0c] border border-border px-2 py-1 text-foreground placeholder-muted-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
              />
              <input
                value={builderSymbol}
                onChange={(e) => setBuilderSymbol(e.target.value.toUpperCase())}
                placeholder="SYMBOL..."
                className="w-24 bg-[#0c0c0c] border border-border px-2 py-1 text-foreground placeholder-muted-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
              />
              <input
                value={builderWeight}
                onChange={(e) => setBuilderWeight(e.target.value)}
                placeholder="WEIGHT (DEF. 1)"
                className="w-24 bg-[#0c0c0c] border border-border px-2 py-1 text-foreground placeholder-muted-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
              />
              <button onClick={addHoldingToBuilder} className="px-2.5 py-1 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] text-muted-foreground flex items-center gap-1">
                <Plus className="w-3 h-3" /> HOLDING
              </button>
            </div>
            {builderHoldings.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {builderHoldings.map((h) => (
                  <span key={h.symbol} className="flex items-center gap-1 px-1.5 py-0.5 border border-border bg-[#0a0a0a] text-foreground">
                    {h.symbol} × {h.weight}
                    <button onClick={() => removeHoldingFromBuilder(h.symbol)}><X className="w-2.5 h-2.5 text-muted-foreground hover:text-[hsl(0,80%,55%)]" /></button>
                  </span>
                ))}
                <button
                  onClick={commitPortfolio}
                  disabled={!builderName.trim()}
                  className="px-2.5 py-1 bg-[hsl(38,95%,50%)]/10 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] disabled:opacity-40 tracking-wider"
                >
                  ADD PORTFOLIO AS DATA POINT
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Current data points */}
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border/60 bg-[#050505] font-terminal text-[8.5px]">
        <span className="text-muted-foreground uppercase tracking-widest mr-1">Data Points ({dataPoints.length}):</span>
        {dataPoints.map((dp) => (
          <span key={dp.id} className={`flex items-center gap-1 px-1.5 py-0.5 border ${dp.kind === "portfolio" ? "border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)]" : "border-border text-[hsl(186,80%,55%)]"}`}>
            {dp.label}
            <button onClick={() => removePoint(dp.id)}><X className="w-2.5 h-2.5 hover:text-[hsl(0,80%,55%)]" /></button>
          </span>
        ))}
        {failed.length > 0 && (
          <span className="ml-3 text-[hsl(0,80%,60%)]">
            NO DATA: {failed.join(", ")}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {isLoading ? (
          <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
        ) : (
          <>
            <div className="h-96 border border-border bg-[#0a0a0a] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 40, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,12%)" />
                  <XAxis
                    type="number" dataKey="risk" name="Risk"
                    tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    label={{ value: "ANNUALIZED RISK (STD DEV) →", position: "insideBottom", offset: -5, fill: "hsl(0,0%,45%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}
                  />
                  <YAxis
                    type="number" dataKey="return" name="Return"
                    tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    label={{ value: "ANNUALIZED RETURN →", angle: -90, position: "insideLeft", fill: "hsl(0,0%,45%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}
                  />
                  <ReferenceLine y={0} stroke="hsl(0,0%,25%)" />
                  <ReferenceLine x={0} stroke="hsl(0,0%,25%)" />
                  {benchmarkPoint && !benchmarkIsNone && (
                    <>
                      <ReferenceLine y={benchmarkPoint.return} stroke="hsl(38,95%,40%)" strokeDasharray="3 3" />
                      <ReferenceLine x={benchmarkPoint.risk} stroke="hsl(38,95%,40%)" strokeDasharray="3 3" />
                    </>
                  )}
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const p: PlottedPoint = payload[0].payload;
                      return (
                        <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5">
                          <div className="text-foreground font-bold">{p.label}</div>
                          <div className="text-muted-foreground">Return: <span className="text-foreground">{fmt(p.return)}%</span></div>
                          <div className="text-muted-foreground">Risk: <span className="text-foreground">{fmt(p.risk)}%</span></div>
                          <div className="text-muted-foreground">Sharpe: <span className="text-[hsl(38,95%,55%)]">{fmt(p.sharpe)}x</span></div>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={singlePoints} shape={pointShape("hsl(186,80%,55%)")} />
                  <Scatter data={portfolioPoints} shape={pointShape("hsl(38,95%,55%)")} />
                  {benchmarkPoint && <Scatter data={[benchmarkPoint]} shape={pointShape("hsl(0,80%,60%)")} />}
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="font-terminal text-[7.5px] text-muted-foreground/70 flex items-start gap-1.5">
              <Info className="w-3 h-3 shrink-0 mt-0.5" />
              <span>
                Circles = individual stocks/funds, diamonds = custom portfolios (weighted, correlation-aware), red diamond = benchmark.
                Dashed lines mark the benchmark's own risk/return, splitting the chart into four quadrants (upper-left = beating the benchmark on both dimensions).
                Benchmarks here are plain price indices, not total-return/dividend-reinvested (TRI) series — this app has no TRI data source. No zoom/pan on this chart yet, just axis auto-scaling.
              </span>
            </div>

            <div>
              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">RANKED BY SHARPE RATIO</div>
              <div className="border border-border">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-[#070707]">
                      <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">LABEL</th>
                      <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">TYPE</th>
                      <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">RETURN</th>
                      <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">RISK</th>
                      <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">SHARPE</th>
                      <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">VS BENCHMARK RETURN</th>
                      <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">OBS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={row.id} className="border-b border-border/30 last:border-b-0">
                        <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{row.label}</td>
                        <td className="px-3 py-2 font-terminal text-[8.5px] text-muted-foreground uppercase">{row.kind}</td>
                        <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(row.return)}%</td>
                        <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(row.risk)}%</td>
                        <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right text-[hsl(38,95%,55%)] font-bold">{fmt(row.sharpe)}x</td>
                        <td className={`px-3 py-2 font-terminal text-[9px] tabular-nums text-right ${row.kind === "benchmark" ? "text-muted-foreground" : (row.return - (benchmarkPoint?.return ?? 0)) >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                          {row.kind === "benchmark" || !benchmarkPoint ? "—" : `${(row.return - benchmarkPoint.return) >= 0 ? "+" : ""}${fmt(row.return - benchmarkPoint.return)}%`}
                        </td>
                        <td className="px-3 py-2 font-terminal text-[8.5px] tabular-nums text-right text-muted-foreground">{row.n || "—"}</td>
                      </tr>
                    ))}
                    {!tableRows.length && (
                      <tr><td colSpan={7} className="py-4 text-center font-terminal text-[9px] text-muted-foreground">No plottable data points yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
