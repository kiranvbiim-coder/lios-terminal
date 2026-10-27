import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const graph = readFileSync(new URL("./GraphExplorer.tsx", import.meta.url), "utf8");

test("graph viewport adapts B1 controls without replacing the terminal's object owner", () => {
  assert.match(graph, /buildCrossDomainGraph\(graphObjects\)/);
  assert.match(graph, /subscribeIntelligenceObjects\(setObjects\)/);
  assert.match(graph, /loadIntelligenceObjects\(\)/);
  assert.match(graph, /graphNodeConnections\(graph, selected\.id\)/);
  for (const name of ["Zoom cross-domain graph out", "Zoom cross-domain graph in", "Fit cross-domain graph"]) {
    assert.ok(graph.includes('aria-label="' + name + '"'));
  }
  assert.match(graph, /onPointerMove=\{event =>/);
  assert.match(graph, /onPointerCancel=\{\(\) =>/);
  assert.match(graph, /onKeyDown=\{event =>/);
  assert.match(graph, /data-graph-object=\{node\.objectId\}/);
  assert.match(graph, /pointer-events-auto absolute w-\[116px\]/);
  assert.doesNotMatch(graph, /new WebSocket\(|fetch\("https?:|Math\.random\(|runConversation\(/);
});

test("graph viewport changes are presentation-only and do not bypass explicit object actions", () => {
  assert.match(graph, /actionsForIntelligenceObject\(selected\)/);
  assert.match(graph, /requestIntelligenceObjectAction\(action\)/);
  assert.match(graph, /maxNodes: 48/);
  assert.match(graph, /selectRecordedCrossDomainGraphObjects\(contextualObjects, deferredQuery, selectedId, 120\)/);
  assert.match(graph, /const deferredQuery = useDeferredValue\(query\)/);
  assert.match(graph, /Math\.min\(1\.8, Math\.max\(0\.35, value\)\)/);
  assert.match(graph, /originX:pan\.x,originY:pan\.y/);
  assert.doesNotMatch(graph, /fetch\(|setProjectId\(|eval\(/);
});
