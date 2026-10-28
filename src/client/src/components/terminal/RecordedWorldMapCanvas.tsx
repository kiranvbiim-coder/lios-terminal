import * as React from "react";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-csp-worker.js?url";
import type { FeatureCollection } from "geojson";
import countries from "@/lib/naturalEarth110mCountries.json";
import type { WorldPoint } from "@/lib/offlineWorldMapPresentation";
import "maplibre-gl/dist/maplibre-gl.css";

// The CSP worker is emitted as a same-origin bundle, never a blob or remote CDN.
maplibregl.setWorkerUrl(workerUrl);
const MERCATOR_LIMIT = 85.0511287798066;

/** Renderer only. P7/P4 and the parent projection own the coordinates and source/time admission. */
export default function RecordedWorldMapCanvas({ points, selectedId, onSelect }: {
  points: readonly WorldPoint[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [ready, setReady] = useState(false);
  const select = useRef(onSelect); select.current = onSelect;

  useEffect(() => {
    if (!host.current) return;
    let live = true;
    let instance: maplibregl.Map | null = null;
    try {
      instance = new maplibregl.Map({
        container: host.current, center: [0, 15], zoom: 0.5, minZoom: 0, maxZoom: 8,
        renderWorldCopies: false, attributionControl: false,
        style: {
          version: 8,
          sources: { countries: { type: "geojson", data: countries as FeatureCollection } },
          layers: [
            { id: "water", type: "background", paint: { "background-color": "#09131e" } },
            { id: "land", type: "fill", source: "countries", paint: { "fill-color": "#253c48", "fill-opacity": 0.85 } },
            { id: "borders", type: "line", source: "countries", paint: { "line-color": "#75919d", "line-width": 0.6 } },
          ],
        },
        // All source data is bundled. Unexpected external tiles/fonts/sprites fail closed.
        transformRequest: () => { throw new Error("External map resources are disabled."); },
      });
      map.current = instance;
      instance.on("load", () => { if (live) setReady(true); });
      instance.on("error", () => { if (live) { setUnavailable(true); setReady(false); } });
      instance.getCanvas().setAttribute("aria-label", "Offline recorded world geography. Arrow keys pan; plus and minus zoom.");
    } catch { setUnavailable(true); }
    const resize = new ResizeObserver(() => instance?.resize());
    if (host.current) resize.observe(host.current);
    return () => {
      live = false; resize.disconnect();
      markers.current.forEach(marker => marker.remove()); markers.current = [];
      instance?.remove(); map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    markers.current.forEach(marker => marker.remove());
    markers.current = points.filter(point => Math.abs(point.latitude) <= MERCATOR_LIMIT).map(point => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = "●";
      element.className = "grid h-11 w-11 place-items-center rounded-full border-2 border-amber-200 bg-zinc-950/90 text-xl text-amber-300 focus-visible:ring-4 focus-visible:ring-amber-300";
      element.setAttribute("aria-label", `Inspect recorded map location ${point.label}`);
      element.setAttribute("aria-pressed", String(point.id === selectedId));
      element.title = point.label;
      element.addEventListener("click", () => select.current(point.id));
      return new maplibregl.Marker({ element }).setLngLat([point.longitude, point.latitude]).addTo(instance);
    });
    return () => { markers.current.forEach(marker => marker.remove()); markers.current = []; };
  }, [points, ready, selectedId]);

  useEffect(() => {
    const point = points.find(item => item.id === selectedId);
    if (ready && point && Math.abs(point.latitude) <= MERCATOR_LIMIT)
      map.current?.jumpTo({ center: [point.longitude, point.latitude], zoom: Math.max(map.current.getZoom(), 2) });
  }, [points, selectedId, ready]);

  const polar = points.filter(point => Math.abs(point.latitude) > MERCATOR_LIMIT).length;
  return <section aria-label="Offline MapLibre world geography" className="space-y-2">
    <div role="group" aria-label="World map controls" className="flex flex-wrap gap-2">
      <button type="button" disabled={!ready} aria-label="Zoom world map out" onClick={() => map.current?.jumpTo({ zoom: Math.max(0, map.current.getZoom() - 0.5) })} className="min-h-11 rounded border border-border/60 px-3 text-sm">Zoom out</button>
      <button type="button" disabled={!ready} aria-label="Zoom world map in" onClick={() => map.current?.jumpTo({ zoom: Math.min(8, map.current.getZoom() + 0.5) })} className="min-h-11 rounded border border-border/60 px-3 text-sm">Zoom in</button>
      <button type="button" disabled={!ready} aria-label="Fit whole world map" onClick={() => map.current?.fitBounds([[-180, -70], [180, 80]], { padding: 10, duration: 0 })} className="min-h-11 rounded border border-border/60 px-3 text-sm">Fit world</button>
    </div>
    <div ref={host} data-testid="offline-world-map-viewport" className="relative h-[310px] min-w-0 overflow-hidden rounded-lg border border-border/60 bg-[#09131e] sm:h-[420px]" />
    {unavailable && <p role="alert" className="text-sm text-amber-200">Offline MapLibre rendering is unavailable on this device. Exact recorded coordinates and source references remain accessible in the location list; no online basemap is requested.</p>}
    {!ready && !unavailable && <p role="status" className="text-sm text-muted-foreground">Loading bundled offline geography…</p>}
    {polar > 0 && <p role="status" className="text-sm text-muted-foreground">{polar} polar location(s) exceed this renderer’s Mercator latitude range. Their exact coordinates remain in the list and have not been clamped or inferred.</p>}
    <p className="font-ui text-xs text-muted-foreground">MapLibre GL JS · Natural Earth public-domain borders · offline, no tiles, geocoding, tracking, remote fonts or location service.</p>
  </section>;
}
