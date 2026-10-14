import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHRAG_SOURCE_LINEAGE, rankPermittedEvidenceLinks, buildPermittedEvidenceNeighborhoods } from "./graphragPermittedEvidenceLinks";

const a={sourceRef:"research:a",entityRefs:["company:A","company:B"]};
const b={sourceRef:"research:b",entityRefs:["company:A","company:B"]};
const c={sourceRef:"research:c",entityRefs:["company:B"]};
const d={sourceRef:"research:d",entityRefs:["company:Z"]};

test("GraphRAG P7 adaptation keeps approved source pin and no shadow graph store",()=>{
 assert.equal(GRAPHRAG_SOURCE_LINEAGE.commit,"769542fbf1d8e5b4c6a8677fefc34621c87894c5");
 assert.equal(GRAPHRAG_SOURCE_LINEAGE.license,"MIT");
 assert.equal(GRAPHRAG_SOURCE_LINEAGE.importedRuntime,false);
});
test("canonical source refs form ranked deterministic source-scoped edges",()=>{
 const expected=[
  {leftSourceRef:"research:a",rightSourceRef:"research:b",sharedEntityCount:2},
  {leftSourceRef:"research:a",rightSourceRef:"research:c",sharedEntityCount:1},
  {leftSourceRef:"research:b",rightSourceRef:"research:c",sharedEntityCount:1},
 ];
 assert.deepEqual(rankPermittedEvidenceLinks([c,b,d,a]),expected);
 assert.deepEqual(rankPermittedEvidenceLinks([a,b,c,d]),expected);
 assert.deepEqual(rankPermittedEvidenceLinks([a,b,c,d],{maxLinks:1}),expected.slice(0,1));
 assert.deepEqual(rankPermittedEvidenceLinks([a,d]),[]);
 assert.deepEqual(rankPermittedEvidenceLinks([]),[]);
});
test("duplicate canonical refs and malformed IDs fail closed rather than double count",()=>{
 assert.throws(()=>rankPermittedEvidenceLinks([a,a]),/Duplicate/);
 assert.throws(()=>rankPermittedEvidenceLinks([{sourceRef:"a",entityRefs:[""]}]));
 assert.throws(()=>rankPermittedEvidenceLinks([{sourceRef:"a",entityRefs:[null as unknown as string]}]));
 assert.throws(()=>rankPermittedEvidenceLinks([{sourceRef:"a",entityRefs:["ok"]}, {sourceRef:" a ",entityRefs:["ok"]}]),/Duplicate/);
 assert.deepEqual(rankPermittedEvidenceLinks([{sourceRef:"a",entityRefs:["x","x"]},{sourceRef:"b",entityRefs:["x"]}]),[
  {leftSourceRef:"a",rightSourceRef:"b",sharedEntityCount:1}
 ]);
});
test("oversized context and budget cannot expand to raw unfiltered graph",()=>{
 for(const maxLinks of [-1,101,Infinity,1.5])assert.throws(()=>rankPermittedEvidenceLinks([],{maxLinks}));
 assert.throws(()=>rankPermittedEvidenceLinks(Array.from({length:51},(_,i)=>({sourceRef:"s:"+i,entityRefs:["x"]}))));
 assert.throws(()=>rankPermittedEvidenceLinks([{sourceRef:"x",entityRefs:["a".repeat(501)]}]));
});

test("GraphRAG coherent in-network and candidate relationship selection yields bounded two-hop source neighborhoods",()=>{
 const edges=rankPermittedEvidenceLinks([d,c,a,b]);
 const expected=[
  {sourceRef:"research:a",directSourceRefs:["research:b","research:c"],twoHopSourceRefs:[],directLinkCount:2,sharedEntityMentions:3},
  {sourceRef:"research:b",directSourceRefs:["research:a","research:c"],twoHopSourceRefs:[],directLinkCount:2,sharedEntityMentions:3},
  {sourceRef:"research:c",directSourceRefs:["research:a","research:b"],twoHopSourceRefs:[],directLinkCount:2,sharedEntityMentions:2},
 ];
 assert.deepEqual(buildPermittedEvidenceNeighborhoods([b,a,d,c],edges),expected);
 assert.deepEqual(buildPermittedEvidenceNeighborhoods([c,b,d,a],[...edges].reverse()),expected);
 assert.deepEqual(buildPermittedEvidenceNeighborhoods([a,d],[]),[]);
});

test("GraphRAG two-hop paths navigate permitted evidence without falsely claiming a direct shared entity",()=>{
 const s=[
  {sourceRef:"first",entityRefs:["company:one"]},
  {sourceRef:"bridge",entityRefs:["company:one","company:two"]},
  {sourceRef:"last",entityRefs:["company:two"]},
 ];
 const links=rankPermittedEvidenceLinks(s);
 assert.deepEqual(links,[
  {leftSourceRef:"bridge",rightSourceRef:"first",sharedEntityCount:1},
  {leftSourceRef:"bridge",rightSourceRef:"last",sharedEntityCount:1},
 ]);
 assert.deepEqual(buildPermittedEvidenceNeighborhoods(s,links),[
  {sourceRef:"bridge",directSourceRefs:["first","last"],twoHopSourceRefs:[],directLinkCount:2,sharedEntityMentions:2},
  {sourceRef:"first",directSourceRefs:["bridge"],twoHopSourceRefs:["last"],directLinkCount:1,sharedEntityMentions:1},
  {sourceRef:"last",directSourceRefs:["bridge"],twoHopSourceRefs:["first"],directLinkCount:1,sharedEntityMentions:1},
 ]);
});

test("GraphRAG graph neighborhoods never expose blocked sources or forged edges",()=>{
 const all=[
  {sourceRef:"allowed-a",entityRefs:["x"]},
  {sourceRef:"blocked-secret",entityRefs:["x"]},
  {sourceRef:"allowed-b",entityRefs:["x"]},
 ];
 const permitted=[all[0],all[2]];
 const edges=rankPermittedEvidenceLinks(permitted);
 const neighborhoods=buildPermittedEvidenceNeighborhoods(permitted,edges);
 assert.equal(JSON.stringify(neighborhoods).includes("blocked-secret"),false);
 assert.throws(()=>buildPermittedEvidenceNeighborhoods(permitted,[
  ...edges,{leftSourceRef:"allowed-a",rightSourceRef:"blocked-secret",sharedEntityCount:1}
 ]),/unpermitted/);
 assert.throws(()=>buildPermittedEvidenceNeighborhoods(permitted,[edges[0],edges[0]]),/duplicate/);
 assert.throws(()=>buildPermittedEvidenceNeighborhoods(permitted,[{leftSourceRef:"allowed-a",rightSourceRef:"allowed-a",sharedEntityCount:1}]),/unpermitted/);
 assert.throws(()=>buildPermittedEvidenceNeighborhoods(permitted,[{...edges[0],sharedEntityCount:501}]));
 assert.throws(()=>buildPermittedEvidenceNeighborhoods([permitted[0],permitted[0]],edges),/unique/);
});
