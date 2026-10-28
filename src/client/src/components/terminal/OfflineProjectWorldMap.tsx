import * as React from "react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { projectOfflineWorldPoints, recordedWorldMapDays, type RecordedGeographicPoint } from "@/lib/offlineWorldMapPresentation";

const RecordedWorldMapCanvas = lazy(() => import("./RecordedWorldMapCanvas"));

export function OfflineProjectWorldMap({ points, origin = "P7 Project graph" }: {
  points: readonly RecordedGeographicPoint[];
  origin?: "P7 Project graph" | "P4 saved table";
}) {
  const [sourceOnly, setSourceOnly] = useState(false);
  const [withEventDate, setWithEventDate] = useState(false);
  const [timeWindowEnabled, setTimeWindowEnabled] = useState(false);
  const [fromDay, setFromDay] = useState<string>("");
  const [throughDay, setThroughDay] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => { setClientReady(true); }, []);
  const availableDays = useMemo(() => recordedWorldMapDays(points), [points]);
  const earliestDay = availableDays[0] ?? "";
  const latestDay = availableDays[availableDays.length - 1] ?? "";
  const selectedFrom = fromDay || earliestDay;
  const selectedThrough = throughDay || latestDay;
  const dateWindowValid = !timeWindowEnabled || Boolean(selectedFrom && selectedThrough && selectedFrom <= selectedThrough &&
    selectedFrom >= earliestDay && selectedThrough <= latestDay);
  const projection = useMemo(
    () => projectOfflineWorldPoints(timeWindowEnabled && !dateWindowValid ? [] : points, {
      sourceOnly, withEventDate: withEventDate || timeWindowEnabled,
      ...(timeWindowEnabled ? { fromDate: selectedFrom, throughDate: selectedThrough } : {}),
    }),
    [points, sourceOnly, withEventDate, timeWindowEnabled, dateWindowValid, selectedFrom, selectedThrough],
  );
  const selected = projection.points.find(point => point.id === selectedId) ?? null;
  const scrubDays = availableDays.filter(day => !selectedFrom || day >= selectedFrom);
  const scrubPosition = scrubDays.findIndex(day => day === selectedThrough);

  function focusPoint(id: string) { setSelectedId(id); }

  if (!points.length) return <p role="status" className="rounded-lg border border-dashed border-border/60 p-3 font-ui text-sm text-muted-foreground">
    No coordinate-bearing Project geography is directly linked to this insight. No location has been inferred.
  </p>;

  return <div data-testid="offline-project-world-map" className="min-w-0 space-y-3">
    <div className="flex flex-wrap gap-2 font-ui text-xs text-muted-foreground" role="status">
      <span>{projection.points.length} recorded locations</span>
      {projection.omittedCount > 0 && <span>{projection.omittedCount} omitted from bounded map view</span>}
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Recorded geography layers">
      <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 font-ui text-xs text-foreground">
        <input type="checkbox" checked={sourceOnly} onChange={event => {setSourceOnly(event.target.checked);setSelectedId(null);}}
          className="h-4 w-4 accent-amber-300 focus-visible:ring-2 focus-visible:ring-amber-300/70" />
        Only points with recorded source IDs
      </label>
      <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 font-ui text-xs text-foreground">
        <input type="checkbox" checked={withEventDate} onChange={event => {setWithEventDate(event.target.checked);setSelectedId(null);}}
          className="h-4 w-4 accent-amber-300 focus-visible:ring-2 focus-visible:ring-amber-300/70" />
        Only points with recorded event dates
      </label>
    </div>
    <section className="rounded-lg border border-border/55 p-3" aria-label="Recorded geography time window" data-testid="world-map-time-controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 font-ui text-sm text-foreground">
          <input type="checkbox" checked={timeWindowEnabled}
            disabled={!availableDays.length}
            onChange={event => { setTimeWindowEnabled(event.target.checked); setSelectedId(null); }}
            className="h-4 w-4 accent-amber-300 focus-visible:ring-2 focus-visible:ring-amber-300/70"/>
          Filter by recorded event time
        </label>
        <span className="font-ui text-xs text-muted-foreground" role="status">
          {availableDays.length ? `${availableDays.length} distinct recorded UTC day(s)` : "No recorded event dates"}
        </span>
      </div>
      {timeWindowEnabled && availableDays.length > 0 && <div className="mt-2 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="font-ui text-xs text-muted-foreground">From (UTC)
            <input type="date" value={selectedFrom} min={earliestDay} max={latestDay}
              onChange={event => { setFromDay(event.target.value); setSelectedId(null); }}
              className="mt-1 min-h-11 w-full rounded-lg border border-border/60 bg-background px-2 font-ui text-sm text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70"/>
          </label>
          <label className="font-ui text-xs text-muted-foreground">Through (UTC)
            <input type="date" value={selectedThrough} min={earliestDay} max={latestDay}
              onChange={event => { setThroughDay(event.target.value); setSelectedId(null); }}
              className="mt-1 min-h-11 w-full rounded-lg border border-border/60 bg-background px-2 font-ui text-sm text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70"/>
          </label>
        </div>
        {scrubDays.length > 1 && <label className="block font-ui text-xs text-muted-foreground">
          Step through recorded event days
          <input type="range" min={0} max={scrubDays.length - 1}
            step={1} value={Math.max(0, scrubPosition)}
            aria-label="Show recorded locations through this UTC event day"
            onChange={event => { setThroughDay(scrubDays[Number(event.target.value)]); setSelectedId(null); }}
            className="mt-2 min-h-10 w-full accent-amber-300"/>
        </label>}
        {!dateWindowValid && <p role="alert" className="font-ui text-xs text-amber-200">
          The selected UTC date window is outside the recorded period or reversed. No points are assumed.
        </p>}
        <p className="font-ui text-xs leading-5 text-muted-foreground">
          Includes only events dated within the selected UTC days. Undated locations remain unknown.
          Date controls are derived from recorded Project evidence, not inferred publication times.
        </p>
      </div>}
    </section>
    {clientReady && <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading the offline map renderer…</p>}>
      <RecordedWorldMapCanvas points={projection.points} selectedId={selectedId} onSelect={focusPoint} />
    </Suspense>}
    {projection.points.length === 0
      ? <p role="status" className="font-ui text-sm text-muted-foreground">No recorded locations meet the selected source or UTC event-time filters.</p>
      : <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Map location list" className="min-w-0 rounded-lg border border-border/55 p-3">
          <h5 className="font-ui text-sm font-semibold text-foreground">Recorded locations ({projection.points.length})</h5>
          <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
            {projection.points.map(point => <li key={point.id}>
              <button type="button" onClick={() => focusPoint(point.id)}
                aria-pressed={selected?.id === point.id}
                className="min-h-10 w-full break-words rounded-md border border-border/50 px-3 py-2 text-left font-ui text-xs text-foreground hover:border-amber-300/45 focus-visible:ring-2 focus-visible:ring-amber-300/70">
                <span className="block font-semibold">{point.label}</span>
                <span className="block text-muted-foreground">{point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}
                  {point.hasSourceId ? " · source ID recorded" : " · no attached source ID"}</span>
              </button>
            </li>)}
          </ul>
        </section>
        <section aria-label="Selected map location provenance" className="min-w-0 space-y-2 rounded-lg border border-border/55 p-3 font-ui text-sm">
          <h5 className="font-semibold text-foreground">Location provenance</h5>
          {selected ? <>
            <p className="break-words font-medium">{selected.label}</p>
            <p className="text-muted-foreground">Latitude {selected.latitude.toFixed(6)} · Longitude {selected.longitude.toFixed(6)}</p>
            {selected.sourceRef
              ? <p className="break-all text-muted-foreground">Recorded source ID: <code>{selected.sourceRef}</code></p>
              : <p className="text-amber-200">No source ID attached. Coordinates are recorded, not independently verified.</p>}
            {selected.occurredAt && <p className="text-muted-foreground">Recorded event: <time dateTime={selected.occurredAt}>{new Date(selected.occurredAt).toLocaleString()}</time></p>}
          </> : <p className="text-muted-foreground">Select a marker or a location from the keyboard-accessible list to inspect the source reference and recorded time.</p>}
        </section>
      </div>}
    <p className="font-ui text-xs leading-5 text-muted-foreground">Public-domain Natural Earth 1:110m generalized borders (not navigation-grade; disputed boundaries may differ). Pins are exact {origin === "P7 Project graph" ? "P7 Project-recorded" : "P4 saved-table"} coordinates with retained source IDs, not geocoded names or device location. No online tiles or external location API.</p>
  </div>;
}
