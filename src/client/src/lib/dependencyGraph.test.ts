import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { buildDependencyGraph } from "./dependencyGraph";

function feed(g: SpreadsheetGrid, cells: Record<string, string>) {
  for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
}

test("buildDependencyGraph: a simple chain A1 -> B1 -> C1 -> D1 groups precedents/dependents by hop distance from the center", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "5", B1: "=A1*2", C1: "=B1*2", D1: "=C1*2" });

  const graph = buildDependencyGraph(g, "C1", 2);
  assert.equal(graph.center, "C1");
  assert.deepEqual(graph.precedentLayers[0].map((n) => n.ref), ["B1"]);
  assert.deepEqual(graph.precedentLayers[1].map((n) => n.ref), ["A1"]);
  assert.deepEqual(graph.dependentLayers[0].map((n) => n.ref), ["D1"]);
});

test("buildDependencyGraph: depth limits how many hops are walked in each direction", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "5", B1: "=A1*2", C1: "=B1*2", D1: "=C1*2" });

  const shallow = buildDependencyGraph(g, "C1", 1);
  assert.equal(shallow.precedentLayers.length, 1);
  assert.equal(shallow.dependentLayers.length, 1);
  assert.deepEqual(shallow.precedentLayers[0].map((n) => n.ref), ["B1"]);
});

test("buildDependencyGraph: includes a 'skip' edge when a two-hop-back precedent also feeds the center directly", () => {
  const g = new SpreadsheetGrid();
  // B1 feeds C1 (one hop), and A1 feeds BOTH B1 (making it two hops back) AND C1 directly (a skip edge).
  feed(g, { A1: "5", B1: "=A1*2", C1: "=A1+B1" });

  const graph = buildDependencyGraph(g, "C1", 2);
  const edgeKeys = graph.edges.map((e) => `${e.from}->${e.to}`);
  assert.ok(edgeKeys.includes("A1->B1"));
  assert.ok(edgeKeys.includes("B1->C1"));
  assert.ok(edgeKeys.includes("A1->C1"), "the direct A1->C1 edge should appear alongside the A1->B1->C1 chain");
});

test("buildDependencyGraph: a cell with an error is flagged as such in its graph node", () => {
  const g = new SpreadsheetGrid();
  feed(g, { A1: "0", B1: "=1/A1", C1: "=B1+1" });

  const graph = buildDependencyGraph(g, "C1", 2);
  const b1Node = graph.precedentLayers[0].find((n) => n.ref === "B1");
  assert.ok(b1Node);
  assert.equal(b1Node!.hasError, true);
});

test("buildDependencyGraph: a leaf cell with no precedents and no dependents produces empty layers and no edges", () => {
  const g = new SpreadsheetGrid();
  g.setCell("Z9", "42");
  const graph = buildDependencyGraph(g, "Z9", 2);
  assert.deepEqual(graph.precedentLayers, []);
  assert.deepEqual(graph.dependentLayers, []);
  assert.deepEqual(graph.edges, []);
});
