import assert from "node:assert/strict";
import test from "node:test";
import { p7ProjectDocumentSchema } from "@shared/p7ResearchContracts";
import {
  buildReactiveContextGraph,
  buildResearchGraph,
  buildUnifiedTimeline,
  compileDeterministicInsights,
  createProjectSnapshot,
  detectExplicitContradictions,
  diffProjectSnapshots,
  p7DocumentId,
  p7Hash,
  searchProjectDocuments,
} from "./p7ProjectIntelligence";

function document(sourceRef: string, title: string, body: string, extra: Record<string, unknown> = {}) {
  return p7ProjectDocumentSchema.parse({
    schemaVersion: "1",
    id: p7DocumentId(1, "research_evidence", sourceRef),
    projectId: 1,
    sourceType: "research_evidence",
    sourceRef,
    title,
    body,
    contentHash: p7Hash({ title, body }),
    occurredAt: "2026-09-20T00:00:00.000Z",
    sourceRefs: [],
    entityRefs: ["AAPL"],
    metadata: extra,
    embedding: null,
  });
}

test("P7 reactive context graph links Project documents, entities and explicit evidence relations", () => {
  const a=document("evidence:a","Revenue evidence","Revenue accelerated",{relations:[{type:"supports",targetRef:"evidence:b"}]});
  const b=document("evidence:b","Primary filing","Annual filing");
  const graph=buildReactiveContextGraph({projectId:1,documents:[a,b],generatedAt:"2026-09-22T00:00:00.000Z"});
  assert.ok(graph.nodes.some((node)=>node.id==="project:1"));
  assert.ok(graph.nodes.some((node)=>node.id==="entity:AAPL"));
  assert.ok(graph.edges.some((edge)=>edge.type==="supports"));
  assert.match(graph.contentHash,/^[a-f0-9]{64}$/);
  const research=buildResearchGraph(graph);
  assert.ok(research.nodes.every((node)=>["project","artifact","evidence","filing","report","thesis","entity","document"].includes(node.kind)));
});

test("P7 search guarantees lexical retrieval and can blend caller-supplied local embeddings", () => {
  const a={...document("doc:a","Margin expansion","Gross margin expanded sharply"),embedding:[1,0]};
  const b={...document("doc:b","Debt profile","Net debt increased"),embedding:[0,1]};
  const lexical=searchProjectDocuments([a,b],{query:"margin",limit:10});
  assert.equal(lexical[0]?.sourceRef,"doc:a");
  const semantic=searchProjectDocuments([a,b],{query:"unmatchedtoken",limit:10,semanticWeight:1,queryEmbedding:[1,0]});
  assert.equal(semantic[0]?.sourceRef,"doc:a");
  assert.ok((semantic[0]?.semanticScore??0)>0.99);
});

test("P7 hybrid search retrieves exact entity refs even when title and body omit the entity", () => {
  const tesla={...document("doc:tesla","Factory update","Production capacity expanded"),entityRefs:["TSLA"]};
  const apple={...document("doc:apple","Factory update","Production capacity expanded"),entityRefs:["AAPL"]};
  const hits=searchProjectDocuments([apple,tesla],{query:"TSLA",limit:10});
  assert.equal(hits[0]?.sourceRef,"doc:tesla");
  assert.equal(hits[0]?.lexicalScore,0);
  assert.ok((hits[0]?.combinedScore??0)>0);
});

test("P7 hybrid search uses structured context refs without requiring body duplication", () => {
  const base=document("doc:structured","Operating evidence","Primary evidence body");
  const structured=p7ProjectDocumentSchema.parse({
    ...base,
    entityRefs:["ACME"],
    contextRefs:{
      ...base.contextRefs,
      entity:["ACME"],
      metric:["free-cash-flow"],
      period:["FY2027"],
      currency:["USD"],
    },
  });
  const unrelated={...document("doc:unrelated","Operating evidence","Primary evidence body"),entityRefs:["OTHER"]};
  const hits=searchProjectDocuments([unrelated,structured],{query:"FY2027 USD",limit:10});
  assert.equal(hits[0]?.sourceRef,"doc:structured");
  assert.equal(hits[0]?.lexicalScore,0);
  assert.ok((hits[0]?.combinedScore??0)>0);
});

test("P7 hybrid rank fusion rewards evidence matching independent retrieval channels", () => {
  const multi={...document("doc:multi","Margin outlook","Margin expansion remains material"),entityRefs:["AAPL"]};
  const lexicalOnly={...document("doc:lexical","Margin outlook","Margin expansion remains material"),entityRefs:["MSFT"]};
  const hits=searchProjectDocuments([lexicalOnly,multi],{query:"AAPL margin",limit:10});
  assert.equal(hits[0]?.sourceRef,"doc:multi");
  assert.ok((hits[0]?.lexicalScore??0)>0);
  assert.ok((hits[0]?.combinedScore??0)>(hits[1]?.combinedScore??0));
});

