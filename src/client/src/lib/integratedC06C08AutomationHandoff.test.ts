import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Integrated C08 only inspects recorded exact-run action failures and never retries", () => {
  const trace = read("../components/terminal/ConversationRuntimeTrace.tsx");
  const projector = read("./recordedActionRecovery.ts");
  assert.match(trace, /inspectRecordedActionRecovery\(events, requestId\)/);
  assert.match(trace, /data-testid="c08-recorded-action-recovery"/);
  assert.match(trace, /onClick=\{onInspectRun\}/);
  assert.match(trace, /Overall run completion does not override these recorded individual outcomes/);
  assert.doesNotMatch(trace, /onClick=\{onRetry\}/);
  assert.match(projector, /event\.requestId !== requestId/);
  assert.match(projector, /receipt\.requestId !== requestId/);
  assert.match(projector, /receiptIds\.has\(receipt\.id\)/);
  assert.doesNotMatch(projector, /fetch\(|apiRequest\(|approveRuntime|runP9WorkflowNow/);
});

test("Integrated C06 reopens only the owned recorded P4 version and retains canonical save outcomes", () => {
  const trace = read("../components/terminal/ConversationRuntimeTrace.tsx");
  const shell = read("../components/terminal/ProjectExperienceShell.tsx");
  const exact = read("./exactRuntimeSavedArtifact.ts");
  assert.match(trace, /data-testid="c06-open-exact-saved-version"/);
  assert.match(trace, /onOpenSavedArtifact\(artifact\.persistedArtifact!/);
  assert.ok(trace.includes("ChatArtifactSaveOutcome"));
  assert.match(shell, /artifactSaveTarget=\{artifactSaveTarget\}/);
  assert.match(shell, /onKeepArtifact=\{chatMode === "temporary" \? undefined : keepArtifact\}/);
  assert.match(shell, /exactRuntimeSavedArtifact\(candidate/);
  assert.match(shell, /isCurrentSavedArtifactHandoff\(saved/);
  assert.match(shell, /traceOwnerChatRef\.current !== original\.chatId/);
  assert.match(shell, /requestLifecycle\(\{/);
  assert.match(shell, /setArtifactViewVersion\(saved\.version\)/);
  assert.match(exact, /event\.requestId !== owner\.requestId/);
  assert.match(exact, /handoff\.requestId === currentRequestId/);
});

test("Integrated C07 gates same run before opening one existing inactive P9 review", () => {
  const trace = read("../components/terminal/ConversationRuntimeTrace.tsx");
  const shell = read("../components/terminal/ProjectExperienceShell.tsx");
  const guard = read("./projectAutomationDraftEligibility.ts");
  const dialog = read("../components/terminal/SaveWorkflowDialog.tsx");
  assert.match(trace, /data-testid="c07-chat-automation-draft"/);
  assert.match(trace, /onClick=\{onPrepareAutomation\}/);
  assert.match(shell, /setLastWorkflowSourceRequestId\(requestId\)/);
  assert.match(shell, /setLastWorkflowSourceRequestId\(null\)/);
  assert.match(shell, /sourceRequestId: lastWorkflowSourceRequestId/);
  assert.match(shell, /setLastWorkflowOrigin\(\{ projectId: selection\.projectId, chatId: selection\.chatId \}\)/);
  assert.match(shell, /originProjectId: lastWorkflowOrigin\?\.projectId \?\? null/);
  assert.match(shell, /originChatId: lastWorkflowOrigin\?\.chatId \?\? null/);
  assert.match(shell, /currentRequestId: runtimeHandoffRequestIdRef\.current/);
  assert.match(shell, /onPrepareAutomation=\{canPrepareChatAutomation/);
  assert.match(shell, /showSaveWorkflow && canPrepareChatAutomation/);
  assert.match(guard, /sourceRequestId !== currentRequestId/);
  assert.match(guard, /originProjectId !== projectId \|\| originChatId !== chatId/);
  assert.match(guard, /inspectRecordedActionRecovery\(runEvents, currentRequestId\)/);
  assert.match(dialog, /enabled: activationReviewed/);
  assert.match(dialog, /data-testid="c07-automation-activation-review"/);
  assert.doesNotMatch(trace, /createP9Workflow|saveConversationAsP9Workflow|runP9WorkflowNow/);
});
