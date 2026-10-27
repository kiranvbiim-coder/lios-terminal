import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordedEvidenceFlowPanel } from "./RecordedEvidenceFlowPanel";
import { RecordedPerspectivesBoard } from "./RecordedPerspectivesBoard";
import type { PerspectiveEvidence, PerspectiveLink, PerspectiveRelation } from "@/lib/researchPerspectives";
import { buildPerspectiveModel } from "@/lib/researchPerspectives";

const record=(id:number,title:string):PerspectiveEvidence=>({
  id,title,excerpt:"Actual retained source text",annotation:null,
  evidenceType:"filing",evidenceKind:"fact",sourceName:"Source "+id,provider:"Registry",
  sourceUrl:"https://official.example.org/"+id,
  publishedAt:"2026-10-27T07:00:00Z",retrievedAt:"2026-10-27T08:00:00Z",
});
const evidence=[record(4,"Published source A"),record(5,"Reported source B")];
const relations:PerspectiveRelation[]=[
  {id:21,fromEvidenceId:4,toEvidenceId:5,relationshipType:"supports",note:"Explicit saved relation"},
  {id:22,fromEvidenceId:5,toEvidenceId:4,relationshipType:"contradicts",note:"Saved opposing link"},
];
const model=buildPerspectiveModel(evidence,relations);
const html=(links:readonly PerspectiveLink[])=>renderToStaticMarkup(
  React.createElement(RecordedEvidenceFlowPanel,{links,selectedId:21,onSelect:()=>undefined}),
);
test("on-demand relationship flow remains collapsed with source counts, not a chart on initial SSR",()=>{
  const text=html(model.links);
  assert.match(text,/data-testid="recorded-evidence-flow"/);
  assert.match(text,/2 explicitly recorded relationships/);
  assert.match(text,/one ledger record, not one unit of influence/);
  assert.match(text,/View flow/);
  assert.match(text,/aria-expanded="false"/);
  assert.doesNotMatch(text,/recorded-evidence-sankey-svg|<iframe|<canvas|<script/);
});
test("flow is not fabricated from unlinked or unauthorized evidence",()=>{
  assert.equal(html([]),"");
  const unrelated=buildPerspectiveModel(evidence.slice(0,1),relations);
  assert.equal(html(unrelated.links),"");
});
test("full authorized Perspectives retains original evidence lanes and source comparison owner",()=>{
  const text=renderToStaticMarkup(React.createElement(RecordedPerspectivesBoard,{
    title:"Source review",question:"What was actually recorded?",thesis:null,
    evidence,relationships:relations,onOpenInvestigation:()=>undefined,
  }));
  assert.match(text,/Perspectives Explorer/);
  assert.match(text,/data-testid="recorded-evidence-flow"/);
  assert.match(text,/Supporting links/);
  assert.match(text,/Challenging links/);
  assert.match(text,/Source filing|Published source A/);
  assert.match(text,/Inspect both records/);
  assert.doesNotMatch(text,/independent confirmation verified|causal weights/);
});
