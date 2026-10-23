import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { Calculator } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useDomainIndicators, useDomainIndicatorDetail, type FredDomain } from "@/lib/useEconomics";
import { computeDescriptiveStats } from "@/lib/statistics";
import { zScoreSeries } from "@/lib/statistics";
import { olsRegression, rollingCorrelation } from "@/lib/quantModels";

const DOMAINS: { value: FredDomain; label: string }[] = [
  { value: "economics_policy", label: "ECONOMICS & FISCAL" },
  { value: "supply_chain", label: "SUPPLY CHAIN & TRADE" },
  { value: "environment_sustainability", label: "ENVIRONMENT" },
  { value: "tourism_hospitality", label: "TOURISM" },
];

function fmt(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : v.toFixed(digits);
}

// Inner-join two {date,value} series on matching date strings, preserving order.
function alignByDate(a: { date: string; value: number }[], b: { date: string; value: number }[]) {
  const bMap = new Map(b.map((r) => [r.date, r.value]));
  const alignedA: number[] = [];
  const alignedB: number[] = [];
  const dates: string[] = [];
  for (const row of a) {
    if (bMap.has(row.date)) {
      alignedA.push(row.value);
      alignedB.push(bMap.get(row.date)!);
      dates.push(row.date);
    }
  }
  return { dates, alignedA, alignedB };
}

