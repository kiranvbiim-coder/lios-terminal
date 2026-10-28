import { canonicalSnapshotColumnTransform } from "@shared/quantModelRegistry";
import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useCallback, useEffect, useState, useRef } from "react";
import { Activity, Database, RefreshCw, TriangleAlert } from "lucide-react";
import type { PointInTimeScalarSeriesSnapshot, PointInTimeYieldCurveSnapshot } from "@shared/pointInTimeData";
import { eligibleEconomicCaptures, type EconomicEvidenceComparison } from "@shared/economicEvidenceTimeMachine";
import { useRecordedAsOfSnapshot } from "@/lib/useRecordedAsOfSnapshot";
import { AdvancedManualWorkflow, ReceiptSummary, useAdvancedWorkflow, type AdvancedReceipt } from "./advancedMacroForecastResearch";
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
  const nativeWorkflow = useAdvancedWorkflow("forecasting", "nowcast");
  const result = nativeWorkflow.result;
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
    setLoading(true); setError(null); 
    try {
      await nativeWorkflow.run({ targetHistory, indicatorHistory, currentIndicators });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Nowcast unavailable."); }
    finally { setLoading(false); }
  };
  return <section className="space-y-2 border border-border p-3">
    <div className="font-terminal text-xs">LINEAR NOWCAST — FROZEN TARGET SERIES</div>
    <div className="font-mono text-xs text-muted-foreground">{series ? `${targetHistory.length} frozen observations bound as targetHistory from ${series.payload.seriesId} (SNAPSHOT ${series.id.slice(0, 8)} / HASH ${series.contentHash.slice(0, 12)}).` : "NO FROZEN SERIES. CAPTURE ONE ON THE SERIES TAB FIRST."} Paste an aligned indicatorHistory (time × indicators, same row count) and currentIndicators — this manual-import path never infers indicator alignment.</div>
    <StructuredJsonEditor schema={NOWCAST_INPUTS_SCHEMA} value={nowcastInputs} onChange={setNowcastInputs} />
    <button type="button" onClick={() => void run()} disabled={!series || loading || !Array.isArray(nowcastInputs.indicatorHistory) || (nowcastInputs.indicatorHistory as unknown[]).length === 0 || !Array.isArray(nowcastInputs.currentIndicators) || (nowcastInputs.currentIndicators as unknown[]).length === 0} className="border border-amber-400/40 px-3 py-1.5 font-terminal text-xs text-amber-300 disabled:opacity-40">{loading ? "RUNNING…" : "RUN NOWCAST"}</button>
    {error && <div role="alert" className="font-mono text-xs text-red-300">{error}</div>}
    {result && <><pre className="max-h-36 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-xs text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={result.receipt} /></>}
  </section>;
}

