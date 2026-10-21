import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { Sigma, Download, ArrowUpDown } from "lucide-react";
import { useOHLCV } from "@/lib/useFinance";
import { computeDescriptiveStats, computeHistogram, computeDailyReturns } from "@/lib/statistics";
import type { OHLCVBar, OHLCVSeries } from "@/lib/finance";
import { RangeSelector } from "@/components/panels/RangeSelector";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";

const RANGES = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "25Y"] as const;
type SortKey = keyof OHLCVBar | "return";
type SortDir = "asc" | "desc";

function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border bg-[#0a0a0a] p-2.5">
      <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{label}</div>
      <div className="font-terminal text-[13px] font-bold tabular-nums text-foreground">{value}</div>
      {sub && <div className="font-terminal text-[7px] text-muted-foreground/70 mt-0.5">{sub}</div>}
    </div>
  );
}

function CompareMode() {
  const [tickerInput, setTickerInput] = useTerminalArtifactState("CompareMode.tickerInput", "AAPL,MSFT,GOOGL,AMZN");
  const [symbols, setSymbols] = useTerminalArtifactState("CompareMode.symbols", tickerInput.split(",").map((s) => s.trim().toUpperCase()));
  const [range, setRange] = useTerminalArtifactState("CompareMode.range", "1Y");

  const results = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["/api/finance/ohlcv", symbol, range, "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol, range, interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to fetch ${symbol}`);
        return res.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60000,
    })),
  });
  const isLoading = results.some((r) => r.isLoading);

  const rows = useMemo(() => {
    if (isLoading) return [];
    return symbols.map((symbol, i) => {
      const bars = results[i].data?.bars ?? [];
      const returns = computeDailyReturns(bars.map((b) => b.close));
      const stats = computeDescriptiveStats(returns, 252);
      return { symbol, stats };
    });
  }, [symbols, results, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <form onSubmit={(e) => { e.preventDefault(); setSymbols(tickerInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)); }} className="flex-1 min-w-[240px]">
          <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="COMMA-SEPARATED TICKERS..." className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        </form>
        <RangeSelector ranges={RANGES} value={range} onChange={setRange} />
      </div>
      {isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : (
        <div className="border border-border overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-border bg-[#070707]">
              {["TICKER", "MEAN", "STD DEV", "SKEW", "KURTOSIS", "MIN", "MAX", "ANN. VOL", "ANN. RETURN"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-border/30 last:border-b-0 hover:bg-white/[1.5%]">
                  <td className="px-3 py-2 font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{r.symbol}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums">{fmt(r.stats.mean)}%</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums">{fmt(r.stats.stdDev)}%</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums">{r.stats.skewness !== null ? fmt(r.stats.skewness, 2) : "—"}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums">{r.stats.kurtosis !== null ? fmt(r.stats.kurtosis, 2) : "—"}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-[hsl(0,80%,60%)]">{fmt(r.stats.min)}%</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-[hsl(142,71%,55%)]">{fmt(r.stats.max)}%</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums font-bold">{r.stats.annualizedVol !== null ? `${fmt(r.stats.annualizedVol)}%` : "—"}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums font-bold">{r.stats.annualizedReturn !== null ? `${fmt(r.stats.annualizedReturn)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DataStatsExplorerPanel({ symbol: initialSymbol }: { symbol?: string }) {
  const [mode, setMode] = useTerminalArtifactState<"single" | "compare">("DataStatsExplorerPanel.mode", "single");
  const [input, setInput] = useTerminalArtifactState("DataStatsExplorerPanel.input", initialSymbol || "AAPL");
  const [symbol, setSymbol] = useState(initialSymbol || "AAPL");
  const [range, setRange] = useTerminalArtifactState("DataStatsExplorerPanel.range", "1Y");
  const [dateFilter, setDateFilter] = useTerminalArtifactState("DataStatsExplorerPanel.dateFilter", "");
  const [minAbsReturn, setMinAbsReturn] = useTerminalArtifactState("DataStatsExplorerPanel.minAbsReturn", "");
  const [sortKey, setSortKey] = useTerminalArtifactState<SortKey>("DataStatsExplorerPanel.sortKey", "date");
  const [sortDir, setSortDir] = useTerminalArtifactState<SortDir>("DataStatsExplorerPanel.sortDir", "desc");
  const [tablePage, setTablePage] = useTerminalArtifactState("DataStatsExplorerPanel.tablePage", 1);

  const { data: series, isLoading, dataUpdatedAt } = useOHLCV(symbol, range, "1d");
  const bars = series?.bars ?? [];

  const closes = useMemo(() => bars.map((b) => b.close), [bars]);
  const returns = useMemo(() => computeDailyReturns(closes), [closes]);
  const stats = useMemo(() => computeDescriptiveStats(returns, 252), [returns]);
  const histogram = useMemo(() => computeHistogram(returns, 24), [returns]);

  // Pair each bar with its return vs. the prior close (first bar has none).
  const rows = useMemo(() => {
    return bars.map((b, i) => ({
      ...b,
      return: i === 0 ? null : ((b.close - bars[i - 1].close) / bars[i - 1].close) * 100,
    }));
  }, [bars]);

  const filteredRows = useMemo(() => {
    let out = rows;
    if (dateFilter.trim()) out = out.filter((r) => r.date.includes(dateFilter.trim()));
    const threshold = parseFloat(minAbsReturn);
    if (!Number.isNaN(threshold) && threshold > 0) out = out.filter((r) => r.return !== null && Math.abs(r.return) >= threshold);
    return [...out].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, dateFilter, minAbsReturn, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const tablePageSize = 100;
  const tablePageCount = Math.max(1, Math.ceil(filteredRows.length / tablePageSize));
  const visibleRows = filteredRows.slice((tablePage - 1) * tablePageSize, tablePage * tablePageSize);
  useEffect(() => {
    setTablePage(1);
  }, [symbol, range, dateFilter, minAbsReturn, sortKey, sortDir]);

  const exportCsv = () => {
    const header = "date,open,high,low,close,volume,return_pct\n";
    const body = filteredRows.map((r) => [r.date, r.open, r.high, r.low, r.close, r.volume, r.return !== null ? r.return.toFixed(4) : ""].join(",")).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${symbol}_${range}_data.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const skewLabel = stats.skewness === null ? "—" : stats.skewness > 0.5 ? "RIGHT-SKEWED (fat upside tail)" : stats.skewness < -0.5 ? "LEFT-SKEWED (fat downside tail)" : "ROUGHLY SYMMETRIC";
  const kurtLabel = stats.kurtosis === null ? "—" : stats.kurtosis > 1 ? "FAT-TAILED SAMPLE (positive excess kurtosis)" : stats.kurtosis < -1 ? "THIN-TAILED (platykurtic)" : "NEAR-NORMAL TAILS";

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <Sigma className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">DATA & STATISTICS EXPLORER</span>
        {mode === "single" && <ProvenanceBadge compact details={{ kind: "computed", source: "/api/finance/ohlcv", method: "Descriptive statistics of observed close-to-close daily percentage returns", inputs: [symbol, range, `${stats.count} valid return observations`], timestamp: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined, logic: "Sample variance/std-dev use observed daily percentage returns. Annualized volatility = daily sample σ × √252; annualized return shown is arithmetic daily mean × 252.", limitations: ["Arithmetic annualized return is not CAGR", "Sample moments can be unstable in short windows", "Tail labels summarize the observed sample and are not distribution guarantees"] }} />}
        <div className="flex border border-border ml-3">
          <button onClick={() => setMode("single")} className={`px-2 py-1 font-terminal text-[8px] tracking-wider border-r border-border ${mode === "single" ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>SINGLE</button>
          <button onClick={() => setMode("compare")} className={`px-2 py-1 font-terminal text-[8px] tracking-wider ${mode === "compare" ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>COMPARE</button>
        </div>
        {mode === "single" && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); setSymbol(input.toUpperCase()); }} className="ml-1 flex items-center gap-1.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                placeholder="TICKER..."
                className="bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-24 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
              />
            </form>
            <RangeSelector ranges={RANGES} value={range} onChange={setRange} />
          </>
        )}
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">STAT</span>
      </div>

      {mode === "compare" ? (
        <CompareMode />
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !bars.length ? (
        <div className="flex-1 flex items-center justify-center font-terminal text-[9px] text-muted-foreground">NO DATA AVAILABLE FOR {symbol}.</div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">
          {/* Descriptive statistics grid */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">
              DESCRIPTIVE STATISTICS — DAILY RETURNS ({stats.count} OBSERVATIONS)
            </div>
            <div className="grid grid-cols-4 md:grid-cols-6 gap-1.5">
              <StatCell label="MEAN" value={`${fmt(stats.mean)}%`} />
              <StatCell label="MEDIAN" value={`${fmt(stats.median)}%`} />
              <StatCell label="STD DEV" value={`${fmt(stats.stdDev)}%`} />
              <StatCell label="VARIANCE (%²)" value={fmt(stats.variance, 3)} sub="daily return variance" />
              <StatCell label="SKEWNESS" value={stats.skewness !== null ? fmt(stats.skewness, 3) : "—"} />
              <StatCell label="KURTOSIS (EXCESS)" value={stats.kurtosis !== null ? fmt(stats.kurtosis, 3) : "—"} />
              <StatCell label="MIN" value={`${fmt(stats.min)}%`} />
              <StatCell label="MAX" value={`${fmt(stats.max)}%`} />
              <StatCell label="P5 / P95" value={`${fmt(stats.p5)}% / ${fmt(stats.p95)}%`} />
              <StatCell label="P25 / P75" value={`${fmt(stats.p25)}% / ${fmt(stats.p75)}%`} />
              <StatCell label="ANNUALIZED VOL" value={stats.annualizedVol !== null ? `${fmt(stats.annualizedVol)}%` : "—"} sub="σ × √252" />
              <StatCell label="ANNUALIZED RETURN" value={stats.annualizedReturn !== null ? `${fmt(stats.annualizedReturn)}%` : "—"} sub="mean × 252" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <div className="border border-border bg-[#0a0a0a] p-2 font-terminal text-[8px] text-muted-foreground">
                <span className="text-foreground">SHAPE:</span> {skewLabel}
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2 font-terminal text-[8px] text-muted-foreground">
                <span className="text-foreground">TAILS:</span> {kurtLabel}
              </div>
            </div>
          </div>

          {/* Return distribution histogram */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">RETURN DISTRIBUTION</div>
            <div className="h-44 border border-border bg-[#0a0a0a] p-3 flex items-end gap-[2px]">
              {(() => {
                const maxCount = Math.max(...histogram.map((h) => h.count), 1);
                return histogram.map((h, i) => {
                  const isMeanBucket = stats.mean >= h.from && stats.mean < h.to;
                  return (
                    <div key={i} className="flex-1 h-full flex flex-col justify-end items-center group relative">
                      <div
                        className={`w-full transition-all ${isMeanBucket ? "bg-[hsl(38,95%,55%)]" : "bg-[hsl(38,60%,35%)] group-hover:bg-[hsl(38,70%,42%)]"}`}
                        style={{ height: `${Math.max(h.count > 0 ? 2 : 0, (h.count / maxCount) * 100)}%` }}
                        title={`${h.from.toFixed(2)}% to ${h.to.toFixed(2)}%: ${h.count} days`}
                      />
                    </div>
                  );
                });
              })()}
            </div>
            <div className="flex justify-between mt-1 font-terminal text-[6.5px] text-muted-foreground/70">
              <span>{fmt(stats.min)}%</span>
              <span>MEAN {fmt(stats.mean)}%</span>
              <span>{fmt(stats.max)}%</span>
            </div>
          </div>

          {/* Raw data table with filtering + export */}
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest">RAW OHLCV DATA</div>
              <div className="flex items-center gap-2">
                <input
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  placeholder="FILTER DATE (E.G. 2026-06)..."
                  className="bg-transparent border border-border px-2 py-1 font-terminal text-[8px] text-foreground w-40 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                />
                <input
                  value={minAbsReturn}
                  onChange={(e) => setMinAbsReturn(e.target.value)}
                  placeholder="MIN |RETURN| %..."
                  className="bg-transparent border border-border px-2 py-1 font-terminal text-[8px] text-foreground w-32 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                />
                <button onClick={exportCsv} className="flex items-center gap-1 px-2 py-1 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground transition-colors">
                  <Download className="w-3 h-3" /> CSV
                </button>
              </div>
            </div>
            <div className="border border-border max-h-80 overflow-y-auto scrollbar-thin">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-[#070707] z-10">
                  <tr className="border-b border-border">
                    {([["date", "DATE"], ["open", "OPEN"], ["high", "HIGH"], ["low", "LOW"], ["close", "CLOSE"], ["volume", "VOLUME"], ["return", "RETURN %"]] as [SortKey, string][]).map(([key, label]) => (
                      <th key={key} onClick={() => toggleSort(key)} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider cursor-pointer hover:text-foreground select-none">
                        <span className="flex items-center gap-1">{label} {sortKey === key && <ArrowUpDown className="w-2.5 h-2.5" />}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.date} className="border-b border-border/30 hover:bg-white/[1.5%]">
                      <td className="px-3 py-1.5 font-terminal text-[9px] tabular-nums text-muted-foreground">{r.date}</td>
                      <td className="px-3 py-1.5 font-terminal text-[9px] tabular-nums">{fmt(r.open)}</td>
                      <td className="px-3 py-1.5 font-terminal text-[9px] tabular-nums">{fmt(r.high)}</td>
                      <td className="px-3 py-1.5 font-terminal text-[9px] tabular-nums">{fmt(r.low)}</td>
                      <td className="px-3 py-1.5 font-terminal text-[9px] tabular-nums font-bold">{fmt(r.close)}</td>
                      <td className="px-3 py-1.5 font-terminal text-[9px] tabular-nums text-muted-foreground">{r.volume.toLocaleString()}</td>
                      <td className={`px-3 py-1.5 font-terminal text-[9px] tabular-nums font-bold ${r.return === null ? "text-muted-foreground" : r.return >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                        {r.return === null ? "—" : `${r.return >= 0 ? "+" : ""}${fmt(r.return)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredRows.length && <div className="p-4 font-terminal text-[9px] text-muted-foreground text-center">NO ROWS MATCH THE CURRENT FILTER.</div>}
            </div>
            <div className="mt-1 flex items-center justify-between font-terminal text-[7.5px] text-muted-foreground/70">
              <span>{filteredRows.length} of {rows.length} rows match filters · showing {visibleRows.length}</span>
              {tablePageCount > 1 && (
                <span className="flex items-center gap-1">
                  <button type="button" disabled={tablePage === 1} onClick={() => setTablePage((value) => Math.max(1, value - 1))} className="border border-border px-2 py-1 disabled:opacity-30">PREV</button>
                  <span>PAGE {tablePage}/{tablePageCount}</span>
                  <button type="button" disabled={tablePage >= tablePageCount} onClick={() => setTablePage((value) => Math.min(tablePageCount, value + 1))} className="border border-border px-2 py-1 disabled:opacity-30">NEXT</button>
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
