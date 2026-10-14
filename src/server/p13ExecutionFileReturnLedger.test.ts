import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  P13ExecutionFileReturnLedger, P13_RETURN_LIMITS,
} from "./p13ExecutionFileReturnLedger";
import type { P13StagedFileReturn } from "./p13PluginWriteReturn";

const componentId = "plugin.return.component";
const id = "22222222-2222-4222-8222-222222222222";

function file(input: {
  id?: string;
  path?: string;
  size?: number;
  component?: string;
  byte?: number;
} = {}): P13StagedFileReturn {
  const data = Buffer.alloc(input.size ?? 15,input.byte ?? 7);
  return {
    executionRequestId:input.id ?? id,
    componentId:input.component ?? componentId,
    scope:"project",
    rootIndex:0,
    relativePath:input.path ?? "out.txt",
    size:data.length,
    sha256:crypto.createHash("sha256").update(data).digest("hex"),
    data,
  };
}

test("P13 ledger clones input/output and clears bytes on completion; no host paths in facts",()=>{
  const ledger=new P13ExecutionFileReturnLedger();
  ledger.begin(id,componentId);
  const returned=file();
  ledger.stage(returned);
  returned.data.fill(0);
  assert.deepEqual(ledger.facts(),{
    activeExecutions:1,storedFiles:1,storedBytes:15,
  });
  const [copy]=ledger.complete(id);
  assert.equal(copy?.data.toString("hex"),"07".repeat(15));
  assert.deepEqual(ledger.facts(),{activeExecutions:0,storedFiles:0,storedBytes:0});
  assert.throws(()=>ledger.complete(id),/revoked/);
  copy!.data.fill(2);
  ledger.begin(id,componentId);
  const another=file({path:"new.txt"});
  ledger.stage(another);
  ledger.revoke(id);
  assert.deepEqual(ledger.facts(),{activeExecutions:0,storedFiles:0,storedBytes:0});
});

test("P13 ledger denies duplicate output, wrong execution and altered return integrity",()=>{
  const ledger=new P13ExecutionFileReturnLedger();
  ledger.begin(id,componentId);
  ledger.stage(file());
  assert.throws(()=>ledger.stage(file()),/duplicate/);
  assert.throws(()=>ledger.stage(file({component:"plugin.other",path:"new.txt"})),/revoked/);
  assert.throws(()=>ledger.stage(file({id:"33333333-3333-4333-8333-333333333333"})),/revoked/);
  const bad=file({path:"changed.txt"});
  assert.throws(()=>ledger.stage({...bad,sha256:"f".repeat(64)}),/integrity/);
  const size=file({path:"bad-size.txt"});
  assert.throws(()=>ledger.stage({...size,size:size.size+1}),/integrity/);
  assert.deepEqual(ledger.facts(),{activeExecutions:1,storedFiles:1,storedBytes:15});
  ledger.revoke(id);
  assert.throws(()=>ledger.stage(file({path:"late.txt"})),/revoked/);
});

test("P13 ledger enforces per-request file cap, byte cap and global budget",()=>{
  const ledger=new P13ExecutionFileReturnLedger();
  ledger.begin(id,componentId);
  for(let i=0;i<P13_RETURN_LIMITS.maxFilesPerExecution;i++)
    ledger.stage(file({path:"output-"+i+".bin",size:10}));
  assert.throws(()=>ledger.stage(file({path:"one-too-many"})),/budget/);
  ledger.revoke(id);
  ledger.begin(id,componentId);
  ledger.stage(file({path:"big-1",size:P13_RETURN_LIMITS.maxBytesPerFile}));
  ledger.stage(file({path:"big-2",size:P13_RETURN_LIMITS.maxBytesPerFile}));
  assert.throws(()=>ledger.stage(file({path:"overflow",size:1})),/budget/);
  assert.throws(()=>ledger.stage(file({path:"oversized",size:P13_RETURN_LIMITS.maxBytesPerFile+1})),/budget/);
  ledger.revoke(id);
  const ids=Array.from({length:5},(_,i)=>"exec-"+i);
  for(let i=0;i<4;i++){
    ledger.begin(ids[i]!,componentId);
    ledger.stage(file({id:ids[i],path:"a",size:P13_RETURN_LIMITS.maxBytesPerFile}));
    ledger.stage(file({id:ids[i],path:"b",size:P13_RETURN_LIMITS.maxBytesPerFile}));
  }
  ledger.begin(ids[4]!,componentId);
  assert.throws(()=>ledger.stage(file({id:ids[4],size:1})),/budget/);
  assert.equal(ledger.facts().storedBytes,P13_RETURN_LIMITS.maxBytesAcrossExecutions);
  ledger.revoke(ids[0]!);
  ledger.stage(file({id:ids[4],size:1}));
  ledger.dispose();
  assert.deepEqual(ledger.facts(),{activeExecutions:0,storedFiles:0,storedBytes:0});
});

test("P13 ledger caps live executions, rejects replay and revokes all on dispose",()=>{
  const ledger=new P13ExecutionFileReturnLedger();
  for(let i=0;i<P13_RETURN_LIMITS.maxExecutions;i++)ledger.begin("exec-"+i,componentId);
  assert.throws(()=>ledger.begin("exec-overflow",componentId),/unavailable/);
  assert.throws(()=>ledger.begin("exec-0",componentId),/unavailable/);
  ledger.revoke("exec-0");
  ledger.begin("exec-next",componentId);
  assert.deepEqual(ledger.complete("exec-next"),[]);
  ledger.dispose();
  assert.equal(ledger.facts().activeExecutions,0);
});
