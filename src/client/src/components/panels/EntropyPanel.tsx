import { useState, useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Brain, ArrowRightLeft, Info, Activity } from "lucide-react";
import { useOHLCV } from "@/lib/useFinance";
import { useQueries } from "@tanstack/react-query";
import type { OHLCVSeries } from "@/lib/finance";
import { Skeleton } from "@/components/ui/skeleton";
import { ConceptExplainer } from "./ConceptExplainer";

// helper to calculate Shannon Entropy
function calculateShannonEntropy(returns: number[], numBins = 10): { entropy: number; normalized: number; bins: number[] } {
  if (returns.length === 0) return { entropy: 0, normalized: 0, bins: [] };

  const min = Math.min(...returns);
  const max = Math.max(...returns);
  const range = max - min;
  const binWidth = range === 0 ? 0.01 : range / numBins;

  const counts = Array(numBins).fill(0);
  returns.forEach((r) => {
    const binIdx = Math.min(numBins - 1, Math.floor((r - min) / binWidth));
    counts[binIdx]++;
  });

  let entropy = 0;
  counts.forEach((c) => {
    const p = c / returns.length;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  });

  const maxEntropy = Math.log2(numBins);
  const normalized = maxEntropy > 0 ? entropy / maxEntropy : 0;

  return { entropy, normalized, bins: counts };
}

// helper to calculate Approximate Entropy (ApEn)
// ApEn measures the regularity/predictability of a sequence
function calculateApEn(data: number[], m = 2, r = 0.2): number {
  const N = data.length;
  if (N < m + 2) return 0;

  // Compute standard deviation of data to scale the tolerance r
  const mean = data.reduce((s, v) => s + v, 0) / N;
  const variance = data.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (N - 1);
  const stdDev = Math.sqrt(variance);
  const R = r * stdDev;

  const phi = (dim: number) => {
    const patterns = [];
    for (let i = 0; i <= N - dim; i++) {
      patterns.push(data.slice(i, i + dim));
    }

    const C = [];
    for (let i = 0; i < patterns.length; i++) {
      let count = 0;
      for (let j = 0; j < patterns.length; j++) {
        // Distance is max absolute difference
        let match = true;
        for (let k = 0; k < dim; k++) {
          if (Math.abs(patterns[i][k] - patterns[j][k]) > R) {
            match = false;
            break;
          }
        }
        if (match) count++;
      }
      C.push(count / patterns.length);
    }

    const logSum = C.reduce((s, c) => s + Math.log(c), 0);
    return logSum / patterns.length;
  };

  try {
    // ApEn = Phi(m) - Phi(m + 1)
    const phiM = phi(m);
    const phiMPlus1 = phi(m + 1);
    return Math.abs(phiM - phiMPlus1);
  } catch {
    return 0.15; // default fallback
  }
}

