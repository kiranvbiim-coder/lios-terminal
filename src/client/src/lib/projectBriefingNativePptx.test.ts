import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { artifactExportPlanSchema } from "@shared/artifactContracts";
import { buildProjectBriefingReport } from "./projectBriefingStoryboard";
import { buildArtifactPptx } from "./exportPptx";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";

const digest = "a".repeat(64);
const chart: PinnedBriefingVisual = {
  projectId: 11, artifactId: "chart:recorded", title: "Revenue trend",
  version: 3, contentHash: digest, sourceRefs: ["filing:2026"],
  content: { kind: "chart", chartType: "line", rendererPreference: "recharts",
    series: [{ id: "revenue", label: "Revenue", points: [{ x: "2025", y: 12 }, { x: "2026", y: 14 }] }], options: {} },
};
const table: PinnedBriefingVisual = {
  projectId: 11, artifactId: "table:recorded", title: "Reported totals",
  version: 2, contentHash: digest, sourceRefs: ["filing:2026"],
  content: { kind: "table", columns: [{ key: "period", label: "Period", type: "string" },
    { key: "total", label: "Total", type: "number" }],
    rows: [{ period: "2025", total: 12 }, { period: "2026", total: 14 }] },
};

test("D1 saved-source storyboard exports actual editable native PPTX chart + table objects", async () => {
  const report = buildProjectBriefingReport({
    projectId: 11, title: "Evidence review", introduction: "Measured values, not model predictions",
    sources: [
      { id: chart.artifactId, projectId: 11, title: chart.title, kind: "chart", headVersion: 3, status: "active" },
      { id: table.artifactId, projectId: 11, title: table.title, kind: "table", headVersion: 2, status: "active" },
    ],
    visuals: [chart, table],
  });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "artifact:native:briefing", version: 1, kind: "report",
    formats: ["pptx", "json"], filenameStem: "Evidence review",
    contentHash: "b".repeat(64), sourceRefs: report.sourceRefs,
  });
  const original = structuredClone(report.content);
  const result = await buildArtifactPptx(plan, report.content);
  assert.match(result.filename, /\.pptx$/);
  const files = unzipSync(result.bytes);
  const slideXml = Object.entries(files)
    .filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .map(([, contents]) => strFromU8(contents));
  assert.ok(slideXml.some(xml => xml.includes("<c:chart")), "a native editable Office chart appears on a slide");
  assert.ok(slideXml.some(xml => xml.includes("<a:tbl>")), "a native editable Office table appears on a slide");
  const editableWorkbook = Object.keys(files).find(path => path.endsWith(".xlsx"));
  assert.ok(editableWorkbook, "native chart has its own local editable Office workbook");
  const tableSlides = slideXml.filter(xml => xml.includes("<a:tbl>")).join("\n");
  assert.match(tableSlides, /2025/);
  assert.match(tableSlides, /2026/);
  assert.match(tableSlides, /14/);
  const chartXml = Object.entries(files)
    .filter(([path]) => /^ppt\/charts\/chart\d+\.xml$/.test(path))
    .map(([, contents]) => strFromU8(contents)).join("\n");
  assert.match(chartXml, /<c:lineChart>/);
  assert.match(chartXml, /<c:v>14<\/c:v>/);
  assert.ok(!Object.keys(files).some(path => /^https?:\/\//.test(path)), "no remote content required");
  assert.deepEqual(report.content, original, "export cannot rewrite canonical P4 values");
});
