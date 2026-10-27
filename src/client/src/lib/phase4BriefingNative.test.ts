import test from "node:test";
import assert from "node:assert/strict";
import type { P7InsightLens } from "@shared/p7ResearchContracts";
import { reportArtifactContentSchema } from "@shared/artifactContracts";
import { composeProjectBriefing } from "./phase4Briefing";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";
const h="b".repeat(64);
const lens:P7InsightLens={schemaVersion:"1",projectId:7,generatedAt:"2026-10-27T09:00:00Z",
  insights:[{id:"i",title:"Saved observation",summary:"A source reports a measured result",
    kind:"change",severity:"watch",deterministic:true,occurredAt:null,sourceRefs:["source:filing"],entityRefs:[]}],
  counts:{change:1}};
const make=(kind:"chart"|"table"):PinnedBriefingVisual => ({
  projectId:7,artifactId:"artifact:"+kind,version:3,contentHash:h,title:"Captured "+kind,sourceRefs:["source:filing"],
  content:kind==="chart" ? {kind:"chart",chartType:"line",rendererPreference:"recharts",
    series:[{id:"s",label:"Recorded",points:[{x:"A",y:10}]}],options:{}} :
    {kind:"table",columns:[{key:"period",label:"Period",type:"string"}],rows:[{period:"Q1"}]}
});
const selection={projectId:7,title:"Editable board briefing",layout:"executive" as const,insightIds:["i"],editorNote:"Review only"};
test("P4-report-native chart and table are embedded with exact version, hash and source provenance",()=>{
  const input=[make("chart"),make("table")];
  const draft=composeProjectBriefing(selection,lens,[],input);
  assert.ok(draft);
  assert.equal(reportArtifactContentSchema.safeParse(draft.content).success,true);
  const chart=draft.content.blocks.find(b=>b.type==="chart_ref");
  const table=draft.content.blocks.find(b=>b.type==="table");
  assert.deepEqual(chart?.attrs.chart,input[0].content);
  assert.deepEqual(table?.attrs.table,input[1].content);
  assert.equal(chart?.attrs.p4Version,3);
  assert.equal(table?.attrs.p4ContentHash,h);
  assert.equal(draft.content.sections.filter(s=>s.id.startsWith("briefing-section-visual-")).length,2);
  assert.deepEqual(draft.sourceRefs,["source:filing"]);
  assert.ok(draft.dependencyRefs.includes("artifact:chart"));
  assert.ok(draft.dependencyRefs.includes("artifact-version:artifact:table:v3:"+h));
  const capturedChart=input[0].content;
  if (capturedChart.kind !== "chart") throw new Error("Expected an exact chart payload.");
  assert.deepEqual(capturedChart.series[0].points,[{x:"A",y:10}]);
});
test("visual-only saved evidence can produce an actual editable report, not a dummy chart",()=>{
  const result=composeProjectBriefing({...selection,insightIds:[]},lens,[],[make("chart")]);
  assert.ok(result);
  assert.equal(result.included,0);
  assert.ok(result.content.blocks.some(b=>b.type==="chart_ref"));
});
test("wrong Project, duplicate pin and >3 visuals deny composition without silent loss",()=>{
  assert.equal(composeProjectBriefing(selection,lens,[],[{...make("chart"),projectId:8}]),null);
  assert.equal(composeProjectBriefing(selection,lens,[],[make("chart"),make("chart")]),null);
  assert.equal(composeProjectBriefing(selection,lens,[],[make("chart"),make("table"),{...make("chart"),artifactId:"artifact:other"},{...make("chart"),artifactId:"artifact:last"}]),null);
  assert.equal(composeProjectBriefing({...selection,insightIds:[]},lens),null);
});
