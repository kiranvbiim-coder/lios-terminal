import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { projectRecordedAgentSteps, RECORDED_AGENT_STEP_LABELS } from "./recordedAgentStepTruth";
const R="22222222-2222-4222-8222-222222222222";
const OTHER="33333333-3333-4333-8333-333333333333";
const e=(type:string,fields:Record<string,unknown>={},requestId=R)=>
 ({requestId,at:"2026-10-28T02:00:00Z",type,...fields}) as unknown as ConversationRuntimeEvent;
const plan=e("plan",{plan:{steps:[
 {id:"s1",label:"Inspect evidence",kind:"retrieve",permissionClass:"safe_auto"},
 {id:"s2",label:"Write Project",kind:"action",permissionClass:"user_confirm"},
 {id:"s3",label:"Save version",kind:"artifact",permissionClass:"user_confirm"},
]}});
const states=(events:ConversationRuntimeEvent[],busy=false,stopRequested=false)=>
 projectRecordedAgentSteps(events,R,{busy,stopRequested}).map(s=>s.state);

test("C04 only exact run and plan steps; foreign event and orphan step cannot overwrite recorded work",()=>{
 assert.deepEqual(states([plan,e("tool_start",{stepId:"s1",label:"Start",componentId:"tool"},OTHER),e("tool_result",{stepId:"outside",outcome:"completed",label:"fake",summary:"",deterministic:true})]),["queued","queued","queued"]);
 assert.deepEqual(projectRecordedAgentSteps([plan],OTHER,{busy:true}),[]);
 assert.deepEqual(projectRecordedAgentSteps([],R,{busy:false}),[]);
});
test("plan and an overall success cannot forge missing individual tool receipts",()=>{
 assert.deepEqual(states([plan,e("done",{status:"completed"})]),["unconfirmed","unconfirmed","unconfirmed"]);
 assert.deepEqual(states([plan,e("tool_start",{stepId:"s1",label:"Inspect evidence",componentId:"test"}),e("done",{status:"completed"})]),["unconfirmed","unconfirmed","unconfirmed"]);
 assert.deepEqual(states([plan,e("tool_result",{stepId:"s1",label:"ok",summary:"",deterministic:true,sourceRefs:[]}),e("done",{status:"completed"})]),["unconfirmed","unconfirmed","unconfirmed"]);
});
test("only explicit tool completion may be displayed as a report, never as verified external success",()=>{
 assert.deepEqual(states([plan,e("tool_result",{stepId:"s1",label:"ok",summary:"",deterministic:true,sourceRefs:[],outcome:"completed"}),e("done",{status:"completed"})]),["reported_complete","unconfirmed","unconfirmed"]);
 assert.match(RECORDED_AGENT_STEP_LABELS.reported_complete,/check receipt/i);
 assert.deepEqual(states([plan,e("tool_result",{stepId:"s1",label:"bad",summary:"",deterministic:false,sourceRefs:[],outcome:"denied"}),e("done",{status:"completed"})]),["denied","unconfirmed","unconfirmed"]);
});
test("failure, skip, denial and cancellation remain distinct; stop request is not a confirmed cancel",()=>{
 for(const outcome of ["failed","skipped","denied","approval_required"] as const) {
  assert.equal(states([plan,e("tool_result",{stepId:"s1",label:"x",summary:"",deterministic:true,outcome})],true)[0],
   {failed:"reported_failed",skipped:"skipped",denied:"denied",approval_required:"awaiting_approval"}[outcome]);
 }
 assert.deepEqual(states([plan,e("tool_start",{stepId:"s1",label:"x",componentId:"x"})],true,true),["cancel_requested","queued","queued"]);
 assert.deepEqual(states([plan,e("done",{status:"cancelled"})]),["cancelled","cancelled","cancelled"]);
});
test("only same-step exact-bound review changes that step to awaiting permission",()=>{
 const review=e("governed_tool_approval_required",{reviewId:"44444444-4444-4444-8444-444444444444",reviewBinding:{stepId:"s2"},choices:["allow_once","deny"]});
 assert.deepEqual(states([plan,review,e("done",{status:"waiting_approval"})]),["queued","awaiting_approval","queued"]);
 assert.deepEqual(states([plan,review,e("tool_result",{stepId:"s2",label:"denied",summary:"",deterministic:true,outcome:"denied"}),e("done",{status:"failed"})]),["unconfirmed","denied","unconfirmed"]);
 assert.deepEqual(states([plan,review,e("done",{status:"cancelled"})]),["cancelled","cancelled","cancelled"]);
});
