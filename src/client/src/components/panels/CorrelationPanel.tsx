import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { ResponsiveContainer, ComposedChart, Scatter, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Grid3X3, ArrowRight, Star, Info, Plus, X } from "lucide-react";
import type { OHLCVSeries } from "@/lib/finance";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  onSymbol: (sym: string) => void;
}

const DEFAULT_CORRELATION_ASSETS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "TSLA",
  "RELIANCE.NS",
  "INFY.NS",
  "TCS.NS",
  "BTC-USD",
  "ETH-USD",
  "^GSPC",
];
const MIN_CORR_ASSETS = 3;
const MAX_CORR_ASSETS = 14;

// Helper to compute Pearson correlation
function calculatePearson(x: number[], y: number[]) {
  const n = x.length;
  if (n === 0) return 0;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

// Helper to compute linear regression (y = alpha + beta * x)
function calculateRegression(x: number[], y: number[]) {
  const n = x.length;
  if (n === 0) return { alpha: 0, beta: 0, r2: 0 };

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denX = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
  }

  const beta = denX === 0 ? 0 : num / denX;
  const alpha = meanY - beta * meanX;

  // R-squared is Pearson correlation squared
  const r = calculatePearson(x, y);
  const r2 = r * r;

  return { alpha, beta, r2 };
}

