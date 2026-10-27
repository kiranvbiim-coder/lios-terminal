import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(file: string) { return readFileSync(new URL(file, import.meta.url), "utf8"); }
const project = source("../components/terminal/ProjectHome.tsx");
const intelligence = source("../components/terminal/ProjectIntelligencePanel.tsx");
const investigation = source("../components/terminal/ProjectInvestigationDesk.tsx");
const conversation = source("../components/terminal/ProjectExperienceShell.tsx");
const agentTrace = source("../components/terminal/ConversationRuntimeTrace.tsx");
const visualGraph = source("../components/terminal/GraphExplorer.tsx");
const scenario = source("../components/terminal/ScenarioComparisonBoard.tsx");
const perspectives = source("../components/panels/RecordedPerspectivesBoard.tsx");
const research = source("../components/panels/ResearchInvestigationPanel.tsx");

test("Phase 3 uses one existing Project Intelligence owner and explicitly opened investigation", () => {
  assert.match(project, /<ProjectIntelligencePanel projectId=\{project\.id\} onInvestigate=\{prompt => onNewChat\(prompt\)\}/);
  assert.equal((project.match(/<ProjectIntelligencePanel /g) ?? []).length, 1);
  assert.match(project, /aria-expanded=\{investigationOpen\}/);
  assert.match(project, /setInvestigationOpen\(false\)/);
  assert.match(intelligence, /<ProjectInvestigationDesk projectId=\{projectId\} graph=\{summary\.graph\} lens=\{lens\}/);
  assert.match(intelligence, /useProjectIntelligence\(projectId\)/);
  assert.match(intelligence, /useProjectInsightLens\(projectId\)/);
});

test("Phase 3 controlled typed investigative views do not execute tools from evidence", () => {
  assert.match(investigation, /investigationViewIntentSchema\.parse/);
  assert.match(investigation, /consequenceTrailChatPrompt\(selected, projectId\)/);
  assert.match(investigation, /recordedGeographicPoints\(projectId, validGraph\)/);
  assert.match(investigation, /recordedConsequenceTrail\(projectId, validGraph, selected\)/);
  assert.doesNotMatch(investigation, /runConversation\(|fetch\(|new Image\(|eval\(|createP9Workflow\(|runP9WorkflowNow\(/);
  assert.match(conversation, /const newProjectChat = async \(starterPrompt/);
  assert.match(conversation, /confirmConversationSwitch\(true, true\)/);
  assert.match(conversation, /setInput\(starterPrompt\.trim\(\)\)/);
});

test("existing premium visual research presenters stay connected to their canonical registries", () => {
  assert.match(visualGraph, /buildCrossDomainGraph\(graphObjects\)/);
  assert.match(visualGraph, /subscribeIntelligenceObjects/);
  assert.match(scenario, /buildScenarioInputComparison\(reference, active, bindings\)/);
  assert.match(perspectives, /source|evidence|citation/i);
  assert.match(research, /<ResearchEvidenceCard/);
});

test("Agent action UX remains owned by the actual P2/GM runtime and receipt approval", () => {
  assert.match(agentTrace, /onGovernedToolReview/);
  assert.match(agentTrace, /onResume/);
  assert.match(agentTrace, /onCancel/);
  assert.match(agentTrace, /AgentExecutionReceipts/);
  assert.match(conversation, /onGovernedToolReview=\{reviewGovernedTool\}/);
  assert.match(conversation, /onCancel=\{\(\) => void cancelRuntime\(\)\}/);
});
