import test from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { artifactExportPlanSchema } from "@shared/artifactContracts";
import { readOfficeArtifactRoundtrip } from "@shared/officeArtifactRoundtrip";
import type { P7InsightLens } from "@shared/p7ResearchContracts";
import { composeProjectBriefing } from "./phase4Briefing";
import { buildNativeArtifactPptx } from "./nativeArtifactPptx";
import { buildArtifactDocx } from "./exportDocx";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";

const hash = "c".repeat(64);
const source = "source:filing:recorded-q3";
const lens: P7InsightLens = {
  schemaVersion: "1", projectId: 7, generatedAt: "2026-10-27T09:00:00Z",
  counts: { change: 1 },
  insights: [{ id: "recorded", kind: "change", title: "Observed source update",
    summary: "This is a captured Project claim requiring review.", severity: "watch",
    deterministic: true, occurredAt: "2026-10-25T00:00:00Z", sourceRefs: [source], entityRefs: [] }],
};
const chart: PinnedBriefingVisual = {
  projectId: 7, artifactId: "artifact:real-chart", version: 4, contentHash: hash,
  title: "Quarterly trend", sourceRefs: [source],
  content: { kind: "chart", rendererPreference: "recharts", chartType: "line",
    series: [{ id: "values", label: "Reported value", points: [{ x: "Q1", y: 12 }, { x: "Q2", y: 14 }] }],
    options: {} },
};
const table: PinnedBriefingVisual = {
  projectId: 7, artifactId: "artifact:real-table", version: 2, contentHash: hash,
  title: "Source observations", sourceRefs: [source],
  content: { kind: "table",
    columns: [{ key: "period", label: "Period", type: "string" }, { key: "amount", label: "Recorded number", type: "number" }],
    rows: [{ period: "Q1", amount: 12 }, { period: "Q2", amount: 14 }] },
};
function draft() {
  const result = composeProjectBriefing({ projectId: 7, title: "Source-owned editable briefing",
    layout: "research", insightIds: ["recorded"], editorNote: "" }, lens, [], [chart, table]);
  assert.ok(result);
  return result;
}
test("D2 real P4 briefing PPTX produces editable native chart + table and round-trips exact canonical content", async () => {
  const composed = draft();
  const content = composed.content;
  const plan = artifactExportPlanSchema.parse({ artifactId: "artifact:briefing",
    version: 1, kind: "report", formats: ["pptx"], filenameStem: "Recorded P4 Briefing",
    contentHash: hash, sourceRefs: composed.sourceRefs });
  const output = await buildNativeArtifactPptx(plan, content);
  assert.ok(output.slideCount >= 2);
  const files = unzipSync(output.bytes);
  const charts = Object.entries(files).filter(([p]) => /^ppt\/charts\/chart\d+\.xml$/.test(p));
  assert.equal(charts.length, 1, "A native editable chart must exist, not a screenshot");
  const slides = Object.entries(files).filter(([p]) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  assert.ok(slides.some(([, b]) => strFromU8(b).includes("<a:tbl>")), "An editable PowerPoint table must exist");
  assert.ok(files["customXml/liosArtifact.xml"], "P4 source metadata must accompany the Office presentation");
  assert.ok(Object.keys(files).some(p => /^ppt\/embeddings\//.test(p)), "Chart workbook must retain editable numeric data");
  const opened = await readOfficeArtifactRoundtrip(output.bytes, "pptx");
  assert.deepEqual(opened.content, content, "Opening the PPTX must recover exact saved P4 report blocks and pinned provenance");
  const again = await buildNativeArtifactPptx(plan, content);
  assert.deepEqual(again.bytes, output.bytes, "Exact source/version PowerPoint bytes should be deterministic");
});
test("D2 DOCX preserves native table and the canonical visual source metadata", () => {
  const composed = draft();
  const plan = artifactExportPlanSchema.parse({ artifactId: "artifact:briefing",
    version: 1, kind: "report", formats: ["docx"], filenameStem: "Recorded P4 Briefing",
    contentHash: hash, sourceRefs: composed.sourceRefs });
  const output = buildArtifactDocx(plan, composed.content);
  const files = unzipSync(output.bytes);
  const xml = strFromU8(files["word/document.xml"]);
  assert.ok(xml.includes("<w:tbl>"), "Recorded data table must remain a native Word table");
  assert.ok(files["customXml/liosArtifact.xml"], "Office output must retain original P4 source/version metadata");
});
