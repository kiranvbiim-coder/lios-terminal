import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineProjectWorldMap } from "./OfflineProjectWorldMap";
import type { RecordedGeographicPoint } from "@/lib/offlineWorldMapPresentation";

const pins: RecordedGeographicPoint[]=[
  {id:"ok",label:"Recorded station",latitude:11,longitude:77,sourceRef:"src:station",occurredAt:"2026-10-27T08:00:00Z"},
  {id:"weak",label:"Unattributed location",latitude:12,longitude:78,sourceRef:null,occurredAt:null},
];
const render=(points:RecordedGeographicPoint[])=>renderToStaticMarkup(React.createElement(OfflineProjectWorldMap,{points}));


test("empty Project location view gives explicit truthful state, never a demo map with pins",()=>{
  const html=render([]);
  assert.match(html,/No coordinate-bearing Project geography/);
  assert.doesNotMatch(html,/recorded-map-location|data-testid="offline-world-map-viewport"/);
});



test("B01 actual UTC time-window and scrubber live inside the existing offline map",()=>{
  const html=render(pins);
  assert.match(html,/data-testid="world-map-time-controls"/);
  assert.match(html,/Filter by recorded event time/);
  assert.match(html,/1 distinct recorded UTC day/);
  assert.doesNotMatch(html, /http[s]?:\/\/[^"]+\.tile|mapbox-gl|maptiler/);
});
