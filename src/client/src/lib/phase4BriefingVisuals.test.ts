import test from "node:test";
import assert from "node:assert/strict";
import type { ArtifactDetail } from "./useArtifacts";
import { captureBriefingVisual, verifyCurrentPinnedVisual, assertSavedBriefingArtifact, eligibleBriefingVisuals } from "./phase4BriefingVisuals";
const h="a".repeat(64);
const chart={kind:"chart" as const,chartType:"line",rendererPreference:"recharts" as const,
  series:[{id:"s1",label:"Recorded series",points:[{x:"2026-10-01",y:12},{x:"2026-10-02",y:14}]}],options:{}};
const table={kind:"table" as const, columns:[{key:"year",label:"Year",type:"string" as const},{key:"amount",label:"Amount",type:"number" as const}],
  rows:[{year:"2025",amount:11},{year:"2026",amount:12}]};
const detail=(content: typeof chart | typeof table = chart): ArtifactDetail => ({
  artifact:{id:"artifact:a",projectId:7,status:"active",kind:content.kind,title:"Recorded figure",origin:"direct",headVersion:2},
  version:{artifactId:"artifact:a",version:2,contentHash:h,sourceRefs:["source:filing"],dependencyRefs:["source:filing"],content},
}) as unknown as ArtifactDetail;
test("only exactly owned, current and sourced P4 chart is pinned, with native values intact",()=>{
  const saved=detail();
  const result=captureBriefingVisual(saved,7);
  assert.equal(result.version,2);
  assert.equal(result.content.kind,"chart");
  assert.deepEqual(result.sourceRefs,["source:filing"]);
  assert.deepEqual(result.content,chart);
  assert.deepEqual(verifyCurrentPinnedVisual(result,saved),result);
  assert.deepEqual(eligibleBriefingVisuals([saved.artifact],7).map(a=>a.id),["artifact:a"]);
});
test("P4 permissions, scopes, exact versions and source existence fail closed",()=>{
  const source=detail();
  assert.throws(()=>captureBriefingVisual(source,8),/current, active/);
  assert.throws(()=>captureBriefingVisual({...source,artifact:{...source.artifact,status:"archived"}},7),/current, active/);
  assert.throws(()=>captureBriefingVisual({...source,artifact:{...source.artifact,headVersion:3}},7),/current, active/);
  assert.throws(()=>captureBriefingVisual({...source,version:{...source.version,sourceRefs:[]}},7),/recorded P4 source/);
  assert.throws(()=>captureBriefingVisual({...source,version:{...source.version,contentHash:"not a digest"}},7),/current, active/);
  const pinned=captureBriefingVisual(source,7);
  assert.throws(()=>verifyCurrentPinnedVisual(pinned,{...source,version:{...source.version,contentHash:"b".repeat(64)}}),/changed/);
  assert.throws(()=>verifyCurrentPinnedVisual(pinned,{...source,version:{...source.version,content:{...chart,series:[{...chart.series[0],points:[{x:"2026",y:100}]}]}}}),/changed/);
});
test("the typed table is exact, bounded and cannot contain arbitrary NaN or undeclared cells",()=>{
  assert.deepEqual(captureBriefingVisual(detail(table),7).content,table);
  assert.throws(()=>captureBriefingVisual(detail({...table,rows:[{year:"2026",amount:Number.NaN}]}),7),/eligible/);
  assert.throws(()=>captureBriefingVisual(detail({...table,rows:[{year:"2026",amount:12,secret:5}]}),7),/eligible/);
  const oversized=Array.from({length:41},(_,i)=>({year:String(i),amount:i}));
  assert.throws(()=>captureBriefingVisual(detail({...table,rows:oversized}),7),/eligible/);
});
test("P4 report save receipt must prove exact content and both lineage arrays",()=>{
  const content={kind:"report" as const,templateId:"lios.source-grounded-briefing.v1",
    blocks:[{id:"intro",type:"heading" as const,text:"Verified",attrs:{}}],
    sections:[{id:"s",title:"Opening",blockIds:["intro"]}],editorPreference:"builtin" as const};
  const res={artifact:{...detail().artifact,id:"artifact:report",kind:"report",origin:"direct",headVersion:1},
    version:{...detail().version,artifactId:"artifact:report",version:1,content,sourceRefs:["source:filing"],dependencyRefs:["source:filing","artifact:chart"]}} as unknown as ArtifactDetail;
  assert.doesNotThrow(()=>assertSavedBriefingArtifact(res,7,content,["artifact:chart"],["source:filing"]));
  assert.throws(()=>assertSavedBriefingArtifact(res,8,content,["artifact:chart"],["source:filing"]),/P4 response/);
  assert.throws(()=>assertSavedBriefingArtifact(res,7,content,["missing"],["source:filing"]),/P4 response/);
  assert.throws(()=>assertSavedBriefingArtifact(res,7,content,["artifact:chart"],["missing"]),/P4 response/);
});
