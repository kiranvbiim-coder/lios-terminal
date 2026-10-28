import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("C08 remains a read-only projector; recovery controls cannot run a tool or bypass P2 review",()=>{
 const trace=readFileSync(new URL("../components/terminal/ConversationRuntimeTrace.tsx",import.meta.url),"utf8");
 const recovery=readFileSync(new URL("./recordedActionRecovery.ts",import.meta.url),"utf8");
 for(const requirement of [
   'inspectRecordedActionRecovery(events, requestId)',
   'data-testid="c08-recorded-action-recovery"',
   'data-testid="c08-receipt-recovery-review"',
   'onClick={onRetry}',
   'The overall run completion does not override these individual reports',
   'Neither this card nor the review control replays a tool or grants permission',
 ])assert.ok(trace.includes(requirement),"missing C08 action reconciliation "+requirement);
 assert.match(recovery,/event.requestId!==requestId/);
 assert.match(recovery,/receipt.requestId!==requestId/);
 assert.match(recovery,/receipts.has\(receipt.id\)/);
 assert.doesNotMatch(recovery,/fetch\(|apiRequest\(|approveRuntime|runP9WorkflowNow|Math\.random/);
});
