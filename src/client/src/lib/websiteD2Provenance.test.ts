import test from "node:test";
import assert from "node:assert/strict";
import type { P7InsightLens, P7TimelineEvent } from "@shared/p7ResearchContracts";
import { composeProjectBriefing } from "./phase4Briefing";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";

const h = "a".repeat(64);
const refs = Array.from({ length: 51 }, (_, i) => "source:filing:" + i);
const base: P7InsightLens = {
  schemaVersion: "1", projectId: 9, generatedAt: "2026-10-27T09:00:00Z", counts: {},
  insights: [{ id: "insight", kind: "change", title: "Changed record",
    summary: "Record changed; no causal claim", severity: "watch", deterministic: true,
    sourceRefs: ["source:known"], entityRefs: [], occurredAt: null }],
};
const selection = { projectId: 9, title: "Board evidence", layout: "research" as const,
  insightIds: ["insight"], editorNote: "" };
test("D2 rejected over-limit insight is never silently truncated into a source-incomplete published report", () => {
  const lens = { ...base, insights: [{ ...base.insights[0], sourceRefs: refs }] };
  assert.equal(composeProjectBriefing(selection, lens), null);
  assert.deepEqual(lens.insights[0].sourceRefs, refs);
});
test("D2 selected research timeline with more than 20 source IDs cannot omit provenance silently", () => {
  const timeline: P7TimelineEvent[] = [{
    id: "event", at: "2026-10-27T09:00:00Z", type: "filing", title: "Matched filing",
    summary: "Source update", sourceRefs: ["source:known", ...refs.slice(0, 20)],
    entityRefs: [], artifactRefs: [], modelRefs: [], decisionRef: null,
  }];
  assert.equal(composeProjectBriefing(selection, base, timeline), null);
  assert.ok(composeProjectBriefing(selection, base, [{ ...timeline[0], sourceRefs: ["source:known"] }]));
});
test("D2 visual-only report describes source rights without inventing an included insight", () => {
  const visual: PinnedBriefingVisual = {
    projectId: 9, artifactId: "artifact:table", version: 2, contentHash: h, title: "Recorded values",
    sourceRefs: ["source:known"], content: { kind: "table",
      columns: [{ key: "metric", label: "Metric", type: "string" }], rows: [{ metric: "Recorded" }] },
  };
  const result = composeProjectBriefing({ ...selection, insightIds: [] }, base, [], [visual]);
  assert.ok(result);
  assert.equal(result.included, 0);
  const narrative = result.content.blocks.map(b => b.text).join("\n");
  assert.match(narrative, /Selected visuals carry recorded source identifiers/);
  assert.doesNotMatch(narrative, /All selected insights carry source identifiers/);
});
