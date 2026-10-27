import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AuthorizedVisualAnswer } from "../../../shared/governedVisualAnswer";
import { projectSavedTableGeography } from "./governedTableGeography";

const table: Extract<AuthorizedVisualAnswer, { kind: "table" }> = {
  status: "ready", kind: "table", version: 2, title: "Public project locations",
  sourceRefs: ["evidence:p7:one", "evidence:p7:two"],
  content: {
    kind: "table",
    columns: [
      { key: "Latitude", label: "Latitude", type: "number" },
      { key: "Longitude", label: "Longitude", type: "number" },
      { key: "source_ref", label: "Source Ref", type: "string" },
      { key: "place_name", label: "Location", type: "string" },
      { key: "event_date", label: "Event Date", type: "date" },
    ],
    rows: [
      { Latitude: 13.08, Longitude: 80.27, source_ref: "evidence:p7:one", place_name: "Chennai", event_date: "2026-10-27" },
      { Latitude: 9.92, Longitude: 78.12, source_ref: "evidence:p7:two", place_name: "Madurai" },
    ],
  },
};
test("exact authorized saved table rows become coordinates on the existing offline map", () => {
  const result = projectSavedTableGeography(table);
  assert.equal(result.scannedRows, 2);
  assert.equal(result.eligibleCount, 2);
  assert.equal(result.points[0].latitude, 13.08);
  assert.equal(result.points[0].longitude, 80.27);
  assert.equal(result.points[0].sourceRef, "evidence:p7:one");
  assert.equal(result.points[0].occurredAt, "2026-10-27T00:00:00.000Z");
  assert.equal(result.points[1].occurredAt, null);
});
test("reject inferred coordinates, source mismatch, invalid range and missing source-ref columns", () => {
  const broken = { ...table, content: { ...table.content, rows: [
    { Latitude: "13.08", Longitude: "80.27", source_ref: "evidence:p7:one" },
    { Latitude: 180, Longitude: 80, source_ref: "evidence:p7:one" },
    { Latitude: 10, Longitude: Number.POSITIVE_INFINITY, source_ref: "evidence:p7:one" },
    { Latitude: 10, Longitude: 80, source_ref: "unapproved:secret" },
    { Latitude: 10, Longitude: 80, source_ref: null },
  ] } } as typeof table;
  assert.equal(projectSavedTableGeography(broken).points.length, 0);
  assert.equal(projectSavedTableGeography({
    ...table, content: { ...table.content, columns: table.content.columns.filter(c => c.key !== "source_ref") },
  }).points.length, 0);
  const chart: AuthorizedVisualAnswer = {
    status: "ready", kind: "chart", title: "Series", version: 1, sourceRefs: ["evidence:p7:one"],
    content: { kind: "chart", chartType: "line", rendererPreference: "recharts",
      series: [{ id: "s1", label: "Recorded series", points: [{ x: 1, y: 2 }] }], options: {} },
  };
  assert.equal(projectSavedTableGeography(chart).points.length, 0);
});
test("bounded map projection never displays more than 60 source-verified points or scans over 1000 rows", () => {
  const lots = { ...table, content: { ...table.content,
    rows: Array.from({ length: 1_050 }, () => ({
      Latitude: 10, Longitude: 10, source_ref: "evidence:p7:one", place_name: "Recorded coordinate",
    })),
  } };
  const result = projectSavedTableGeography(lots);
  assert.equal(result.scannedRows, 1000);
  assert.equal(result.eligibleCount, 1000);
  assert.equal(result.points.length, 60);
  assert.equal(result.omittedCount, 940);
});
test("Chat map uses saved source-backed table only, no external map network or invented location", () => {
  const ui = readFileSync(new URL("../components/terminal/GovernedVisualAnswer.tsx", import.meta.url), "utf8");
  assert.match(ui, /projectSavedTableGeography\(decision\)/);
  assert.match(ui, /<OfflineProjectWorldMap points=\{mapProjection\.points\} origin="P4 saved table"/);
  assert.match(ui, /View recorded locations/);
  assert.doesNotMatch(ui, /geocode|mapbox|googleapis|OpenStreetMap|createArtifact\(/i);
});
