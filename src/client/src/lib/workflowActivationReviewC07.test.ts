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
 assert.doesNotMatch(s,/text-\\[(?:6|7|8)px\\]/);
});
test("C07 current Project consequence view offers only a locally reviewed paused P9 definition",()=>{
 const review=source("../components/terminal/ProjectConsequenceReview.tsx");
 const draft=source("./reviewedProjectMonitorHandoff.ts");
 assert.match(review,/data-testid="c07-project-monitor-handoff"/);
 assert.match(review,/disabled until separately reviewed and approved in P9/);
 assert.match(review,/setMonitorReview\(monitorHandoff\.graphHash\)/);
 assert.match(review,/<PulseProjectMonitorReview/);

 assert.match(draft,/quickMonitorDraft\("changes",false,60\)/);
 assert.match(draft,/definition\.enabled\)/);
 assert.doesNotMatch(review,/saveConversationAsP9Workflow|runP9WorkflowNow/);
});
test("C07 activation acknowledgement is also tied to existing approval grants",()=>{
 const s=source("../components/terminal/SaveWorkflowDialog.tsx");
 assert.match(s,/request\.executionMode, request\.sourceScope, request\.approvals, acceptedIdentity/);
 assert.match(s,/setActivationReviewedKey\(event\.target\.checked \? activationSignature : null\)/);
 assert.match(s,/enabled: activationReviewed/);
});
