import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const project = readFileSync(new URL("../components/terminal/ProjectHome.tsx", import.meta.url), "utf8");
const resume = readFileSync(new URL("../components/terminal/ProjectResumeDesk.tsx", import.meta.url), "utf8");
const watch = readFileSync(new URL("../components/terminal/ProjectWatchroomDesk.tsx", import.meta.url), "utf8");
const automations = readFileSync(new URL("../components/terminal/ProjectAutomationPanel.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../components/terminal/HomeAttentionPanel.tsx", import.meta.url), "utf8");
const search = readFileSync(new URL("../components/terminal/WorkSearchDialog.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");

test("Project Home has one discoverable route to each existing P6 and P9 authority", () => {
  assert.match(project, /<ProjectResumeDesk key=\{project\.id\}/);
  assert.match(project, /<ProjectWatchroomDesk key=\{project\.id\}/);
  assert.match(project, /<ProjectContinuityPanel key=\{project\.id\}/);
  assert.equal((project.match(/<ProjectContinuityPanel /g) ?? []).length, 1);
  assert.equal((project.match(/<ProjectWatchroomDesk /g) ?? []).length, 1);
  assert.doesNotMatch(project, /<ProjectAutomationPanel /);
  assert.match(project, /onClick=\{\(\) => setWatchroomsOpen\(value => !value\)\}/);
  assert.match(project, /onClick=\{\(\) => setContinuityOpen\(value => !value\)\}/);
  assert.match(project, /setWatchroomsOpen\(false\)/);
  assert.match(project, /setContinuityOpen\(false\)/);
});

test("saved-work selection reuses real Project chat and session handoffs", () => {
  assert.match(resume, /projectResumeSelection\(projectId, chats, sessions\)/);
  assert.match(resume, /onOpenChat\(chat\)/);
  assert.match(resume, /onOpenSession\(session\)/);
  assert.match(resume, /onFocusArtifact\(item\.decisionArtifactId!, item\.title\)/);
  assert.match(resume, /useP6ProjectContinuity\(projectId\)/);
  assert.doesNotMatch(resume, /createProjectChat|createQuickChat|runConversation|localStorage/);
});

test("Watchroom summary stays read only and all writes go through existing P9 governed management", () => {
  assert.match(watch, /useP9Workflows\(managing \? null : projectId\)/);
  assert.match(watch, /useP9Runs\(managing \? null : projectId\)/);
  assert.match(watch, /useP9Notifications\(managing \? null : projectId\)/);
  assert.match(watch, /<ProjectAutomationPanel key=\{projectId\} projectId=\{projectId\}/);
  assert.match(automations, /prepareP9ManualRunConfirmation\(projectId, id\)/);
  assert.match(automations, /saveP9ManualRunDraft\(projectId, id, updatedAt\)/);
  assert.match(automations, /createP9Workflow\(projectId, quickMonitorDraft\(/);
  assert.doesNotMatch(watch, /createP9Workflow\(|runP9WorkflowNow\(|markP9NotificationRead\(/);
  assert.doesNotMatch(automations, /<HomeAttentionPanel\s*\/>/);
});

test("Phase 2's global journeys remain in one shell, not new sidebar products", () => {
  assert.match(shell, /<HomeAttentionPanel \/>/);
  assert.match(shell, /<WorkSearchDialog[\s\S]*?onAskIntelligence=/);
  assert.match(search, /<VisualIntelligenceSearch query=\{query\}/);
  assert.match(home, /get|Home intelligence/i);
  assert.doesNotMatch(project, /window\.open|new Image|\/api\/new-watchroom/);
});
