import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBoundedAgentModelObject, BoundedModelReplyError, LANGALPHA_MODEL_REPLY_SOURCE,
} from "./langAlphaModelReplyParser";

test("LangAlpha parser adopts exact upstream source and not a parallel agent runtime",()=>{
 assert.equal(LANGALPHA_MODEL_REPLY_SOURCE.commit,"941ca4a18f5a364caf481a6f78cdb040086aa38d");
 assert.equal(LANGALPHA_MODEL_REPLY_SOURCE.installedDonorRuntime,false);
});
test("planning JSON survives markdown fencing, prose braces and nested escaped strings",()=>{
 const v={steps:[{id:"one",toolId:"known",label:'Compare "{pair}" quotes',input:{query:'{A} "x"'},dependsOn:[]}]};
 const text='For reference: {not-json}.\n\n```json\n'+JSON.stringify(v)+'\n```\nPostscript {not-json either}';
 assert.deepEqual(parseBoundedAgentModelObject(text),v);
});
test("review objects are selected over unrelated preceding JSON snippets",()=>{
 const data={decision:"complete",answer:"Finished"};
 assert.deepEqual(parseBoundedAgentModelObject('Example: {"ignored":1}\\n'+JSON.stringify(data)),data);
});
test("untrusted model text is bounded in length and JSON nesting",()=>{
 assert.throws(()=>parseBoundedAgentModelObject("x".repeat(256001)),(e:unknown)=>e instanceof BoundedModelReplyError&&e.kind==="too_large");
 assert.throws(()=>parseBoundedAgentModelObject('{"steps":'+ "[".repeat(90)+"0"+"]".repeat(90)+"}"),BoundedModelReplyError);
 assert.throws(()=>parseBoundedAgentModelObject("no brace at all"),(e:unknown)=>e instanceof BoundedModelReplyError&&e.kind==="no_object");
});
test("malformed or candidate-exhausting text fails with secret-safe reason",()=>{
 assert.throws(()=>parseBoundedAgentModelObject('secret-password=abc {invalid\n{another'),(e:unknown)=>{
  return e instanceof BoundedModelReplyError&&!e.message.includes("abc");
 });
 const spam="{invalid} ".repeat(33)+'{"steps":[]}';
 assert.throws(()=>parseBoundedAgentModelObject(spam),BoundedModelReplyError);
});
test("non-plan objects are handed back to GM shape validator, not auto-approved",()=>{
 assert.deepEqual(parseBoundedAgentModelObject('{"admin":true}'),{admin:true});
});
