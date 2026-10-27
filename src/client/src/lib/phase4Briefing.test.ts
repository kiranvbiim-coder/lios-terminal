import test from "node:test";
import assert from "node:assert/strict";
import { reportArtifactContentSchema } from "@shared/artifactContracts";
import type { P7InsightLens, P7TimelineEvent } from "@shared/p7ResearchContracts";
import { composeProjectBriefing } from "./phase4Briefing";

const lens: P7InsightLens = {
  schemaVersion: "1", projectId: 42, generatedAt: "2026-10-27T09:00:00Z", counts: { change: 2 },
  insights: [
    { id: "a", title: "Water report update", summary: "A source reported a change", kind: "change", severity: "watch",
      deterministic: true, occurredAt: "2026-10-27T08:00:00Z", sourceRefs: ["P7:source-a", "P7:source-a"], entityRefs: [] },
    { id: "b", title: "Open question", summary: "An issue remains unresolved", kind: "open_question", severity: "info",
      deterministic: true, occurredAt: null, sourceRefs: [], entityRefs: [] },
  ],
};
const timeline: P7TimelineEvent[] = [
  { id: "event-1", at: "2026-10-27T07:00:00Z", title: "Filed evidence", type: "filing", summary: "Retained record", sourceRefs: ["P7:source-a", "P7:source-b"], entityRefs: [], artifactRefs: [], modelRefs: [], decisionRef: null },
  { id: "event-2", at: "2026-10-27T08:00:00Z", title: "Unrelated Project event", type: "filing", summary: "Not part of selected evidence", sourceRefs: ["P7:other"], entityRefs: [], artifactRefs: [], modelRefs: [], decisionRef: null },
];

test("source-based storyboard is valid canonical editable P4 report, never fictional market content", () => {
  const draft = composeProjectBriefing({projectId:42,title:"Review briefing",layout:"research",insightIds:["a","b"],editorNote:"Internal review only"},lens,timeline);
  assert.ok(draft);
  assert.equal(draft.content.kind,"report");
  assert.equal(reportArtifactContentSchema.safeParse(draft.content).success,true);
  assert.equal(draft.content.editorPreference,"builtin");
  assert.deepEqual(draft.dependencyRefs,["P7:source-a","P7:source-b"]);
  assert.equal(draft.included,2);
  assert.equal(draft.unreferenced,1);
  const text = draft.content.blocks.map(block=>block.text).join("\n");
  assert.match(text,/P7:source-a/);
  assert.match(text,/P7:source-b/);
  assert.match(text,/No explicit source IDs recorded/);
  assert.match(text,/Editorial draft/);
  assert.doesNotMatch(text,/Unrelated Project event|P7:other/);
  assert.doesNotMatch(text,/S&P 500|NVDA|assured gains|verified forecast/);
});

test("wrong Project, no insight or blank title never creates briefing", () => {
  const input={projectId:42,title:"A",layout:"executive" as const,insightIds:["a"],editorNote:""};
  assert.equal(composeProjectBriefing({...input,projectId:43},lens),null);
  assert.equal(composeProjectBriefing({...input,insightIds:["foreign"]},lens),null);
  assert.equal(composeProjectBriefing({...input,title:"  "},lens),null);
  assert.equal(composeProjectBriefing(input,null),null);
});

test("selection bound and source IDs remain immutable", () => {
  const many={ ...lens, insights: Array.from({length:25},(_,i)=>({...lens.insights[0],id:"entry-"+i, title:"Insight "+i})) };
  const draft=composeProjectBriefing({projectId:42,title:"Monitored",layout:"monitoring",insightIds:many.insights.map(item=>item.id),editorNote:""},many);
  assert.ok(draft);
  assert.equal(draft.included,16);
  assert.deepEqual(lens.insights[0].sourceRefs,["P7:source-a","P7:source-a"]);
  assert.ok(draft.content.blocks.every(block=>block.text.length<=25000));
});

test("non-research layouts do not silently add unrelated history", () => {
  const draft=composeProjectBriefing({projectId:42,title:"Executive",layout:"executive",insightIds:["a"],editorNote:""},lens,timeline);
  assert.ok(draft);
  assert.equal(draft.content.sections.some(s=>s.id==="briefing-section-timeline"),false);
  assert.deepEqual(draft.dependencyRefs,["P7:source-a"]);
});

test("research timeline is absent when no event shares an exact selected source or entity", () => {
  const irrelevant: P7TimelineEvent[] = [{ ...timeline[1] }];
  const report=composeProjectBriefing({projectId:42,title:"Scoped",layout:"research",insightIds:["a"],editorNote:""},lens,irrelevant);
  assert.ok(report);
  assert.equal(report.content.sections.some(section=>section.id==="briefing-section-timeline"),false);
  assert.deepEqual(report.dependencyRefs,["P7:source-a"]);
});
