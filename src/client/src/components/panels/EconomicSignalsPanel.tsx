import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { Gauge } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useIndicatorDetail } from "@/lib/useEconomics";
import { useBlsSeries } from "@/lib/useBls";
import { olsRegression } from "@/lib/quantModels";

function fmt(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

// Sahm Rule (Sahm 2019): a real-time recession trigger. 3-month moving
// average of the unemployment rate, minus that average's own trailing
// 12-month low. A reading >= 0.5 has historically always coincided with
// the start of a recession.
function computeSahmRule(unrate: { date: string; value: number }[]) {
  const ma3: (number | null)[] = unrate.map((_, i) =>
    i < 2 ? null : (unrate[i].value + unrate[i - 1].value + unrate[i - 2].value) / 3,
  );
  return unrate.map((row, i) => {
    const v = ma3[i];
    if (v === null) return { date: row.date, sahm: null as number | null };
    const windowStart = Math.max(0, i - 11);
    const window = ma3.slice(windowStart, i + 1).filter((x): x is number => x !== null);
    return { date: row.date, sahm: window.length ? v - Math.min(...window) : null };
  });
}

// Okun's Law (Okun 1962): real GDP growth above/below trend moves the
// unemployment rate in the opposite direction. Classic first-difference
// regression: Δunemployment = a + b * (real GDP growth, QoQ annualized).
function computeOkunsLaw(gdp: { date: string; value: number }[], unrateByDate: Map<string, number>) {
  const growth: number[] = [];
  const deltaU: number[] = [];
  const dates: string[] = [];
  for (let i = 1; i < gdp.length; i++) {
    const prevU = unrateByDate.get(gdp[i - 1].date);
    const curU = unrateByDate.get(gdp[i].date);
    if (prevU === undefined || curU === undefined) continue;
    const g = (Math.pow(gdp[i].value / gdp[i - 1].value, 4) - 1) * 100; // QoQ annualized
    growth.push(g);
    deltaU.push(curU - prevU);
    dates.push(gdp[i].date);
  }
  if (growth.length < 6) return null;
  const reg = olsRegression(deltaU, [growth]);
  return { ...reg, n: growth.length, chartData: dates.map((d, i) => ({ date: d, growth: growth[i], deltaU: deltaU[i] })) };
}

export default function EconomicSignalsPanel() {
  const { data: unrateDetail, isLoading: unrateLoading } = useIndicatorDetail("UNRATE");
  const { data: gdpDetail, isLoading: gdpLoading } = useIndicatorDetail("GDPC1");
  const { data: cpiDetail, isLoading: cpiLoading } = useIndicatorDetail("CPIAUCSL");
  const { data: wageGrowth } = useBlsSeries("CES0500000003");

  // Taylor Rule inputs -- textbook defaults, user-adjustable, same pattern
  // as the WACC builder in Finance's ValuationPanel: real Fed/BLS data in,
  // clearly-labeled policy assumptions adjustable, not hidden as if fetched.
  const [neutralRealRate, setNeutralRealRate] = useTerminalArtifactState("EconomicSignalsPanel.neutralRealRate", 2.0);
  const [targetInflation, setTargetInflation] = useTerminalArtifactState("EconomicSignalsPanel.targetInflation", 2.0);
  const [naturalUnemployment, setNaturalUnemployment] = useTerminalArtifactState("EconomicSignalsPanel.naturalUnemployment", 4.4);

  const sahmSeries = useMemo(() => {
    if (!unrateDetail?.history.length) return [];
    return computeSahmRule(unrateDetail.history);
  }, [unrateDetail]);
  const currentSahm = [...sahmSeries].reverse().find((r) => r.sahm !== null)?.sahm ?? null;

  const okun = useMemo(() => {
    if (!gdpDetail?.history.length || !unrateDetail?.history.length) return null;
    const unrateByDate = new Map(unrateDetail.history.map((r) => [r.date, r.value]));
    return computeOkunsLaw(gdpDetail.history, unrateByDate);
  }, [gdpDetail, unrateDetail]);

  const currentInflation = useMemo(() => {
    if (!cpiDetail?.history.length) return null;
    const h = cpiDetail.history;
    const latest = h[h.length - 1];
    const yearAgo = h.find((r) => r.date === shiftMonths(latest.date, -12));
    if (!yearAgo) return null;
    return ((latest.value / yearAgo.value) - 1) * 100;
  }, [cpiDetail]);

  const currentUnrate = unrateDetail?.history.length ? unrateDetail.history[unrateDetail.history.length - 1].value : null;

  const taylorRate = useMemo(() => {
    if (currentInflation === null || currentUnrate === null) return null;
    const outputGap = -2 * (currentUnrate - naturalUnemployment); // Okun rule-of-thumb: 1pt unemployment gap ~ 2pt output gap
    return neutralRealRate + currentInflation + 0.5 * (currentInflation - targetInflation) + 0.5 * outputGap;
  }, [currentInflation, currentUnrate, neutralRealRate, targetInflation, naturalUnemployment]);

  const isLoading = unrateLoading || gdpLoading || cpiLoading;

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <Gauge className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">ECONOMIC SIGNALS — SAHM RULE · OKUN&apos;S LAW · TAYLOR RULE</span>
        <span className="font-terminal text-[7px] text-[hsl(142,71%,50%)] tracking-widest border border-[hsl(142,71%,30%)]/40 px-1.5 py-0.5">FRED + BLS · NO KEY</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">ESIG</span>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-6">
          {/* ── Sahm Rule ─────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-terminal text-[9px] text-muted-foreground tracking-widest">SAHM RULE — REAL-TIME RECESSION TRIGGER</span>
              {currentSahm !== null && (
                <span className={`font-terminal text-[8px] px-1.5 py-0.5 border tracking-wider ${
                  currentSahm >= 0.5 ? "text-[hsl(0,80%,60%)] border-[hsl(0,80%,60%)]/40" : "text-[hsl(142,71%,50%)] border-[hsl(142,71%,30%)]/40"
                }`}>
                  {fmt(currentSahm)}pp {currentSahm >= 0.5 ? "— TRIGGERED" : "— BELOW THRESHOLD"}
                </span>
              )}
            </div>
            <div className="font-terminal text-[7.5px] text-muted-foreground/70 mb-2">
              Sahm = (3-month avg. unemployment rate) − (its own trailing-12-month low). A reading ≥ 0.50 has, historically, always coincided with a recession's start.
            </div>
            <div className="h-32 border border-border bg-[#0a0a0a] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sahmSeries.filter((r) => r.sahm !== null)} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={50} />
                  <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={30} />
                  <ReferenceLine y={0.5} stroke="hsl(0,80%,50%)" strokeDasharray="3 3" strokeOpacity={0.6} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(2)}pp`, "Sahm"]} />
                  <Bar dataKey="sahm">
                    {sahmSeries.filter((r) => r.sahm !== null).map((row, i) => (
                      <Cell key={i} fill={(row.sahm ?? 0) >= 0.5 ? "hsl(0,80%,55%)" : "hsl(38,95%,55%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ── Okun's Law ────────────────────────────────────────────── */}
          <section>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">
              OKUN&apos;S LAW — Δ UNEMPLOYMENT = α + β · REAL GDP GROWTH (QoQ ANNUALIZED)
            </div>
            {!okun ? (
              <div className="border border-border bg-[#0a0a0a] p-3 font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING QUARTERLY DATA.</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: "OKUN COEFFICIENT (β)", val: fmt(okun.betas[0], 3) },
                    { label: "R-SQUARED", val: fmt(okun.rSquared, 3) },
                    { label: "N (QUARTERS)", val: String(okun.n) },
                  ].map((k) => (
                    <div key={k.label} className="border border-border bg-[#0a0a0a] p-2.5 text-center">
                      <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                      <div className="font-terminal text-[13px] font-bold tabular-nums text-[hsl(38,95%,55%)]">{k.val}</div>
                    </div>
                  ))}
                </div>
                <div className="font-terminal text-[7.5px] text-muted-foreground/70 mb-2">
                  β is normally negative: faster GDP growth is associated with a falling unemployment rate. Textbook estimates cluster around −0.3 to −0.5.
                </div>
                <div className="h-28 border border-border bg-[#0a0a0a] p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={okun.chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={50} />
                      <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={35} />
                      <ReferenceLine y={0} stroke="hsl(0,0%,30%)" />
                      <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number, name: string) => [`${v.toFixed(2)}${name === "growth" ? "% GDP growth" : "pp Δ unemployment"}`, name === "growth" ? "GDP Growth" : "Δ Unemployment"]} />
                      <Area type="monotone" dataKey="growth" stroke="hsl(199,89%,55%)" strokeWidth={1.5} fill="hsl(199,89%,55%)" fillOpacity={0.12} dot={false} />
                      <Area type="monotone" dataKey="deltaU" stroke="hsl(0,80%,60%)" strokeWidth={1.5} fill="hsl(0,80%,60%)" fillOpacity={0.08} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </section>

          {/* ── Taylor Rule ───────────────────────────────────────────── */}
          <section>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">
              TAYLOR RULE — IMPLIED POLICY RATE
            </div>
            <div className="font-terminal text-[7.5px] text-muted-foreground/70 mb-3">
              i = r* + π + 0.5·(π − π*) + 0.5·(output gap), output gap approximated via Okun&apos;s rule-of-thumb from the unemployment gap. r*, π*, and the natural rate below are standard textbook policy assumptions — adjust them, the calculation re-runs on real CPI/UNRATE data.
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: "NEUTRAL REAL RATE r* (%)", val: neutralRealRate, set: setNeutralRealRate },
                { label: "INFLATION TARGET π* (%)", val: targetInflation, set: setTargetInflation },
                { label: "NATURAL UNEMPLOYMENT (%)", val: naturalUnemployment, set: setNaturalUnemployment },
              ].map((f) => (
                <div key={f.label} className="border border-border bg-[#0a0a0a] p-2">
                  <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest mb-1">{f.label}</div>
                  <input
                    type="number" step={0.1} value={f.val}
                    onChange={(e) => f.set(parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent font-terminal text-[12px] text-foreground focus:outline-none"
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "CURRENT INFLATION (CPI YoY)", val: fmt(currentInflation, 2, "%") },
                { label: "CURRENT UNEMPLOYMENT", val: fmt(currentUnrate, 2, "%") },
                { label: "WAGE GROWTH (AVG HRLY EARNINGS)", val: wageGrowth?.history.length ? fmt(wageGrowth.history[wageGrowth.history.length - 1].value, 2, "/hr") : "—" },
                { label: "TAYLOR RULE IMPLIED RATE", val: fmt(taylorRate, 2, "%") },
              ].map((k) => (
                <div key={k.label} className="border border-border bg-[#0a0a0a] p-2.5 text-center">
                  <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                  <div className="font-terminal text-[13px] font-bold tabular-nums text-[hsl(38,95%,55%)]">{k.val}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">
          Real FRED (UNRATE, GDPC1, CPIAUCSL) and BLS (CES0500000003) data feeding real, named macro formulas — same calculation discipline as Finance's CAPM/WACC panels.
        </span>
      </div>
    </div>
  );
}

function shiftMonths(dateStr: string, months: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}-01`;
}
