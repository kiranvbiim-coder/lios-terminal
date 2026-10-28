import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("C07 reuses one existing P9 review dialog; Chat cannot schedule directly", () => {
  const shell = source("../components/terminal/ProjectExperienceShell.tsx");
  const trace = source("../components/terminal/ConversationRuntimeTrace.tsx");
  const dialog = source("../components/terminal/SaveWorkflowDialog.tsx");
  for (const fragment of [
    "setLastWorkflowSourceRequestId(requestId)",
    "setLastWorkflowSourceRequestId(null)",
    "canPrepareProjectAutomationDraft({",
    "sourceRequestId: lastWorkflowSourceRequestId",
    "currentRequestId: runtimeHandoffRequestIdRef.current",
    "setShowSaveWorkflow(true)",
    "<SaveWorkflowDialog",
    "showSaveWorkflow && canPrepareChatAutomation",
  ]) assert.ok(shell.includes(fragment), "C07 missing bound handoff: " + fragment);
  assert.match(trace, /data-testid="c07-chat-automation-draft"/);
  assert.match(trace, /onClick=\{onPrepareAutomation\}/);
  assert.match(dialog, /enabled: activationReviewed/);
  assert.match(dialog, /useState<"manual" \| "interval" \| "daily" \| "event">\("manual"\)/);
  assert.match(dialog, /data-testid="c07-automation-activation-review"/);
  assert.doesNotMatch(trace, /saveConversationAsP9Workflow|createP9Workflow|runP9WorkflowNow/);
});

test("C07 eligibility is read-only and blocks cross-run and unresolved tool outcomes", () => {
  const eligibility = source("./projectAutomationDraftEligibility.ts");
  assert.match(eligibility, /sourceRequestId !== currentRequestId/);
  assert.match(eligibility, /inspectRecordedActionRecovery\(runEvents, currentRequestId\)/);
  assert.match(eligibility, /final.status !== "completed"/);
  assert.doesNotMatch(eligibility, /fetch\(|apiRequest\(|saveConversationAsP9Workflow\(|runP9WorkflowNow\(/);
});
