import test from "node:test";
import assert from "node:assert/strict";
import type { P7InsightLens, P7TimelineEvent } from "@shared/p7ResearchContracts";
import { stableSerialize } from "./analyticalCore";
import { composeProjectBriefing } from "./phase4Briefing";

const base: P7InsightLens = {
  schemaVersion: "1", generatedAt: "2026-10-27T01:00:00Z", projectId: 17, counts: { change: 1 },
  insights: [{
    id: "recorded-insight", title: "Saved finding", summary: "A filed figure",
    kind: "change", severity: "watch", deterministic: true,
    sourceRefs: ["source:filing:17"], entityRefs: [], occurredAt: null,
  }],
};
const choose = {
  projectId: 17, title: "Verified P7 project briefing",
  layout: "research" as const, insightIds: ["recorded-insight"], editorNote: "Reviewed",
};
const timeline: P7TimelineEvent[] = [{
  id: "source-event", type: "filing", at: "2026-10-27T02:00:00Z",
  title: "Filed", summary: "A dated source observation",
  sourceRefs: ["source:filing:17"], entityRefs: [], artifactRefs: [], modelRefs: [], decisionRef: null,
}];


test("changed P7 observation and matched timeline are distinguishable from reviewed preview before write", () => {
  const preview = composeProjectBriefing(choose, base, timeline);
  assert.ok(preview);
  const now = composeProjectBriefing(choose, {
    ...base, insights: [{ ...base.insights[0], summary: "Amended source figure" }],
  }, timeline);
  assert.ok(now);
  assert.notEqual(stableSerialize(now.content), stableSerialize(preview.content));
  const modifiedTime = composeProjectBriefing(choose, base, [{
    ...timeline[0], summary: "Superseded timeline fact",
  }]);
  assert.ok(modifiedTime);
  assert.notEqual(stableSerialize(modifiedTime.content), stableSerialize(preview.content));
});

test("P7 server-generated request timestamp is NOT mistaken for a source revision", () => {
  const first = composeProjectBriefing(choose, base, timeline);
  const refreshed = composeProjectBriefing(choose, {
    ...base, generatedAt: "2026-10-27T01:01:00Z",
  }, timeline);
  assert.ok(first);
  assert.ok(refreshed);
  assert.equal(stableSerialize(first.content), stableSerialize(refreshed.content),
    "A new P7 API generation time alone must not lock every otherwise unchanged saved briefing.");
});

test("cross-Project fresh lens is never silently accepted by the canonical composer", () => {
  assert.equal(composeProjectBriefing(choose, { ...base, projectId: 18 }, timeline), null);
  assert.equal(composeProjectBriefing(choose, null, timeline), null);
});
