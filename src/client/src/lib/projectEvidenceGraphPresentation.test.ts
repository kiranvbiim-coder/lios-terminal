import assert from "node:assert/strict";
import test from "node:test";
import type { P7ContextGraph, P7Insight } from "@shared/p7ResearchContracts";
import { projectEvidenceGraphProjection } from "./projectEvidenceGraphPresentation";

const h="a".repeat(64);
const graph: P7ContextGraph = {
  schemaVersion:"1",projectId:17,generatedAt:"2026-10-27T06:00:00Z",contentHash:h,
  nodes:[
    {id:"event",kind:"event",label:"Reviewed filing",sourceRef:"source:filing",occurredAt:"2026-10-27T05:00:00Z",contentHash:h,metadata:{}},
    {id:"entity",kind:"entity",label:"Recorded company",sourceRef:null,occurredAt:null,contentHash:null,metadata:{}},
    {id:"unrelated",kind:"entity",label:"Unrelated private research",sourceRef:"source:other",occurredAt:null,contentHash:h,metadata:{}},
  ],
  edges:[
    {id:"link",from:"event",to:"entity",type:"mentions",evidenceRefs:["source:filing"],metadata:{}},
    {id:"unattributed",from:"entity",to:"event",type:"references",evidenceRefs:[],metadata:{}},
    {id:"orphan",from:"event",to:"missing",type:"references",evidenceRefs:["source:unverified"],metadata:{}},
    {id:"unrelated-edge",from:"unrelated",to:"missing",type:"references",evidenceRefs:[],metadata:{}},
  ],
};
const insight: P7Insight = {id:"insight",kind:"change",title:"Recorded source-linked development",
  summary:"Neither a quantified cause nor a forecast",severity:"info",
  sourceRefs:["source:filing"],entityRefs:[],deterministic:true,occurredAt:null};

test("projection renders only the selected Project's exact P7 adjacency",()=>{
  const p=projectEvidenceGraphProjection(17,graph,insight);
  assert.deepEqual(p.nodes.map(n=>n.id),["event","entity"]);
  assert.deepEqual(p.edges.map(e=>e.id),["link","unattributed"]);
  assert.equal(p.edges[0].evidenceRefs[0],"source:filing");
  assert.equal(p.edges[1].evidenceRefs.length,0);
  assert.equal(p.matchedCount,1);
  assert.equal(p.totalRecordedEdges,2);
  assert.equal(p.omittedEdges,0);
  assert.deepEqual(projectEvidenceGraphProjection(18,graph,insight).nodes,[]);
  assert.deepEqual(projectEvidenceGraphProjection(17,null,insight).nodes,[]);
  assert.deepEqual(projectEvidenceGraphProjection(17,graph,null).edges,[]);
});
test("deterministic placement has only bounded finite coordinates, without fabricated relation labels",()=>{
  const one=projectEvidenceGraphProjection(17,graph,insight);
  const two=projectEvidenceGraphProjection(17,graph,insight);
  assert.deepEqual(one,two);
  assert.ok(one.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
  assert.deepEqual(one.edges.map(e=>e.type),["mentions","references"]);
  assert.equal(graph.nodes[1].sourceRef,null);
  assert.equal(graph.edges[1].evidenceRefs.length,0);
});
test("bounded, source-matched graph omits extras and reports omissions honestly",()=>{
  const bigger: P7ContextGraph = {...graph,
    nodes:[graph.nodes[0],...Array.from({length:80},(_,i)=>({...graph.nodes[1],id:"company-"+i,label:"Company "+i}))],
    edges:Array.from({length:80},(_,i)=>({...graph.edges[0],id:"reference-"+i,to:"company-"+i})),
  };
  const shown=projectEvidenceGraphProjection(17,bigger,insight);
  assert.equal(shown.totalRecordedEdges,80);
  assert.equal(shown.edges.length,40);
  assert.equal(shown.omittedEdges,40);
  assert.equal(shown.nodes.length,40);
  assert.equal(shown.omittedNodes,9);
  assert.ok(shown.nodes.every(n=>n.id!=="unrelated"));
});
test("no matched entity/source yields no fake graph even with unrelated stored edges",()=>{
  const result=projectEvidenceGraphProjection(17,graph,{...insight,sourceRefs:["wrong"],entityRefs:[]});
  assert.equal(result.nodes.length,0);
  assert.equal(result.edges.length,0);
});
