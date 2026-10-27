import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { latestMarketCapture, marketCaptureKnownOn, type MarketCaptureComparison } from "@shared/marketEvidenceTimeMachine";
import { Database, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { MarketDatasetRevisionReport, PointInTimeMarketSnapshot } from "@shared/pointInTimeData";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

function number(value: number | null, digits = 4) {
  return value === null ? "--" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function MarketDataFabricPanel({ symbol }: { symbol: string }) {
  const upper = symbol.toUpperCase();
  const [snapshots, setSnapshots] = useState<PointInTimeMarketSnapshot[]>([]);
  const [revision, setRevision] = useState<MarketDatasetRevisionReport | null>(null);
  const [asKnownDay, setAsKnownDay] = useState("");
  const [comparison, setComparison] = useState<MarketCaptureComparison | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const comparisonAbort = useRef<AbortController | null>(null);
  const activeOwner = useRef(upper);
  activeOwner.current = upper;
  const readSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useTerminalArtifactState<"bars" | "actions" | "lineage">("MarketDataFabricPanel.tab", "bars");
  // Do not expose a previous symbol\'s retained captures while switching tabs.
  const current = latestMarketCapture(snapshots, upper);
  const historical = asKnownDay ? marketCaptureKnownOn(snapshots, upper, asKnownDay) : null;
  const visibleComparison = comparison?.baseline.id === historical?.id &&
    comparison?.current.id === current?.id && comparison.baseline.entityKey === upper ? comparison : null;

  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    setSnapshots([]);
    setRevision(null);
    setError(null);
    try {
      const rows = await json<PointInTimeMarketSnapshot[]>(`/api/data-snapshots/markets/${encodeURIComponent(upper)}`,
        { credentials: "same-origin", cache: "no-store" });
      if (sequence !== readSequence.current || activeOwner.current !== upper) return;
      const newest = latestMarketCapture(rows, upper);
      const report = newest ? await json<MarketDatasetRevisionReport>(
        `/api/data-snapshots/${encodeURIComponent(newest.id)}/revisions`,
        { credentials: "same-origin", cache: "no-store" }) : null;
      if (sequence !== readSequence.current || activeOwner.current !== upper) return;
      setSnapshots(rows);
      setRevision(report);
    } catch (cause) {
      if (sequence === readSequence.current && activeOwner.current === upper)
        setError(cause instanceof Error ? cause.message : "Market dataset unavailable.");
    }
  }, [upper]);

  useEffect(() => {
    // A new symbol cannot inherit the previous symbol\'s disabled/busy state.
    setBusy(false);
    setAsKnownDay("");
    void load();
    return () => { readSequence.current += 1; };
  }, [load]);

  useEffect(() => {
    comparisonAbort.current?.abort();
    setComparison(null);
    setComparisonError(null);
    setComparing(false);
    return () => comparisonAbort.current?.abort();
  }, [upper, asKnownDay, historical?.id, current?.id]);

  const inspectCaptures = async () => {
    if (!historical || !current || historical.id === current.id || comparing) return;
    comparisonAbort.current?.abort();
    const controller = new AbortController();
    comparisonAbort.current = controller;
    setComparing(true);
    setComparisonError(null);
    setComparison(null);
    try {
      const params = new URLSearchParams({ baselineId: historical.id, currentId: current.id });
      const result = await json<MarketCaptureComparison>(
        `/api/data-snapshots/markets/${encodeURIComponent(upper)}/compare?${params}`,
        { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || activeOwner.current !== upper) return;
      if (result.status !== "compared" || result.baseline.id !== historical.id ||
        result.current.id !== current.id || result.baseline.entityKey !== upper ||
        result.current.entityKey !== upper || result.baseline.contentHash !== historical.contentHash ||
        result.current.contentHash !== current.contentHash)
        throw new Error("Snapshot identity changed during comparison; refresh the recorded captures.");
      setComparison(result);
    } catch (cause) {
      if (!controller.signal.aborted && activeOwner.current === upper)
        setComparisonError(cause instanceof Error ? cause.message : "Recorded comparison unavailable.");
    } finally {
      if (comparisonAbort.current === controller) {
        comparisonAbort.current = null;
        setComparing(false);
      }
    }
  };

  const capture = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await json(`/api/data-snapshots/markets/${encodeURIComponent(upper)}`, { method: "POST", body: JSON.stringify({ range: "5Y" }) });
      if (activeOwner.current === upper) await load();
    } catch (cause) {
      if (activeOwner.current === upper) setError(cause instanceof Error ? cause.message : "Capture failed.");
    } finally { if (activeOwner.current === upper) setBusy(false); }
  };

  const bars = useMemo(() => [...(current?.payload.bars ?? [])].reverse().slice(0, 250), [current]);

  return <div className="h-full min-h-0 flex flex-col bg-background overflow-hidden">
    <header className="shrink-0 border-b border-border px-4 py-3 flex flex-wrap items-center gap-3">
      <Database className="w-4 h-4 text-amber-300" />
      <div><div className="font-terminal text-[10px]">POINT-IN-TIME MARKET DATA / {upper}</div><div className="font-mono text-[7px] text-muted-foreground">IMMUTABLE DAILY OBSERVATIONS, RETURNS, ACTIONS AND REVISION LINEAGE</div></div>
      <button onClick={capture} disabled={busy} className="ml-auto h-8 border border-amber-400/40 px-3 font-terminal text-[8px] text-amber-300 disabled:opacity-40" title="Capture a new immutable five-year market snapshot">
        <RefreshCw className={`inline w-3.5 h-3.5 mr-2 ${busy ? "animate-spin" : ""}`} />{busy ? "CAPTURING" : "CAPTURE 5Y"}
      </button>
    </header>
    {error && <div className="shrink-0 border-b border-red-400/30 bg-red-400/5 px-4 py-2 font-mono text-[8px] text-red-300"><TriangleAlert className="inline w-3.5 h-3.5 mr-2" />{error}</div>}
    {!current ? <div className="flex-1 grid place-items-center"><div className="text-center"><Database className="mx-auto mb-3 w-6 h-6 text-muted-foreground" /><div className="font-terminal text-[9px]">NO FROZEN MARKET DATASET</div><div className="mt-1 font-mono text-[7px] text-muted-foreground">CAPTURE CREATES THE FIRST AUDITABLE VERSION FOR {upper}</div></div></div> : <>
      <div className="shrink-0 grid grid-cols-2 md:grid-cols-6 border-b border-border">
        {[
          ["OBSERVATIONS", current.quality.barCount], ["QUALITY", `${(current.quality.score * 100).toFixed(1)}%`],
          ["ACTIONS", current.quality.actionCount], ["VERSIONS", snapshots.length], ["CORRECTIONS", revision?.changedObservations ?? 0],
          ["MATERIAL", revision?.materialChanges ?? 0],
        ].map(([label, value]) => <div key={label} className="border-r border-border px-3 py-2"><div className="font-mono text-[7px] text-muted-foreground">{label}</div><div className="font-terminal text-[10px]">{value}</div></div>)}
      </div>
      <div className="shrink-0 border-b border-border px-4 py-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[7px] text-muted-foreground">
        <span>{current.observationStart} TO {current.observationEnd}</span><span>{current.currency} / {current.timezone}</span><span>BASIS {current.payload.priceBasis.toUpperCase()}</span><span>AS OF {new Date(current.availableAt).toLocaleString()}</span><span>HASH {current.contentHash.slice(0, 12)}</span>
        <span className={current.quality.warnings.length ? "text-amber-300" : "text-emerald-300"}><ShieldCheck className="inline w-3 h-3 mr-1" />{current.quality.warnings.length ? `${current.quality.warnings.length} DATA WARNINGS` : "QUALITY GATE CLEAR"}</span>
      </div>
      {current.quality.warnings.length > 0 && <div className="shrink-0 border-b border-border bg-amber-400/[0.03] px-4 py-2 font-mono text-[7px] text-amber-200">{current.quality.warnings.join(" / ")}</div>}
      <section aria-label="Evidence Time Machine for immutable market captures"
        data-testid="b06-market-evidence-time-machine" className="shrink-0 space-y-3 border-b border-border/70 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-ui text-sm font-semibold text-foreground">Evidence Time Machine</h3>
            <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
              Compare snapshots actually captured and available by the selected UTC date.
              Older OHLCV dates do not prove their values were known at that time.
            </p>
          </div>
          <label className="font-ui text-xs text-muted-foreground">
            As known on (UTC)
            <input type="date" value={asKnownDay} onChange={event => setAsKnownDay(event.target.value)}
              aria-label="Choose UTC date when saved market capture was available"
              className="mt-1 block min-h-11 rounded-lg border border-border/70 bg-background px-3 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"/>
          </label>
        </div>
        {asKnownDay && (!historical ?
          <p role="status" className="font-ui text-sm text-amber-200">
            No retained {upper} market capture was actually available on that date. Historical values are not reconstructed.
          </p> : <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Recorded capture pair">
              {([["Known then", historical], ["Latest retained", current]] as const).map(([caption, capture]) =>
                <div key={String(caption)} className="min-w-0 space-y-1 rounded-lg border border-border/60 p-3 font-ui text-xs">
                  <p className="font-semibold text-foreground">{caption}</p>
                  <p className="text-muted-foreground">Available: <time dateTime={capture.availableAt}>{new Date(capture.availableAt).toLocaleString()}</time></p>
                  <p className="text-muted-foreground">Observed bars: {capture.observationStart} through {capture.observationEnd}</p>
                  <p className="break-all text-muted-foreground">Capture ID: <code>{capture.id}</code></p>
                  <p className="break-all text-muted-foreground">SHA-256: <code>{capture.contentHash}</code></p>
                </div>)}
            </div>
            {historical.id === current.id
              ? <p className="font-ui text-xs text-muted-foreground" role="status">This was already the latest retained capture. No later version is available to compare.</p>
              : <button type="button" onClick={() => void inspectCaptures()} disabled={comparing}
                className="min-h-11 rounded-lg border border-amber-300/50 px-3 font-ui text-sm font-medium text-foreground hover:bg-amber-300/[0.05] focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-40">
                  {comparing ? "Comparing retained captures…" : "Compare recorded versions"}
                </button>}
            {comparisonError && <p role="alert" className="font-ui text-xs text-rose-200">{comparisonError}</p>}
            {visibleComparison && <div className="space-y-3" data-testid="b06-snapshot-revision-comparison">
              <p role="status" className="font-ui text-xs leading-5 text-muted-foreground">
                {visibleComparison.changes.status === "unchanged" ? "Retained snapshots have no reported observation revisions." : "Recorded snapshot revisions"}
                {" · "}{visibleComparison.changes.changedObservations} corrected field value(s)
                {" · "}{visibleComparison.changes.materialChanges} material field revision(s)
                {" · "}{visibleComparison.changes.totalAddedDates} added date(s)
                {" · "}{visibleComparison.changes.totalRemovedDates} removed date(s)
                {" · "}{visibleComparison.changes.actionChanges} corporate-action changes.
              </p>
              <p className="font-ui text-xs leading-5 text-muted-foreground">
                Corrected historical observations are different from new trading dates.
                Deltas are saved-source revisions, not investment returns, causal impacts or a live feed.
                Both source content hashes were checked against the canonical stored payload and lineage.
              </p>
              <div className="max-h-60 overflow-auto rounded-lg border border-border/60">
                <table className="w-full min-w-[520px] border-collapse text-left font-ui text-xs">
                  <caption className="p-2 text-left text-muted-foreground">Recorded corrections to existing dates; first 24 of the bounded revision preview</caption>
                  <thead className="sticky top-0 bg-background text-muted-foreground"><tr>
                    {["Observation date","Field","Known then","Latest capture","Delta"].map(label =>
                      <th key={label} scope="col" className="border-b border-border/60 px-3 py-2">{label}</th>)}
                  </tr></thead>
                  <tbody>{visibleComparison.changes.revisions.slice(0, 24).map((row, index) => <tr key={row.date+":"+row.field+":"+index} className="border-b border-border/35">
                    <th scope="row" className="px-3 py-2 font-medium">{row.date}</th>
                    <td className="px-3 py-2">{row.field}</td>
                    <td className="px-3 py-2 tabular-nums">{number(row.before)}</td>
                    <td className="px-3 py-2 tabular-nums">{number(row.after)}</td>
                    <td className="px-3 py-2 tabular-nums">{number(row.absoluteChange)}{row.material ? " · material" : ""}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              {visibleComparison.changes.revisions.length + visibleComparison.omitted.revisions > 24 && <p className="font-ui text-xs text-muted-foreground">
                {visibleComparison.changes.revisions.length + visibleComparison.omitted.revisions - 24} additional revised field(s) not shown in this view.
              </p>}
              {(visibleComparison.changes.totalAddedDates > 0 || visibleComparison.changes.totalRemovedDates > 0) &&
                <p className="font-ui text-xs text-muted-foreground">
                  Added dates: {visibleComparison.changes.addedDates.join(", ") || "none shown"}
                  {" · "}Removed dates: {visibleComparison.changes.removedDates.join(", ") || "none shown"}.
                  The full counts include {visibleComparison.omitted.addedDates + visibleComparison.omitted.removedDates} dates outside the bounded preview.
                </p>}
            </div>}
          </div>)}
      </section>
      <div className="shrink-0 border-b border-border px-4 py-2 flex gap-1">
        {(["bars", "actions", "lineage"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`h-7 border px-3 font-terminal text-[7px] ${tab === item ? "border-amber-400/50 text-amber-300" : "border-border text-muted-foreground"}`}>{item.toUpperCase()}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "bars" && <table className="w-full font-mono text-[8px]"><thead className="sticky top-0 bg-black text-muted-foreground"><tr>{["DATE", "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "PRICE RET", "LOG RET", "TOTAL RET"].map((item) => <th key={item} className="border-b border-border px-3 py-2 text-right first:text-left">{item}</th>)}</tr></thead><tbody>{bars.map((bar) => <tr key={bar.date} className="border-b border-border/50"><td className="px-3 py-1.5">{bar.date}</td>{[bar.open, bar.high, bar.low, bar.close, bar.volume].map((value, index) => <td key={index} className="px-3 py-1.5 text-right">{number(value, index === 4 ? 0 : 4)}</td>)}{[bar.priceReturn, bar.logReturn, bar.totalReturn].map((value, index) => <td key={index} className="px-3 py-1.5 text-right">{value === null ? "--" : `${(value * 100).toFixed(3)}%`}</td>)}</tr>)}</tbody></table>}
        {tab === "actions" && <table className="w-full font-mono text-[8px]"><thead className="sticky top-0 bg-black text-muted-foreground"><tr>{["EFFECTIVE", "TYPE", "CASH", "CURRENCY", "SPLIT", "SOURCE"].map((item) => <th key={item} className="border-b border-border px-3 py-2 text-left">{item}</th>)}</tr></thead><tbody>{current.payload.corporateActions.map((action, index) => <tr key={`${action.effectiveDate}-${action.type}-${index}`} className="border-b border-border/50"><td className="px-3 py-2">{action.effectiveDate}</td><td className="px-3 py-2">{action.type.toUpperCase()}</td><td className="px-3 py-2">{number(action.cashAmount)}</td><td className="px-3 py-2">{action.currency ?? "--"}</td><td className="px-3 py-2">{action.splitFrom && action.splitTo ? `${action.splitFrom}:${action.splitTo}` : "--"}</td><td className="px-3 py-2">{action.source}</td></tr>)}</tbody></table>}
        {tab === "lineage" && <pre className="p-4 whitespace-pre-wrap font-mono text-[8px] leading-5 text-muted-foreground">{JSON.stringify({ snapshotId: current.id, parentSnapshotId: current.parentSnapshotId, datasetKey: current.datasetKey, retrievedAt: current.retrievedAt, availableAt: current.availableAt, lineage: current.lineage, revision }, null, 2)}</pre>}
      </div>
    </>}
  </div>;
}
