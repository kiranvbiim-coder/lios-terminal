import assert from "node:assert/strict";
import test from "node:test";
import {recordedGraphDomainCounts} from "./recordedGraphDomainCounts";
import type {CrossDomainNode} from "./terminalCrossDomainGraph";
const nodes: CrossDomainNode[]=[
  {objectId:"a",label:"Retained policy",domain:"policy",strength:.3},
  {objectId:"b",label:"Retained market",domain:"market",strength:1},
  {objectId:"c",label:"Another market",domain:"market",strength:0},
  {objectId:"b",label:"Duplicate ID",domain:"policy",strength:1},
];
test("B08 treemap groups only unique visible saved objects, not importance or inferred links",()=>{
  const before=structuredClone(nodes);
  assert.deepEqual(recordedGraphDomainCounts(nodes),[{domain:"market",count:2},{domain:"policy",count:1}]);
  assert.deepEqual(nodes,before);
  assert.deepEqual(recordedGraphDomainCounts([]),[]);
});
test("B08 treemap retains 120 limit and never weights object importance by strength",()=>{
  const many=Array.from({length:170},(_,i)=>({...nodes[0],objectId:"id-"+i}));
  assert.deepEqual(recordedGraphDomainCounts(many),[{domain:"policy",count:120}]);
});