export default function IndicatorWorkbenchPanel() {
  const [domain, setDomain] = useTerminalArtifactState<FredDomain>("IndicatorWorkbenchPanel.domain", "economics_policy");
  const { data: catalog } = useDomainIndicators(domain);

  const [seriesACode, setSeriesACode] = useTerminalArtifactState("IndicatorWorkbenchPanel.seriesACode", "");
  const [seriesBCode, setSeriesBCode] = useTerminalArtifactState("IndicatorWorkbenchPanel.seriesBCode", "");

  const activeA = seriesACode || catalog?.[0]?.seriesId || "";
  const activeB = seriesBCode || catalog?.[1]?.seriesId || catalog?.[0]?.seriesId || "";

  const { data: detailA, isLoading: loadingA } = useDomainIndicatorDetail(domain, activeA);
  const { data: detailB, isLoading: loadingB } = useDomainIndicatorDetail(domain, activeB);

  const stats = useMemo(() => {
    if (!detailA?.history.length) return null;
    return computeDescriptiveStats(detailA.history.map((h) => h.value));
  }, [detailA]);

  const zSeries = useMemo(() => {
    if (!detailA?.history.length) return [];
    const zs = zScoreSeries(detailA.history.map((h) => h.value));
    return detailA.history.map((h, i) => ({ date: h.date, z: zs[i] ?? 0 }));
  }, [detailA]);

  const currentZ = zSeries.length ? zSeries[zSeries.length - 1].z : null;

  const regression = useMemo(() => {
    if (!detailA?.history.length || !detailB?.history.length || activeA === activeB) return null;
    const { dates, alignedA, alignedB } = alignByDate(detailA.history, detailB.history);
    if (dates.length < 5) return null;
    const reg = olsRegression(alignedA, [alignedB]);
    const rollCorr = rollingCorrelation(alignedA, alignedB, Math.min(12, Math.max(3, Math.floor(dates.length / 3))));
    const chartData = dates.map((d, i) => ({ date: d, a: alignedA[i], b: alignedB[i], corr: rollCorr[i] }));
    return { ...reg, n: dates.length, chartData };
  }, [detailA, detailB, activeA, activeB]);

  const nameA = catalog?.find((c) => c.seriesId === activeA)?.name ?? activeA;
  const nameB = catalog?.find((c) => c.seriesId === activeB)?.name ?? activeB;

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <Calculator className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">INDICATOR STATS &amp; REGRESSION WORKBENCH</span>
        <span className="font-terminal text-[7px] text-[hsl(142,71%,50%)] tracking-widest border border-[hsl(142,71%,30%)]/40 px-1.5 py-0.5">REAL CALCS · SAME LIB AS CAPM</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">IWKB</span>
      </div>

      <div className="flex border-b border-border bg-[#060606] shrink-0 overflow-x-auto scrollbar-thin">
        {DOMAINS.map((d) => (
          <button
            key={d.value}
            onClick={() => { setDomain(d.value); setSeriesACode(""); setSeriesBCode(""); }}
            className={`px-3 py-2 font-terminal text-[8px] tracking-wider whitespace-nowrap border-r border-border/50 ${
              domain === d.value ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-[#060606] shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="font-terminal text-[8px] text-muted-foreground">SERIES A</span>
          <select
            value={activeA}
            onChange={(e) => setSeriesACode(e.target.value)}
            className="bg-[#0a0a0a] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none min-w-[220px]"
          >
            {(catalog ?? []).map((i) => <option key={i.seriesId} value={i.seriesId}>{i.name.toUpperCase()}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-terminal text-[8px] text-muted-foreground">SERIES B (REGRESSOR)</span>
          <select
            value={activeB}
            onChange={(e) => setSeriesBCode(e.target.value)}
            className="bg-[#0a0a0a] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none min-w-[220px]"
          >
            {(catalog ?? []).map((i) => <option key={i.seriesId} value={i.seriesId}>{i.name.toUpperCase()}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {loadingA || !detailA ? (
          <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
        ) : (
          <>
            {/* Descriptive stats -- same computeDescriptiveStats() used for finance returns, applied here to a raw indicator series. */}
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">DESCRIPTIVE STATISTICS — {nameA.toUpperCase()}</div>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-5">
              {stats && [
                { label: "MEAN", val: fmt(stats.mean) },
                { label: "MEDIAN", val: fmt(stats.median) },
                { label: "STD DEV", val: fmt(stats.stdDev) },
                { label: "VARIANCE", val: fmt(stats.variance) },
                { label: "MIN", val: fmt(stats.min) },
                { label: "MAX", val: fmt(stats.max) },
                { label: "SKEWNESS", val: fmt(stats.skewness) },
                { label: "KURTOSIS", val: fmt(stats.kurtosis) },
              ].map((k) => (
                <div key={k.label} className="border border-border bg-[#0a0a0a] p-2 text-center">
                  <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                  <div className="font-terminal text-[11px] font-bold tabular-nums text-foreground">{k.val}</div>
                </div>
              ))}
            </div>

            {/* Z-score anomaly detection */}
            <div className="flex items-center gap-2 mb-2">
              <span className="font-terminal text-[9px] text-muted-foreground tracking-widest">Z-SCORE ANOMALY DETECTION</span>
              {currentZ !== null && (
                <span className={`font-terminal text-[8px] px-1.5 py-0.5 border tracking-wider ${
                  Math.abs(currentZ) >= 2 ? "text-[hsl(0,80%,60%)] border-[hsl(0,80%,60%)]/40" : "text-[hsl(142,71%,50%)] border-[hsl(142,71%,30%)]/40"
                }`}>
                  CURRENT: {currentZ >= 0 ? "+" : ""}{currentZ.toFixed(2)}σ {Math.abs(currentZ) >= 2 ? "— ANOMALOUS" : "— NORMAL RANGE"}
                </span>
              )}
            </div>
            <div className="h-32 border border-border bg-[#0a0a0a] p-3 mb-5">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={zSeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                  <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={30} />
                  <ReferenceLine y={2} stroke="hsl(0,80%,50%)" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <ReferenceLine y={-2} stroke="hsl(0,80%,50%)" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <ReferenceLine y={0} stroke="hsl(0,0%,30%)" />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(2)}σ`, "Z-Score"]} />
                  <Bar dataKey="z">
                    {zSeries.map((row, i) => (
                      <Cell key={i} fill={Math.abs(row.z) >= 2 ? "hsl(0,80%,55%)" : "hsl(38,95%,55%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* OLS regression against Series B */}
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">
              OLS REGRESSION — {nameA.toUpperCase()} = α + β · {nameB.toUpperCase()}
            </div>
            {loadingB ? (
              <div className="font-terminal text-[9px] text-muted-foreground mb-5">LOADING SERIES B...</div>
            ) : !regression ? (
              <div className="border border-border bg-[#0a0a0a] p-3 mb-5 font-terminal text-[9px] text-muted-foreground">
                {activeA === activeB ? "SELECT A DIFFERENT SERIES B TO REGRESS AGAINST." : "NOT ENOUGH OVERLAPPING DATES BETWEEN THE TWO SERIES."}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    { label: "ALPHA (α)", val: fmt(regression.alpha) },
                    { label: "BETA (β)", val: fmt(regression.betas[0]) },
                    { label: "R-SQUARED", val: fmt(regression.rSquared) },
                    { label: "RESIDUAL STD DEV", val: fmt(regression.residualStdDev) },
                  ].map((k) => (
                    <div key={k.label} className="border border-border bg-[#0a0a0a] p-2.5 text-center">
                      <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                      <div className="font-terminal text-[13px] font-bold tabular-nums text-[hsl(38,95%,55%)]">{k.val}</div>
                    </div>
                  ))}
                </div>
                <div className="font-terminal text-[8px] text-muted-foreground mb-2">
                  n = {regression.n} overlapping observations · ROLLING CORRELATION (WINDOW-ADAPTIVE)
                </div>
                <div className="h-28 border border-border bg-[#0a0a0a] p-3 mb-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={regression.chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="corrFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(199,89%,55%)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="hsl(199,89%,55%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                      <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={30} domain={[-1, 1]} />
                      <ReferenceLine y={0} stroke="hsl(0,0%,30%)" />
                      <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [v === null ? "—" : v.toFixed(2), "Correlation"]} />
                      <Area type="monotone" dataKey="corr" stroke="hsl(199,89%,55%)" strokeWidth={1.5} fill="url(#corrFill)" dot={false} connectNulls />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">
          Descriptive stats, z-score anomaly detection, and OLS regression use the exact same functions (statistics.ts / quantModels.ts) as the Finance domain's CAPM and factor-model panels — applied here to raw FRED indicator series instead of asset returns.
        </span>
      </div>
    </div>
  );
}
