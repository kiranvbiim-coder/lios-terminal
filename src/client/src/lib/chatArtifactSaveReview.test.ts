import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationArtifactDraft } from "@shared/conversationRuntime";
import {reviewChatArtifactSave,chatArtifactSaveAcknowledgmentKey} from "./chatArtifactSaveReview";
const draft:ConversationArtifactDraft={
 schemaVersion:"1",artifactId:"11111111-1111-4111-8111-111111111111",artifactType:"report",
 title:"Recorded research report",projectId:17,sourceRefs:["evidence:1","evidence:1"],
 executionReceiptIds:[],data:{blocks:[{text:"Private data must not appear in review metadata"}]},
 persistence:"project_candidate",
};
test("C06 requires exact recorded run, valid persistence and destination",()=>{
 assert.equal(reviewChatArtifactSave(draft,null).status,"blocked");
 assert.equal(reviewChatArtifactSave({...draft,persistence:"ephemeral"},"22222222-2222-4222-8222-222222222222").status,"blocked");
 assert.equal(reviewChatArtifactSave({...draft,projectId:null},"22222222-2222-4222-8222-222222222222").status,"blocked");
 const review=reviewChatArtifactSave(draft,"22222222-2222-4222-8222-222222222222");
 assert.equal(review.status,"review");
 if(review.status==="review"){
  assert.equal(review.destination,"Project 17");
  assert.equal(review.sourceCount,1);
  assert.equal(review.hasReceipts,false);
  assert.equal(JSON.stringify(review).includes("Private data"),false);
 }
});
test("C06 Chat candidates and missing sources are disclosed, not treated as verified",()=>{
 const result=reviewChatArtifactSave({...draft,persistence:"chat_candidate",projectId:null,sourceRefs:[]},"22222222-2222-4222-8222-222222222222");
 assert.equal(result.status,"review");
 if(result.status==="review"){
  assert.equal(result.destination,"The current saved Chat");
  assert.match(result.disclosure,/No supporting source references/);
 }
});
test("C06 changes to draft payload, source lineage or destination always require new acknowledgement",()=>{
 const key=chatArtifactSaveAcknowledgmentKey(draft,"22222222-2222-4222-8222-222222222222");
 for(const changed of [
  {...draft,data:{blocks:[]}}, {...draft,sourceRefs:["evidence:2"]},
  {...draft,projectId:18}, {...draft,persistence:"chat_candidate" as const},
 ])assert.notEqual(chatArtifactSaveAcknowledgmentKey(changed,"22222222-2222-4222-8222-222222222222"),key);
});
