import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { useYieldCurve } from "@/lib/useEconomics";
import { AreaChart, Area, Line, BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid, Cell } from "recharts";
import { TrendingDown, AlertTriangle, WifiOff, Globe2 } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import { fitNelsonSiegel } from "@/lib/quantModels";
import { useLseStatus, useLseBondsCountries, useLseBondsScreen } from "@/lib/useLse";
import { parseTenorYears, formatTenorLabel } from "@/lib/bondTenor";
import { AdvancedRatesDerivativesRunner } from "@/lib/advancedRatesDerivatives";
import { ReceiptSummary, runAdvancedManual, type AdvancedReceipt } from "./advancedMacroForecastResearch";

// Tenor label -> maturity in years, for Nelson-Siegel fitting.
const MATURITY_YEARS: Record<string, number> = {
  "1M": 1 / 12, "3M": 0.25, "6M": 0.5, "1Y": 1, "2Y": 2, "3Y": 3,
  "5Y": 5, "7Y": 7, "10Y": 10, "20Y": 20, "30Y": 30,
};

interface Props { onNav: (v: ViewMode) => void; onSymbol: (s: string) => void; }

// Three real historical snapshots, fetched from FRED at the actual date --
// not approximated. Dates picked for well-documented curve shapes: the
// 2006 pre-GFC flattening, the Aug 2019 2s10s inversion, and the Oct 2022
// rate-shock peak.
const HISTORICAL_DATES: { key: string; label: string; color: string; date: string }[] = [
  { key: "gfc",   label: "2006 (Pre-GFC)",    color: "hsl(0,70%,55%)",   date: "2006-06-29" },
  { key: "covid", label: "2019 (2s10s Invert)", color: "hsl(38,95%,55%)", date: "2019-08-14" },
  { key: "shock", label: "2022 (Rate Shock)",  color: "hsl(270,70%,60%)", date: "2022-10-21" },
];

// Purely illustrative textbook shape -- not tied to any real date, kept
// distinct from the three real fetched snapshots above.
const TEXTBOOK_NORMAL = { label: "Textbook Normal (Illustrative)", color: "hsl(142,60%,45%)", data: [3.5, 3.6, 3.7, 3.8, 4.0, 4.1, 4.3, 4.5, 4.7, 4.9, 5.0] };

function findYield(curve: { label: string; yield: number | null }[] | undefined, label: string): number | null {
  return curve?.find((p) => p.label === label)?.yield ?? null;
}

