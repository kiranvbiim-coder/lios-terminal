import test from "node:test";
import assert from "node:assert/strict";
import type { P7ContextGraph, P7Insight } from "@shared/p7ResearchContracts";
import { reviewRecordedConsequences, consequenceReviewPrompt } from "./recordedConsequenceReview";
const h = "a".repeat(64);
const node = (id: string, kind: P7ContextGraph["nodes"][number]["kind"], ref: string | null, saved = false, external = false) =>
  ({ id, kind, label: id, sourceRef: ref, contentHash: saved ? h : null, occurredAt: null, metadata: external ? { external: true } : {} });
const edge = (id: string, from: string, to: string, evidenceRefs: string[], type: P7ContextGraph["edges"][number]["type"] = "references") =>
  ({ id, from, to, evidenceRefs, type, metadata: {} });
const graph: P7ContextGraph = { schemaVersion:"1", projectId:7, generatedAt:"2026-10-27T09:00:00Z", contentHash:h,
  nodes:[node("project:7","project","project:7"), node("doc:filing","filing","src:filing",true),
    node("entity:company","entity","company"),node("doc:decision","decision","src:decision",true),
    node("portfolio:holding","portfolio","portfolio:holding"),node("external:secret","document","secret",false,true)],
  edges:[edge("hub","project:7","doc:decision",["src:decision"],"contains"),
    edge("link-a","doc:filing","entity:company",["src:filing"],"mentions"),
    edge("link-b","doc:decision","entity:company",["src:decision"],"mentions"),
    edge("invalid-external","doc:filing","external:secret",["src:filing","secret"]),
    edge("invalid-orphan","doc:filing","absent",["src:filing"]),
    edge("invalid-unsigned","doc:filing","portfolio:holding",[])] };
const insight: P7Insight = { id:"i",kind:"change",title:"Recorded source changed",summary:"",severity:"watch",
  sourceRefs:["src:filing"],entityRefs:[],deterministic:true,occurredAt:null };
test("source-backed two-hop paths reuse exact stored directional edges, not project hub", () => {
  const result=reviewRecordedConsequences(7,graph,insight);
  assert.equal(result.status,"ready");
  assert.deepEqual(result.targets.map(t=>t.id),["doc:decision"]);
  assert.deepEqual(result.targets[0].steps.map(s=>s.id),["link-a","link-b"]);
  assert.equal(result.targets[0].steps[1].forward,false);
  assert.deepEqual(result.targets[0].steps[1].evidenceRefs,["src:decision"]);
});
test("cross-Project, source-free, external, orphan and unsigned data fail closed", () => {
  assert.equal(reviewRecordedConsequences(8,graph,insight).status,"unavailable");
  assert.equal(reviewRecordedConsequences(7,graph,{...insight,sourceRefs:[]}).status,"no_sources");
  assert.equal(reviewRecordedConsequences(7,graph,{...insight,sourceRefs:["secret"]}).targets.length,0);
  assert.equal(reviewRecordedConsequences(7,{...graph,edges:Array(10001).fill(graph.edges[0])},insight).status,"too_large");
});
test("direct saved portfolio reference requires a genuine source edge and is not a position", () => {
  const next={...graph,edges:[...graph.edges,edge("linked-portfolio","doc:filing","portfolio:holding",["src:filing"])]};
  const r=reviewRecordedConsequences(7,next,insight);
  assert.equal(r.targets.find(t=>t.kind==="portfolio")?.steps[0].id,"linked-portfolio");
  const prompt=consequenceReviewPrompt(7,h,insight,r.targets[0]);
  assert.match(prompt,/Shared graph references do not prove causality/);
  assert.match(prompt,/without explicit approval/);
});
test("targets and omissions are bounded, stable and do not leak external node metadata", () => {
  const extra=Array.from({length:30},(_,i)=>node("portfolio:"+i,"portfolio","p:"+i));
  const next={...graph,nodes:[...graph.nodes,...extra],edges:[...graph.edges,...extra.map((n,i)=>edge("extra:"+i,"doc:filing",n.id,["src:filing"]))]};
  const result=reviewRecordedConsequences(7,next,insight,4);
  assert.equal(result.targets.length,4);
  assert.equal(result.total-result.targets.length,result.omitted);
  assert.deepEqual(result,reviewRecordedConsequences(7,next,insight,4));
  assert.equal(result.targets.some(t=>t.id.includes("secret")),false);
});
