import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { conversationRequestSchema } from "@shared/conversationRuntime";
import { trustManifestSchema } from "@shared/trustContracts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-claim-review-"));
process.env.LIMURIA_DATA_DIR = root;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProjectChat, addProjectChatMessage } = await import("./projectChatStore");
const { resolveRecordedClaimReview } = await import("./recordedClaimReview");
const { planConversationWorkflow, executeConversationRuntime } = await import("./conversationRuntime");

test("recorded claim review resolves exact owned history and never falls through to ticker/options retrieval", async t => {
  await initDb(); t.after(async () => { await closeDb(); fs.rmSync(root, { recursive:true, force:true }); });
  const [owner, foreign] = await getDb().insert(users).values(["owner", "foreign"].map(name => ({name,email:`${crypto.randomUUID()}@example.test`,passwordHash:"unused",role:"internal_analyst" as const}))).returning();
  const ctx = {userId:owner.id,organizationId:null,role:owner.role};
  const other = {userId:foreign.id,organizationId:null,role:foreign.role};
  const chat = await createProjectChat(ctx,{scope:"quick",title:null});
  const otherChat = await createProjectChat(other,{scope:"quick",title:null});
  const binding = {sourceRequestId:crypto.randomUUID(),trustId:crypto.randomUUID(),claimId:crypto.randomUUID()};
  const manifest = trustManifestSchema.parse({schemaVersion:"1",trustId:binding.trustId,requestId:binding.sourceRequestId,
    generatedAt:new Date().toISOString(),sourceScope:"my_data",summary:{freshness:"snapshot",quality:"high",confidence:"medium",conflictState:"none",evidenceCoveragePct:100,sourceCount:1,receiptCount:0,missingCount:0},
    evidence:[{evidenceId:crypto.randomUUID(),sourceRef:"private:source-one",providerLabel:"Owned retained source",kind:"manual",observedAt:new Date().toISOString(),freshness:"snapshot",quality:"high",confidence:"medium"}],
    claims:[{claimId:binding.claimId,label:"The exact retained observation",path:"manual:observation",status:"supported",sourceRefs:["private:source-one"],confidence:"medium",explanation:"Recorded observation"}],
  });
  await addProjectChatMessage(ctx,chat.id,{role:"assistant",content:"Original source-backed answer",metadata:{runtimeRequestId:binding.sourceRequestId,recordedTrustManifest:manifest}});
  const text = await resolveRecordedClaimReview(ctx,chat.id,binding);
  assert.match(text,/The exact retained observation/);
  assert.match(text,/No provider was contacted/);
  assert.doesNotMatch(text,/private:source-one/);
  await assert.rejects(resolveRecordedClaimReview(other,chat.id,binding));
  await assert.rejects(resolveRecordedClaimReview(other,otherChat.id,binding),/unavailable/);
  await assert.rejects(resolveRecordedClaimReview(ctx,chat.id,{...binding,trustId:crypto.randomUUID()}),/unavailable/);
  await assert.rejects(resolveRecordedClaimReview(ctx,chat.id,{...binding,claimId:crypto.randomUUID()}),/exact selected claim/);
  const request = conversationRequestSchema.parse({requestId:crypto.randomUUID(),message:"Review decision options. Recorded claim ID",recordedClaimReview:binding,context:{symbol:"AAPL"}});
  const plan = planConversationWorkflow(request);
  assert.equal(plan.intent.parameters.workflow,"recorded_claim_review");
  assert.deepEqual(plan.capabilities,[]);
  let aiCalls=0;
  const result = await executeConversationRuntime({tenant:ctx,scope:"quick",chatId:chat.id,projectId:null,history:[],request,recordedClaimReviewText:text,
    emit:()=>{},aiCompletion:async()=>{aiCalls++;throw new Error("Unexpected model dispatch");}});
  assert.equal(result.text,text); assert.equal(result.label,"manual"); assert.equal(aiCalls,0); assert.deepEqual(result.receiptIds,[]);
  await assert.rejects(executeConversationRuntime({tenant:ctx,scope:"quick",chatId:chat.id,projectId:null,history:[],request,emit:()=>{}}),/exact owner-scoped claim/);
});
