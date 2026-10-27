import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { P7ContextGraph, P7Insight } from "@shared/p7ResearchContracts";
import { ProjectEvidenceGraph } from "./ProjectEvidenceGraph";

const sha = "b".repeat(64);
const graph: P7ContextGraph = {
  schemaVersion:"1",projectId:15,generatedAt:"2026-10-27T04:00:00Z",contentHash:sha,
  nodes:[
    {id:"a",kind:"event",label:"Official recorded change",sourceRef:"filing:official",occurredAt:null,contentHash:sha,metadata:{}},
    {id:"b",kind:"entity",label:"Adjacent issuer",sourceRef:null,occurredAt:null,contentHash:null,metadata:{}},
    {id:"c",kind:"resource",label:"Secret other Project memo",sourceRef:"private:other",occurredAt:null,contentHash:null,metadata:{}},
  ],
  edges:[
    {id:"rel",from:"a",to:"b",type:"mentions",evidenceRefs:["filing:official"],metadata:{}},
    {id:"not-permitted",from:"c",to:"other",type:"references",evidenceRefs:[],metadata:{}},
  ],
};
const insight: P7Insight = {id:"insight",kind:"change",title:"Official project insight",
  summary:"Recorded, not proved causal",severity:"watch",sourceRefs:["filing:official"],entityRefs:[],
  deterministic:true,occurredAt:null};
const render=(projectId:number,sourceGraph:P7ContextGraph|null=graph)=>renderToStaticMarkup(React.createElement(ProjectEvidenceGraph,{projectId,graph:sourceGraph,insight}));

test("one read-only SVG viewport provides accessible zoom, fit, node and edge inspection",()=>{
  const html=render(15);
  assert.match(html,/data-testid="project-evidence-graph"/);
  assert.match(html,/Zoom graph in/);
  assert.match(html,/Zoom graph out/);
  assert.match(html,/Fit graph to viewport/);
  assert.match(html,/Interactive recorded Project graph/);
  assert.match(html,/data-testid="p7-recorded-graph-node"/);
  assert.match(html,/Official recorded change/);
  assert.match(html,/1 edge source ID\(s\)/);
  assert.match(html,/Recorded relationships/);
  assert.match(html,/Adjacency|adjacency/);
  assert.doesNotMatch(html,/Secret other Project memo|private:other|not-permitted/);
  assert.doesNotMatch(html,/<iframe|<script|href="https?:/);
});
test("wrong Project graph is not drawn or leaked via empty state",()=>{
  const html=render(16);
  assert.match(html,/No recorded graph nodes connect/);
  assert.doesNotMatch(html,/Official recorded change|filing:official|Secret other Project memo/);
});
test("missing graph does not synthesize nodes, edges or geography",()=>{
  const html=render(15,null);
  assert.match(html,/No recorded graph nodes connect/);
  assert.doesNotMatch(html,/data-testid="p7-recorded-graph-node"|<svg/);
});
