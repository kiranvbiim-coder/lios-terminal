import test from "node:test";
import assert from "node:assert/strict";
import {reconcileUnconfirmedRunPrompt} from "./runRecoveryReconciliation";
test("C08 produces only an exact-run read-only reconciliation draft",()=>{
 const text=reconcileUnconfirmedRunPrompt("22222222-2222-4222-8222-222222222222");
 assert.ok(text);
 assert.match(text!,/READ-ONLY reconciliation/);
 assert.match(text!,/Prior request ID: 22222222/);
 assert.match(text!,/Do not replay this run/);
 assert.match(text!,/outcome unknown/);
});
test("C08 cannot synthesize run identity from missing or untrusted request",()=>{
 assert.equal(reconcileUnconfirmedRunPrompt(null),null);
 assert.equal(reconcileUnconfirmedRunPrompt("not-a-run"),null);
 assert.equal(reconcileUnconfirmedRunPrompt("abcd"),null);
});