function MacroModelTab({ curve, series }: { curve: PointInTimeYieldCurveSnapshot | null; series: PointInTimeScalarSeriesSnapshot | null }) {
  const [fred, setFred] = useState<ProviderStatus | null>(null);
  const nativeCurve = useAdvancedWorkflow("macro", "yield-curve-signals");
  const curveResult = nativeCurve.result;
  const [curveError, setCurveError] = useState<string | null>(null);
  const [curveLoading, setCurveLoading] = useState(false);
  useEffect(() => { void json<ProviderStatus[]>("/api/finance/provider-status").then((items) => setFred(items.find((item) => item.id === "fred") ?? null)).catch(() => setFred(null)); }, []);
  const runCurve = async () => {
    if (!curve) return;
    const points = curve.payload.points.filter((point) => point.yield !== null);
    if (points.length < 3) { setCurveError("Frozen curve has fewer than three valid nodes."); return; }
    const parameters = { maturitiesYears: points.map((point) => point.maturityYears), yieldsPct: points.map((point) => point.yield!) };
    setCurveLoading(true); setCurveError(null); 
    try {
      await nativeCurve.run(parameters, {
        dataClassification: "cached",
        sourceBindings: ([
          ["maturitiesYears", "maturity_years"], ["yieldsPct", "yield_value"],
        ] as const).map(([field, sourceField]) => ({
          contractFamily: "macro", field, connectorId: "fred", provider: curve.provider, priority: "primary",
          sourceReference: `data-snapshots/curves/ust/${curve.id}`, asOf: curve.effectiveAt, retrievedAt: curve.retrievedAt,
          freshness: "frozen point-in-time snapshot", snapshot: { id: curve.id, contentHash: curve.contentHash },
          transformations: [canonicalSnapshotColumnTransform({ field: sourceField, selection: "values", scale: 1, rowsWhereFinite: "yield_value" })],
        })),
      });
    } catch (cause) { setCurveError(cause instanceof Error ? cause.message : "Yield curve signal unavailable."); }
    finally { setCurveLoading(false); }
  };
  return <div className="space-y-3 p-4">
    <div className="font-terminal text-xs text-amber-300">ADVANCED MACRO WORKFLOWS</div>
    <div className={`border p-2 font-mono text-xs ${fred?.state === "configured" ? "border-emerald-400/30 text-emerald-300" : "border-amber-400/30 text-amber-200"}`}>
      {fred?.state === "configured" ? "FRED CONNECTOR CONFIGURED — ONLY FROZEN SNAPSHOTS ARE USED AS SOURCED INPUTS." : `FRED CONNECTOR UNAVAILABLE — ${fred?.setup ?? "Configure it before capturing new observations."} Existing frozen snapshots may still be calculated only when current linked rights permit. Manual imports remain manual.`}
    </div>
    <section className="space-y-2 border border-border p-3">
      <div className="font-terminal text-xs">YIELD-CURVE SIGNALS — FROZEN FRED UST CURVE</div>
      <div className="font-mono text-xs text-muted-foreground">{curve ? `SNAPSHOT ${curve.id} / AS-OF ${curve.effectiveAt} / HASH ${curve.contentHash}` : "NO FROZEN UST CURVE. CAPTURE ONE AFTER CONFIGURING FRED."}</div>
      <button type="button" onClick={() => void runCurve()} disabled={!curve?.entitlementPolicyId || curveLoading} className="border border-amber-400/40 px-3 py-1.5 font-terminal text-xs text-amber-300 disabled:opacity-40">{curveLoading ? "RUNNING…" : "RUN SOURCED CURVE SIGNALS"}</button>
      {curveError && <div role="alert" className="font-mono text-xs text-red-300">{curveError}</div>}
      {curveResult && <><pre className="max-h-36 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-xs text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(curveResult).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={curveResult.receipt} /></>}
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
  const [knownOnDay, setKnownOnDay] = useState("");
  const [historicalComparison, setHistoricalComparison] = useState<EconomicEvidenceComparison | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const compareAbort = useRef<AbortController | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useTerminalArtifactState<string | null>("EconomicDataFabricPanel.selectedSeriesSnapshot", null);
  const [selectedCurveId, setSelectedCurveId] = useTerminalArtifactState<string | null>("EconomicDataFabricPanel.selectedCurveSnapshot", null);
  const loadOwner = `${seriesId}:${selectedSeriesId ?? ""}:${selectedCurveId ?? ""}`;
  const latestLoadOwner = useRef(loadOwner); latestLoadOwner.current = loadOwner;
  const loadSequence = useRef(0);
  useEffect(() => { if (selectedSeriesId === null && series[0]?.entityKey === seriesId) setSelectedSeriesId(series[0].id); }, [series, seriesId, selectedSeriesId, setSelectedSeriesId]);
  useEffect(() => { if (selectedCurveId === null && curves[0]) setSelectedCurveId(curves[0].id); }, [curves, selectedCurveId, setSelectedCurveId]);
  const [policyId, setPolicyId] = useTerminalArtifactState("EconomicDataFabricPanel.policyId", "");
  const [tab, setTab] = useTerminalArtifactState<"series" | "curve" | "macro" | "lineage">("EconomicDataFabricPanel.tab", "series");
  const [busy, setBusy] = useState<"series" | "curve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentSeries = selectedSeriesId ? series.find(item => item.id === selectedSeriesId) ?? null : series[0] ?? null;
  const currentCurve = selectedCurveId ? curves.find(item => item.id === selectedCurveId) ?? null : curves[0] ?? null;
  const recordedCaptures = eligibleEconomicCaptures(series,seriesId);
  const latestSeriesCapture = recordedCaptures[0] ?? null;
  const historicalLookup = useRecordedAsOfSnapshot<PointInTimeScalarSeriesSnapshot>({
    url:`/api/data-snapshots/economics/${encodeURIComponent(seriesId)}/as-of`,
    entityKey:seriesId,datasetKey:`economic:${seriesId}`,dataClass:"economic_series",
    day:knownOnDay,revision:latestSeriesCapture?.id,
  });
  const savedThen = historicalLookup.snapshot;
  const shownComparison = historicalComparison &&
    historicalComparison.baseline.id === savedThen?.id && historicalComparison.current.id === latestSeriesCapture?.id &&
    historicalComparison.baseline.entityKey === seriesId ? historicalComparison : null;
  useEffect(() => {
    compareAbort.current?.abort();
    setHistoricalComparison(null);
    setCompareError(null);
    setComparing(false);
    return () => compareAbort.current?.abort();
  }, [seriesId,knownOnDay,savedThen?.id,latestSeriesCapture?.id]);
  const compareSavedEconomicCaptures = async () => {
    if (!savedThen || !latestSeriesCapture || savedThen.id === latestSeriesCapture.id || comparing) return;
    compareAbort.current?.abort();
    const controller = new AbortController();
    compareAbort.current = controller;
    setComparing(true);
    setCompareError(null);
    setHistoricalComparison(null);
    try {
      const selectedSeries = seriesId;
      const pair = new URLSearchParams({baselineId:savedThen.id,currentId:latestSeriesCapture.id});
      const result = await json<EconomicEvidenceComparison>(
        `/api/data-snapshots/economics/${encodeURIComponent(seriesId)}/compare?${pair}`,
        {credentials:"same-origin",cache:"no-store",signal:controller.signal});
      if (controller.signal.aborted || selectedSeries !== latestLoadOwner.current.split(":")[0]) return;
      if (result.status !== "compared" || result.baseline.id !== savedThen.id ||
        result.current.id !== latestSeriesCapture.id ||
        result.baseline.entityKey !== selectedSeries || result.current.entityKey !== selectedSeries ||
        result.baseline.contentHash !== savedThen.contentHash ||
        result.current.contentHash !== latestSeriesCapture.contentHash)
        throw new Error("Saved economic evidence changed while comparing; reload current captures.");
      setHistoricalComparison(result);
    } catch (cause) {
      if (!controller.signal.aborted && seriesId === latestLoadOwner.current.split(":")[0])
        setCompareError(cause instanceof Error ? cause.message : "Saved economic comparison unavailable.");
    } finally {
      if (compareAbort.current === controller) {
        compareAbort.current = null;
        setComparing(false);
      }
    }
  };
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const owner = loadOwner;
    try { setError(null); const [s, c] = await Promise.all([
      json<PointInTimeScalarSeriesSnapshot[]>(`/api/data-snapshots/economics/${encodeURIComponent(seriesId)}`),
      json<PointInTimeYieldCurveSnapshot[]>("/api/data-snapshots/curves/ust"),
    ]);
      if (selectedSeriesId && !s.some(item=>item.id===selectedSeriesId)) {
        const saved = await json<PointInTimeScalarSeriesSnapshot>(`/api/data-snapshots/${encodeURIComponent(selectedSeriesId)}`);
        if (saved.dataClass !== "economic_series" || saved.entityKey !== seriesId) throw new Error("Selected series snapshot does not match the current series.");
        s.push(saved);
      }
      if (selectedCurveId && !c.some(item=>item.id===selectedCurveId)) {
        const saved = await json<PointInTimeYieldCurveSnapshot>(`/api/data-snapshots/${encodeURIComponent(selectedCurveId)}`);
        if (saved.dataClass !== "yield_curve") throw new Error("Selected curve snapshot does not match the original curve.");
        c.push(saved);
      }
      if (sequence === loadSequence.current && owner === latestLoadOwner.current) { setSeries(s); setCurves(c); }
    } catch (cause) { if (sequence === loadSequence.current && owner === latestLoadOwner.current) setError(cause instanceof Error ? cause.message : "Economic data fabric unavailable."); }
  }, [seriesId, selectedSeriesId, selectedCurveId, loadOwner]);
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [load]);
  const capture = async (kind: "series" | "curve") => {
    const owner = loadOwner;
    setBusy(kind); setError(null);
    try {
      const captured = await json<{ snapshot: PointInTimeScalarSeriesSnapshot | PointInTimeYieldCurveSnapshot }>(kind === "series" ? `/api/data-snapshots/economics/${encodeURIComponent(seriesId)}` : "/api/data-snapshots/curves/ust", { method: "POST", body: JSON.stringify(kind === "series" ? { points: 240 } : {}) });
      if (owner !== latestLoadOwner.current) return;
      if (kind === "series") setSelectedSeriesId(captured.snapshot.id); else setSelectedCurveId(captured.snapshot.id);
      await load();
    }
    catch (cause) { if (owner === latestLoadOwner.current) setError(cause instanceof Error ? cause.message : "Capture failed."); } finally { setBusy(null); }
  };
  const linkPolicy = async () => {
    const snapshot = tab === "curve" || tab === "macro" ? currentCurve : currentSeries;
    if (!snapshot || !policyId.trim()) return;
    const owner = loadOwner;
    setError(null);
    try { await json(`/api/data-snapshots/${snapshot.id}/entitlement`, { method: "POST", body: JSON.stringify({ contentHash: snapshot.contentHash, policyId: policyId.trim() }) }); await load(); }
    catch (cause) { if (owner === latestLoadOwner.current) setError(cause instanceof Error ? cause.message : "Explicit policy linkage failed."); }
  };
  return <div className="h-full min-h-0 flex flex-col bg-background overflow-hidden">
    <header className="shrink-0 border-b border-border px-4 py-3 flex flex-wrap items-center gap-3"><Activity className="w-4 h-4 text-amber-300" /><div><div className="font-terminal text-xs">MACRO, RATES AND CURVE DATA FABRIC</div><div className="font-mono text-xs text-muted-foreground">FRED VINTAGES / IMMUTABLE AVAILABILITY / AS-OF REPLAY</div></div>
      <form onSubmit={(event) => { event.preventDefault(); setSelectedSeriesId(null); setSeries([]); setSeriesId(seriesInput.trim().toUpperCase()); }} className="ml-auto flex"><input aria-label="FRED series ID" value={seriesInput} onChange={(event) => setSeriesInput(event.target.value)} className="h-8 w-32 border border-border bg-black px-2 font-mono text-xs uppercase outline-none focus:border-amber-400/50" /><button title="Load FRED series" className="w-8 h-8 border border-l-0 border-border text-amber-300"><RefreshCw className="w-3.5 h-3.5 mx-auto" /></button></form>
      <button onClick={() => capture("series")} disabled={busy !== null} className="h-8 border border-amber-400/40 px-3 font-terminal text-xs text-amber-300 disabled:opacity-40"><Database className="inline w-3.5 h-3.5 mr-2" />{busy === "series" ? "CAPTURING" : "CAPTURE SERIES"}</button>
      <button onClick={() => capture("curve")} disabled={busy !== null} className="h-8 border border-amber-400/40 px-3 font-terminal text-xs text-amber-300 disabled:opacity-40"><Database className="inline w-3.5 h-3.5 mr-2" />{busy === "curve" ? "CAPTURING" : "CAPTURE UST CURVE"}</button>
    </header>
    {error && <div className="shrink-0 border-b border-red-400/30 px-4 py-2 font-mono text-xs text-red-300"><TriangleAlert className="inline w-3.5 h-3.5 mr-2" />{error}</div>}
    <div className="shrink-0 grid grid-cols-2 md:grid-cols-6 border-b border-border">{[
      ["SERIES", seriesId], ["SERIES VERSIONS", series.length], ["OBSERVATIONS", currentSeries?.quality.validObservationCount ?? 0],
      ["VINTAGE COVERAGE", currentSeries ? `${(currentSeries.quality.vintageCoverage * 100).toFixed(0)}%` : "--"],
      ["CURVE VERSIONS", curves.length], ["CURVE TENORS", currentCurve?.quality.validObservationCount ?? 0],
    ].map(([label, value]) => <div key={label} className="border-r border-border px-3 py-2"><div className="font-mono text-xs text-muted-foreground">{label}</div><div className="font-terminal text-xs truncate">{value}</div></div>)}</div>
    <nav className="shrink-0 border-b border-border px-4 py-2 flex gap-1">{(["series", "curve", "macro", "lineage"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`h-7 border px-3 font-terminal text-xs ${tab === item ? "border-amber-400/50 text-amber-300" : "border-border text-muted-foreground"}`}>{item.toUpperCase()}</button>)}</nav>
    <div className="flex flex-wrap gap-3 border-b border-border p-3 text-xs">
      <label>Recorded series <select aria-label="Recorded economic series snapshot" value={currentSeries?.id ?? ""} onChange={event=>setSelectedSeriesId(event.target.value)}><option value="" disabled>Unavailable</option>{series.map(item=><option key={item.id} value={item.id}>{item.id} · {item.availableAt}</option>)}</select></label>
      <label>Recorded curve <select aria-label="Recorded economic curve snapshot" value={currentCurve?.id ?? ""} onChange={event=>setSelectedCurveId(event.target.value)}><option value="" disabled>Unavailable</option>{curves.map(item=><option key={item.id} value={item.id}>{item.id} · {item.availableAt}</option>)}</select></label>
      <label>Existing policy ID <input aria-label="Existing economic source policy ID" value={policyId} onChange={event=>setPolicyId(event.target.value)}/></label>
      <button type="button" onClick={()=>void linkPolicy()} disabled={!policyId.trim()}>Link reviewed policy to selected source</button>
      <p>Only current admin/compliance can link an existing matching policy. No rights are created from a configured connector; immutable historical hashes are unchanged.</p>
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      {tab === "series" && <section data-testid="b06-economic-evidence-time-machine"
        aria-label="Economic Evidence Time Machine" className="space-y-3 border-b border-border/70 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-ui text-sm font-semibold text-foreground">Economic Evidence Time Machine</h3>
            <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
              Compare recorded FRED series snapshots actually available by a selected UTC day.
              Older observation dates do not establish that values were captured then.
            </p>
          </div>
          <label className="font-ui text-xs text-muted-foreground">
            As known on (UTC)
            <input aria-label="Recorded economic snapshot as known on UTC day" type="date"
              value={knownOnDay} onChange={event=>setKnownOnDay(event.target.value)}
              className="mt-1 block min-h-11 rounded-md border border-border/60 bg-background px-3 font-ui text-sm text-foreground"/>
          </label>
        </div>
        {knownOnDay && (historicalLookup.status === "loading"
          ? <p role="status" className="font-ui text-xs text-muted-foreground">Inspecting retained economic vintages…</p>
          : historicalLookup.status === "unavailable"
            ? <p role="alert" className="font-ui text-xs text-rose-200">{historicalLookup.error || "Saved macro vintage lookup unavailable."}</p>
          : !savedThen || !latestSeriesCapture
          ? <p role="status" className="font-ui text-xs text-amber-200">
              No immutable {seriesId} snapshot was retained as available on that day. This view cannot reconstruct missing evidence.
            </p>
          : <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Retained economic source captures">
                {([{name:"Captured then",snapshot:savedThen},{name:"Latest retained",snapshot:latestSeriesCapture}] as const).map(({name,snapshot})=>
                  <article key={name} className="min-w-0 space-y-1 rounded-lg border border-border/60 p-3 font-ui text-xs">
                    <h4 className="font-semibold text-foreground">{name}</h4>
                    <p className="text-muted-foreground">Available <time dateTime={snapshot.availableAt}>{new Date(snapshot.availableAt).toLocaleString()}</time></p>
                    <p className="text-muted-foreground">{snapshot.payload.unit || "Unspecified unit"} · {snapshot.payload.frequency}</p>
                    <p className="break-all text-muted-foreground">Snapshot <code>{snapshot.id}</code></p>
                    <p className="break-all text-muted-foreground">SHA-256 <code>{snapshot.contentHash}</code></p>
                  </article>)}
              </div>
              {savedThen.id === latestSeriesCapture.id
                ? <p role="status" className="font-ui text-xs text-muted-foreground">The saved capture was already the latest retained version. There is no newer snapshot.</p>
                : <button type="button" disabled={comparing} onClick={()=>void compareSavedEconomicCaptures()}
                    className="min-h-11 rounded-md border border-amber-300/50 px-3 font-ui text-sm text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-40">
                    {comparing ? "Comparing recorded vintages…" : "Compare saved economic vintages"}
                  </button>}
              {compareError && <p role="alert" className="font-ui text-xs text-rose-200">{compareError}</p>}
              {shownComparison && <div className="space-y-2" data-testid="b06-economic-snapshot-comparison">
                <p role="status" className="font-ui text-xs leading-5 text-muted-foreground">
                  {shownComparison.changes.changedObservations} revised recorded observation(s) ·
                  {" "}{shownComparison.changes.totalAddedDates} new observation date(s) ·
                  {" "}{shownComparison.changes.totalRemovedDates} removed date(s).
                  Differences may reflect value revisions or FRED vintage metadata changes, not a causal event.
                </p>
                <div className="max-h-64 overflow-auto rounded-md border border-border/60">
                  <table className="w-full min-w-[560px] text-left font-ui text-xs">
                    <caption className="p-2 text-left text-muted-foreground">
                      Retained source revision pairs, first 24 shown. Values share the recorded unit.
                    </caption>
                    <thead className="sticky top-0 bg-background text-muted-foreground"><tr>
                      {["Observation","Then","Latest","Difference","Vintage start (then / latest)"].map(label=>
                        <th key={label} scope="col" className="border-b border-border/50 px-3 py-2">{label}</th>)}
                    </tr></thead>
                    <tbody>{shownComparison.changes.revisions.slice(0,24).map((item,index)=><tr key={item.date+":"+index} className="border-b border-border/35">
                      <th scope="row" className="px-3 py-2">{item.date}</th>
                      <td className="px-3 py-2 tabular-nums">{item.before}</td>
                      <td className="px-3 py-2 tabular-nums">{item.after}</td>
                      <td className="px-3 py-2 tabular-nums">{item.absoluteChange}</td>
                      <td className="px-3 py-2">{item.beforeVintage.realtimeStart || "unknown"} / {item.afterVintage.realtimeStart || "unknown"}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
                {shownComparison.changes.changedObservations > 24 && <p className="font-ui text-xs text-muted-foreground">
                  {shownComparison.changes.changedObservations-24} additional source-revision rows omitted from this preview.
                </p>}
                {(shownComparison.changes.totalAddedDates > 0 || shownComparison.changes.totalRemovedDates > 0) &&
                  <p className="font-ui text-xs text-muted-foreground">
                    Added: {shownComparison.changes.addedDates.join(", ") || "none shown"} ·
                    Removed: {shownComparison.changes.removedDates.join(", ") || "none shown"}.
                    {shownComparison.omitted.addedDates+shownComparison.omitted.removedDates} further dates omitted.
                  </p>}
              </div>}
            </div>)}
      </section>}
      {tab === "series" && (!currentSeries ? <div className="p-8 font-terminal text-xs text-muted-foreground">NO FROZEN SERIES. CAPTURE {seriesId} TO BEGIN.</div> : <><div className="px-4 py-2 border-b border-border font-mono text-xs text-muted-foreground">{currentSeries.payload.name} / {currentSeries.payload.unit || "UNITLESS"} / {currentSeries.payload.frequency.toUpperCase()} / AVAILABLE {new Date(currentSeries.availableAt).toLocaleString()} / HASH {currentSeries.contentHash.slice(0, 12)}</div><table className="w-full font-mono text-xs"><thead className="sticky top-0 bg-black text-muted-foreground"><tr>{["OBSERVATION", "VALUE", "VINTAGE START", "VINTAGE END", "SOURCE AVAILABLE"].map((item) => <th key={item} className="border-b border-border px-3 py-2 text-right first:text-left">{item}</th>)}</tr></thead><tbody>{[...currentSeries.payload.observations].reverse().map((row) => <tr key={row.date} className="border-b border-border/50"><td className="px-3 py-1.5">{row.date}</td><td className="px-3 py-1.5 text-right">{row.value.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td><td className="px-3 py-1.5 text-right">{row.realtimeStart ?? "--"}</td><td className="px-3 py-1.5 text-right">{row.realtimeEnd ?? "--"}</td><td className="px-3 py-1.5 text-right">{new Date(row.availableAt).toLocaleDateString()}</td></tr>)}</tbody></table></>)}
      {tab === "curve" && (!currentCurve ? <div className="p-8 font-terminal text-xs text-muted-foreground">NO FROZEN TREASURY CURVE.</div> : <><div className="px-4 py-2 border-b border-border font-mono text-xs text-muted-foreground">UST NOMINAL / {currentCurve.payload.curveDate} / AVAILABLE {new Date(currentCurve.availableAt).toLocaleString()} / HASH {currentCurve.contentHash.slice(0, 12)}</div><div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6">{currentCurve.payload.points.map((point) => <div key={point.label} className="border-r border-b border-border p-4"><div className="font-terminal text-xs text-muted-foreground">{point.label} / {point.seriesId}</div><div className="mt-2 font-mono text-lg">{point.yield === null ? "--" : `${point.yield.toFixed(3)}%`}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{point.observationDate ?? "NO DATE"}</div></div>)}</div></>)}
      {tab === "macro" && <MacroModelTab curve={currentCurve} series={currentSeries} />}
      {tab === "lineage" && <pre className="p-4 whitespace-pre-wrap font-mono text-xs leading-5 text-muted-foreground">{JSON.stringify({ series: currentSeries && { id: currentSeries.id, parent: currentSeries.parentSnapshotId, clocks: { effectiveAt: currentSeries.effectiveAt, publishedAt: currentSeries.publishedAt, retrievedAt: currentSeries.retrievedAt, availableAt: currentSeries.availableAt }, quality: currentSeries.quality, lineage: currentSeries.lineage }, curve: currentCurve && { id: currentCurve.id, parent: currentCurve.parentSnapshotId, clocks: { effectiveAt: currentCurve.effectiveAt, publishedAt: currentCurve.publishedAt, retrievedAt: currentCurve.retrievedAt, availableAt: currentCurve.availableAt }, quality: currentCurve.quality, lineage: currentCurve.lineage }, fxWorkflow: "Use EURUSD=X PITDATA (or another Yahoo-format FX pair) for immutable FX OHLCV and returns." }, null, 2)}</pre>}
    </div>
  </div>;
}
