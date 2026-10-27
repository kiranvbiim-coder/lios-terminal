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
