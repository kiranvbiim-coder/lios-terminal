import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useCallback, useEffect, useState } from "react";
import { Activity, Database, RefreshCw, TriangleAlert } from "lucide-react";
import type { PointInTimeScalarSeriesSnapshot, PointInTimeYieldCurveSnapshot } from "@shared/pointInTimeData";
import { AdvancedManualWorkflow, ReceiptSummary, runAdvancedManual, runAdvancedSourced, type AdvancedReceipt } from "./advancedMacroForecastResearch";
import { StructuredJsonEditor, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json(); if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`); return body as T;
}

interface ProviderStatus { id: string; state: "configured" | "not_configured" | "disabled"; detail: string; setup: string; }

// Additive: forecasting/nowcast wired from this tab's own frozen target
// series (currentSeries below is a real immutable point-in-time snapshot
// with a content hash) -- indicatorHistory/currentIndicators still require
// a manual, analyst-reviewed paste since this single-series fabric has no
// second live indicator series aligned to the same dates. The overall
// request is honestly classified manual because it mixes a real capture
// with pasted indicator data; manualInputs records the exact submitted
// parameters, including the real target history values.
const NOWCAST_INPUTS_SCHEMA: JsonFieldSchema[] = [
  { kind: "numberMatrix", key: "indicatorHistory", label: "Indicator History", help: "Rows aligned to each frozen observation (time x indicators).", default: [] },
  { kind: "numberArray", key: "currentIndicators", label: "Current Indicators", default: [] },
];
function NowcastRunner({ series }: { series: PointInTimeScalarSeriesSnapshot | null }) {
  const [nowcastInputs, setNowcastInputs] = useTerminalArtifactState<Record<string, unknown>>("NowcastRunner.nowcastInputs", { indicatorHistory: [], currentIndicators: [] });
  const [result, setResult] = useState<(Record<string, unknown> & { receipt?: AdvancedReceipt }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const targetHistory = series?.payload.observations.map((observation) => observation.value) ?? [];
  const run = async () => {
    if (!series || targetHistory.length < 2) { setError("Capture a frozen series on the SERIES tab first."); return; }
    const indicatorHistory = nowcastInputs.indicatorHistory;
    const currentIndicators = nowcastInputs.currentIndicators;
    if (!Array.isArray(indicatorHistory) || indicatorHistory.length !== targetHistory.length) {
      setError(`indicatorHistory must be an array of ${targetHistory.length} rows, one aligned to each frozen ${series.payload.seriesId} observation.`);
      return;
    }
    if (!Array.isArray(currentIndicators)) { setError("currentIndicators must be an array of numbers."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await runAdvancedManual("forecasting", "nowcast", { targetHistory, indicatorHistory, currentIndicators }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Nowcast unavailable."); }
    finally { setLoading(false); }
  };
  return <section className="space-y-2 border border-border p-3">
    <div className="font-terminal text-[9px]">LINEAR NOWCAST — FROZEN TARGET SERIES</div>
    <div className="font-mono text-[7px] text-muted-foreground">{series ? `${targetHistory.length} frozen observations bound as targetHistory from ${series.payload.seriesId} (SNAPSHOT ${series.id.slice(0, 8)} / HASH ${series.contentHash.slice(0, 12)}).` : "NO FROZEN SERIES. CAPTURE ONE ON THE SERIES TAB FIRST."} Paste an aligned indicatorHistory (time × indicators, same row count) and currentIndicators — this manual-import path never infers indicator alignment.</div>
    <StructuredJsonEditor schema={NOWCAST_INPUTS_SCHEMA} value={nowcastInputs} onChange={setNowcastInputs} />
    <button type="button" onClick={() => void run()} disabled={!series || loading || !Array.isArray(nowcastInputs.indicatorHistory) || (nowcastInputs.indicatorHistory as unknown[]).length === 0 || !Array.isArray(nowcastInputs.currentIndicators) || (nowcastInputs.currentIndicators as unknown[]).length === 0} className="border border-amber-400/40 px-3 py-1.5 font-terminal text-[8px] text-amber-300 disabled:opacity-40">{loading ? "RUNNING…" : "RUN NOWCAST"}</button>
    {error && <div role="alert" className="font-mono text-[8px] text-red-300">{error}</div>}
    {result && <><pre className="max-h-36 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[7px] text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={result.receipt} /></>}
  </section>;
}

function MacroModelTab({ curve, series }: { curve: PointInTimeYieldCurveSnapshot | null; series: PointInTimeScalarSeriesSnapshot | null }) {
  const [fred, setFred] = useState<ProviderStatus | null>(null);
  const [curveResult, setCurveResult] = useState<(Record<string, unknown> & { receipt?: AdvancedReceipt }) | null>(null);
  const [curveError, setCurveError] = useState<string | null>(null);
  const [curveLoading, setCurveLoading] = useState(false);
  useEffect(() => { void json<ProviderStatus[]>("/api/finance/provider-status").then((items) => setFred(items.find((item) => item.id === "fred") ?? null)).catch(() => setFred(null)); }, []);
  const runCurve = async () => {
    if (!curve || fred?.state !== "configured") return;
    const points = curve.payload.points.filter((point) => point.yield !== null);
    if (points.length < 3) { setCurveError("Frozen curve has fewer than three valid nodes."); return; }
    const parameters = { maturitiesYears: points.map((point) => point.maturityYears), yieldsPct: points.map((point) => point.yield!) };
    setCurveLoading(true); setCurveError(null); setCurveResult(null);
    try {
      setCurveResult(await runAdvancedSourced("macro", "yield-curve-signals", parameters, {
        dataClassification: "cached",
        sourceBindings: [{
          contractFamily: "macro", field: "yield_curve", connectorId: "fred", provider: "FRED", priority: "primary",
          sourceReference: `data-snapshots/curves/ust/${curve.id}`, asOf: curve.effectiveAt, retrievedAt: curve.retrievedAt,
          freshness: "frozen point-in-time snapshot", snapshot: { id: curve.id, contentHash: curve.contentHash },
          transformations: ["drop null yield nodes", "use stored maturityYears and yieldsPct"],
        }],
        transformations: ["point-in-time yield curve snapshot"],
      }));
    } catch (cause) { setCurveError(cause instanceof Error ? cause.message : "Yield curve signal unavailable."); }
    finally { setCurveLoading(false); }
  };
  return <div className="space-y-3 p-4">
    <div className="font-terminal text-[9px] text-amber-300">ADVANCED MACRO WORKFLOWS</div>
    <div className={`border p-2 font-mono text-[8px] ${fred?.state === "configured" ? "border-emerald-400/30 text-emerald-300" : "border-amber-400/30 text-amber-200"}`}>
      {fred?.state === "configured" ? "FRED CONNECTOR CONFIGURED — ONLY FROZEN FRED SNAPSHOTS ARE USED AS SOURCED INPUTS." : `FRED UNAVAILABLE — ${fred?.setup ?? "Set FRED_API_KEY or fredApiKey, then capture a snapshot. Manual imports below remain manual."}`}
    </div>
    <section className="space-y-2 border border-border p-3">
      <div className="font-terminal text-[9px]">YIELD-CURVE SIGNALS — FROZEN FRED UST CURVE</div>
      <div className="font-mono text-[7px] text-muted-foreground">{curve ? `SNAPSHOT ${curve.id} / AS-OF ${curve.effectiveAt} / HASH ${curve.contentHash}` : "NO FROZEN UST CURVE. CAPTURE ONE AFTER CONFIGURING FRED."}</div>
      <button type="button" onClick={() => void runCurve()} disabled={!curve || fred?.state !== "configured" || curveLoading} className="border border-amber-400/40 px-3 py-1.5 font-terminal text-[8px] text-amber-300 disabled:opacity-40">{curveLoading ? "RUNNING…" : "RUN SOURCED CURVE SIGNALS"}</button>
      {curveError && <div role="alert" className="font-mono text-[8px] text-red-300">{curveError}</div>}
      {curveResult && <><pre className="max-h-36 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[7px] text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(curveResult).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={curveResult.receipt} /></>}
    </section>
    <NowcastRunner series={series} />
    <AdvancedManualWorkflow spec={{ family: "macro", model: "financial-conditions-index", label: "FINANCIAL CONDITIONS INDEX", instructions: "Paste indicatorNames, historicalValues (time × indicators, at least 30 rows), tighteningDirection, and optional latestValues from a reviewed import." }} />
    <AdvancedManualWorkflow spec={{ family: "macro", model: "recession-probability", label: "RECESSION PROBABILITY", instructions: "Paste featureNames, historicalFeatures, recessionLabels (at least 50 aligned observations), latestFeatures, and optional l2PenaltyInverseC from a reviewed import." }} />
    <AdvancedManualWorkflow spec={{ family: "macro", model: "inflation-decomposition", label: "INFLATION DECOMPOSITION", instructions: "Paste components with name, weightPct, and inflationRatePct. This is a manual decomposition, not a live CPI claim." }} />
  </div>;
}

export default function EconomicDataFabricPanel() {
  const [seriesInput, setSeriesInput] = useTerminalArtifactState("EconomicDataFabricPanel.seriesInput", "FEDFUNDS");
  const [seriesId, setSeriesId] = useTerminalArtifactState("EconomicDataFabricPanel.seriesId", "FEDFUNDS");
  const [series, setSeries] = useState<PointInTimeScalarSeriesSnapshot[]>([]);
  const [curves, setCurves] = useState<PointInTimeYieldCurveSnapshot[]>([]);
  const [tab, setTab] = useTerminalArtifactState<"series" | "curve" | "macro" | "lineage">("EconomicDataFabricPanel.tab", "series");
  const [busy, setBusy] = useState<"series" | "curve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentSeries = series[0] ?? null, currentCurve = curves[0] ?? null;
  const load = useCallback(async () => {
    try { setError(null); const [s, c] = await Promise.all([
      json<PointInTimeScalarSeriesSnapshot[]>(`/api/data-snapshots/economics/${encodeURIComponent(seriesId)}`),
      json<PointInTimeYieldCurveSnapshot[]>("/api/data-snapshots/curves/ust"),
    ]); setSeries(s); setCurves(c); } catch (cause) { setError(cause instanceof Error ? cause.message : "Economic data fabric unavailable."); }
  }, [seriesId]);
  useEffect(() => { void load(); }, [load]);
  const capture = async (kind: "series" | "curve") => {
    setBusy(kind); setError(null);
    try { await json(kind === "series" ? `/api/data-snapshots/economics/${encodeURIComponent(seriesId)}` : "/api/data-snapshots/curves/ust", { method: "POST", body: JSON.stringify(kind === "series" ? { points: 240 } : {}) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Capture failed."); } finally { setBusy(null); }
  };
  return <div className="h-full min-h-0 flex flex-col bg-background overflow-hidden">
    <header className="shrink-0 border-b border-border px-4 py-3 flex flex-wrap items-center gap-3"><Activity className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-[10px]">MACRO, RATES AND CURVE DATA FABRIC</div><div className="font-mono text-[7px] text-muted-foreground">FRED VINTAGES / IMMUTABLE AVAILABILITY / AS-OF REPLAY</div></div>
      <form onSubmit={(event) => { event.preventDefault(); setSeriesId(seriesInput.trim().toUpperCase()); }} className="ml-auto flex"><input aria-label="FRED series ID" value={seriesInput} onChange={(event) => setSeriesInput(event.target.value)} className="h-8 w-32 border border-border bg-black px-2 font-mono text-[9px] uppercase outline-none focus:border-amber-400/50" /><button title="Load FRED series" className="w-8 h-8 border border-l-0 border-border text-amber-300"><RefreshCw className="w-3.5 h-3.5 mx-auto" /></button></form>
      <button onClick={() => capture("series")} disabled={busy !== null} className="h-8 border border-amber-400/40 px-3 font-terminal text-[7px] text-amber-300 disabled:opacity-40"><Database className="inline w-3.5 h-3.5 mr-2" />{busy === "series" ? "CAPTURING" : "CAPTURE SERIES"}</button>
      <button onClick={() => capture("curve")} disabled={busy !== null} className="h-8 border border-amber-400/40 px-3 font-terminal text-[7px] text-amber-300 disabled:opacity-40"><Database className="inline w-3.5 h-3.5 mr-2" />{busy === "curve" ? "CAPTURING" : "CAPTURE UST CURVE"}</button>
    </header>
    {error && <div className="shrink-0 border-b border-red-400/30 px-4 py-2 font-mono text-[8px] text-red-300"><TriangleAlert className="inline w-3.5 h-3.5 mr-2" />{error}</div>}
    <div className="shrink-0 grid grid-cols-2 md:grid-cols-6 border-b border-border">{[
      ["SERIES", seriesId], ["SERIES VERSIONS", series.length], ["OBSERVATIONS", currentSeries?.quality.validObservationCount ?? 0],
      ["VINTAGE COVERAGE", currentSeries ? `${(currentSeries.quality.vintageCoverage * 100).toFixed(0)}%` : "--"],
      ["CURVE VERSIONS", curves.length], ["CURVE TENORS", currentCurve?.quality.validObservationCount ?? 0],
    ].map(([label, value]) => <div key={label} className="border-r border-border px-3 py-2"><div className="font-mono text-[7px] text-muted-foreground">{label}</div><div className="font-terminal text-[9px] truncate">{value}</div></div>)}</div>
    <nav className="shrink-0 border-b border-border px-4 py-2 flex gap-1">{(["series", "curve", "macro", "lineage"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`h-7 border px-3 font-terminal text-[7px] ${tab === item ? "border-amber-400/50 text-amber-300" : "border-border text-muted-foreground"}`}>{item.toUpperCase()}</button>)}</nav>
    <div className="min-h-0 flex-1 overflow-auto">
      {tab === "series" && (!currentSeries ? <div className="p-8 font-terminal text-[9px] text-muted-foreground">NO FROZEN SERIES. CAPTURE {seriesId} TO BEGIN.</div> : <><div className="px-4 py-2 border-b border-border font-mono text-[7px] text-muted-foreground">{currentSeries.payload.name} / {currentSeries.payload.unit || "UNITLESS"} / {currentSeries.payload.frequency.toUpperCase()} / AVAILABLE {new Date(currentSeries.availableAt).toLocaleString()} / HASH {currentSeries.contentHash.slice(0, 12)}</div><table className="w-full font-mono text-[8px]"><thead className="sticky top-0 bg-black text-muted-foreground"><tr>{["OBSERVATION", "VALUE", "VINTAGE START", "VINTAGE END", "SOURCE AVAILABLE"].map((item) => <th key={item} className="border-b border-border px-3 py-2 text-right first:text-left">{item}</th>)}</tr></thead><tbody>{[...currentSeries.payload.observations].reverse().map((row) => <tr key={row.date} className="border-b border-border/50"><td className="px-3 py-1.5">{row.date}</td><td className="px-3 py-1.5 text-right">{row.value.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td><td className="px-3 py-1.5 text-right">{row.realtimeStart ?? "--"}</td><td className="px-3 py-1.5 text-right">{row.realtimeEnd ?? "--"}</td><td className="px-3 py-1.5 text-right">{new Date(row.availableAt).toLocaleDateString()}</td></tr>)}</tbody></table></>)}
      {tab === "curve" && (!currentCurve ? <div className="p-8 font-terminal text-[9px] text-muted-foreground">NO FROZEN TREASURY CURVE.</div> : <><div className="px-4 py-2 border-b border-border font-mono text-[7px] text-muted-foreground">UST NOMINAL / {currentCurve.payload.curveDate} / AVAILABLE {new Date(currentCurve.availableAt).toLocaleString()} / HASH {currentCurve.contentHash.slice(0, 12)}</div><div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6">{currentCurve.payload.points.map((point) => <div key={point.label} className="border-r border-b border-border p-4"><div className="font-terminal text-[8px] text-muted-foreground">{point.label} / {point.seriesId}</div><div className="mt-2 font-mono text-lg">{point.yield === null ? "--" : `${point.yield.toFixed(3)}%`}</div><div className="mt-1 font-mono text-[7px] text-muted-foreground">{point.observationDate ?? "NO DATE"}</div></div>)}</div></>)}
      {tab === "macro" && <MacroModelTab curve={currentCurve} series={currentSeries} />}
      {tab === "lineage" && <pre className="p-4 whitespace-pre-wrap font-mono text-[8px] leading-5 text-muted-foreground">{JSON.stringify({ series: currentSeries && { id: currentSeries.id, parent: currentSeries.parentSnapshotId, clocks: { effectiveAt: currentSeries.effectiveAt, publishedAt: currentSeries.publishedAt, retrievedAt: currentSeries.retrievedAt, availableAt: currentSeries.availableAt }, quality: currentSeries.quality, lineage: currentSeries.lineage }, curve: currentCurve && { id: currentCurve.id, parent: currentCurve.parentSnapshotId, clocks: { effectiveAt: currentCurve.effectiveAt, publishedAt: currentCurve.publishedAt, retrievedAt: currentCurve.retrievedAt, availableAt: currentCurve.availableAt }, quality: currentCurve.quality, lineage: currentCurve.lineage }, fxWorkflow: "Use EURUSD=X PITDATA (or another Yahoo-format FX pair) for immutable FX OHLCV and returns." }, null, 2)}</pre>}
    </div>
  </div>;
}
