import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const screen = (name: string) =>
  readFileSync(new URL("../components/terminal/" + name + ".tsx", import.meta.url), "utf8");

test("Sprint B graph relationships are filtered from the existing recorded Intelligence Object store", () => {
  const ui = screen("GraphExplorer");
  const selector = readFileSync(new URL("./graphExplorerPresentation.ts", import.meta.url), "utf8");
  assert.match(ui, /loadIntelligenceObjects\(/);
  assert.match(ui, /buildCrossDomainGraph\(graphObjects\)/);
  assert.match(ui, /Filter recorded relationship type/);
  assert.match(ui, /relation: relation \|\| undefined/);
  assert.match(ui, /graphNodeConnections\(graph, selected\.id\)\.filter/);
  assert.match(selector, /relationEdges = settings\.relation \? graph\.edges\.filter/);
  assert.match(selector, /participating\.has\(node\.objectId\)/);
  assert.doesNotMatch(ui, /fetch\(|apiRequest\(|runPython\(/);
});

test("Sprint B source review reads only published evidence and never computes a synthetic trust score", () => {
  const ui = screen("ProvenanceDrawer");
  assert.match(ui, /getEvidenceSnapshot\(/);
  assert.match(ui, /subscribeEvidence\(setSnapshot\)/);
  assert.match(ui, /filterPublishedSources\(/);
  assert.match(ui, /safePublishedSourceUrl\(item\.sourceUrl\)/);
  assert.match(ui, /noopener noreferrer/);
  assert.match(ui, /not independent verification/);
  assert.doesNotMatch(ui, /fetch\(|apiRequest\(/);
});

test("Sprint B comparisons and rich insights stay on the canonical capture and receipt surfaces", () => {
  const ui = screen("AnalyticalStudio");
  assert.match(ui, /describeSnapshotPair\(/);
  assert.match(ui, /context\.kind === "same-context"/);
  assert.match(ui, /allowCrossContext/);
  assert.match(ui, /Record(?:ed|ed insight) change/i);
  assert.match(ui, /RecordedAnalyticalDifference/);
  assert.match(ui, /diffCalculationReceipts\(/);
  assert.match(ui, /warningsAdded/);
  assert.match(ui, /warningsRemoved/);
  assert.doesNotMatch(ui, /fetch\(|apiRequest\(|runPython\(/);
});
