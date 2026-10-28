import test from "node:test";
import assert from "node:assert/strict";
import type {ConversationRuntimeEvent} from "@shared/conversationRuntime";
import {exactRuntimeSavedArtifact} from "./exactRuntimeSavedArtifact";
const R="11111111-1111-4111-8111-111111111111";
const A="artifact:22222222-2222-4222-8222-222222222222";
const record={requestId:R,type:"artifact",at:"2026-10-28T07:00:00.000Z",
 artifact:{projectId:12,title:"Evidence report",artifactType:"research"},
 persistedArtifact:{id:A,version:3}} as ConversationRuntimeEvent;
const owner={requestId:R,projectId:12,chatId:10};
test("C06 bound P4 handoff preserves exact saved version rather than promoting to latest",()=>{
 assert.deepEqual(exactRuntimeSavedArtifact(record,owner),{
   artifactId:A,version:3,projectId:12,requestId:R,
 });
 assert.equal(exactRuntimeSavedArtifact(record,{...owner,projectId:13}),null);
 assert.equal(exactRuntimeSavedArtifact(record,{...owner,chatId:null}),null);
 assert.equal(exactRuntimeSavedArtifact(record,{...owner,requestId:"other"}),null);
});
test("C06 rejects imaginary, malformed and unsaved versions",()=>{
 for(const value of [
  {...record,persistedArtifact:undefined},
  {...record,persistedArtifact:{id:"bad",version:3}},
  {...record,persistedArtifact:{id:A,version:0}},
  {...record,persistedArtifact:{id:A,version:1.3}},
  {...record,type:"text"},
 ])assert.equal(exactRuntimeSavedArtifact(value as ConversationRuntimeEvent,owner),null);
 assert.equal(exactRuntimeSavedArtifact(null,owner),null);
});
