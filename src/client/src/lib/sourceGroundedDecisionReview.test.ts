import assert from "node:assert/strict";
import test from "node:test";
import type {TrustManifest} from "@shared/trustContracts";
import {sourceGroundedDecisionReview} from "./sourceGroundedDecisionReview";
const ID="22222222-2222-4222-8222-222222222222";
const SOURCE="private:never-send-this";
const manifest={
 trustId:ID,summary:{conflictState:"none"},evidence:[{
  sourceRef:SOURCE,kind:"provider",access:{state:"allowed",entitlementRequired:false},
  connectorState:"live_verified",providerLabel:"Saved provider",observedAt:"2026-10-27T09:00:00Z",
 }],assumptions:[{ref:"assumption:a",value:"NEVER-TRANSMIT-MODEL-DATA"}],
 missing:[],warnings:[],claims:[{
  claimId:ID,status:"supported",sourceRefs:[SOURCE],assumptionRefs:["assumption:a"],
  label:"Do not blindly advise",explanation:"Private recorded text",confidence:"high",
 }],
} as unknown as TrustManifest;
test("C05 only creates an opt-in review prompt from exact, matched, known-access recorded evidence",()=>{
 const review=sourceGroundedDecisionReview(manifest,ID);
 assert.equal(review.status,"ready");
 if(review.status!=="ready")return;
 assert.equal(review.draft.sourceCount,1);
 assert.equal(review.draft.unresolvedAssumptions,0);
 assert.match(review.draft.prompt,/CURRENT source permission/);
 assert.match(review.draft.prompt,/Do not execute tools/);
 assert.doesNotMatch(review.draft.prompt,/private:never|NEVER-TRANSMIT|Do not blindly advise|Private recorded text/);
 assert.equal(sourceGroundedDecisionReview(manifest,"missing").status,"blocked");
});
test("C05 refuses unsupported, materially conflicted, unlinked, AI-only or denied source claims",()=>{
 for(const patch of [
  {claims:[{...manifest.claims[0],status:"conflicted"}]},
  {summary:{conflictState:"material"}},
  {claims:[{...manifest.claims[0],sourceRefs:[]}]},
  {claims:[{...manifest.claims[0],sourceRefs:["missing"]}]},
  {evidence:[{...manifest.evidence[0],kind:"ai"}]},
  {evidence:[{...manifest.evidence[0],access:{state:"revoked"}}]},
  {evidence:[{...manifest.evidence[0],access:null}]},
 ])assert.equal(sourceGroundedDecisionReview({...manifest,...patch} as TrustManifest,ID).status,"blocked");
});
test("C05 missing assumptions are called out, never filled by guessed values",()=>{
 const review=sourceGroundedDecisionReview({...manifest,assumptions:[]} as TrustManifest,ID);
 assert.equal(review.status,"ready");
 if(review.status==="ready") {
  assert.equal(review.draft.unresolvedAssumptions,1);
  assert.match(review.draft.prompt,/request missing inputs/);
 }
});
