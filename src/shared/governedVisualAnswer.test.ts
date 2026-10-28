import test from "node:test";
import assert from "node:assert/strict";
import {
  governedVisualAnswerRequestSchema,
  resolveGovernedVisualAnswer,
  visualRequestFromRuntimeArtifact,
} from "./governedVisualAnswer";

const id="artifact:00000000-0000-4000-8000-000000000025";
const hash="f".repeat(64);
const request={artifactId:id,version:4,projectId:19,kind:"chart" as const,sourceRefs:["filing:official"]};
const chart={
  kind:"chart",rendererPreference:"echarts",chartType:"line",
  series:[{id:"revenue",label:"Reported revenue",points:[{x:"2024",y:75},{x:"2025",y:90}]}],
  options:{},
};
function detail(content: unknown = chart) {
  return {
    artifact:{id,projectId:19,kind:"chart",status:"active",title:"Saved verified chart"},
    version:{artifactId:id,version:4,contentHash:hash,sourceRefs:["filing:official"],content},
  };
}
test("valid saved chart uses only exact server-returned source points and original version",()=>{
  const valid=resolveGovernedVisualAnswer(request,detail());
  assert.equal(valid.status,"ready");
  if(valid.status==="ready" && valid.kind==="chart"){
    assert.deepEqual(valid.content.series[0].points,[{x:"2024",y:75},{x:"2025",y:90}]);
    assert.equal(valid.version,4);
    assert.deepEqual(valid.sourceRefs,["filing:official"]);
  }
  const fromEvent=visualRequestFromRuntimeArtifact({
    artifact:{artifactType:"chart",projectId:19,sourceRefs:["filing:official"]},
    persistedArtifact:{id,version:4},
  });
  assert.deepEqual(fromEvent,request);
});

test("source, Project, version, title/status/content owner mismatches all fail closed",()=>{
  const changes=[
    [{...request,projectId:20},detail()],
    [{...request,version:3},detail()],
    [{...request,sourceRefs:["unrelated:source"]},detail()],
    [request,{...detail(),artifact:{...detail().artifact,id:"artifact:00000000-0000-4000-8000-000000000026"}}],
    [request,{...detail(),artifact:{...detail().artifact,projectId:null}}],
    [request,{...detail(),artifact:{...detail().artifact,status:"archived"}}],
    [request,{...detail(),artifact:{...detail().artifact,kind:"table"}}],
    [request,{...detail(),version:{...detail().version,artifactId:"artifact:00000000-0000-4000-8000-000000000026"}}],
    [request,{...detail(),version:{...detail().version,sourceRefs:[]}}],
    [request,null],
  ] as Array<[unknown,unknown]>;
  for(const [ask,remote] of changes)assert.equal(resolveGovernedVisualAnswer(ask,remote).status,"blocked");
});

test("model cannot submit inline observations, URLs, new map coords or choose unsupported visual types",()=>{
  for (const invalid of [
    {...request,series:[{points:[{x:2025,y:9000}]}]},
    {...request,lat:40,lon:-73},
    {...request,kind:"map"},
    {...request,kind:"graph"},
    {...request,sourceRefs:[]},
    {...request,sourceRefs:["filing:official"],version:0},
    {...request,artifactId:"https://elsewhere.example/secret"},
  ])assert.equal(governedVisualAnswerRequestSchema.safeParse(invalid).success,false);
  assert.equal(visualRequestFromRuntimeArtifact({
    artifact:{artifactType:"chart",projectId:19,sourceRefs:[]},persistedArtifact:{id,version:4},
  }),null);
  assert.equal(visualRequestFromRuntimeArtifact({
    artifact:{artifactType:"chart",projectId:19,sourceRefs:["filing:official"]},
  }),null);
});

test("non-finite chart values, duplicate noncompatible chart types and resource-heavy projections cannot render",()=>{
  for(const bad of [
    {...chart,series:[{...chart.series[0],points:[{x:1,y:NaN}]}]},
    {...chart,series:[{...chart.series[0],points:[{x:Infinity,y:30}]}]},
    {...chart,chartType:"candlestick"},
    {...chart,series:[{...chart.series[0],points:[]}]},
    {...chart,series:Array.from({length:13},(_,i)=>({...chart.series[0],id:String(i)}))},
    {...chart,series:[{...chart.series[0],points:Array.from({length:5001},(_,i)=>({x:i,y:i}))}]},
  ])assert.equal(resolveGovernedVisualAnswer(request,detail(bad)).status,"blocked");
});

