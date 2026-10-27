import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineProjectWorldMap } from "./OfflineProjectWorldMap";
import type { RecordedGeographicPoint } from "@/lib/offlineWorldMapPresentation";

const pins: RecordedGeographicPoint[]=[
  {id:"ok",label:"Recorded station",latitude:11,longitude:77,sourceRef:"src:station",occurredAt:"2026-10-27T08:00:00Z"},
  {id:"weak",label:"Unattributed location",latitude:12,longitude:78,sourceRef:null,occurredAt:null},
];
const render=(points:RecordedGeographicPoint[])=>renderToStaticMarkup(React.createElement(OfflineProjectWorldMap,{points}));

test("real offline atlas with no remote tiles supports zoom/fit, source layers and keyboard marker list",()=>{
  const html=render(pins);
  assert.match(html,/data-testid="offline-project-world-map"/);
  assert.match(html,/src="\/maps\/natural-earth-110m-world\.svg"/);
  assert.match(html,/Zoom world map in/);
  assert.match(html,/Zoom world map out/);
  assert.match(html,/Fit whole world map/);
  assert.match(html,/Recorded geography layers/);
  assert.match(html,/Only points with recorded source IDs/);
  assert.match(html,/Only points with recorded event dates/);
  assert.match(html,/Find a recorded location or source/);
  assert.match(html,/Search saved locations, IDs or source references/);
  assert.match(html,/No place lookup, device location or network request/);
  assert.match(html,/type="search"/);

  assert.match(html,/data-testid="recorded-map-location"/);
  assert.match(html,/Recorded station/);
  assert.match(html,/Unattributed location/);
  assert.match(html,/public-domain Natural Earth/i);
  assert.match(html,/no.*geocoded names|not geocoded names/i);
  assert.doesNotMatch(html,/(?:src|href)=["\u0027]https?:\/\/|api_key|<iframe|<script|maptiler|openstreetmap\.org/);
});

test("empty Project location view gives explicit truthful state, never a demo map with pins",()=>{
  const html=render([]);
  assert.match(html,/No coordinate-bearing Project geography/);
  assert.doesNotMatch(html,/recorded-map-location|data-testid="offline-world-map-viewport"/);
});

test("bundled Natural Earth asset is pinned and safe to display offline",()=>{
  const atlas=readFileSync(new URL("../../../public/maps/natural-earth-110m-world.svg",import.meta.url),"utf8");
  assert.match(atlas,/viewBox="0 0 1152 576"/);
  assert.match(atlas,/ca96624a56bd078437bca8184e78163e5039ad19/);
  assert.match(atlas,/Natural Earth public domain/);
  assert.match(atlas,/<path d="M/);
  assert.ok(atlas.length>50000&&atlas.length<250000);
  assert.doesNotMatch(atlas,/<script|<iframe|<foreignObject|onload=|onclick=|http-equiv|xlink:href|<image|<use|url\(https?:|<style/gi);
  assert.equal(atlas.includes("token="),false);
});


test("B01 single offline map uses the same approved point projection for search and pins", () => {
  const source=readFileSync(new URL("./OfflineProjectWorldMap.tsx",import.meta.url),"utf8");
  assert.match(source,/projectOfflineWorldPoints\(points, \{ sourceOnly, withEventDate, query \}\)/);
  assert.match(source,/onChange=\{event => \{ setQuery\(event\.target\.value\); setSelectedId\(null\); \}\}/);
  assert.match(source,/setQuery\(""\)/);
  assert.match(source,/aria-label="Map location list"/);
  assert.doesNotMatch(source,/fetch\(|navigator\.geolocation|mapboxgl|maplibregl|localStorage/);
});
