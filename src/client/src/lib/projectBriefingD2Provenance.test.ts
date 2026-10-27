import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectBriefingReport } from "./projectBriefingStoryboard";
import { captureBriefingVisual, verifyCurrentPinnedVisual, assertSavedBriefingArtifact } from "./phase4BriefingVisuals";
import type { ArtifactDetail } from "./useArtifacts";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";

const hash = "a".repeat(64);
const sourceRefs = ["source:primary", "source:filing"];
const content = {
  kind: "chart" as const, chartType: "line", rendererPreference: "recharts" as const,
  series: [{ id: "measure", label: "Observed measure", points: [{ x: "2025", y: 12 }, { x: "2026", y: 14 }] }], options: {},
};
function detail(): ArtifactDetail {
  return {
    artifact: { id: "chart:a", projectId: 8, status: "active", kind: "chart", title: "Observed chart", origin: "direct", headVersion: 3 },
    version: { artifactId: "chart:a", version: 3, contentHash: hash, sourceRefs, dependencyRefs: [],
      content },
  } as unknown as ArtifactDetail;
}
const sources = [{ id: "chart:a", projectId: 8, title: "Observed chart", kind: "chart" as const,
  headVersion: 3, status: "active" as const }];
const make = (visual: PinnedBriefingVisual) => buildProjectBriefingReport({
  projectId: 8, title: "Recorded proof", introduction: "Editorial review",
  sources, visuals: [visual],
});
test("D2 canonical visual pins reject oversized, anonymous or cross-Project source lineage without dropping identifiers", () => {
  const pin = captureBriefingVisual(detail(), 8);
  assert.equal(make(pin).sourceRefs.length, 2);
  assert.throws(() => make({ ...pin, sourceRefs: Array.from({ length: 101 }, (_, i) => "source:" + i) }), /must match an explicitly selected/);
  assert.throws(() => make({ ...pin, sourceRefs: ["source:primary", "  "] }), /must match an explicitly selected/);
  assert.throws(() => make({ ...pin, projectId: 99 }), /must match an explicitly selected/);
  assert.throws(() => make({ ...pin, version: 4 }), /must match an explicitly selected/);
});
test("D2 exact P4 reads accept equivalent object key order but reject altered values and revoked sources", () => {
  const original = detail();
  const pin = captureBriefingVisual(original, 8);
  const sameValue = { ...original, version: { ...original.version, content: {
    options: {}, series: content.series, rendererPreference: content.rendererPreference,
    chartType: content.chartType, kind: content.kind,
  } } } as ArtifactDetail;
  assert.doesNotThrow(() => verifyCurrentPinnedVisual(pin, sameValue));
  const changed = { ...original, version: { ...original.version,
    content: { ...content, series: [{ ...content.series[0], points: [{ x: "2025", y: 12 }, { x: "2026", y: 15 }] }] } } } as ArtifactDetail;
  assert.throws(() => verifyCurrentPinnedVisual(pin, changed), /changed/);
  assert.throws(() => verifyCurrentPinnedVisual(pin, {
    ...original, version: { ...original.version, sourceRefs: ["source:primary"] },
  }), /changed/);
});
test("D2 confirmed saved Report compares canonical values rather than JSON insertion order", () => {
  const pin = captureBriefingVisual(detail(), 8);
  const report = make(pin);
  const reordered = { editorPreference: report.content.editorPreference,
    sections: report.content.sections, blocks: report.content.blocks,
    templateId: report.content.templateId, kind: report.content.kind };
  const saved = {
    artifact: { id: "report:a", projectId: 8, status: "active", kind: "report",
      title: "Recorded proof", origin: "direct", headVersion: 1 },
    version: { artifactId: "report:a", version: 1, contentHash: "b".repeat(64),
      sourceRefs: report.sourceRefs, dependencyRefs: report.dependencyRefs, content: reordered },
  } as unknown as ArtifactDetail;
  assert.doesNotThrow(() => assertSavedBriefingArtifact(saved, 8, report.content, report.dependencyRefs, report.sourceRefs));
  assert.throws(() => assertSavedBriefingArtifact({ ...saved, version: { ...saved.version, content: {
    ...reordered, blocks: [...reordered.blocks, { id: "injected", type: "paragraph", text: "Unsourced", attrs: {} }],
  } } } as ArtifactDetail, 8, report.content, report.dependencyRefs, report.sourceRefs), /did not confirm/);
  assert.throws(() => assertSavedBriefingArtifact({ ...saved,
    version: { ...saved.version, sourceRefs: [] } } as ArtifactDetail, 8, report.content, report.dependencyRefs, report.sourceRefs), /did not confirm/);
});
