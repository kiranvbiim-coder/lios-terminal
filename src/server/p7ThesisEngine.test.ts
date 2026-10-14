import assert from "node:assert/strict";
import test from "node:test";
import { thesisArtifactContentSchema } from "@shared/artifactContracts";
import { p7ProjectDocumentSchema } from "@shared/p7ResearchContracts";
import { buildReactiveContextGraph, createProjectSnapshot, p7DocumentId, p7Hash } from "./p7ProjectIntelligence";
import { appendThesisPostmortem, buildThesisCounterThesisReview, refreshThesisArtifact } from "./p7ThesisEngine";

const thesis=thesisArtifactContentSchema.parse({
  kind:"thesis",status:"active",entityRef:"AAPL",summary:"Base thesis",
  expectedOutcomes:[{id:"o1",text:"Revenue growth exceeds 10%"}],
  claims:[{id:"c1",text:"Margins expand"}],
  catalysts:[{id:"cat1",text:"Product launch"}],
  risks:[{id:"r1",text:"Demand weakens"}],
  invalidationConditions:[{id:"i1",text:"Margins contract"}],
  openQuestions:[{id:"q1",text:"Is demand durable?"}],
});

function signalDoc(ref:string,signals:Array<Record<string,string>>) {
  return p7ProjectDocumentSchema.parse({
    schemaVersion:"1",id:p7DocumentId(1,"research_evidence",ref),projectId:1,sourceType:"research_evidence",sourceRef:ref,
    title:ref,body:"Evidence",contentHash:p7Hash(ref),occurredAt:"2026-09-22T00:00:00.000Z",sourceRefs:[],entityRefs:["AAPL"],
    metadata:{thesisSignals:signals},embedding:null,
  });
}

test("P7 thesis refresh changes state only from explicit evidence signals", () => {
  const docs=[
    signalDoc("filing:new",[{type:"supports",targetId:"c1"},{type:"outcome_occurred",targetId:"o1"},{type:"catalyst_occurred",targetId:"cat1"},{type:"question_answered",targetId:"q1"}]),
    signalDoc("call:new",[{type:"contradicts",targetId:"c1"},{type:"risk_materialized",targetId:"r1"}]),
  ];
  const graph=buildReactiveContextGraph({projectId:1,documents:docs});
  const snapshot=createProjectSnapshot({projectId:1,graph,documents:docs});
  const result=refreshThesisArtifact({thesis,documents:docs,snapshot,refreshedAt:"2026-09-22T01:00:00.000Z"});
  assert.equal(result.thesis.expectedOutcomes[0].status,"occurred");
  assert.ok(result.thesis.expectedOutcomes[0].evidenceRefs.includes("filing:new"));
  assert.equal(result.thesis.claims[0].status,"contradicted");
  assert.equal(result.thesis.catalysts[0].status,"occurred");
  assert.equal(result.thesis.risks[0].status,"materialized");
  assert.equal(result.thesis.openQuestions[0].status,"answered");
  assert.ok(result.contradictions.length>0);
  assert.equal(result.thesis.refresh.snapshotId,snapshot.id);
});

test("P7 thesis invalidation and postmortem remain explicit and version-friendly", () => {
  const docs=[signalDoc("filing:bad",[{type:"invalidation_triggered",targetId:"i1"}])];
  const graph=buildReactiveContextGraph({projectId:1,documents:docs});
  const snapshot=createProjectSnapshot({projectId:1,graph,documents:docs});
  const refreshed=refreshThesisArtifact({thesis,documents:docs,snapshot}).thesis;
  assert.equal(refreshed.status,"invalidated");
  const post=appendThesisPostmortem({thesis:refreshed,outcome:"invalidated",summary:"Demand and margin assumptions failed.",whatFailed:["margin assumption"],evidenceRefs:["filing:bad"],at:"2026-09-22T02:00:00.000Z"});
  assert.equal(post.postmortems.length,1);
  assert.equal(post.postmortems[0].outcome,"invalidated");
});


