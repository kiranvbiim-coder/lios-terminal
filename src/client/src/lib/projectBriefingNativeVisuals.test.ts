import test from "node:test";
import assert from "node:assert/strict";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";
import type { BriefingSource } from "./projectBriefingStoryboard";
import { buildProjectBriefingReport } from "./projectBriefingStoryboard";
import { reportArtifactContentSchema } from "@shared/artifactContracts";

const sha = "a".repeat(64);
const sources: BriefingSource[] = [
  { id: "chart-1", projectId: 11, kind: "chart", title: "Saved growth", status: "active", headVersion: 3 },
  { id: "table-1", projectId: 11, kind: "table", title: "Saved values", status: "active", headVersion: 2 },
];
const chart: PinnedBriefingVisual = {
  artifactId: "chart-1", projectId: 11, version: 3, contentHash: sha, title: "Saved growth",
  sourceRefs: ["filing:2026"], content: { kind: "chart", chartType: "line", rendererPreference: "recharts",
    series: [{ id: "revenue", label: "Revenue", points: [{ x: "2025", y: 12 }, { x: "2026", y: 14 }] }], options: {} },
};
const table: PinnedBriefingVisual = {
  artifactId: "table-1", projectId: 11, version: 2, contentHash: sha, title: "Saved values",
  sourceRefs: ["filing:2026", "report:original"], content: { kind: "table",
    columns: [{ key: "period", label: "Period", type: "string" }, { key: "amount", label: "Amount", type: "number" }],
    rows: [{ period: "2025", amount: 12 }, { period: "2026", amount: 14 }] },
};
const draft = (visuals: PinnedBriefingVisual[]) => buildProjectBriefingReport({
  projectId: 11, title: "Investor board brief", introduction: "Recorded results only", sources, visuals,
});

test("existing eight-source storyboard remains editable and no visual is copied automatically", () => {
  const original = draft([]);
  assert.equal(original.content.kind, "report");
  assert.equal(original.content.blocks.filter(block => block.type === "artifact_ref").length, 2);
  assert.equal(original.content.blocks.filter(block => block.type === "chart_ref" || block.type === "table").length, 0);
  assert.deepEqual(original.dependencyRefs, ["chart-1", "table-1"]);
  assert.deepEqual(original.sourceRefs, []);
});
test("explicitly pinned native chart and table preserve exact saved values, versions and source hashes", () => {
  const result = draft([chart, table]);
  assert.equal(reportArtifactContentSchema.safeParse(result.content).success, true);
  const nativeChart = result.content.blocks.find(b => b.id === "briefing-frame-1-native-visual");
  const nativeTable = result.content.blocks.find(b => b.id === "briefing-frame-2-native-visual");
  assert.equal(nativeChart?.type, "chart_ref");
  assert.equal(nativeTable?.type, "table");
  assert.deepEqual(nativeChart?.attrs.chart, chart.content);
  assert.deepEqual(nativeTable?.attrs.table, table.content);
  assert.equal(nativeChart?.attrs.p4Version, 3);
  assert.equal(nativeTable?.attrs.p4Version, 2);
  assert.equal(nativeChart?.attrs.p4ContentHash, sha);
  assert.deepEqual(result.sourceRefs, ["filing:2026", "report:original"]);
  assert.ok(result.dependencyRefs.includes("artifact-version:chart-1:v3:" + sha));
  assert.ok(result.dependencyRefs.includes("artifact-version:table-1:v2:" + sha));
  assert.ok(result.content.sections[1].blockIds.includes(nativeChart!.id));
  assert.ok(result.content.sections[2].blockIds.includes(nativeTable!.id));
});
test("visual pins cannot silently substitute other Project, version or unselected sources", () => {
  assert.throws(() => draft([{ ...chart, projectId: 5 }]), /must match/);
  assert.throws(() => draft([{ ...chart, version: 8 }]), /must match/);
  assert.throws(() => draft([{ ...chart, artifactId: "unselected" }]), /must match/);
  assert.throws(() => draft([{ ...chart, sourceRefs: [] }]), /must match/);
  assert.throws(() => draft([chart, chart]), /three distinct/);
  assert.throws(() => draft([chart, table, { ...chart, artifactId: "extra" }, table]), /three distinct/);
});