test("P7 hybrid channels cannot leak metadata from excluded sources", () => {
  const allowed={...document("doc:allowed","Allowed","No entity token in body"),entityRefs:["SAFE"]};
  const denied={...document("doc:denied","Denied","No entity token in body"),entityRefs:["SECRETENTITY"],sourceRefs:["external:denied"]};
  const hits=searchProjectDocuments([allowed,denied],{
    query:"SECRETENTITY",
    limit:10,
    allowedSourceRefs:["doc:allowed"],
  });
  assert.deepEqual(hits,[]);
});

test("P7 provider policy filters explicit provider metadata before ranking and excerpts", () => {
  const rights={
    entitlement:{decision:"allowed",policyId:null,permittedUses:["internal_research"],reasons:[]},
    aiTransmission:"permitted",
    internalUse:"permitted",
    redistribution:"restricted",
  };
  const broker=document("doc:broker","Margin broker note","Margin outlook alpha provider secret",{
    researchSource:{
      class:"broker_research",
      identity:{
        sourceId:"note-1",providerId:"alpha-research",organization:"Alpha",
        author:null,analystId:null,expertId:null,url:null,
      },
      rights,
    },
  });
  const acquired=document("doc:acquired","Margin acquired note","Margin outlook beta provider evidence",{
    provider:"beta-provider",
  });
  const untagged=document("doc:untagged","Margin untagged note","Margin outlook untagged evidence");

  const alpha=searchProjectDocuments([broker,acquired,untagged],{
    query:"margin outlook",limit:10,providerAllow:["alpha-research"],
  });
  assert.deepEqual(alpha.map((hit)=>hit.sourceRef),["doc:broker"]);

  const beta=searchProjectDocuments([broker,acquired,untagged],{
    query:"margin outlook",limit:10,
    providerAllow:["alpha-research","beta-provider"],
    providerDeny:["alpha-research"],
  });
  assert.deepEqual(beta.map((hit)=>hit.sourceRef),["doc:acquired"]);
  assert.equal(JSON.stringify(beta).includes("alpha provider secret"),false);

  const missing=searchProjectDocuments([broker,acquired,untagged],{
    query:"margin outlook",limit:10,providerAllow:["missing-provider"],
  });
  assert.deepEqual(missing,[],"non-empty provider allow-list excludes untagged evidence");

  const denyOnly=searchProjectDocuments([broker,acquired,untagged],{
    query:"margin outlook",limit:10,providerDeny:["alpha-research"],
  });
  assert.deepEqual(new Set(denyOnly.map((hit)=>hit.sourceRef)),new Set(["doc:acquired","doc:untagged"]));
});

test("P7 Time Machine reports added removed and changed sources by immutable content hash", () => {
  const a=document("doc:a","A","old");
  const graph1=buildReactiveContextGraph({projectId:1,documents:[a],generatedAt:"2026-09-20T00:00:00.000Z"});
  const s1=createProjectSnapshot({projectId:1,graph:graph1,documents:[a],generatedAt:"2026-09-20T00:00:00.000Z"});
  const a2=document("doc:a","A","new");
  const b=document("doc:b","B","added");
  const graph2=buildReactiveContextGraph({projectId:1,documents:[a2,b],generatedAt:"2026-09-21T00:00:00.000Z"});
  const s2=createProjectSnapshot({projectId:1,graph:graph2,documents:[a2,b],generatedAt:"2026-09-21T00:00:00.000Z"});
  const delta=diffProjectSnapshots(s1,s2);
  assert.equal(delta.changed.length,1);
  assert.equal(delta.added.length,1);
  assert.equal(delta.removed.length,0);
});

test("P7 Insight Lens emits one deterministic contradiction per exact explicit evidence pair", () => {
  const stale={...document("doc:old","Old evidence","Old"),occurredAt:"2020-01-01T00:00:00.000Z",metadata:{relations:[
    {type:"contradicts",targetRef:"doc:new"},
    {type:"supports",targetRef:"doc:other",note:"This note says contradict but the declared relation is support."},
  ]}};
  const current={...document("doc:new","Current evidence","New"),occurredAt:"2026-09-21T00:00:00.000Z",metadata:{relations:[
    {type:"contradicts",targetRef:"doc:old"},
  ]}};
  const other=document("doc:other","Other evidence","Other");
  const explicit=detectExplicitContradictions([stale,current,other]);
  assert.equal(explicit.length,1);
  assert.deepEqual(explicit[0].sourceRefs,["doc:new","doc:old"]);
  assert.equal(explicit[0].occurredAt,"2026-09-21T00:00:00.000Z");
  assert.match(explicit[0].summary,/Current evidence/);
  assert.match(explicit[0].summary,/Old evidence/);

  const lens=compileDeterministicInsights({projectId:1,documents:[stale,current,other],now:"2026-09-22T00:00:00.000Z",staleEvidenceDays:365});
  const contradictions=lens.insights.filter((item)=>item.kind==="contradiction");
  assert.equal(contradictions.length,1);
  assert.deepEqual(contradictions[0].sourceRefs,["doc:new","doc:old"]);
  assert.ok(lens.insights.some((item)=>item.kind==="stale_evidence"));
  assert.ok(lens.insights.every((item)=>item.deterministic===true));
});