// helper to calculate directed Transfer Entropy between two returns vectors
function calculateTransferEntropy(x: number[], y: number[]): { xToY: number; yToX: number } {
  // Discretize returns into binary state (1 for Up, 0 for Down)
  const N = Math.min(x.length, y.length);
  if (N < 50) return { xToY: 0, yToX: 0 };

  const bx = x.map((r) => (r >= 0 ? 1 : 0));
  const by = y.map((r) => (r >= 0 ? 1 : 0));

  // Count joint frequencies for:
  // p(y_t+1, y_t, x_t) and conditional versions
  // States are represented as binary keys e.g. "y_t1,y_t,x_t" => "1,1,0"
  const counts: Record<string, number> = {};
  const condY: Record<string, number> = {}; // y_t
  const condYX: Record<string, number> = {}; // y_t, x_t
  
  let total = 0;

  for (let t = 0; t < N - 1; t++) {
    const xt = bx[t];
    const yt = by[t];
    const yt1 = by[t + 1];

    const key = `${yt1},${yt},${xt}`;
    const keyY = `${yt1},${yt}`;
    const keyYX = `${yt},${xt}`;

    counts[key] = (counts[key] || 0) + 1;
    condY[keyY] = (condY[keyY] || 0) + 1;
    condYX[keyYX] = (condYX[keyYX] || 0) + 1;
    total++;
  }

  // T(X->Y) = sum( p(yt1, yt, xt) * log2( p(yt1 | yt, xt) / p(yt1 | yt) ) )
  // p(yt1 | yt, xt) = p(yt1, yt, xt) / p(yt, xt)
  // p(yt1 | yt) = p(yt1, yt) / p(yt)
  let xToY = 0;
  Object.keys(counts).forEach((key) => {
    const [yt1, yt, xt] = key.split(",").map(Number);
    const pJoint = counts[key] / total;
    
    // cond probabilities
    const cYX = condYX[`${yt},${xt}`] || 0;
    const pCondYX = cYX > 0 ? counts[key] / cYX : 0;

    const cY = condY[`${yt1},${yt}`] || 0;
    // Marginal sum p(yt)
    let sumY = 0;
    Object.keys(condY).forEach((kY) => {
      if (kY.endsWith(`,${yt}`)) sumY += condY[kY];
    });
    const pCondY = sumY > 0 ? cY / sumY : 0;

    if (pCondYX > 0 && pCondY > 0) {
      xToY += pJoint * Math.log2(pCondYX / pCondY);
    }
  });

  // Simple mirror estimate for Y->X
  let yToX = 0;
  const countsR: Record<string, number> = {};
  const condXR: Record<string, number> = {};
  const condXYR: Record<string, number> = {};
  let totalR = 0;

  for (let t = 0; t < N - 1; t++) {
    const xt = bx[t];
    const yt = by[t];
    const xt1 = bx[t + 1];

    const key = `${xt1},${xt},${yt}`;
    const keyX = `${xt1},${xt}`;
    const keyXY = `${xt},${yt}`;

    countsR[key] = (countsR[key] || 0) + 1;
    condXR[keyX] = (condXR[keyX] || 0) + 1;
    condXYR[keyXY] = (condXYR[keyXY] || 0) + 1;
    totalR++;
  }

  Object.keys(countsR).forEach((key) => {
    const [xt1, xt, yt] = key.split(",").map(Number);
    const pJoint = countsR[key] / totalR;
    
    const cXY = condXYR[`${xt},${yt}`] || 0;
    const pCondXY = cXY > 0 ? countsR[key] / cXY : 0;

    const cX = condXR[`${xt1},${xt}`] || 0;
    let sumX = 0;
    Object.keys(condXR).forEach((kX) => {
      if (kX.endsWith(`,${xt}`)) sumX += condXR[kX];
    });
    const pCondX = sumX > 0 ? cX / sumX : 0;

    if (pCondXY > 0 && pCondX > 0) {
      yToX += pJoint * Math.log2(pCondXY / pCondX);
    }
  });

  return { xToY, yToX };
}

