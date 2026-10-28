import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");

test("C08 per-tool anomalies are visible even when the overall run reports completed",()=>{
 const trace=read("../components/terminal/ConversationRuntimeTrace.tsx");
 const audit=read("./recordedActionRecovery.ts");
 assert.match(trace,/inspectRecordedActionRecovery\(events, requestId\)/);
 assert.match(trace,/done\?\.type === "done" && done\.status === "completed" && actionRecovery\.needsReconciliation/);
 assert.match(trace,/data-testid="c08-recorded-action-recovery"/);
 assert.match(trace,/The overall run completion does not override these individual reports/);
 for(const field of ["failedToolReports","deniedToolReports","unfinishedToolStarts","failedReceipts","cancelledReceipts","ignoredForeignReceipts"]) {
   assert.ok(trace.includes("actionRecovery."+field), "missing recorded count: "+field);
 }
 assert.match(audit,/event\.requestId!==requestId/);
 assert.match(audit,/receipt\.requestId!==requestId/);
 assert.match(audit,/receipts\.has\(receipt\.id\)/);
 assert.doesNotMatch(audit,/fetch\(|apiRequest\(|runP9WorkflowNow|approveRuntime/);
});

test("C08 reconciliation controls inspect history without retry, grant or execution",()=>{
 const trace=read("../components/terminal/ConversationRuntimeTrace.tsx");
 assert.match(trace,/data-testid="c08-receipt-recovery-review" onClick=\{onInspectRun\}/);
 assert.match(trace,/data-testid="c08-receipt-recovery-review" onClick=\{\(\) => setShowWork\(true\)\}/);
 assert.match(trace,/Neither this card nor its review control replays a tool or grants permission/);
 assert.doesNotMatch(trace,/onClick=\{onRetry\}/);
 assert.doesNotMatch(trace,/data-testid="c08-receipt-recovery-review" onClick=\{\(\) => onFollowUp/);
});
