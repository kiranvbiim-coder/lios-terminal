import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Focus, MapPin, Minus, Plus } from "lucide-react";
import { projectOfflineWorldPoints, recordedWorldMapDays, type RecordedGeographicPoint } from "@/lib/offlineWorldMapPresentation";

const WIDTH = 1152;
const HEIGHT = 576;
const MIN_ZOOM = 0.23;
const MAX_ZOOM = 4;
const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
const ATLAS = "/maps/natural-earth-110m-world.svg";

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
  const [atlasUnavailable, setAtlasUnavailable] = useState(false);
  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; fromX: number; fromY: number } | null>(null);
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

  const fit = () => {
    const width = viewportRef.current?.clientWidth ?? 560;
    const height = viewportRef.current?.clientHeight ?? 360;
    const next = clampZoom(Math.min((width - 20) / WIDTH, (height - 20) / HEIGHT, 1));
    setZoom(next);
    setPan({ x: (width - WIDTH * next) / 2, y: (height - HEIGHT * next) / 2 });
  };
  useEffect(() => {
    fit();
    const update = () => fit();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  function focusPoint(id: string) {
    const point = projection.points.find(item => item.id === id);
    if (!point) return;
    setSelectedId(id);
    const width = viewportRef.current?.clientWidth ?? 560;
    const height = viewportRef.current?.clientHeight ?? 360;
    const next = clampZoom(Math.max(zoom, 1.1));
    setZoom(next);
    setPan({
      x: width / 2 - (point.x / 100) * WIDTH * next,
      y: height / 2 - (point.y / 100) * HEIGHT * next,
    });
  }

  if (!points.length) return <p role="status" className="rounded-lg border border-dashed border-border/60 p-3 font-ui text-sm text-muted-foreground">
    No coordinate-bearing Project geography is directly linked to this insight. No location has been inferred.
  </p>;

  return <div data-testid="offline-project-world-map" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2 font-ui text-xs text-muted-foreground" role="status">
        <span>{projection.points.length} locations plotted</span>
        {projection.omittedCount > 0 && <span>{projection.omittedCount} omitted from bounded map view</span>}
      </div>
      <div role="group" aria-label="World map controls" className="flex flex-wrap gap-1.5">
        <button type="button" aria-label="Zoom world map out" onClick={() => setZoom(value => clampZoom(value - 0.16))}
          className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-border/60 focus-visible:ring-2 focus-visible:ring-amber-300/70"><Minus className="h-4 w-4" aria-hidden="true"/></button>
        <button type="button" aria-label="Zoom world map in" onClick={() => setZoom(value => clampZoom(value + 0.16))}
          className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-border/60 focus-visible:ring-2 focus-visible:ring-amber-300/70"><Plus className="h-4 w-4" aria-hidden="true"/></button>
        <button type="button" aria-label="Fit whole world map" onClick={fit}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border/60 px-3 font-ui text-xs focus-visible:ring-2 focus-visible:ring-amber-300/70"><Focus className="h-4 w-4" aria-hidden="true"/>Fit world</button>
      </div>
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
    <div ref={viewportRef} role="region" tabIndex={0}
      aria-label="Offline world map. Drag blank space to pan, use zoom controls, Tab to location markers or select locations in the list."
      data-testid="offline-world-map-viewport"
      className="relative h-[310px] min-w-0 touch-none overflow-hidden rounded-lg border border-border/60 bg-[#09131e] outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 sm:h-[420px]"
      onWheel={event => {
        if (document.activeElement !== event.currentTarget &&
          !event.currentTarget.contains(document.activeElement)) return;
        if (event.cancelable) event.preventDefault();
        setZoom(value => clampZoom(value + (event.deltaY < 0 ? 0.1 : -0.1)));
      }}
      onPointerDown={event => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        dragRef.current = { id:event.pointerId, x:event.clientX, y:event.clientY, fromX:pan.x, fromY:pan.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (drag?.id !== event.pointerId) return;
        setPan({ x: drag.fromX + event.clientX - drag.x, y: drag.fromY + event.clientY - drag.y });
      }}
      onPointerCancel={() => { dragRef.current = null; }}
      onPointerUp={event => { if (dragRef.current?.id === event.pointerId) dragRef.current = null; }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const dx = event.key === "ArrowLeft" ? -40 : event.key === "ArrowRight" ? 40 : 0;
        const dy = event.key === "ArrowUp" ? -40 : event.key === "ArrowDown" ? 40 : 0;
        if (dx || dy) { event.preventDefault(); setPan(previous => ({x:previous.x+dx,y:previous.y+dy})); }
        if (event.key === "Home") { event.preventDefault(); fit(); }
      }}>
      <div className="pointer-events-none absolute left-0 top-0" style={{
        width: WIDTH, height: HEIGHT,
        transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
        transformOrigin: "top left",
      }}>
        <img src={ATLAS} alt="" aria-hidden="true" draggable={false}
          width={WIDTH} height={HEIGHT} decoding="async"
          onLoad={() => setAtlasUnavailable(false)} onError={() => setAtlasUnavailable(true)}
          className="absolute inset-0 h-full w-full select-none" />
        {projection.points.map(point => <button key={point.id} type="button"
          aria-label={`Inspect recorded map location ${point.label}`}
          aria-pressed={selected?.id === point.id}
          onClick={() => focusPoint(point.id)}
          title={point.label}
          data-testid="recorded-map-location"
          className={`pointer-events-auto absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 focus-visible:z-30 focus-visible:ring-4 focus-visible:ring-amber-300/70 ${selected?.id === point.id
            ? "z-20 border-white bg-amber-400 text-zinc-950" : point.hasSourceId
            ? "border-amber-200/90 bg-amber-400/90 text-zinc-950 hover:bg-amber-200"
            : "border-dashed border-amber-200/80 bg-zinc-950 text-amber-300 hover:bg-zinc-900"}`}
          style={{ left: `${point.x}%`, top: `${point.y}%` }}>
          <MapPin className="h-4 w-4" aria-hidden="true"/>
        </button>)}
      </div>
      <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border/50 bg-[#07131c]/90 px-2 py-1 font-ui text-xs text-white/75">Natural Earth · offline · {Math.round(zoom * 100)}%</span>
    </div>
    {atlasUnavailable && <p role="alert" className="rounded-lg border border-amber-300/40 p-3 font-ui text-sm text-amber-200">Bundled world outline unavailable. Recorded coordinates remain accessible below; no online basemap will be requested.</p>}
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
