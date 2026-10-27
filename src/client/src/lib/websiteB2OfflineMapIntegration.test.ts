import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");

test("Project P7 geography tab reuses exact selected-insight recorded nodes and offline map owner",()=>{
  const desk=source("../components/terminal/ProjectInvestigationDesk.tsx");
  assert.match(desk,/recordedGeographicPoints\(projectId, validGraph\)/);
  assert.match(desk,/geographic\.filter\(point => implicated\.has\(point\.id\)\)/);
  assert.match(desk,/<OfflineProjectWorldMap key=\{projectId \+ ":" \+ selected\.id\} points=\{localGeographic\} \/>/);
  assert.match(desk,/aria-label="Recorded geographic coordinates"/);
  assert.match(desk,/none are directly linked to the chosen insight/);
  assert.doesNotMatch(desk,/GeographicEvidenceDiagram|navigator\.geolocation|mapbox|new maplibre/);
});

test("map is one bounded first-party static atlas, not third-party map API or speculative geocoding",()=>{
  const map=source("../components/terminal/OfflineProjectWorldMap.tsx");
  const selector=source("./offlineWorldMapPresentation.ts");
  assert.match(map,/const ATLAS = "\/maps\/natural-earth-110m-world\.svg"/);
  assert.match(map,/projectOfflineWorldPoints\(points, \{ sourceOnly, withEventDate \}\)/);
  assert.match(map,/onPointerMove=\{event =>/);
  assert.match(map,/onKeyDown=\{event =>/);
  assert.match(map,/onError=\{\(\) => setAtlasUnavailable\(true\)\}/);
  assert.match(map,/no online basemap will be requested/);
  assert.match(map,/Only points with recorded source IDs/);
  assert.match(map,/Only points with recorded event dates/);
  assert.match(selector,/const MAX_POINTS = 60/);
  assert.doesNotMatch(map,/fetch\(|XMLHttpRequest|navigator\.geolocation|window\.location|eval\(|new WebSocket|maptiler|googleapis|demotiles/);
  // Documentation may truthfully explain it is *not* geocoding. Prohibit
  // executable/geolocation inference, not the mere word inside a comment.
  assert.doesNotMatch(selector,/\b(?:geocode|geoip)\s*\(|Math\.random\s*\(/);
});
