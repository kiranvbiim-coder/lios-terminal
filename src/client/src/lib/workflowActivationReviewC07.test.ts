import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source = (path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");

test("C07 P9 saved workflow is an inactive, manual draft unless user separately reviews activation",()=>{
 const s=source("../components/terminal/SaveWorkflowDialog.tsx");
 for(const required of [
   'useState<"manual" | "interval" | "daily" | "event">("manual")',
   'useState(false)',
   'activationReviewedKey === activationSignature',
   'enabled: activationReviewed',
   'if (activateAfterSave && !activationReviewed)',
   'data-testid="c07-automation-activation-review"',
   'Save inactive draft',
   'Save and activate',
   'setActivationReviewedKey(null)',
   'saveConversationAsP9Workflow(projectId, {',
 ])assert.ok(s.includes(required),"Missing safe draft/review behavior: "+required);
 assert.doesNotMatch(s,/enabled: true/);
 assert.doesNotMatch(s,/text-\[(?:6|7|8)px\]/);
});
test("C07 Chat hands off to existing P9 review only for a completed current Project request",()=>{
 const shell=source("../components/terminal/ProjectExperienceShell.tsx");
 const trace=source("../components/terminal/ConversationRuntimeTrace.tsx");
 assert.match(shell,/onPrepareAutomation=\{chatMode === "project"/);
 assert.match(shell,/activeChat\?\.scope === "project"/);
 assert.match(shell,/event\.type === "done" && event\.requestId === runtimeRequestId && event\.status === "completed"/);
 assert.match(shell,/keepingArtifactRef\.current \|\| artifactDraftDirtyRef\.current/);
 assert.match(shell,/setShowSaveWorkflow\(true\)/);
 assert.match(shell,/<SaveWorkflowDialog/);
 assert.match(trace,/data-testid="c07-chat-automation-draft"/);
 assert.match(trace,/!busy && done\?\.type === "done" && done\.status === "completed"/);
 assert.doesNotMatch(trace,/createP9Workflow|saveConversationAsP9Workflow|runP9WorkflowNow/);
});
