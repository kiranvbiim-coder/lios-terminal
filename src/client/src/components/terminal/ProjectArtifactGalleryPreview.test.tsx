import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  checkedGalleryArtifactContent,
  GalleryRecordedPreviewContent,
  recordedGalleryChartPath,
} from "./ProjectArtifactGalleryPreview";
import type { ArtifactDetail, ProjectArtifactRecord } from "@/lib/useArtifacts";
import type { ArtifactContent } from "@shared/artifactContracts";

const saved = {
  id: "saved-42", projectId: 6, kind: "chart" as const,
  headVersion: 3, status: "active" as const, title: "Saved forecast",
};
const chart: Extract<ArtifactContent, { kind: "chart" }> = {
  kind: "chart", rendererPreference: "recharts", chartType: "line",
  series: [{ id: "a", label: "Observed", points: [
    { x: "jan", y: 10 }, { x: "feb", y: 20 }, { x: "mar", y: 30 },
  ] }], options: {},
};
function exact(overrides: { artifact?: Record<string, unknown>; version?: Record<string, unknown> } = {}): ArtifactDetail {
  return {
    artifact: { ...saved, ...overrides.artifact },
    version: { artifactId: saved.id, version: saved.headVersion, content: chart, ...overrides.version },
  } as ArtifactDetail;
}
test("gallery preview only uses matching exact Project, version, identity, kind and status", () => {
  assert.equal(checkedGalleryArtifactContent(saved, exact()), chart);
  assert.equal(checkedGalleryArtifactContent(saved, exact({ artifact: { projectId: 7 } })), null);
  assert.equal(checkedGalleryArtifactContent(saved, exact({ artifact: { id: "different" } })), null);
  assert.equal(checkedGalleryArtifactContent(saved, exact({ artifact: { headVersion: 4 } })), null);
  assert.equal(checkedGalleryArtifactContent(saved, exact({ artifact: { kind: "table" } })), null);
  assert.equal(checkedGalleryArtifactContent(saved, exact({ artifact: { status: "archived" } })), null);
  assert.equal(checkedGalleryArtifactContent(saved, exact({ version: { version: 2 } })), null);
  assert.equal(checkedGalleryArtifactContent(saved, exact({ version: { artifactId: "wrong" } })), null);
  assert.equal(checkedGalleryArtifactContent(saved, undefined), null);
});

test("chart artwork plots only recorded numeric values", () => {
  assert.equal(recordedGalleryChartPath(chart), "M8.00,82.00 L150.00,47.00 L292.00,12.00");
  assert.equal(recordedGalleryChartPath({ ...chart, series: [] }), null);
  const html = renderToStaticMarkup(React.createElement(GalleryRecordedPreviewContent, { content: chart }));
  assert.match(html, /3 recorded points/);
  assert.match(html, /First 3 saved positions/);
  assert.match(html, /M8\.00,82\.00 L150\.00,47\.00 L292\.00,12\.00/);
});

test("gallery line preview preserves missing positions and never connects across gaps", () => {
  const interrupted: typeof chart = { ...chart, series: [{ ...chart.series[0], points: [
    { x: "jan", y: 10 }, { x: "feb", y: Number.NaN }, { x: "mar", y: 20 }, { x: "apr", y: 30 },
  ] }] };
  const path = recordedGalleryChartPath(interrupted);
  assert.equal(path, "M8.00,82.00 M197.33,47.00 L292.00,12.00");
  assert.doesNotMatch(path!, /NaN|Infinity|L197\.33/);
  const html = renderToStaticMarkup(React.createElement(GalleryRecordedPreviewContent, { content: interrupted }));
  assert.match(html, /gaps are not joined/);
  assert.match(html, /missing points remain disconnected/);
});

test("non-line charts never invent a linear trend preview", () => {
  const bar: typeof chart = { ...chart, chartType: "bar" };
  assert.equal(recordedGalleryChartPath(bar), null);
  const html = renderToStaticMarkup(React.createElement(GalleryRecordedPreviewContent, { content: bar }));
  assert.doesNotMatch(html, /<svg\b|<path\b/);
  assert.match(html, /not a line chart/);
  assert.match(html, /3 recorded points/);
});

test("finite extreme and flat line data produce only finite SVG coordinates", () => {
  const extreme: typeof chart = { ...chart, series: [{ ...chart.series[0], points: [
    { x: "a", y: -Number.MAX_VALUE }, { x: "b", y: Number.MAX_VALUE },
  ] }] };
  assert.equal(recordedGalleryChartPath(extreme), "M8.00,82.00 L292.00,12.00");
  const flat: typeof chart = { ...chart, series: [{ ...chart.series[0], points: [
    { x: "a", y: 10 }, { x: "b", y: 10 },
  ] }] };
  assert.equal(recordedGalleryChartPath(flat), "M8.00,47.00 L292.00,47.00");
  const incomplete: typeof chart = { ...chart, series: [{ ...chart.series[0], points: [
    { x: "a", y: 1 }, { x: "b", y: Number.NaN },
  ] }] };
  assert.equal(recordedGalleryChartPath(incomplete), null);
});
test("recorded table preview uses exact rows, has semantic headings, and escapes cells", () => {
  const table: Extract<ArtifactContent, { kind: "table" }> = {
    kind: "table",
    columns: [{ key: "a", label: "Company", type: "string" }, { key: "b", label: "Value", type: "number" }],
    rows: [{ a: "<script>bad</script>", b: 23 }],
  };
  const html = renderToStaticMarkup(React.createElement(GalleryRecordedPreviewContent, { content: table }));
  assert.match(html, /<th scope="col"/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, />23<\/td>/);
  assert.doesNotMatch(html, /<script\b/);
});

test("document previews display recorded text, never invented marketing copy", () => {
  const report: Extract<ArtifactContent, { kind: "report" }> = {
    kind: "report", templateId: null, editorPreference: "builtin",
    sections: [], blocks: [{ id: "x", type: "paragraph", text: "Authorized report findings", attrs: {} }],
  };
  const html = renderToStaticMarkup(React.createElement(GalleryRecordedPreviewContent, { content: report }));
  assert.match(html, /Authorized report findings/);
  assert.match(html, /Report · 0 sections · 1 saved blocks/);
  assert.doesNotMatch(html, /sample data|demo chart/i);
});
