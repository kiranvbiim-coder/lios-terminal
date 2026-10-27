import test from "node:test";
import assert from "node:assert/strict";
import { buildPerspectiveModel, filterPerspectiveLinks, type PerspectiveEvidence, type PerspectiveRelation } from "./researchPerspectives";
import { projectRecordedEvidenceFlow } from "./recordedEvidenceFlow";

const record = (id: number, title: string): PerspectiveEvidence => ({
  id, title, evidenceType: "filing", evidenceKind: "fact",
  excerpt: "Recorded excerpt, not a numerical estimate", annotation: null,
  sourceName: "Retained source " + id, provider: "Source provider",
  sourceUrl: "https://recorded.example.org/" + id,
  publishedAt: "2026-10-27T07:00:00Z", retrievedAt: "2026-10-27T09:00:00Z",
});
const evidence = [record(1, "Source filing"), record(2, "Counterpoint"), record(3, "Later correction")];
const relationships: PerspectiveRelation[] = [
  { id: 10, fromEvidenceId: 1, toEvidenceId: 2, relationshipType: "supports", note: "Recorded supporting claim" },
  { id: 11, fromEvidenceId: 2, toEvidenceId: 1, relationshipType: "contradicts", note: "Explicit challenge to other record" },
  { id: 12, fromEvidenceId: 3, toEvidenceId: 1, relationshipType: "supersedes", note: null },
  { id: 13, fromEvidenceId: 3, toEvidenceId: 999, relationshipType: "supports", note: "Missing evidence endpoint" },
];

test("only resolved authorized relationship IDs enter the visual; no missing source is invented", () => {
  const model=buildPerspectiveModel(evidence,relationships);
  assert.equal(model.unresolvedCount,1);
  const result=projectRecordedEvidenceFlow(model.links);
  assert.equal(result.rows.length,3);
  assert.equal(result.totalRecordedLinks,3);
  assert.deepEqual(result.rows.map(row=>[row.id,row.fromEvidenceId,row.toEvidenceId,row.relationType]),[
    [10,1,2,"supports"],[11,2,1,"contradicts"],[12,3,1,"supersedes"],
  ]);
  assert.equal(result.links.length,6);
  assert.ok(result.links.every(link=>link.value===1));
  assert.ok(result.nodes.every(node=>!node.name.includes("999")));
  assert.ok(result.rows.every(row=>row.id!==13));
});

test("opposing recorded links cannot generate a cyclic Sankey or inferred vote/consensus weight",()=>{
  const result=projectRecordedEvidenceFlow(buildPerspectiveModel(evidence,relationships).links);
  assert.ok(result.nodes.some(node=>node.name==="from:1"));
  assert.ok(result.nodes.some(node=>node.name==="to:1"));
  assert.ok(result.nodes.some(node=>node.name==="relation:11"));
  for(const link of result.links) {
    assert.ok(link.source.startsWith("from:") || link.source.startsWith("relation:"));
    assert.ok(link.target.startsWith("relation:") || link.target.startsWith("to:"));
    assert.notEqual(link.source,link.target);
    assert.equal(link.value,1);
  }
  assert.deepEqual(result.links.filter(link=>link.source==="relation:11").map(x=>x.target),["to:1"]);
  assert.ok(!JSON.stringify(result).includes("score"));
  assert.ok(!JSON.stringify(result).includes("probability"));
});

test("canonical Perspectives filters drive both lanes and chart, not a parallel source query",()=>{
  const model=buildPerspectiveModel(evidence,relationships);
  const selected=filterPerspectiveLinks(model.links,"explicit challenge","challenge");
  const result=projectRecordedEvidenceFlow(selected);
  assert.equal(result.totalRecordedLinks,1);
  assert.deepEqual(result.rows.map(row=>row.id),[11]);
  assert.deepEqual(projectRecordedEvidenceFlow(filterPerspectiveLinks(model.links,"not retained","all")).rows,[]);
});

test("flow is bounded, notes remain unmodified, and any omitted links are disclosed",()=>{
  const original=buildPerspectiveModel(evidence,relationships).links[0];
  const many=Array.from({length:70},(_,index)=>({...original,id:100+index}));
  const json=JSON.stringify(many);
  const limited=projectRecordedEvidenceFlow(many);
  assert.equal(limited.rows.length,16);
  assert.equal(limited.omittedLinks,54);
  assert.equal(limited.totalRecordedLinks,70);
  assert.equal(limited.links.length,32);
  assert.equal(projectRecordedEvidenceFlow(many,200).rows.length,32);
  assert.equal(projectRecordedEvidenceFlow(many,NaN).rows.length,16);
  assert.equal(JSON.stringify(many),json);
});

test("repeated/invalid relation identities never duplicate chart paths or fabricate weights",()=>{
  const relation=buildPerspectiveModel(evidence,relationships).links[0];
  const result=projectRecordedEvidenceFlow([
    relation,relation,{...relation,id:NaN},{...relation,id:11.7},
  ]);
  assert.deepEqual(result.rows.map(row=>row.id),[10]);
  assert.equal(result.links.length,2);
  assert.equal(result.omittedLinks,0);
});