test("P7 contradiction detection ignores non-contradict relation prose and self-relations", () => {
  const a=document("doc:a","A","A",{relations:[
    {type:"supports",targetRef:"doc:b",note:"May contradict a different interpretation."},
    {type:"references",targetRef:"doc:b",note:"contradiction mentioned in prose"},
    {type:"contradicts",targetRef:"doc:a"},
  ]});
  const b=document("doc:b","B","B");
  assert.deepEqual(detectExplicitContradictions([a,b]),[]);
});

test("P7 unified timeline sorts Project evidence and retains artifact/model/decision links", () => {
  const older={...document("doc:1","Older","x"),occurredAt:"2026-09-20T00:00:00.000Z"};
  const newer={...document("artifact:model@v2","Newer","y",{artifactId:"artifact:model",artifactKind:"valuation",decisionRef:"artifact:decision"}),occurredAt:"2026-09-21T00:00:00.000Z"};
  const timeline=buildUnifiedTimeline([older,newer]);
  assert.equal(timeline[0].title,"Newer");
  assert.deepEqual(timeline[0].artifactRefs,["artifact:model"]);
  assert.deepEqual(timeline[0].modelRefs,["artifact:model"]);
  assert.equal(timeline[0].decisionRef,"artifact:decision");
});


test("P7 Context Graph carries the finance-specific context dimensions", () => {
  const base=document("context:1","Contextual evidence","Metric changed");
  const contextual=p7ProjectDocumentSchema.parse({
    ...base,
    contextRefs:{
      entity:["AAPL"],metric:["revenue"],period:["FY2026"],date:["2026-09-22T00:00:00.000Z"],
      event:["earnings:q4"],portfolio:["portfolio:core"],benchmark:["SPX"],scenario:["bull"],
      geography:["US"],currency:["USD"],
    },
  });
  const graph=buildReactiveContextGraph({projectId:1,documents:[contextual]});
  for(const id of ["metric:revenue","period:FY2026","event:earnings:q4","portfolio:portfolio:core","benchmark:SPX","scenario:bull","geography:US","currency:USD"]) {
    assert.ok(graph.nodes.some((node)=>node.id===id), "missing context node "+id);
  }
});

test("P7 Insight Lens compiles explicit deterministic anomaly trend percentile revision correlation curve and regime signals", () => {
  const doc=document("signal:1","Deterministic signals","Engine output",{
    deterministicInsights:[
      {kind:"anomaly",title:"Revenue anomaly",summary:"z-score exceeded deterministic threshold",severity:"watch"},
      {kind:"trend",title:"Margin trend",summary:"four-quarter deterministic trend"},
      {kind:"percentile",title:"Valuation percentile",summary:"historical percentile"},
      {kind:"revision",title:"Estimate revision",summary:"consensus revision"},
      {kind:"correlation",title:"Correlation break",summary:"rolling correlation shift"},
      {kind:"curve",title:"Curve inversion",summary:"term-structure condition"},
      {kind:"regime",title:"Risk regime",summary:"deterministic regime classifier"},
    ],
  });
  const lens=compileDeterministicInsights({projectId:1,documents:[doc],now:"2026-09-22T00:00:00.000Z"});
  for(const kind of ["anomaly","trend","percentile","revision","correlation","curve","regime"]) {
    assert.ok(lens.insights.some((item)=>item.kind===kind), "missing deterministic insight "+kind);
  }
  assert.ok(lens.insights.every((item)=>item.deterministic));
});


test("P7 deterministic Project search enforces explicit only-source allow-lists", () => {
  const allowed={...document("sec:10-k:2026","Allowed filing","Margin pressure expanded"),sourceRefs:["sec:10-k:2026"]};
  const denied={...document("web:commentary","Outside commentary","Margin pressure expanded"),sourceRefs:["web:commentary"]};
  const hits=searchProjectDocuments([allowed,denied],{
    query:"margin pressure",
    limit:10,
    allowedSourceRefs:["sec:10-k:2026"],
  });
  assert.equal(hits.length,1);
  assert.equal(hits[0].sourceRef,"sec:10-k:2026");
});