export default function CorrelationPanel({ onSymbol }: Props) {
  const [assets, setAssets] = useTerminalArtifactState<string[]>("CorrelationPanel.assets", DEFAULT_CORRELATION_ASSETS);
  const [assetInput, setAssetInput] = useTerminalArtifactState("CorrelationPanel.assetInput", "");
  const [selectedA, setSelectedA] = useTerminalArtifactState("CorrelationPanel.selectedA", "AAPL");
  const [selectedB, setSelectedB] = useTerminalArtifactState("CorrelationPanel.selectedB", "^GSPC");

  const addAsset = () => {
    const t = assetInput.trim().toUpperCase();
    if (t && !assets.includes(t) && assets.length < MAX_CORR_ASSETS) {
      setAssets((prev) => [...prev, t]);
      setAssetInput("");
    }
  };
  const removeAsset = (sym: string) => {
    if (assets.length <= MIN_CORR_ASSETS) return;
    setAssets((prev) => prev.filter((a) => a !== sym));
  };

  // Keep the selected pair pointing at assets still in the basket -- removing
  // one shouldn't leave the regression panel referencing a deleted symbol.
  useEffect(() => {
    if (!assets.includes(selectedA)) setSelectedA(assets[0]);
    if (!assets.includes(selectedB)) setSelectedB(assets[1] ?? assets[0]);
  }, [assets, selectedA, selectedB]);

  // Load historical data for all assets in parallel
  const results = useQueries({
    queries: assets.map((symbol) => ({
      queryKey: ["/api/finance/ohlcv", symbol, "1Y", "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol, range: "1Y", interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to fetch ${symbol}`);
        return res.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60000,
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const hasError = results.some((r) => r.isError);

  // Compute daily returns mapped by date
  const returnsData = useMemo(() => {
    if (isLoading || hasError) return null;

    const returnsByAsset: Record<string, Map<string, number>> = {};
    assets.forEach((symbol, index) => {
      const bars = results[index].data?.bars || [];
      const returnsMap = new Map<string, number>();

      for (let i = 1; i < bars.length; i++) {
        const prev = bars[i - 1].close;
        const curr = bars[i].close;
        if (prev > 0) {
          const ret = (curr - prev) / prev;
          const dateStr = bars[i].date.split("T")[0];
          returnsMap.set(dateStr, ret);
        }
      }
      returnsByAsset[symbol] = returnsMap;
    });

    return returnsByAsset;
  }, [results, isLoading, hasError]);

  // Compute correlation matrix and scatter series
  const correlationMatrix = useMemo(() => {
    if (!returnsData) return null;

    const matrix: Record<string, Record<string, number>> = {};
    assets.forEach((a) => {
      matrix[a] = {};
      assets.forEach((b) => {
        const returnsA = returnsData[a];
        const returnsB = returnsData[b];

        // Find common dates
        const commonDates: string[] = [];
        returnsA.forEach((_, date) => {
          if (returnsB.has(date)) commonDates.push(date);
        });

        const x = commonDates.map((d) => returnsA.get(d)!);
        const y = commonDates.map((d) => returnsB.get(d)!);

        matrix[a][b] = calculatePearson(x, y);
      });
    });

    return matrix;
  }, [returnsData]);

  // Compute scatter plot series for selected pair
  const regressionDetails = useMemo(() => {
    if (!returnsData || !returnsData[selectedA] || !returnsData[selectedB]) return null;

    const returnsA = returnsData[selectedA];
    const returnsB = returnsData[selectedB];

    const commonDates: string[] = [];
    returnsA.forEach((_, date) => {
      if (returnsB.has(date)) commonDates.push(date);
    });

    const x = commonDates.map((d) => returnsA.get(d)!);
    const y = commonDates.map((d) => returnsB.get(d)!);

    const scatterData = commonDates.map((date) => ({
      date,
      x: returnsA.get(date)! * 100, // format as percentage
      y: returnsB.get(date)! * 100, // format as percentage
    }));

    // Regression stats (using percentages)
    const xPct = x.map((v) => v * 100);
    const yPct = y.map((v) => v * 100);
    const { alpha, beta, r2 } = calculateRegression(xPct, yPct);

    // Generate trend line points
    const minX = Math.min(...xPct, -2);
    const maxX = Math.max(...xPct, 2);
    const trendLine = [
      { x: minX, y: alpha + beta * minX },
      { x: maxX, y: alpha + beta * maxX },
    ];

    const correlation = calculatePearson(x, y);

    return {
      scatterData,
      trendLine,
      alpha,
      beta,
      r2,
      correlation,
    };
  }, [returnsData, selectedA, selectedB]);

  if (isLoading) {
    return (
      <div className="h-full p-4 space-y-4 bg-[#050505] flex flex-col justify-center animate-pulse">
        <Skeleton className="h-8 w-1/3 bg-border" />
        <div className="grid grid-cols-2 gap-4 flex-1">
          <Skeleton className="h-full bg-border" />
          <Skeleton className="h-full bg-border" />
        </div>
      </div>
    );
  }

  const getCellBg = (r: number) => {
    if (r > 0.05) {
      return { backgroundColor: `rgba(34,197,94,${r * 0.4})`, color: "hsl(142,71%,45%)" };
    }
    if (r < -0.05) {
      return { backgroundColor: `rgba(239,68,68,${Math.abs(r) * 0.4})`, color: "hsl(0,80%,55%)" };
    }
    return { backgroundColor: "transparent", color: "#888" };
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* Title Header Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <Grid3X3 className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">CROSS-ASSET RELATION MATRIX</span>
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={assetInput}
            onChange={(e) => setAssetInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && addAsset()}
            disabled={assets.length >= MAX_CORR_ASSETS}
            placeholder={assets.length >= MAX_CORR_ASSETS ? `MAX ${MAX_CORR_ASSETS} ASSETS` : "ADD TICKER…"}
            className="w-28 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40"
          />
          <button
            onClick={addAsset}
            disabled={assets.length >= MAX_CORR_ASSETS}
            className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-2.5 h-2.5" /> ADD
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {/* Left Column: Correlation Heatmap Matrix */}
        <div className="flex-1 p-4 overflow-auto scrollbar-thin border-b xl:border-b-0 xl:border-r border-border">
          <div className="mb-3 font-terminal text-[9px] tracking-widest text-muted-foreground uppercase flex items-center gap-2">
            <Info className="w-3.5 h-3.5" /> CLICK ANY CELL TO RUN RETURNS REGRESSION · HOVER A ROW LABEL TO REMOVE
          </div>

          <div className="min-w-[650px] overflow-hidden border border-border">
            {/* Header row */}
            <div className="grid border-b border-border bg-[#070707]" style={{ gridTemplateColumns: `repeat(${assets.length + 1}, minmax(0, 1fr))` }}>
              <div className="p-2 font-terminal text-[8px] font-bold text-muted-foreground text-center border-r border-border">ASSET</div>
              {assets.map((asset) => (
                <div key={asset} className="p-2 font-terminal text-[8px] font-bold text-muted-foreground text-center truncate border-r border-border last:border-r-0">
                  {asset.replace(".NS", "")}
                </div>
              ))}
            </div>

            {/* Matrix rows */}
            {assets.map((rowAsset) => (
              <div key={rowAsset} className="grid border-b border-border last:border-b-0 hover:bg-white/[1%]" style={{ gridTemplateColumns: `repeat(${assets.length + 1}, minmax(0, 1fr))` }}>
                {/* Row label */}
                <div
                  onClick={() => onSymbol(rowAsset)}
                  className="group p-2 font-terminal text-[8px] font-bold text-foreground truncate text-center border-r border-border cursor-pointer hover:underline hover:text-[hsl(38,95%,55%)] relative"
                >
                  {rowAsset.replace(".NS", "")}
                  {assets.length > MIN_CORR_ASSETS && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeAsset(rowAsset); }}
                      className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-[hsl(0,80%,55%)]"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>

                {/* Heatmap cells */}
                {assets.map((colAsset) => {
                  const r = correlationMatrix?.[rowAsset]?.[colAsset] ?? 0;
                  const isSelected = selectedA === rowAsset && selectedB === colAsset;
                  const cellStyle = getCellBg(r);

                  return (
                    <button
                      key={colAsset}
                      onClick={() => {
                        setSelectedA(rowAsset);
                        setSelectedB(colAsset);
                      }}
                      style={cellStyle}
                      className={`p-2 font-terminal text-[10px] font-semibold text-center border-r border-border last:border-r-0 font-mono transition-all tabular-nums ${
                        isSelected ? "ring-1 ring-inset ring-amber-500 font-bold bg-white/5" : ""
                      }`}
                    >
                      {r.toFixed(2)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Regression Scatter Plot and Stats */}
        <div className="w-full xl:w-[420px] bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          {/* Header */}
          <div className="px-4 py-2 border-b border-border bg-[#090909] flex items-center justify-between shrink-0 font-terminal text-[9px] tracking-widest text-muted-foreground">
            <span>PAIR ANALYSIS</span>
            <div className="flex items-center gap-1 text-foreground font-bold">
              <span>{selectedA.replace(".NS", "")}</span>
              <ArrowRight className="w-3 h-3 text-amber-500" />
              <span>{selectedB.replace(".NS", "")}</span>
            </div>
          </div>

          {/* Scatter Chart */}
          <div className="p-4 border-b border-border flex flex-col">
            <span className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-2">DAILY RETURNS SCATTER & REGRESSION</span>
            <div className="h-[220px] w-full relative">
              {regressionDetails && (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart margin={{ top: 10, right: 10, left: -25, bottom: -5 }}>
                    <CartesianGrid stroke="#111" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name={selectedA}
                      unit="%"
                      stroke="#555"
                      tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={selectedB}
                      unit="%"
                      stroke="#555"
                      tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0].payload;
                        return (
                          <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5">
                            <div className="text-muted-foreground font-bold">{pt.date}</div>
                            <div className="text-foreground">{selectedA.replace(".NS", "")} Return: {pt.x.toFixed(2)}%</div>
                            <div className="text-foreground">{selectedB.replace(".NS", "")} Return: {pt.y.toFixed(2)}%</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter name="Returns Pair" data={regressionDetails.scatterData} fill="rgba(245,158,11,0.3)" line={false} />
                    <Line
                      name="Regression Line"
                      data={regressionDetails.trendLine}
                      type="monotone"
                      dataKey="y"
                      stroke="hsl(186,80%,55%)"
                      dot={false}
                      activeDot={false}
                      strokeWidth={1.5}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Stats details */}
          <div className="p-4 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#080808] border border-border/60 p-3">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">PEARSON CORRELATION</div>
                <div className={`font-terminal text-lg font-bold font-mono ${
                  (regressionDetails?.correlation ?? 0) > 0.1 ? "text-up" :
                  (regressionDetails?.correlation ?? 0) < -0.1 ? "text-down" : "text-muted-foreground"
                }`}>
                  {regressionDetails ? (regressionDetails.correlation >= 0 ? "+" : "") + regressionDetails.correlation.toFixed(4) : "—"}
                </div>
              </div>

              <div className="bg-[#080808] border border-border/60 p-3">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">R-SQUARED (R²)</div>
                <div className="font-terminal text-lg font-bold font-mono text-foreground">
                  {regressionDetails ? regressionDetails.r2.toFixed(4) : "—"}
                </div>
                <div className="font-terminal text-[7px] text-muted-foreground mt-0.5">Variance explained</div>
              </div>
            </div>

            <div className="bg-[#080808] border border-border/60 p-3 space-y-2">
              <div className="font-terminal text-[8px] text-muted-foreground tracking-widest border-b border-border/40 pb-1">
                REGRESSION MODEL: Y = α + βX
              </div>

              <div className="flex items-center justify-between font-terminal text-[10px]">
                <span className="text-muted-foreground">BETA (SLOPE / β)</span>
                <span className="text-foreground font-mono font-bold">
                  {regressionDetails ? regressionDetails.beta.toFixed(4) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between font-terminal text-[10px]">
                <span className="text-muted-foreground">ALPHA (INTERCEPT / α)</span>
                <span className="text-foreground font-mono font-bold">
                  {regressionDetails ? regressionDetails.alpha.toFixed(4) + "%" : "—"}
                </span>
              </div>
            </div>

            <div className="text-[8px] font-terminal text-muted-foreground leading-normal flex items-start gap-1">
              <span>*</span>
              <span>
                Calculations are based on 1-year daily return series. Assets with different local market trading calendars are pairwise aligned on overlapping trading days.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
