import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");

test("existing Project Intelligence owner uses bounded graph projection only in relationships",()=>{
  const desk=source("../components/terminal/ProjectInvestigationDesk.tsx");
  const graph=source("../components/terminal/ProjectEvidenceGraph.tsx");
  const projection=source("./projectEvidenceGraphPresentation.ts");
  assert.match(desk, /view === "relationships"/);
  assert.match(desk, /<ProjectEvidenceGraph key=\{projectId \+ ":" \+ selected\.id\} projectId=\{projectId\} graph=\{validGraph\} insight=\{selected\}/);
  assert.match(projection,/recordedConsequenceTrail\(projectId, graph, insight, 48\)/);
  assert.match(projection,/graph\.projectId !== projectId/);
  assert.match(graph,/aria-label="Graph viewport controls"/);
  assert.match(graph,/onPointerMove=\{event =>/);
  assert.match(graph,/onKeyDown=\{event =>/);
  assert.match(graph,/onClick=\{\(\) => selectNode\(item\.id\)\}/);
  assert.match(graph,/Selected graph object evidence/);
  assert.match(graph,/Read-only Project P7 evidence/);
  assert.doesNotMatch(graph,/fetch\(|eval\(|runConversation\(|requestIntelligenceObjectAction\(|setProjectId\(/);
});

test("cross-domain graph keeps its own Intelligence Object store and gains viewport controls",()=>{
  const graph=source("../components/terminal/GraphExplorer.tsx");
  assert.match(graph,/buildCrossDomainGraph\(graphObjects\)/);
  assert.match(graph,/subscribeIntelligenceObjects\(setObjects\)/);
  assert.match(graph,/loadIntelligenceObjects\(\)/);
  assert.match(graph,/graphNodeConnections\(graph, selected\.id\)/);
  assert.match(graph,/aria-label="Zoom cross-domain graph in"/);
  assert.match(graph,/aria-label="Zoom cross-domain graph out"/);
  assert.match(graph,/aria-label="Fit cross-domain graph"/);
  assert.match(graph,/onPointerMove=\{event =>/);
  assert.match(graph,/onKeyDown=\{event =>/);
  assert.match(graph,/pointer-events-auto absolute w-\[116px\]/);
  assert.doesNotMatch(graph,/new WebSocket\(|fetch\("https?:|Math\.random\(|runConversation\(/);
});
