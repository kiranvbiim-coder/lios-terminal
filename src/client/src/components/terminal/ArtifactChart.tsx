// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { lazy, Suspense, useId, useMemo, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { ArtifactContent } from "@shared/artifactContracts";
import { prepareArtifactChart, selectArtifactChartViewport } from "@/lib/artifactChartProjection";
import { chartRecordedContext, chartSourceCaveat } from "@/lib/artifactChartContext";
import ArtifactChartRecordedTable from "./ArtifactChartRecordedTable";
import { ExpertViewDisclosure } from "./ArtifactExpertView";
const EChartsArtifactPlot=lazy(()=>import("./EChartsArtifactPlot"));

type ChartContent = Extract<ArtifactContent, { kind: "chart" }>;
const CHART_TYPES = ["line", "area", "bar", "scatter"] as const;
const WINDOW_SIZE = 250;
const COLORS = ["#fcd34d", "#67e8f9", "#a78bfa", "#6ee7b7", "#fda4af", "#fdba74", "#93c5fd", "#e879f9"];
const TICK = { fill: "#999", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" };
const CONTROL = "rounded border border-border/50 px-3 py-2 font-ui text-[13px] disabled:opacity-40";
const SELECT = "rounded border border-border/50 bg-[#090909] px-2 py-2 font-ui text-[13px]";

function exact(value: string | number) {
  return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value);
}
function coordinateLabel(value: string | number) {
  return typeof value === "string" ? JSON.stringify(value) : exact(value);
}

/** A renderer failure must not erase the independently available exact table. */
class ChartPlotBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="alert" data-testid="artifact-chart-plot-failed" className="rounded border border-amber-300/30 p-3 font-ui text-[13px] text-amber-200">The chart drawing failed. Use the exact recorded comparison table below; the saved data is unchanged.</p>
      : this.props.children;
  }
}