test("SI-03.19 derives explicit base-case, counter-thesis and unresolved posture without numeric invention", () => {
  const initial=buildThesisCounterThesisReview(thesis);
  assert.equal(initial.posture,"unrated");
  assert.deepEqual(initial.baseCase,[]);
  assert.deepEqual(initial.counterCase,[]);
  assert.deepEqual(initial.unresolved,[{claimId:"c1",text:"Margins expand"}]);

  const supportDoc=signalDoc("filing:support",[{type:"supports",targetId:"c1"}]);
  const supportSnapshot=createProjectSnapshot({
    projectId:1,
    graph:buildReactiveContextGraph({projectId:1,documents:[supportDoc]}),
    documents:[supportDoc],
  });
  const supported=refreshThesisArtifact({
    thesis,
    documents:[supportDoc],
    snapshot:supportSnapshot,
    refreshedAt:"2026-09-23T01:00:00.000Z",
  });
  assert.equal(supported.review.posture,"strengthening");
  assert.deepEqual(supported.review.baseCase,[{
    claimId:"c1",
    text:"Margins expand",
    evidenceRefs:["filing:support"],
  }]);
  assert.deepEqual(supported.review.counterCase,[]);
  assert.match(supported.changes.at(-1)??"",/unrated → strengthening/);

  const counterDoc=signalDoc("call:counter",[{type:"contradicts",targetId:"c1"}]);
  const mixedDocs=[supportDoc,counterDoc];
  const mixedSnapshot=createProjectSnapshot({
    projectId:1,
    graph:buildReactiveContextGraph({projectId:1,documents:mixedDocs}),
    documents:mixedDocs,
  });
  const mixed=refreshThesisArtifact({
    thesis,
    documents:mixedDocs,
    snapshot:mixedSnapshot,
    refreshedAt:"2026-09-23T02:00:00.000Z",
  });
  assert.equal(mixed.review.posture,"mixed");
  assert.deepEqual(mixed.review.baseCase[0].evidenceRefs,["filing:support"]);
  assert.deepEqual(mixed.review.counterCase,[{
    claimId:"c1",
    text:"Margins expand",
    evidenceRefs:["call:counter"],
    status:"contradicted",
  }]);
  assert.deepEqual(mixed.review.unresolved,[]);
});

test("SI-03.19 explicit counter-evidence weakens while explicit invalidation dominates", () => {
  const counterDoc=signalDoc("call:counter-only",[{type:"contradicts",targetId:"c1"}]);
  const counterSnapshot=createProjectSnapshot({
    projectId:1,
    graph:buildReactiveContextGraph({projectId:1,documents:[counterDoc]}),
    documents:[counterDoc],
  });
  const weakened=refreshThesisArtifact({
    thesis,
    documents:[counterDoc],
    snapshot:counterSnapshot,
    refreshedAt:"2026-09-24T01:00:00.000Z",
  });
  assert.equal(weakened.review.posture,"weakening");
  assert.equal(weakened.review.baseCase.length,0);
  assert.equal(weakened.review.counterCase.length,1);

  const invalidationDoc=signalDoc("filing:invalidate",[{type:"invalidation_triggered",targetId:"i1"}]);
  const docs=[counterDoc,invalidationDoc];
  const snapshot=createProjectSnapshot({
    projectId:1,
    graph:buildReactiveContextGraph({projectId:1,documents:docs}),
    documents:docs,
  });
  const invalidated=refreshThesisArtifact({
    thesis,
    documents:docs,
    snapshot,
    refreshedAt:"2026-09-24T02:00:00.000Z",
  });
  assert.equal(invalidated.thesis.status,"invalidated");
  assert.equal(invalidated.review.posture,"invalidated");
  assert.deepEqual(invalidated.review.invalidationRefs,["filing:invalidate"]);
});

test("SI-03.19 prose without explicit thesis signals does not move posture and repeated refresh is stable", () => {
  const prose=p7ProjectDocumentSchema.parse({
    schemaVersion:"1",
    id:p7DocumentId(1,"research_evidence","memo:prose"),
    projectId:1,
    sourceType:"research_evidence",
    sourceRef:"memo:prose",
    title:"Bearish prose",
    body:"Margins may collapse and the thesis could be wrong.",
    contentHash:p7Hash("memo:prose"),
    occurredAt:"2026-09-25T00:00:00.000Z",
    sourceRefs:[],
    entityRefs:["AAPL"],
    metadata:{},
    embedding:null,
  });
  const snapshot=createProjectSnapshot({
    projectId:1,
    graph:buildReactiveContextGraph({projectId:1,documents:[prose]}),
    documents:[prose],
  });
  const first=refreshThesisArtifact({
    thesis,
    documents:[prose],
    snapshot,
    refreshedAt:"2026-09-25T01:00:00.000Z",
  });
  assert.equal(first.review.posture,"unrated");
  assert.deepEqual(first.contradictions,[]);
  assert.equal(first.changes.some((change)=>change.includes("posture changed")),false);

  const second=refreshThesisArtifact({
    thesis:first.thesis,
    documents:[prose],
    snapshot,
    refreshedAt:"2026-09-25T02:00:00.000Z",
  });
  assert.equal(second.review.posture,"unrated");
  assert.deepEqual(second.review,first.review);
  assert.deepEqual(second.changes,[]);
});
