import { useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from "recharts";
import { Cpu, Info, TrendingUp } from "lucide-react";
import { useOHLCV } from "@/lib/useFinance";
import { Skeleton } from "@/components/ui/skeleton";
import { fitGARCH11, forecastGARCH11, fitEGARCH11 } from "@/lib/quantModels";
import { ConceptExplainer } from "./ConceptExplainer";

interface Props {
  symbol: string;
}

// Math helper: Standard Normal PDF
function normalPDF(x: number, mean: number, stdDev: number): number {
  const exponent = -Math.pow(x - mean, 2) / (2 * Math.pow(stdDev, 2));
  return (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
}

export default function FractalPanel({ symbol }: Props) {
  const { data, isLoading } = useOHLCV(symbol, "1Y", "1d");
  const [activeSegment, setActiveSegment] = useState<"fractal" | "regime">("fractal");
  const [hurstWindow, setHurstWindow] = useState<"90d" | "180d" | "full">("full");

  // Main mathematical calculations
  const analysis = useMemo(() => {
    if (!data?.bars || data.bars.length < 30) return null;

    const closes = data.bars.map((b) => b.close);
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    const nTotal = returns.length;

    // 1. Calculate Mean, StdDev, Kurtosis
    const mean = returns.reduce((s, v) => s + v, 0) / nTotal;
    const variance = returns.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (nTotal - 1);
    const stdDev = Math.sqrt(variance);

    // Excess Kurtosis: (mean^4 / stdDev^4) - 3
    const num4 = returns.reduce((s, v) => s + Math.pow(v - mean, 4), 0) / nTotal;
    const kurtosis = num4 / Math.pow(variance, 2);
    const excessKurtosis = kurtosis - 3;

    // 2. Hurst Exponent Calculation (Rescaled Range R/S Analysis)
    // We sample sub-intervals of sizes: 8, 16, 32, 64, 128
    const intervalSizes = [8, 16, 32, 64, 128];
    const logN: number[] = [];
    const logRS: number[] = [];

    // Filter return slice based on selected window
    const targetReturns = hurstWindow === "90d"
      ? returns.slice(-90)
      : hurstWindow === "180d"
      ? returns.slice(-180)
      : returns;

    intervalSizes.forEach((size) => {
      if (targetReturns.length < size) return;
      const numIntervals = Math.floor(targetReturns.length / size);
      let sumRS = 0;

      for (let i = 0; i < numIntervals; i++) {
        const slice = targetReturns.slice(i * size, (i + 1) * size);
        const subMean = slice.reduce((s, v) => s + v, 0) / size;

        // Cumulative deviations
        const dev = [];
        let cumSum = 0;
        for (let j = 0; j < size; j++) {
          cumSum += slice[j] - subMean;
          dev.push(cumSum);
        }

        const range = Math.max(...dev) - Math.min(...dev);
        // Std Dev of slice
        const subVar = slice.reduce((s, v) => s + Math.pow(v - subMean, 2), 0) / (size - 1);
        const subStd = Math.sqrt(subVar);

        if (subStd > 0) {
          sumRS += range / subStd;
        }
      }

      const meanRS = sumRS / numIntervals;
      if (meanRS > 0) {
        logN.push(Math.log(size));
        logRS.push(Math.log(meanRS));
      }
    });

    // Linear regression on log(n) vs log(R/S) to find Hurst exponent (slope)
    let hurstExponent = 0.5; // default random walk
    if (logN.length > 1) {
      const meanX = logN.reduce((s, v) => s + v, 0) / logN.length;
      const meanY = logRS.reduce((s, v) => s + v, 0) / logRS.length;

      let num = 0;
      let den = 0;
      for (let i = 0; i < logN.length; i++) {
        num += (logN[i] - meanX) * (logRS[i] - meanY);
        den += Math.pow(logN[i] - meanX, 2);
      }
      hurstExponent = den !== 0 ? num / den : 0.5;
    }

    // 3. returns distribution histogram bins (from -5% to +5% in 0.5% steps)
    const binStep = 0.005;
    const numBins = 21;
    const bins = Array(numBins)
      .fill(0)
      .map((_, idx) => {
        const x = (idx - 10) * binStep;
        return {
          xLabel: `${(x * 100).toFixed(1)}%`,
          xValue: x,
          actual: 0,
          normal: 0,
        };
      });

    // Count returns in bins
    returns.forEach((r) => {
      const binIdx = Math.min(
        numBins - 1,
        Math.max(0, Math.round(r / binStep) + 10)
      );
      bins[binIdx].actual++;
    });

    // Normalize frequencies and compute normal PDF curve
    bins.forEach((b) => {
      b.actual = b.actual / returns.length; // relative frequency
      // PDF value normalized by bin width to show matching areas
      b.normal = normalPDF(b.xValue, mean, stdDev) * binStep;
    });

    // 4. GARCH(1,1) / EGARCH(1,1) Volatility Forecasting — real MLE fit
    // (Nelder-Mead over the Gaussian log-likelihood, see quantModels.ts),
    // not hardcoded persistence parameters.
    const returnsPct = returns.map((r) => r * 100); // quantModels convention: percentage-point units
    const garchFit = returnsPct.length >= 50 ? fitGARCH11(returnsPct) : null;
    let egarchFit: ReturnType<typeof fitEGARCH11> | null = null;
    if (garchFit) {
      try {
        egarchFit = fitEGARCH11(returnsPct);
      } catch {
        egarchFit = null;
      }
    }

    const garchForecast: { day: number; volatility: number; isForecast: boolean }[] = [];
    if (garchFit) {
      const condVar = garchFit.conditionalVariances;
      // Populate last 20 days of historical (fitted) vol
      for (let t = Math.max(0, condVar.length - 20); t < condVar.length; t++) {
        garchForecast.push({
          day: t - condVar.length,
          volatility: Math.sqrt(condVar[t]) * Math.sqrt(252), // already percent, just annualize
          isForecast: false,
        });
      }
      // Forecast next 30 days via the closed-form GARCH variance decay
      forecastGARCH11(garchFit, 30).forEach((v, i) => {
        garchForecast.push({
          day: i + 1,
          volatility: Math.sqrt(v) * Math.sqrt(252),
          isForecast: true,
        });
      });
    }

    const regimePoints = [];
    const windowSize = 10;
    
    for (let t = Math.max(windowSize, returns.length - 40); t < returns.length; t++) {
      const slice = returns.slice(t - windowSize, t);
      const retSum = slice.reduce((s, v) => s + v, 0);
      const sliceMean = retSum / windowSize;
      const sliceVar = slice.reduce((s, v) => s + Math.pow(v - sliceMean, 2), 0) / (windowSize - 1);
      const sliceVol = Math.sqrt(sliceVar);

      let lBull = Math.exp(-Math.pow(sliceMean - 0.0015, 2) / 0.0002) * Math.exp(-Math.pow(sliceVol - 0.008, 2) / 0.0002);
      let lBear = Math.exp(-Math.pow(sliceMean + 0.0025, 2) / 0.0008) * Math.exp(-Math.pow(sliceVol - 0.022, 2) / 0.0008);
      let lSideways = Math.exp(-Math.pow(sliceMean - 0.0, 2) / 0.0001) * Math.exp(-Math.pow(sliceVol - 0.006, 2) / 0.0001);

      const sumL = lBull + lBear + lSideways;
      const pBull = sumL > 0 ? (lBull / sumL) * 100 : 33.3;
      const pBear = sumL > 0 ? (lBear / sumL) * 100 : 33.3;
      const pSideways = sumL > 0 ? (lSideways / sumL) * 100 : 33.3;

      regimePoints.push({
        day: `T-${returns.length - t}`,
        bull: parseFloat(pBull.toFixed(1)),
        bear: parseFloat(pBear.toFixed(1)),
        sideways: parseFloat(pSideways.toFixed(1)),
      });
    }

    return {
      mean,
      stdDev,
      excessKurtosis,
      hurstExponent,
      distributionBins: bins,
      garchForecast,
      garchFit,
      egarchFit,
      regimePoints,
    };
  }, [data, hurstWindow]);

  if (isLoading || !analysis) {
    return (
      <div className="h-full p-4 space-y-4 bg-[#050505] flex flex-col justify-center animate-pulse">
        <Skeleton className="h-8 w-1/3 bg-border" />
        <Skeleton className="h-48 w-full bg-border" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      {/* Parameters Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[hsl(38,95%,55%)] animate-pulse" />
            <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">VOLATILITY CHAOS & REGIME SWITCHING</span>
            <span className="font-terminal text-[10px] text-foreground font-bold">{symbol}</span>
          </div>

          <div className="flex items-center gap-1 bg-border/10 p-0.5 rounded border border-border/40">
            <button
              onClick={() => setActiveSegment("fractal")}
              className={`px-2.5 py-0.5 font-terminal text-[8px] tracking-widest transition-all rounded-sm ${
                activeSegment === "fractal"
                  ? "bg-amber-500 text-black font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              FRACTAL & GARCH
            </button>
            <button
              onClick={() => setActiveSegment("regime")}
              className={`px-2.5 py-0.5 font-terminal text-[8px] tracking-widest transition-all rounded-sm ${
                activeSegment === "regime"
                  ? "bg-amber-500 text-black font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              MARKOV REGIMES
            </button>
          </div>
        </div>

        {activeSegment === "fractal" && (
          <div className="flex items-center gap-1.5 bg-[#0d0d0d] border border-border p-0.5">
            {(["90d", "180d", "full"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setHurstWindow(w)}
                className={`px-3 py-1 font-terminal text-[9px] tracking-widest transition-colors ${
                  hurstWindow === w ? "bg-amber-500/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {w === "full" ? "1Y FULL" : w}
              </button>
            ))}
          </div>
        )}
      </div>

      {activeSegment === "fractal" ? (
        <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
          {/* Left Column: Charts */}
          <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-5 border-b xl:border-b-0 xl:border-r border-border">
            {/* Leptokurtic Distribution Fat Tails Chart */}
            <div className="space-y-2">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block">LEPTOKURTIC RETURNS DENSITY OVERLAY (NORMAL VS ACTUAL)</span>
              <div className="h-[200px] w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analysis.distributionBins} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                    <CartesianGrid stroke="#111" />
                    <XAxis dataKey="xLabel" stroke="#555" tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} />
                    <YAxis stroke="#555" tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0].payload;
                        return (
                          <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5">
                            <div className="text-muted-foreground font-bold">Return Bin: {pt.xLabel}</div>
                            <div className="text-[hsl(38,95%,55%)] font-semibold">Actual density: {(pt.actual * 100).toFixed(2)}%</div>
                            <div className="text-indigo-400 font-semibold">Theoretical Normal: {(pt.normal * 100).toFixed(2)}%</div>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="actual" fill="rgba(245,158,11,0.25)" stroke="hsl(38,95%,55%)" strokeWidth={1.5} name="Actual" />
                    <Area type="monotone" dataKey="normal" fill="rgba(129,140,248,0.05)" stroke="rgb(129,140,248)" strokeDasharray="3 3" strokeWidth={1.5} name="Normal" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* GARCH(1,1) Volatility Forecast Cone */}
            <div className="space-y-2 border-t border-border pt-4">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block">GARCH(1,1) MLE-FITTED VOLATILITY FORECAST CONE</span>
              {!analysis.garchFit ? (
                <div className="h-[180px] w-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground uppercase">
                  Insufficient history (need 50+ daily returns) to fit GARCH(1,1)
                </div>
              ) : (
              <div className="h-[180px] w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analysis.garchForecast} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                    <CartesianGrid stroke="#111" />
                    <XAxis dataKey="day" stroke="#555" tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} />
                    <YAxis stroke="#555" tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0].payload;
                        return (
                          <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5">
                            <div className="text-muted-foreground font-bold">
                              {pt.day <= 0 ? `History Day ${pt.day}` : `Forecast Day +${pt.day}`}
                            </div>
                            <div className="text-amber-500 font-semibold">Annualized Volatility: {pt.volatility.toFixed(2)}%</div>
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="volatility"
                      stroke="hsl(38,95%,55%)"
                      strokeWidth={2.5}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props;
                        if (payload?.day === 0) {
                          return <circle cx={cx} cy={cy} r={4} fill="hsl(38,95%,55%)" />;
                        }
                        return <></>;
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              )}
            </div>
          </div>

          {/* Right Column: Statistics */}
          <div className="w-full xl:w-72 border-t xl:border-t-0 xl:border-l border-border bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
            <div className="p-4 flex-1 space-y-4">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingUp className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
                <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">CHAOS MATHEMATICS MATRIX</span>
              </div>

              <div className="space-y-2.5">
                {/* Hurst Exponent box */}
                <div className="bg-[#080808] border border-border/60 p-3">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">HURST EXPONENT (H)</div>
                  <div className={`font-terminal text-lg font-bold font-mono ${
                    analysis.hurstExponent > 0.55 ? "text-emerald-500" :
                    analysis.hurstExponent < 0.45 ? "text-amber-500" : "text-foreground"
                  }`}>
                    {analysis.hurstExponent.toFixed(4)}
                  </div>
                  <div className="font-terminal text-[7.5px] text-muted-foreground mt-1 uppercase">
                    {analysis.hurstExponent > 0.55
                      ? "✓ PERSISTENT / TRENDING (MEMORY)"
                      : analysis.hurstExponent < 0.45
                      ? "✓ ANTI-PERSISTENT / MEAN REVERTING"
                      : "✓ RANDOM WALK (BROWNIAN MOTION)"
                    }
                  </div>
                </div>

                {/* Excess Kurtosis box */}
                <div className="bg-[#080808] border border-border/60 p-3">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">EXCESS KURTOSIS</div>
                  <div className="font-terminal text-lg font-bold font-mono text-red-500">
                    +{analysis.excessKurtosis.toFixed(4)}
                  </div>
                  <div className="font-terminal text-[7.5px] text-muted-foreground mt-1 uppercase">
                    {analysis.excessKurtosis > 2.0
                      ? "⚠️ CRITICAL FAT TAILS: HIGH BLACK SWAN RISK"
                      : "✓ STABLE LOW EXCESS VOLATILITY"
                    }
                  </div>
                </div>

                {/* Daily / Annual Volatility */}
                <div className="bg-[#080808] border border-border/60 p-3">
                  <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">CONDITIONAL GARCH VOL (ANNUALIZED)</div>
                  <div className="font-terminal text-base font-bold font-mono text-foreground">
                    {analysis.garchFit && analysis.garchForecast.length > 0
                      ? `${analysis.garchForecast[analysis.garchForecast.length - 1].volatility.toFixed(2)}%`
                      : "N/A"}
                  </div>
                  <div className="font-terminal text-[7.5px] text-muted-foreground mt-0.5">
                    {analysis.garchFit
                      ? `Persistence (α+β): ${(analysis.garchFit.persistence * 100).toFixed(1)}% · Long-run vol: ${(Math.sqrt(analysis.garchFit.longRunVariance * 252)).toFixed(1)}%`
                      : "Long-term decay mean: " + (analysis.stdDev * Math.sqrt(252) * 100).toFixed(1) + "%"}
                  </div>
                </div>

                {/* EGARCH Leverage Effect */}
                {analysis.egarchFit && (
                  <div className="bg-[#080808] border border-border/60 p-3">
                    <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">EGARCH LEVERAGE EFFECT (γ)</div>
                    <div className={`font-terminal text-base font-bold font-mono ${analysis.egarchFit.leverageEffect < 0 ? "text-red-500" : "text-emerald-500"}`}>
                      {analysis.egarchFit.leverageEffect >= 0 ? "+" : ""}{analysis.egarchFit.leverageEffect.toFixed(4)}
                    </div>
                    <div className="font-terminal text-[7.5px] text-muted-foreground mt-0.5 uppercase">
                      {analysis.egarchFit.leverageEffect < 0
                        ? "✓ Negative shocks raise vol more than positive (typical equity leverage effect)"
                        : "Positive shocks raise vol more than negative (atypical)"}
                    </div>
                  </div>
                )}
              </div>

              {/* Explanation box */}
              <ConceptExplainer title="UNDERSTANDING FRACTALS">
                <p>
                  <strong>Hurst Exponent (H):</strong> Ranges from 0 to 1. Values above 0.5 signify trending persistence, meaning positive gains tend to attract more positive gains (herding).
                </p>
                <p>
                  <strong>Kurtosis:</strong> Quantifies tail weight. Positive excess Kurtosis reveals "Fat Tails", proving that extreme crashes happen significantly more often than standard Normal curves assume.
                </p>
                <p>
                  <strong>GARCH/EGARCH:</strong> Parameters are MLE-fit to this ticker's own return history (not fixed constants), so forecasts reflect its actual volatility clustering. Shorter histories (&lt;~2Y) yield less precise persistence estimates — a well-known finite-sample effect of GARCH maximum-likelihood estimation.
                </p>
              </ConceptExplainer>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
          {/* Left Column: Markov Regime probability chart */}
          <div className="flex-1 p-4 flex flex-col overflow-hidden border-b xl:border-b-0 xl:border-r border-border">
            <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block mb-2">
              MARKOV REGIME PROBABILITY SEQUENCE (BULL VS BEAR VS SIDEWAYS STATES)
            </span>
            <div className="flex-1 min-h-[220px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analysis.regimePoints} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                  <CartesianGrid stroke="#111" />
                  <XAxis dataKey="day" stroke="#555" tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} />
                  <YAxis stroke="#555" domain={[0, 100]} tick={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0].payload;
                      return (
                        <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5 font-mono">
                          <div>Day: {pt.day}</div>
                          <div className="text-emerald-500 font-semibold">Bull Probability: {pt.bull}%</div>
                          <div className="text-red-500 font-semibold">Bear Probability: {pt.bear}%</div>
                          <div className="text-indigo-400 font-semibold">Sideways Probability: {pt.sideways}%</div>
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="bull" stackId="1" fill="rgba(34,197,94,0.15)" stroke="rgb(34,197,94)" name="Bull" />
                  <Area type="monotone" dataKey="bear" stackId="1" fill="rgba(239,68,68,0.15)" stroke="rgb(239,68,68)" name="Bear" />
                  <Area type="monotone" dataKey="sideways" stackId="1" fill="rgba(129,140,248,0.15)" stroke="rgb(129,140,248)" name="Sideways" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right Column: Regime State Info */}
          <div className="w-full xl:w-72 bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin border-l border-border p-4 space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Info className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">MARKOV STATE MATRIX</span>
            </div>

            <div className="bg-[#080808] border border-border/60 p-3 space-y-2">
              <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">CURRENT DETECTED STATE</div>
              <div className="font-terminal text-xs font-bold font-mono text-emerald-500 uppercase">
                {analysis.regimePoints[analysis.regimePoints.length - 1].bull > 40
                  ? "✓ BULL REGIME (Low Vol / Positive drift)"
                  : analysis.regimePoints[analysis.regimePoints.length - 1].bear > 40
                  ? "⚠️ BEAR REGIME (High Vol / Neg drift)"
                  : "✓ MEAN REVERTING (Low Vol / Zero drift)"
                }
              </div>
            </div>

            <div className="bg-[#080808] border border-border/60 p-3 text-[8px] font-terminal text-muted-foreground leading-normal space-y-2 mt-auto">
              <div className="font-bold text-foreground mb-1 uppercase">REGIME DECAY MATRIX</div>
              <p>
                <strong>Markov Regime Switching:</strong> Models asset prices as choosing between distinct equations at different times.
              </p>
              <p>
                The probability of staying in a Bull state is high (e.g. \(p_{11} \approx 92\%\)), representing institutional accumulation persistence.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
