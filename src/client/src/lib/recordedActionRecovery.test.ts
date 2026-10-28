import assert from "node:assert/strict";
import test from "node:test";
import {inspectRecordedActionRecovery} from "./recordedActionRecovery";
import type {ConversationRuntimeEvent} from "@shared/conversationRuntime";
const R="11111111-1111-4111-8111-111111111111";
const O="22222222-2222-4222-8222-222222222222";
function e(type:string,body:Record<string,unknown>={},requestId=R):ConversationRuntimeEvent {
 return {type,at:"2026-10-28T03:00:00.000Z",requestId,...body} as unknown as ConversationRuntimeEvent;
}
function receipt(id:string,status:"failed"|"completed"|"cancelled",requestId=R) {
 return e("receipt",{receipt:{id,requestId,status}});
}
test("C08 denied and failed tools remain unresolved even when run-level done says completed",()=>{
 const result=inspectRecordedActionRecovery([
  e("tool_start",{stepId:"send",label:"Send",componentId:"external"}),
  e("tool_result",{stepId:"send",outcome:"denied",summary:"Private",label:"Send",deterministic:false}),
  e("tool_result",{stepId:"read",outcome:"failed",summary:"Private",label:"Read",deterministic:true}),
  e("done",{status:"completed"}),
 ],R);
 assert.deepEqual([result.failedToolReports,result.deniedToolReports,result.unfinishedToolStarts,result.needsReconciliation],[1,1,0,true]);
});
test("C08 a restarted tool with no last result is unconfirmed, not a green success",()=>{
 const result=inspectRecordedActionRecovery([
  e("tool_result",{stepId:"a",outcome:"completed",summary:"",label:"a",deterministic:true}),
  e("tool_start",{stepId:"a",label:"a",componentId:"write"}),
  e("tool_start",{stepId:"b",label:"b",componentId:"write"}),
  e("done",{status:"completed"}),
 ],R);
 assert.equal(result.unfinishedToolStarts,2);
});
test("C08 only exact owner receipts count; duplicate IDs ignored, cross-run receipt excluded",()=>{
 const id="33333333-3333-4333-8333-333333333333";
 const x=inspectRecordedActionRecovery([
  receipt(id,"failed"),receipt(id,"failed"),
  receipt("44444444-4444-4444-8444-444444444444","cancelled"),
  receipt("55555555-5555-4555-8555-555555555555","completed",O),
  e("tool_result",{stepId:"foreign",outcome:"failed",label:"foreign",summary:"",deterministic:false},O),
  e("receipt",{receipt:{id:"66666666-6666-4666-8666-666666666666",requestId:O,status:"completed"}}),
 ],R);
 assert.equal(x.failedReceipts,1);assert.equal(x.cancelledReceipts,1);
 assert.equal(x.failedToolReports,0);assert.equal(x.ignoredForeignReceipts,1);
 assert.deepEqual(inspectRecordedActionRecovery([],R).needsReconciliation,false);
 assert.deepEqual(inspectRecordedActionRecovery([receipt(id,"failed")],null).needsReconciliation,false);
});
