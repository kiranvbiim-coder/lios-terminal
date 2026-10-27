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
  assert.match(html, /First 3 recorded points/);
  assert.match(html, /M8\.00,82\.00 L150\.00,47\.00 L292\.00,12\.00/);
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
