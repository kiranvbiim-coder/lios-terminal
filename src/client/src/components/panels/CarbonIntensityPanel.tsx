import { useState, useMemo } from "react";
import { Thermometer } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useOwidCountries, useOwidCountrySeries } from "@/lib/useOwid";
import { computeDescriptiveStats, zScoreSeries } from "@/lib/statistics";
import { olsRegression } from "@/lib/quantModels";

function fmt(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(digits)}${suffix}`;
}

export default function CarbonIntensityPanel() {
  const { data: countries, isLoading: countriesLoading } = useOwidCountries();
  const [iso3, setIso3] = useState("USA");
  const { data: series, isLoading } = useOwidCountrySeries(iso3);

  // Only years with real (non-null) CO2 figures.
  const history = useMemo(() => (series?.history ?? []).filter((r) => r.co2 !== null), [series]);
  const recent = useMemo(() => history.filter((r) => r.year >= 1980), [history]); // modern-era window, avoids thin early-20th-century reporting

  const co2Stats = useMemo(() => {
    if (!recent.length) return null;
    return computeDescriptiveStats(recent.map((r) => r.co2 as number));
  }, [recent]);

  const co2Z = useMemo(() => {
    if (!recent.length) return [];
    const zs = zScoreSeries(recent.map((r) => r.co2 as number));
    return recent.map((r, i) => ({ year: r.year, z: zs[i] ?? 0 }));
  }, [recent]);
  const currentZ = co2Z.length ? co2Z[co2Z.length - 1].z : null;

  // Real OLS trend regression on the modeled warming contribution --
  // slope * 10 = warming rate per decade attributable to this country's
  // cumulative CO2, the same regression-on-time technique NOAA/NASA use to
  // report a "warming rate," just applied to OWID's per-country series.
  const warmingTrend = useMemo(() => {
    const withTemp = history.filter((r) => r.tempChangeFromCo2 !== null && r.year >= 1980);
    if (withTemp.length < 10) return null;
    const y = withTemp.map((r) => r.tempChangeFromCo2 as number);
    const x = withTemp.map((r) => r.year);
    const reg = olsRegression(y, [x]);
    return { ...reg, ratePerDecade: reg.betas[0] * 10, chartData: withTemp.map((r) => ({ year: r.year, temp: r.tempChangeFromCo2 })) };
  }, [history]);

  const latest = history.length ? history[history.length - 1] : null;
  const carbonIntensitySeries = useMemo(() => recent.filter((r) => r.co2PerGdp !== null).map((r) => ({ year: r.year, intensity: r.co2PerGdp })), [recent]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <Thermometer className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">CARBON INTENSITY &amp; CLIMATE TREND — OUR WORLD IN DATA</span>
        <span className="font-terminal text-[7px] text-[hsl(142,71%,50%)] tracking-widest border border-[hsl(142,71%,30%)]/40 px-1.5 py-0.5">OFFICIAL · NO KEY</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">CARB</span>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#060606] shrink-0 flex-wrap">
        <span className="font-terminal text-[8px] text-muted-foreground">COUNTRY</span>
        {countriesLoading ? (
          <Skeleton className="h-7 w-40 bg-border" />
        ) : (
          <select
            value={iso3}
            onChange={(e) => setIso3(e.target.value)}
            className="bg-[#0a0a0a] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none min-w-[200px]"
          >
            {(countries ?? []).map((c) => <option key={c.iso3} value={c.iso3}>{c.name.toUpperCase()}</option>)}
          </select>
        )}
      </div>

      {isLoading || !series ? (
        <div className="flex-1 flex items-center justify-center font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !series.isLive ? (
        <div className="flex-1 flex items-center justify-center font-terminal text-[9px] text-muted-foreground">NO DATA AVAILABLE FOR THIS COUNTRY.</div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-6">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "CO2 EMISSIONS", val: fmt(latest?.co2, 1, " Mt") },
              { label: "CO2 PER CAPITA", val: fmt(latest?.co2PerCapita, 2, " t") },
              { label: "SHARE OF GLOBAL CO2", val: fmt(latest?.shareGlobalCo2, 2, "%") },
              { label: "AS OF", val: String(latest?.year ?? "—") },
            ].map((k) => (
              <div key={k.label} className="border border-border bg-[#0a0a0a] p-2.5 text-center">
                <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                <div className="font-terminal text-[13px] font-bold tabular-nums text-foreground">{k.val}</div>
              </div>
            ))}
          </div>

          {/* Carbon intensity trend -- kg CO2 per $ of GDP, OWID's own computed column */}
          <section>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">CARBON INTENSITY — kg CO2 PER $ OF GDP</div>
            <div className="h-32 border border-border bg-[#0a0a0a] p-3">
              {carbonIntensitySeries.length < 2 ? (
                <div className="h-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground">NO GDP-LINKED DATA FOR THIS COUNTRY.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={carbonIntensitySeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="intensityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="year" tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                    <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [v.toFixed(3), "kg CO2 / $"]} />
                    <Area type="monotone" dataKey="intensity" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#intensityFill)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="font-terminal text-[7.5px] text-muted-foreground/70 mt-1">A falling line is real decoupling — the economy growing faster than its emissions, not just emissions falling outright.</div>
          </section>

          {/* Z-score anomaly detection on annual emissions */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-terminal text-[9px] text-muted-foreground tracking-widest">EMISSIONS Z-SCORE (SINCE 1980)</span>
              {currentZ !== null && (
                <span className={`font-terminal text-[8px] px-1.5 py-0.5 border tracking-wider ${
                  Math.abs(currentZ) >= 2 ? "text-[hsl(0,80%,60%)] border-[hsl(0,80%,60%)]/40" : "text-[hsl(142,71%,50%)] border-[hsl(142,71%,30%)]/40"
                }`}>
                  CURRENT: {currentZ >= 0 ? "+" : ""}{currentZ.toFixed(2)}σ
                </span>
              )}
            </div>
            {co2Stats && (
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[
                  { label: "MEAN", val: fmt(co2Stats.mean, 1, " Mt") },
                  { label: "STD DEV", val: fmt(co2Stats.stdDev, 1, " Mt") },
                  { label: "MIN", val: fmt(co2Stats.min, 1, " Mt") },
                  { label: "MAX", val: fmt(co2Stats.max, 1, " Mt") },
                ].map((k) => (
                  <div key={k.label} className="border border-border bg-[#0a0a0a] p-2 text-center">
                    <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                    <div className="font-terminal text-[11px] font-bold tabular-nums text-foreground">{k.val}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="h-28 border border-border bg-[#0a0a0a] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={co2Z} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="year" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                  <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={30} />
                  <ReferenceLine y={0} stroke="hsl(0,0%,30%)" />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(2)}σ`, "Z-Score"]} />
                  <Area type="monotone" dataKey="z" stroke="hsl(199,89%,55%)" strokeWidth={1.5} fill="hsl(199,89%,55%)" fillOpacity={0.15} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Warming trend regression */}
          <section>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">
              WARMING CONTRIBUTION TREND — OLS REGRESSION ON YEAR
            </div>
            {!warmingTrend ? (
              <div className="border border-border bg-[#0a0a0a] p-3 font-terminal text-[9px] text-muted-foreground">NOT ENOUGH MODELED TEMPERATURE DATA FOR THIS COUNTRY.</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: "RATE PER DECADE", val: `${warmingTrend.ratePerDecade >= 0 ? "+" : ""}${warmingTrend.ratePerDecade.toFixed(4)}°C` },
                    { label: "R-SQUARED", val: warmingTrend.rSquared.toFixed(3) },
                    { label: "SINCE", val: "1980" },
                  ].map((k) => (
                    <div key={k.label} className="border border-border bg-[#0a0a0a] p-2.5 text-center">
                      <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                      <div className="font-terminal text-[13px] font-bold tabular-nums text-[hsl(38,95%,55%)]">{k.val}</div>
                    </div>
                  ))}
                </div>
                <div className="h-28 border border-border bg-[#0a0a0a] p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={warmingTrend.chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <XAxis dataKey="year" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                      <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}°`} />
                      <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(3)}°C`, "Modeled Warming"]} />
                      <Area type="monotone" dataKey="temp" stroke="hsl(0,80%,60%)" strokeWidth={1.5} fill="hsl(0,80%,60%)" fillOpacity={0.12} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">
          Our World in Data / Global Carbon Project — official, free, no key required. Descriptive stats, z-score anomaly detection, and OLS trend regression use the same functions as Finance's CAPM/risk panels.
        </span>
      </div>
    </div>
  );
}
