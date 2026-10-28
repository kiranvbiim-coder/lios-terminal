import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");

test("C05 reuses the existing P3 Prism -> Trust -> Chat composer chain, not a second recommendation engine",()=>{
 const prism=read("../components/terminal/EvidencePrism.tsx");
 const trust=read("../components/terminal/ConversationTrustPanel.tsx");
 const chat=read("../components/terminal/ConversationRuntimeTrace.tsx");
 assert.match(prism,/sourceGroundedDecisionReview\(manifest, claim\.claimId\)/);
 assert.match(prism,/data-testid="c05-recorded-decision-review"/);
 assert.match(prism,/onReviewDecision\(decision\.draft\.prompt\)/);
 assert.match(trust,/onReviewDecision=\{onReviewDecision\}/);
 assert.match(chat,/onReviewDecision=\{onFollowUp\}/);
 assert.match(chat,/Prefills the composer with a suggested next request; never sends it/);
 for(const text of [prism,trust,chat]){
  assert.doesNotMatch(text,/autoExecuteDecision|recommendation\\.execute|automaticallySendRecommendation/);
 }
});
