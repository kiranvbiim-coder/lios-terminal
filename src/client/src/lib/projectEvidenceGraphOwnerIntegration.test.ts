import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const project = read("../components/terminal/ProjectHome.tsx");
const intelligence = read("../components/terminal/ProjectIntelligencePanel.tsx");
const desk = read("../components/terminal/ProjectInvestigationDesk.tsx");
const p7 = read("./projectEvidenceGraphPresentation.ts");
const graph = read("../components/terminal/ProjectEvidenceGraph.tsx");

test("the existing Project home has exactly one identity-reset P7 Intelligence owner and reviewed Chat handoff", () => {
  assert.equal((project.match(/<ProjectIntelligencePanel /g) ?? []).length, 1);
  assert.match(project, /<ProjectIntelligencePanel key=\{project\.id\} projectId=\{project\.id\} onInvestigate=\{prompt => onNewChat\(prompt\)\}/);
  assert.match(intelligence, /useProjectIntelligence\(projectId\)/);
  assert.match(intelligence, /useProjectInsightLens\(projectId\)/);
  assert.match(intelligence, /<ProjectInvestigationDesk projectId=\{projectId\} graph=\{summary\.graph\} lens=\{lens\} onInvestigate=\{onInvestigate\}/);
  assert.match(intelligence, /!intelligence\.isError && !insights\.isError/);
});

test("P7 relationships are Project-scoped, read-only and derive from retained graph adjacency", () => {
  assert.match(desk, /graph\?\.projectId === projectId/);
  assert.match(desk, /lens\?\.projectId === projectId/);
  assert.match(desk, /view === "relationships"/);
  assert.match(desk, /<ProjectEvidenceGraph key=\{projectId \+ ":" \+ selected\.id\}/);
  assert.match(p7, /recordedConsequenceTrail\(projectId, graph, insight, 48\)/);
  assert.match(p7, /graph\.projectId !== projectId/);
  assert.match(graph, /aria-label="Graph viewport controls"/);
  assert.match(graph, /onPointerMove=\{event =>/);
  assert.match(graph, /onKeyDown=\{event =>/);
  assert.doesNotMatch(graph, /fetch\(|runConversation\(|eval\(|requestIntelligenceObjectAction\(/);
});

test("the P7 investigation does not duplicate the unrelated terminal-wide graph owner", () => {
  const other = read("../components/terminal/GraphExplorer.tsx");
  assert.match(other, /buildCrossDomainGraph\(graphObjects\)/);
  assert.match(other, /subscribeIntelligenceObjects\(setObjects\)/);
  assert.doesNotMatch(desk, /buildCrossDomainGraph\(|loadIntelligenceObjects\(/);
});