export default function ArtifactChart({ content, artifactSourceRefs, ...mode }: {
  content: ChartContent;
  artifactSourceRefs?: readonly string[];
} & ({ readOnly: true; onSave?: never } | { readOnly?: false; onSave: (content: ArtifactContent) => Promise<void> })) {
  const id = useId();
  const [chartType, setChartType] = useState(content.chartType);
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const [offset, setOffset] = useState(0);
  const [pointIndex, setPointIndex] = useState(0);
  const [seriesIndex, setSeriesIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const prepared = useMemo(() => prepareArtifactChart({ ...content, chartType }), [content, chartType]);
  const recordedContext = useMemo(() => chartRecordedContext(content, artifactSourceRefs), [content, artifactSourceRefs]);
  const viewport = useMemo(() => prepared.status === "ready"
    ? selectArtifactChartViewport(prepared, { offset, limit: WINDOW_SIZE }) : null, [prepared, offset]);
  const visibleSeries = useMemo(() => viewport?.series.filter(series => !hidden.has(series.index)) ?? [], [viewport, hidden]);
  const visibleIndices = useMemo(() => visibleSeries.map(series => series.index), [visibleSeries]);
  const scatterRows = useMemo(() => chartType === "scatter" && viewport
    ? visibleSeries.map(series => ({ series, rows: viewport.rows.filter(row => row[series.dataKey] !== null) })) : [], [chartType, viewport, visibleSeries]);
  const selectedRow = viewport?.rows[Math.min(pointIndex, Math.max(0, viewport.rows.length - 1))];
  const selectedSeries = prepared.status === "ready" ? prepared.series[seriesIndex] : undefined;
  const selectedPoint = selectedRow ? selectedSeries?.points.get(selectedRow.x) : undefined;
  const hasPoints = prepared.status === "ready" && prepared.xValues.length > 0;

  const save = async () => {
    if (mode.readOnly || savingRef.current || chartType === content.chartType) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      if (mode.readOnly) throw new Error("Captured chart is read-only.");
      await mode.onSave({ ...content, chartType });
      setSaveMessage("Chart configuration saved as a new Artifact revision.");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Chart revision could not be saved. Your recorded chart is unchanged.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const page = (nextOffset: number) => { setOffset(nextOffset); setPointIndex(0); };

  return <section aria-label="Chart Artifact" data-testid="artifact-chart" data-chart-type={chartType} className="space-y-3">
    {!mode.readOnly && <div className="flex flex-wrap items-end gap-3">
      <label htmlFor={`${id}-type`} className="space-y-1 font-ui text-[13px]"><span className="block text-muted-foreground">Chart type</span>
        <select id={`${id}-type`} aria-label="Chart type" value={chartType} disabled={saving} onChange={event => { setChartType(event.target.value); setSaveError(null); setSaveMessage(null); }} className={SELECT}>
          {!CHART_TYPES.some(type => type === content.chartType) && <option value={content.chartType}>{content.chartType} (unsupported)</option>}
          {CHART_TYPES.map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}
        </select>
      </label>
      <button type="button" data-testid="artifact-chart-save" disabled={saving || chartType === content.chartType} onClick={() => void save()} className={CONTROL}>{saving ? "Saving revision…" : "Save chart revision"}</button>
      {chartType !== content.chartType && <><button type="button" disabled={saving} onClick={() => { setChartType(content.chartType); setSaveError(null); setSaveMessage(null); }} className={CONTROL}>Reset chart type</button><span className="font-ui text-[13px] text-amber-200">Unsaved preview · recorded type: {content.chartType}</span></>}
    </div>}
    <p className="font-ui text-[13px] text-muted-foreground">Exact recorded values · one linear Y axis, fixed across series and windows · gaps are not connected. Series visibility and point inspection are local view controls, not Artifact edits.</p>
    <section data-testid="artifact-chart-recorded-context" aria-label="Recorded chart units, period and source context" className="space-y-1 rounded border border-border/50 p-3 font-ui text-[12px]">
      <p>X: {recordedContext.xLabel}{recordedContext.xUnit ? ` · Unit: ${recordedContext.xUnit}` : " · Unit: unknown"} · Y: {recordedContext.yLabel}{recordedContext.yUnit ? ` · Unit: ${recordedContext.yUnit}` : " · Unit: unknown"}</p>
      <p>Period: {recordedContext.period ?? "Not recorded"}. {recordedContext.sourceBasis === "artifact_version" ? "Saved P4 version source refs" : "Chart option source refs"}: {recordedContext.evidenceRefs.length ? `${recordedContext.evidenceRefs.length} recorded` : "Not recorded"}.</p>
      <p className="text-amber-200">{chartSourceCaveat(recordedContext)}</p>
      {!!recordedContext.evidenceRefs.length && <details className="pt-1">
        <summary className="cursor-pointer">Show recorded source references (not verified)</summary>
        <ul className="max-h-40 list-disc overflow-auto pl-5">{recordedContext.evidenceRefs.map(sourceRef => <li key={sourceRef} className="break-all">{sourceRef}</li>)}</ul>
      </details>}
    </section>
    {content.rendererPreference !== "recharts" && content.rendererPreference !== "echarts" && <p className="font-ui text-[13px] text-amber-200">This chart was saved with a different drawing preference ({content.rendererPreference}). It is shown with the standard chart view; saving the chart type keeps that preference.</p>}
    {Object.keys(content.options).length > 0 && <ExpertViewDisclosure summary="Expert view" hint="Recorded chart settings not used by this view"><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-terminal text-[12px]">{JSON.stringify(content.options, null, 2)}</pre></ExpertViewDisclosure>}
    {saveError && <p role="alert" data-testid="artifact-chart-save-error" className="text-sm text-red-200">{saveError}</p>}
    {saveMessage && <p role="status" className="text-sm text-emerald-200">{saveMessage}</p>}
    {prepared.status !== "ready" ? <p role="alert" data-testid="artifact-chart-unavailable" className="rounded border border-amber-300/20 p-3 text-sm text-amber-200">{prepared.message} The recorded Artifact is unchanged.</p>
      : !hasPoints || !viewport ? <p role="status" data-testid="artifact-chart-empty" className="rounded border border-border/50 p-3 text-sm text-muted-foreground">No recorded chart points. No values have been inferred.</p>
      : <>
        <fieldset className="rounded border border-border/50 p-3" data-testid="artifact-chart-legend"><legend className="px-1 font-ui text-[13px]">Series visibility</legend>
          <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-2 overflow-auto">{prepared.series.map(series => <label key={series.index} className="flex items-center gap-2 font-ui text-[13px]">
            <input type="checkbox" aria-label={`Show series ${series.label}`} checked={!hidden.has(series.index)} onChange={() => setHidden(current => { const next = new Set(current); if (next.has(series.index)) next.delete(series.index); else next.add(series.index); return next; })}/>
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[series.index % COLORS.length] }}/>{series.label}
          </label>)}</div>
        </fieldset>
        <p role="status" aria-live="polite" aria-atomic="true" data-testid="artifact-chart-counts" className="font-terminal text-[12px] text-muted-foreground">Showing X positions {viewport.offset + 1}–{viewport.endExclusive} of {viewport.totalDistinctPoints} · {viewport.totalSourcePoints} recorded source points · shared Y range {viewport.yDomain?.map(exact).join(" to ")}. No sampling or aggregation.</p>
        <nav aria-label="Chart viewport" className="flex items-center gap-3">
          <button type="button" aria-label="Previous chart window" disabled={!viewport.hasPrevious} onClick={() => page(Math.max(0, viewport.offset - WINDOW_SIZE))} className={CONTROL}>Previous window</button>
          <button type="button" aria-label="Next chart window" disabled={!viewport.hasNext} onClick={() => page(viewport.endExclusive)} className={CONTROL}>Next window</button>
        </nav>
        {!visibleSeries.length ? <p role="status" className="p-3 text-sm text-muted-foreground">All series are hidden. Select a series above to display it; exact recorded points remain available below.</p> : <ChartPlotBoundary key={`${chartType}:${content.rendererPreference}`}><div className="h-[320px] min-w-0 rounded border border-border/50 bg-[#0a0a0a] p-2" data-testid="artifact-chart-plot" role="img" aria-label={`${chartType} chart, ${visibleSeries.length} visible series. Use the exact point inspector below for keyboard access.`}>
          {content.rendererPreference === "echarts" ? <Suspense fallback={<p role="status" className="p-3 text-sm">Loading chart…</p>}><EChartsArtifactPlot projection={prepared} viewport={viewport} chartType={chartType as "line"|"area"|"bar"|"scatter"} visibleIndices={visibleIndices}/></Suspense> : <><ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={viewport.rows} margin={{ top: 12, right: 16, left: 12, bottom: 12 }}>
              <CartesianGrid stroke="#222" strokeDasharray="3 3"/>
              <XAxis dataKey={prepared.xKind === "number" ? "x" : "xIndex"} type={prepared.xKind === "number" ? "number" : "category"} allowDuplicatedCategory={false} domain={["dataMin", "dataMax"]} tick={TICK} stroke="#555" tickLine={false} minTickGap={35} tickFormatter={value => prepared.xKind === "category" ? coordinateLabel(prepared.xValues[Number(value)]) : exact(value)}/>
              <YAxis type="number" domain={viewport.yDomain ?? [0, 1]} allowDataOverflow tick={TICK} stroke="#555" tickLine={false} width={76}/>
              <ReferenceLine y={0} stroke="#666"/>
              <Tooltip filterNull={false} content={({ active, payload }) => {
                const row = payload?.[0]?.payload as { x?: string | number; xIndex?: number } | undefined;
                if (!active || row?.x === undefined) return null;
                return <div data-testid="artifact-chart-tooltip" className="max-h-64 max-w-sm overflow-auto rounded border border-border bg-[#0c0c0c] p-3 font-terminal text-[12px]">
                  <div className="mb-2 break-words text-muted-foreground">X: {coordinateLabel(row.x)}</div>
                  {visibleSeries.map(series => { const point = prepared.series[series.index].points.get(row.x!); return <div key={series.index} className="break-words"><span style={{ color: COLORS[series.index % COLORS.length] }}>{series.label}</span>: {point ? exact(point.y) : "No recorded point (gap)"}{point ? ` · source point ${point.sourcePointIndex + 1}` : ""}</div>; })}
                </div>;
              }}/>
              {chartType === "scatter" ? scatterRows.map(({ series, rows }) => <Scatter key={series.index} name={series.label} data={rows} dataKey={series.dataKey} fill={COLORS[series.index % COLORS.length]} isAnimationActive={false}/>) : visibleSeries.map(series => {
                const color = COLORS[series.index % COLORS.length];
                if (chartType === "bar") return <Bar key={series.index} name={series.label} dataKey={series.dataKey} fill={color} isAnimationActive={false}/>;
                if (chartType === "area") return <Area key={series.index} name={series.label} dataKey={series.dataKey} type="linear" stroke={color} fill={color} fillOpacity={0.12} baseValue={0} connectNulls={false} dot={false} activeDot={{ r: 4 }} isAnimationActive={false}/>;
                return <Line key={series.index} name={series.label} dataKey={series.dataKey} type="linear" stroke={color} connectNulls={false} dot={viewport.rows.length === 1} activeDot={{ r: 4 }} isAnimationActive={false}/>;
              })}
            </ComposedChart>
          </ResponsiveContainer></>}
        </div></ChartPlotBoundary>}
        <ArtifactChartRecordedTable projection={prepared} content={content}/>
        <section aria-label="Exact chart point inspector" data-testid="artifact-chart-inspector" className="space-y-3 rounded border border-border/50 p-3">
          <h3 className="font-ui text-[14px] font-semibold">Exact recorded point</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 font-ui text-[13px]"><span className="block text-muted-foreground">Inspect series</span><select aria-label="Inspect chart series" value={seriesIndex} onChange={event => setSeriesIndex(Number(event.target.value))} className={SELECT}>{prepared.series.map(series => <option key={series.index} value={series.index}>{series.label}{hidden.has(series.index) ? " (hidden)" : ""}</option>)}</select></label>
            <label className="space-y-1 font-ui text-[13px]"><span className="block text-muted-foreground">X position in this window</span><select aria-label="Inspect chart point" value={Math.min(pointIndex, viewport.rows.length - 1)} onChange={event => setPointIndex(Number(event.target.value))} className={SELECT}>{viewport.rows.map((row, index) => <option key={row.xIndex} value={index}>{row.xIndex + 1}: {coordinateLabel(row.x)}</option>)}</select></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-label="Previous chart point" disabled={pointIndex <= 0} onClick={() => setPointIndex(current => Math.max(0, current - 1))} className={CONTROL}>Previous point</button>
            <button type="button" aria-label="Next chart point" disabled={pointIndex >= viewport.rows.length - 1} onClick={() => setPointIndex(current => Math.min(viewport.rows.length - 1, current + 1))} className={CONTROL}>Next point</button>
          </div>
          <div tabIndex={0} aria-label="Exact point values; arrow keys change point, Home and End move within window" onKeyDown={event => {
            const next = event.key === "ArrowRight" ? Math.min(viewport.rows.length - 1, pointIndex + 1) : event.key === "ArrowLeft" ? Math.max(0, pointIndex - 1) : event.key === "Home" ? 0 : event.key === "End" ? viewport.rows.length - 1 : null;
            if (next !== null) { event.preventDefault(); setPointIndex(next); }
          }} className="overflow-auto rounded border border-border/40 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
            <dl aria-live="polite" aria-atomic="true" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 break-words font-terminal text-[12px]">
              <dt className="text-muted-foreground">Series</dt><dd>{selectedSeries?.label} · {selectedSeries?.id}</dd>
              <dt className="text-muted-foreground">X</dt><dd data-testid="artifact-chart-exact-x">{selectedRow ? coordinateLabel(selectedRow.x) : "No point"}</dd>
              <dt className="text-muted-foreground">Y</dt><dd data-testid="artifact-chart-exact-y">{selectedPoint ? exact(selectedPoint.y) : "No recorded point (gap)"}</dd>
              <dt className="text-muted-foreground">Source point</dt><dd>{selectedPoint ? `${selectedPoint.sourcePointIndex + 1} (original series order)` : "None at this X; no interpolation"}</dd>
            </dl>
          </div>
        </section>
      </>}
  </section>;
}