test("valid exact-source saved table is shown but unsourced/empty and mismatched content is blocked",()=>{
  const tableContent={kind:"table",columns:[{key:"x",label:"Period",type:"string"},{key:"y",label:"Revenue",type:"number"}],
    rows:[{x:"2025",y:12},{x:"2026",y:null}]};
  const tableReq={...request,kind:"table" as const};
  const tableDetail={...detail(tableContent),artifact:{...detail().artifact,kind:"table"}};
  const resolved=resolveGovernedVisualAnswer(tableReq,tableDetail);
  assert.equal(resolved.status,"ready");
  if(resolved.status==="ready"&&resolved.kind==="table"){
    assert.equal(resolved.content.rows[1].y,null);
    assert.equal(resolved.content.columns[1].label,"Revenue");
  }
  assert.equal(resolveGovernedVisualAnswer(tableReq,{...tableDetail,version:{...tableDetail.version,content:{...tableContent,rows:[]}}}).status,"blocked");
  assert.equal(resolveGovernedVisualAnswer(tableReq,detail()).status,"blocked");
});

test("P3 saved trust observation explicitly denying a selected source blocks P4 visual display",()=>{
  const withAccess=(state:string,entitlementRequired:boolean|null=false)=>({
    ...detail(),
    version:{...detail().version,trustManifest:{evidence:[
      {sourceRef:"filing:official",access:{state,entitlementRequired}},
    ]}},
  });
  assert.equal(resolveGovernedVisualAnswer(request,withAccess("allowed")).status,"ready");
  for(const state of ["blocked","restricted","denied","unauthorized","expired","not_entitled"]){
    assert.equal(resolveGovernedVisualAnswer(request,withAccess(state)).status,"blocked",state);
  }
  assert.equal(resolveGovernedVisualAnswer(request,withAccess("allowed",true)).status,"blocked");
  assert.equal(resolveGovernedVisualAnswer(request,{
    ...detail(),version:{...detail().version,trustManifest:{evidence:[
      {sourceRef:"another:source",access:{state:"allowed",entitlementRequired:false}},
    ]}},
  }).status,"blocked");
  assert.equal(resolveGovernedVisualAnswer(request,{
    ...detail(),version:{...detail().version,trustManifest:{evidence:[{sourceRef:"filing:official",access:{state:123}}]}},
  }).status,"blocked");
});


test("C01 saved Chart/Table display rejects subset and duplicate model-request source identity", () => {
  const multiple = { ...detail(), version: {
    ...detail().version, sourceRefs: ["filing:official", "feed:restricted"],
  } };
  assert.equal(resolveGovernedVisualAnswer(request, multiple).status, "blocked",
    "A one-source runtime request must not display a full saved version using two sources");
  assert.equal(resolveGovernedVisualAnswer({
    ...request, sourceRefs: ["filing:official", "filing:official"],
  }, multiple).status, "blocked");
  assert.equal(resolveGovernedVisualAnswer({
    ...request, sourceRefs: ["filing:official", "feed:restricted"],
  }, multiple).status, "ready", "Correct exact full set remains displayable after authenticated GET");
});

test("C01 any recorded denied source observation blocks a visual, regardless of observation order", () => {
  const denied = { sourceRef: "filing:official", access: { state: "denied", entitlementRequired: false } };
  const allowed = { sourceRef: "filing:official", access: { state: "allowed", entitlementRequired: false } };
  for (const observations of [[denied, allowed], [allowed, denied]]) {
    const remote = { ...detail(), version: {
      ...detail().version, trustManifest: { evidence: observations },
    } };
    assert.equal(resolveGovernedVisualAnswer(request, remote).status, "blocked",
      "Last-write-wins entitlement maps must never silently erase a recorded denial");
  }
});