// Additive: macro/yield-curve-signals wired from this panel's own already-
// labelled live FRED tenors (MATURITY_YEARS). Classified manual -- this is
// a live query, not a persisted immutable snapshot with a content hash, so
// it is honestly recorded as an analyst-reviewed manual import rather than
// fabricating a sourced hash. Only renders once the US tab has confirmed
// isLive, so a missing FRED key never silently substitutes a default.
function YieldCurveSignalsRunner({ curve }: { curve: { label: string; yield: number | null }[] }) {
  const [result, setResult] = useState<(Record<string, unknown> & { receipt?: AdvancedReceipt }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const points = curve
    .filter((p) => p.yield !== null && MATURITY_YEARS[p.label] !== undefined)
    .sort((a, b) => MATURITY_YEARS[a.label] - MATURITY_YEARS[b.label]);
  const run = async () => {
    if (points.length < 3) { setError("Live curve has fewer than three valid labelled tenors."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await runAdvancedManual("macro", "yield-curve-signals", {
        maturitiesYears: points.map((p) => MATURITY_YEARS[p.label]),
        yieldsPct: points.map((p) => p.yield as number),
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Yield curve signal unavailable."); }
    finally { setLoading(false); }
  };
  return <section className="space-y-2 border border-border p-3">
    <div className="font-terminal text-[9px] text-amber-300">YIELD-CURVE SIGNALS — LIVE LABELLED FRED TENORS</div>
    <div className="font-mono text-[7px] text-muted-foreground">{points.length} live tenors bound: {points.map((p) => p.label).join(", ") || "none"}. Manual classification -- no persisted immutable snapshot backs this live FRED query.</div>
    <button type="button" onClick={() => void run()} disabled={points.length < 3 || loading} className="border border-amber-400/40 px-3 py-1.5 font-terminal text-[8px] text-amber-300 disabled:opacity-40">{loading ? "RUNNING…" : "RUN CURVE SIGNALS FROM LIVE TENORS"}</button>
    {error && <div role="alert" className="font-mono text-[8px] text-red-300">{error}</div>}
    {result && <><pre className="max-h-36 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[7px] text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={result.receipt} /></>}
  </section>;
}

export default function YieldCurvePanel({}: Props) {
  const [tab, setTab] = useTerminalArtifactState<"us" | "global">("YieldCurvePanel.tab", "us");
  const lseStatus = useLseStatus();
  const lseConfigured = lseStatus.data?.configured ?? false;
  const bondCountries = useLseBondsCountries();
  const [globalCountry, setGlobalCountry] = useTerminalArtifactState<string>("YieldCurvePanel.globalCountry", "");
  const activeCountry = globalCountry || bondCountries.data?.[0]?.code || "";
  const bondScreen = useLseBondsScreen(tab === "global" ? activeCountry : undefined);
  const globalCurve = useMemo(() => {
    const rows = bondScreen.data ?? [];
    return rows
      .map((row) => ({ row, years: parseTenorYears(row.symbol) ?? parseTenorYears(row.name) }))
      .filter((entry): entry is { row: typeof rows[number]; years: number } => entry.years !== null && typeof entry.row.last_value === "number")
      .sort((a, b) => a.years - b.years)
      .map((entry) => ({ label: formatTenorLabel(entry.years), years: entry.years, yield: entry.row.last_value as number, symbol: entry.row.symbol, name: entry.row.name, changePct: entry.row.change_pct ?? null }));
  }, [bondScreen.data]);
  const globalCurveCountryName = bondCountries.data?.find((c) => c.code === activeCountry)?.name ?? activeCountry;

  const live = useYieldCurve();
  const gfc = useYieldCurve(HISTORICAL_DATES[0].date);
  const covid = useYieldCurve(HISTORICAL_DATES[1].date);
  const shock = useYieldCurve(HISTORICAL_DATES[2].date);
  const historicalQueries = [gfc, covid, shock];

  const curve = live.data?.curve ?? [];
  const isLive = live.data?.isLive ?? false;

  const y1m = findYield(curve, "1M");
  const y3m = findYield(curve, "3M");
  const y2y = findYield(curve, "2Y");
  const y5y = findYield(curve, "5Y");
  const y10y = findYield(curve, "10Y");
  const y30y = findYield(curve, "30Y");

  const spread2s10s = y2y !== null && y10y !== null ? y10y - y2y : null;
  const spread3m10y = y3m !== null && y10y !== null ? y10y - y3m : null;
  const spread5s30s = y5y !== null && y30y !== null ? y30y - y5y : null;
  const spread10s30s = y10y !== null && y30y !== null ? y30y - y10y : null;

  const SPREADS: { label: string; desc: string; val: number | null }[] = [
    { label: "2s10s", desc: "Classic recession indicator (inverted < 0)", val: spread2s10s },
    { label: "3m10y", desc: "Most predictive inversion signal", val: spread3m10y },
    { label: "5s30s", desc: "Curve steepness / reflation signal", val: spread5s30s },
    { label: "10s30s", desc: "Long-end steepness", val: spread10s30s },
  ];

  const isInverted = (spread2s10s ?? 0) < 0 || (spread3m10y ?? 0) < 0;

  // Nelson-Siegel: smooth 3-factor (level/slope/curvature) parametric fit
  // to the observed tenors, MLE-free (nonlinear least squares via Nelder-Mead
  // over β0,β1,β2,λ -- see quantModels.ts). Used to interpolate/smooth the
  // curve and to read off the level/slope/curvature decomposition directly.
  const nsFit = useMemo(() => {
    const points = curve
      .filter((p) => p.yield !== null && MATURITY_YEARS[p.label] !== undefined)
      .map((p) => ({ maturity: MATURITY_YEARS[p.label], yield: p.yield as number }));
    if (points.length < 4) return null;
    try {
      return fitNelsonSiegel(points);
    } catch {
      return null;
    }
  }, [curve]);

  const curveWithFit = useMemo(
    () => curve.map((p) => ({ ...p, nsFitted: nsFit && MATURITY_YEARS[p.label] !== undefined ? nsFit.fitted(MATURITY_YEARS[p.label]) : null })),
    [curve, nsFit]
  );

  const regressionRisk = useMemo(() => {
    let risk = 0;
    if (spread2s10s !== null) {
      if (spread2s10s < 0) risk += 40;
      else if (spread2s10s < 0.5) risk += 20;
    }
    if (spread3m10y !== null) {
      if (spread3m10y < 0) risk += 35;
      else if (spread3m10y < 0.3) risk += 15;
    }
    if (y10y !== null && y10y > 5) risk += 10;
    if (y3m !== null && y10y !== null && y3m > y10y) risk += 15;
    return Math.min(100, risk);
  }, [spread2s10s, spread3m10y, y10y, y3m]);

  const recColor = regressionRisk > 60 ? "text-[hsl(0,80%,60%)]" : regressionRisk > 35 ? "text-[hsl(38,95%,55%)]" : "text-[hsl(142,71%,55%)]";
  const recLabel = regressionRisk > 60 ? "ELEVATED" : regressionRisk > 35 ? "MODERATE" : "LOW";

  const fmt = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
  const fmtSpread = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);

  const tabBar = (
    <div className="flex items-center gap-px px-4 pt-2 border-b border-border bg-[#070707] shrink-0">
      <button onClick={() => setTab("us")} className={`px-3 py-1.5 font-terminal text-[9px] tracking-widest border-b-2 ${tab === "us" ? "border-[hsl(38,95%,55%)] text-[hsl(38,95%,55%)]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>US TREASURY</button>
      <button onClick={() => setTab("global")} className={`flex items-center gap-1 px-3 py-1.5 font-terminal text-[9px] tracking-widest border-b-2 ${tab === "global" ? "border-[hsl(186,80%,55%)] text-[hsl(186,80%,55%)]" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Globe2 className="w-3 h-3" /> GLOBAL ({bondCountries.data?.length ?? 0})</button>
    </div>
  );

  if (tab === "us" && !live.isLoading && !isLive) {
    return (
      <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
        {tabBar}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
          <WifiOff className="w-8 h-8 text-muted-foreground" />
          <div className="font-terminal text-[10px] tracking-widest text-muted-foreground">NO DATA — HONEST STATE, NOT A BUG</div>
          <div className="font-terminal text-[8px] text-muted-foreground/70 max-w-md leading-relaxed">
            No FRED API key configured. This panel shows real US Treasury yield data only —
            it does not fabricate values. Set FRED_API_KEY or ~/.limuria-terminal/config.json fredApiKey to enable.
            The GLOBAL tab covers 34 sovereign curves independently via London Strategic Edge.
          </div>
        </div>
      </div>
    );
  }

  if (tab === "global") {
    return (
      <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
        {tabBar}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
          <Globe2 className="w-4 h-4 text-[hsl(186,80%,55%)]" />
          <span className="panel-label">GLOBAL SOVEREIGN YIELD CURVES</span>
          <span className="font-terminal text-[7px] text-[hsl(186,80%,55%)] tracking-widest border border-[hsl(186,80%,35%)]/40 px-1.5 py-0.5">LONDON STRATEGIC EDGE</span>
          {lseConfigured && (
            <select
              value={activeCountry}
              onChange={(e) => setGlobalCountry(e.target.value)}
              className="ml-2 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none"
            >
              {(bondCountries.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          )}
          <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">YCRV · GLOBAL</span>
        </div>
        {!lseConfigured ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
            <WifiOff className="w-8 h-8 text-muted-foreground" />
            <div className="font-terminal text-[10px] tracking-widest text-muted-foreground">NO DATA — HONEST STATE, NOT A BUG</div>
            <div className="font-terminal text-[8px] text-muted-foreground/70 max-w-md leading-relaxed">
              No London Strategic Edge API key configured. This tab covers real sovereign bond
              yields across 34 countries — it does not fabricate values. Get a free key at
              londonstrategicedge.com/data and add it in the Data Connection Center.
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between">
              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest">{globalCurveCountryName.toUpperCase()} SOVEREIGN CURVE</div>
              <div className="font-terminal text-[7px] text-muted-foreground/60">{globalCurve.length} TENORS PLOTTED · {(bondScreen.data?.length ?? 0) - globalCurve.length} UNRECOGNIZED TENOR EXCLUDED</div>
            </div>
            <div className="bg-[#080808] border border-border p-3 h-52">
              {bondScreen.isLoading ? (
                <div className="h-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground">LOADING…</div>
              ) : globalCurve.length === 0 ? (
                <div className="h-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground text-center px-4">No parseable tenor-coded instruments for this country in the bonds catalog.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={globalCurve} margin={{ top: 4, right: 8, bottom: 4, left: 28 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,10%)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                    <YAxis domain={["auto", "auto"]} tickFormatter={(v) => `${v.toFixed(1)}%`} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(3)}%`, "Yield"]} contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                    <Bar dataKey="yield" name="Yield">
                      {globalCurve.map((entry) => <Cell key={entry.symbol} fill={(entry.changePct ?? 0) < 0 ? "hsl(0,80%,55%)" : "hsl(186,80%,55%)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="border border-border">
              <table className="w-full font-terminal text-[9px]">
                <thead>
                  <tr className="border-b border-border bg-[#080808] text-muted-foreground">
                    <th className="text-left p-2 tracking-widest">TENOR</th>
                    <th className="text-left p-2 tracking-widest">SYMBOL</th>
                    <th className="text-left p-2 tracking-widest">NAME</th>
                    <th className="text-right p-2 tracking-widest">YIELD</th>
                    <th className="text-right p-2 tracking-widest">1D CHG</th>
                  </tr>
                </thead>
                <tbody>
                  {globalCurve.map((entry) => (
                    <tr key={entry.symbol} className="border-b border-border/40">
                      <td className="p-2 text-foreground font-bold">{entry.label}</td>
                      <td className="p-2 text-muted-foreground">{entry.symbol}</td>
                      <td className="p-2 text-muted-foreground">{entry.name ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums text-foreground">{entry.yield.toFixed(3)}%</td>
                      <td className={`p-2 text-right tabular-nums ${(entry.changePct ?? 0) < 0 ? "text-[hsl(0,80%,60%)]" : "text-[hsl(142,71%,55%)]"}`}>{entry.changePct === null ? "—" : `${entry.changePct > 0 ? "+" : ""}${entry.changePct.toFixed(2)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      {tabBar}
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <TrendingDown className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">US TREASURY YIELD CURVE & SPREAD MONITOR</span>
        <span className="font-terminal text-[7px] text-[hsl(142,71%,50%)] tracking-widest border border-[hsl(142,71%,30%)]/40 px-1.5 py-0.5">FRED LIVE</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">YCRV</span>
      </div>

      {/* KPI Strip */}
      <div className="shrink-0 grid grid-cols-6 border-b border-border bg-[#060606]">
        {[
          { label: "1M YIELD",  val: fmt(y1m) },
          { label: "2Y YIELD",  val: fmt(y2y) },
          { label: "10Y YIELD", val: fmt(y10y) },
          { label: "30Y YIELD", val: fmt(y30y) },
          { label: "2s10s",     val: fmtSpread(spread2s10s), cls: (spread2s10s ?? 0) < 0 ? "text-[hsl(0,80%,60%)]" : "text-[hsl(142,71%,55%)]" },
          { label: "CURVE STATUS", val: isInverted ? "⚠ INVERTED" : "NORMAL", cls: isInverted ? "text-[hsl(0,80%,60%)]" : "text-[hsl(142,71%,55%)]" },
        ].map(k => (
          <div key={k.label} className="p-2 border-r border-border last:border-r-0 text-center">
            <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-0.5">{k.label}</div>
            <div className={`font-terminal text-[11px] font-bold tabular-nums ${k.cls || "text-foreground"}`}>{k.val}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main chart */}
        <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto scrollbar-thin">

          {isInverted && (
            <div className="flex items-start gap-2 bg-[hsl(0,80%,10%)] border border-[hsl(0,80%,25%)] p-2.5 text-[9px] font-terminal text-[hsl(0,80%,65%)]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>YIELD CURVE INVERSION DETECTED — Historically precedes recession by 12–24 months. 7 of last 7 US recessions were preceded by 2s10s inversion.</span>
            </div>
          )}

          {/* Live yield curve */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest">LIVE US TREASURY YIELD CURVE</div>
              <div className="font-terminal text-[7px] text-muted-foreground/60">
                {curve.find(p => p.asOf)?.asOf ? `AS OF ${curve.find(p => p.asOf)?.asOf}` : ""}
              </div>
            </div>
            <div className="bg-[#080808] border border-border p-3 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curveWithFit} margin={{ top: 4, right: 8, bottom: 4, left: 28 }}>
                  <defs>
                    <linearGradient id="yc-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="hsl(38,95%,55%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(38,95%,55%)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,10%)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                  <YAxis domain={["auto","auto"]} tickFormatter={v => `${v.toFixed(1)}%`} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number, name: string) => [`${v.toFixed(3)}%`, name === "nsFitted" ? "Nelson-Siegel Fit" : "Yield"]} contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                  <ReferenceLine y={0} stroke="hsl(0,0%,20%)" />
                  <Area type="monotone" dataKey="yield" stroke="hsl(38,95%,55%)" strokeWidth={2} fill="url(#yc-grad)" dot={{ r: 3, fill: "hsl(38,95%,55%)", strokeWidth: 0 }} name="Current" connectNulls />
                  {nsFit && (
                    <Line type="monotone" dataKey="nsFitted" stroke="hsl(200,80%,60%)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Nelson-Siegel Fit" connectNulls />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {nsFit && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 font-terminal text-[7.5px] text-muted-foreground">
                <span style={{ color: "hsl(200,80%,60%)" }}>◆ NELSON-SIEGEL FIT</span>
                <span>Level (β₀): <span className="text-foreground tabular-nums">{nsFit.beta0.toFixed(2)}%</span></span>
                <span>Slope (β₁): <span className="text-foreground tabular-nums">{nsFit.beta1.toFixed(2)}%</span></span>
                <span>Curvature (β₂): <span className="text-foreground tabular-nums">{nsFit.beta2.toFixed(2)}%</span></span>
                <span>λ (decay): <span className="text-foreground tabular-nums">{nsFit.lambda.toFixed(2)}y</span></span>
                <span>Fit RMSE: <span className="text-foreground tabular-nums">{nsFit.rmse.toFixed(3)}%</span></span>
              </div>
            )}
          </div>

          {/* Historical overlays */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">HISTORICAL CURVE COMPARISON</div>
            <div className="grid grid-cols-2 gap-3">
              {HISTORICAL_DATES.map((hist, i) => {
                const histCurve = historicalQueries[i].data?.curve ?? [];
                const hData = curve.map((p) => ({
                  label: p.label,
                  yield: findYield(histCurve, p.label),
                  current: p.yield,
                }));
                return (
                  <div key={hist.key} className="bg-[#080808] border border-border p-2.5">
                    <div className="font-terminal text-[8px] mb-1.5" style={{ color: hist.color }}>{hist.label} — {hist.date}</div>
                    <div className="h-20">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={hData} margin={{ top: 2, right: 4, bottom: 2, left: 16 }}>
                          <XAxis dataKey="label" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 6, fill: "hsl(0,0%,35%)" }} tickLine={false} axisLine={false} />
                          <YAxis domain={["auto","auto"]} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 6, fill: "hsl(0,0%,35%)" }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(0)}%`} />
                          <Area type="monotone" dataKey="yield" stroke={hist.color} strokeWidth={1.5} fill={hist.color} fillOpacity={0.08} dot={false} name={hist.label} connectNulls />
                          <Area type="monotone" dataKey="current" stroke="hsl(38,95%,55%)" strokeWidth={1} fill="none" strokeDasharray="3 2" dot={false} name="Current" connectNulls />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
              <div className="bg-[#080808] border border-border p-2.5">
                <div className="font-terminal text-[8px] mb-1.5" style={{ color: TEXTBOOK_NORMAL.color }}>{TEXTBOOK_NORMAL.label}</div>
                <div className="h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={curve.map((p, i) => ({ label: p.label, yield: TEXTBOOK_NORMAL.data[i], current: p.yield }))}
                      margin={{ top: 2, right: 4, bottom: 2, left: 16 }}
                    >
                      <XAxis dataKey="label" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 6, fill: "hsl(0,0%,35%)" }} tickLine={false} axisLine={false} />
                      <YAxis domain={["auto","auto"]} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 6, fill: "hsl(0,0%,35%)" }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(0)}%`} />
                      <Area type="monotone" dataKey="yield" stroke={TEXTBOOK_NORMAL.color} strokeWidth={1.5} fill={TEXTBOOK_NORMAL.color} fillOpacity={0.08} dot={false} name={TEXTBOOK_NORMAL.label} connectNulls />
                      <Area type="monotone" dataKey="current" stroke="hsl(38,95%,55%)" strokeWidth={1} fill="none" strokeDasharray="3 2" dot={false} name="Current" connectNulls />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
          <AdvancedRatesDerivativesRunner
            title="CURVE BOOTSTRAP · MANUAL TERMS"
            modelPaths={["fixed-income/bootstrap-par-curve"]}
          />
          <YieldCurveSignalsRunner curve={curve} />
        </div>

        {/* Right panel: spreads + recession signal */}
        <div className="w-64 shrink-0 border-l border-border bg-[#060606] p-4 space-y-4 overflow-y-auto scrollbar-thin">

          {/* Recession risk meter */}
          <div className="border border-border p-3 space-y-2">
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">RECESSION RISK GAUGE</div>
            <div className={`font-terminal text-4xl font-bold tabular-nums ${recColor}`}>{regressionRisk}%</div>
            <div className={`font-terminal text-[10px] tracking-widest ${recColor}`}>{recLabel} RISK</div>
            <div className="h-2 bg-[#111]">
              <div className="h-full transition-all duration-700" style={{ width: `${regressionRisk}%`, backgroundColor: regressionRisk > 60 ? "hsl(0,80%,55%)" : regressionRisk > 35 ? "hsl(38,95%,55%)" : "hsl(142,71%,45%)" }} />
            </div>
            <div className="font-terminal text-[7.5px] text-muted-foreground/70 leading-relaxed">Based on 2s10s, 3m10y inversion signals and absolute yield levels.</div>
          </div>

          {/* Spread table */}
          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">KEY SPREADS</div>
            {SPREADS.map((s) => {
              const isNeg = (s.val ?? 0) < 0;
              const bps = s.val !== null ? Math.round(s.val * 100) : null;
              const cls = s.val === null ? "text-muted-foreground" : isNeg ? "text-[hsl(0,80%,60%)]" : "text-[hsl(142,71%,55%)]";
              return (
                <div key={s.label} className="py-2.5 border-b border-border/40">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-terminal text-[10px] font-bold text-foreground">{s.label}</span>
                    <span className={`font-terminal text-[11px] font-bold tabular-nums ${cls}`}>{bps === null ? "—" : `${isNeg ? "" : "+"}${bps} bps`}</span>
                  </div>
                  <div className="font-terminal text-[7.5px] text-muted-foreground leading-tight">{s.desc}</div>
                  {s.val !== null && isNeg && <div className="font-terminal text-[7.5px] text-[hsl(0,80%,55%)] mt-0.5">⚠ INVERTED</div>}
                </div>
              );
            })}
          </div>

          {/* Quick key */}
          <div className="bg-[#080808] border border-border p-2.5 space-y-1.5 font-terminal text-[7.5px] text-muted-foreground">
            <div className="text-foreground font-bold tracking-widest mb-1">INTERPRETATION GUIDE</div>
            <p><span className="text-[hsl(142,71%,50%)]">Normal:</span> Short yields &lt; Long yields = healthy growth outlook</p>
            <p><span className="text-[hsl(0,80%,55%)]">Inverted:</span> Short &gt; Long = market expects Fed cuts = recession ahead</p>
            <p><span className="text-[hsl(38,95%,50%)]">Flat:</span> Transition phase — watch for direction</p>
          </div>
        </div>
      </div>
    </div>
  );
}