export default function EntropyPanel({ symbol }: { symbol: string }) {
  const [partnerAsset, setPartnerAsset] = useState("BTC-USD");

  // Fetch target active asset ohlcv
  const { data: primaryData, isLoading: isPrimaryLoading } = useOHLCV(symbol, "1Y", "1d");

  // Fetch comparator partner asset ohlcv
  const { data: partnerData, isLoading: isPartnerLoading } = useOHLCV(partnerAsset, "1Y", "1d");

  const results = useMemo(() => {
    if (isPrimaryLoading || isPartnerLoading || !primaryData?.bars || !partnerData?.bars) return null;

    const closesX = primaryData.bars.map((b) => b.close);
    const returnsX: number[] = [];
    for (let i = 1; i < closesX.length; i++) {
      returnsX.push((closesX[i] - closesX[i - 1]) / closesX[i - 1]);
    }

    const closesY = partnerData.bars.map((b) => b.close);
    const returnsY: number[] = [];
    for (let i = 1; i < closesY.length; i++) {
      returnsY.push((closesY[i] - closesY[i - 1]) / closesY[i - 1]);
    }

    // 1. Shannon returns entropy of primary asset
    const shannon = calculateShannonEntropy(returnsX, 10);
    // Format bin frequencies for Recharts bar chart
    const entropyChartData = shannon.bins.map((count, idx) => ({
      bin: idx + 1,
      count,
    }));

    // 2. Approximate Entropy (ApEn) of primary asset
    const apen = calculateApEn(returnsX.slice(-100), 2, 0.2); // use last 100 days for performance

    // 3. Transfer Entropy between primary asset and partner asset
    const te = calculateTransferEntropy(returnsX, returnsY);

    // net information transfer
    const leads = te.xToY > te.yToX;
    const strength = Math.abs(te.xToY - te.yToX);

    return {
      shannonNorm: shannon.normalized,
      apen,
      te,
      leads,
      strength,
      entropyChartData,
    };
  }, [primaryData, partnerData, isPrimaryLoading, isPartnerLoading]);

  if (isPrimaryLoading || isPartnerLoading || !results) {
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
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-[hsl(38,95%,55%)] animate-pulse" />
          <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">INFORMATION ENTROPY & LEAD-LAG SOLVER</span>
          <span className="font-terminal text-[10px] text-foreground font-bold">{symbol}</span>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="font-terminal text-[9px] text-muted-foreground">LEAD-LAG PARTNER:</span>
          <select
            value={partnerAsset}
            onChange={(e) => setPartnerAsset(e.target.value)}
            className="bg-black border border-border rounded px-1.5 py-0.5 font-terminal text-[8px] text-foreground font-bold"
          >
            <option value="AAPL">AAPL</option>
            <option value="MSFT">MSFT</option>
            <option value="RELIANCE.NS">RELIANCE</option>
            <option value="INFY.NS">INFOSYS</option>
            <option value="BTC-USD">BITCOIN</option>
          </select>
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {/* Left Column: Return Bin Frequencies Chart */}
        <div className="flex-1 p-4 flex flex-col overflow-hidden border-b xl:border-b-0 xl:border-r border-border">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase block mb-2">
            RETURN DENSITY ENTROPY HISTOGRAM (10 BINS DISCRETIZATION)
          </span>

          <div className="flex-1 min-h-[220px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={results.entropyChartData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid stroke="#111" />
                <XAxis dataKey="bin" stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
                <YAxis stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.02)" }}
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload;
                    return (
                      <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5 font-mono">
                        <div>Return Bin #{pt.bin}</div>
                        <div className="text-amber-500 font-bold">Frequencies: {pt.count} days</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" fill="rgba(245,158,11,0.3)" stroke="hsl(38,95%,55%)" strokeWidth={1} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Calculations & Interpretations */}
        <div className="w-full xl:w-80 border-l border-border bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          <div className="p-4 flex-1 space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">INFORMATION STATISTICS</span>
            </div>

            <div className="space-y-2.5">
              {/* Shannon Entropy box */}
              <div className="bg-[#080808] border border-border/60 p-3">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">SHANNON ENTROPY (NORMALIZED)</div>
                <div className="font-terminal text-lg font-bold font-mono text-foreground">
                  {results.shannonNorm.toFixed(4)}
                </div>
                <div className="font-terminal text-[7.5px] text-muted-foreground mt-1 uppercase">
                  {results.shannonNorm > 0.85
                    ? "✓ HIGH CHAOS (STOCHASTIC RANDOM WALK)"
                    : "✓ STRUCTURED REGIME (POTENTIAL TRENDS)"
                  }
                </div>
              </div>

              {/* Approximate Entropy box */}
              <div className="bg-[#080808] border border-border/60 p-3">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest mb-1">APPROXIMATE ENTROPY (APEN)</div>
                <div className="font-terminal text-lg font-bold font-mono text-foreground">
                  {results.apen.toFixed(4)}
                </div>
                <div className="font-terminal text-[7.5px] text-muted-foreground mt-1 uppercase">
                  * Low values signify strong pattern repetition/regularity.
                </div>
              </div>

              {/* Transfer Entropy lead-lag box */}
              <div className="bg-[#080808] border border-border/60 p-3 space-y-2">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">DIRECTED INFORMATION TRANSFER</div>
                
                <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                  <ArrowRightLeft className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div className="font-terminal text-[10px] leading-tight">
                    {results.leads ? (
                      <div>
                        <span className="text-emerald-500 font-bold">{symbol.replace(".NS", "")}</span> leads{" "}
                        <span className="text-foreground">{partnerAsset.replace(".NS", "")}</span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-emerald-500 font-bold">{partnerAsset.replace(".NS", "")}</span> leads{" "}
                        <span className="text-foreground">{symbol.replace(".NS", "")}</span>
                      </div>
                    )}
                    <span className="text-[7.5px] text-muted-foreground font-mono block">
                      Information Gain: {results.strength.toFixed(5)} bits
                    </span>
                  </div>
                </div>

                <div className="font-mono text-[8.5px] text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>T({symbol.replace(".NS", "")} → {partnerAsset.replace(".NS", "")}):</span>
                    <span>{results.te.xToY.toFixed(5)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>T({partnerAsset.replace(".NS", "")} → {symbol.replace(".NS", "")}):</span>
                    <span>{results.te.yToX.toFixed(5)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Explanation box */}
            <ConceptExplainer title="INFORMATION THEORY NOTE">
              <p>
                <strong>Shannon Entropy:</strong> Measures uncertainty. A value of 1.0 represents complete market efficiency (white noise), where returns are uniformly distributed.
              </p>
              <p>
                <strong>Transfer Entropy:</strong> A directed information-theoretic measure. If \(T(A \to B) &gt; T(B \to A)\), it proves that historic returns of A contain predictive information about B above and beyond what is contained in B's own history.
              </p>
            </ConceptExplainer>
          </div>
        </div>
      </div>
    </div>
  );
}
