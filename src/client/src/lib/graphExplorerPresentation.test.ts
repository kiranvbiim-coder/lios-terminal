import assert from "node:assert/strict";
import test from "node:test";
import { buildCrossDomainGraph, type CrossDomainGraph } from "./terminalCrossDomainGraph";
import { graphNodeConnections, presentCrossDomainGraph, selectRecordedCrossDomainGraphObjects } from "./graphExplorerPresentation";
import type { IntelligenceObject } from "./terminalIntelligenceObjects";

const object = (id: string, label: string, relations: IntelligenceObject["relations"] = []): IntelligenceObject => ({
  id, kind: "evidence", label, status: "stable", tags: [], assumptions: {}, metadata: {},
  relations, createdAt: 1000, updatedAt: 1000,
});
function fixture() {
  const recorded = [
    object("e:policy", "Policy filing", [{ targetId: "e:market", kind: "affects", note: "Named in source" }]),
    object("e:market", "Market report", [
      { targetId: "e:decision", kind: "supports", note: "Recorded support" },
      { targetId: "e:missing", kind: "supports", note: "Missing target must not become a node" },
    ]),
    object("e:decision", "Decision memo"),
    object("e:unrelated", "Unconnected research"),
  ];
  return buildCrossDomainGraph(recorded);
}
test("graph shows only previously recorded edges, never an invented path", () => {
  const graph = fixture();
  const view = presentCrossDomainGraph(graph);
  assert.deepEqual(view.nodes.map(x => x.objectId), graph.nodes.map(x => x.objectId));
  assert.deepEqual(view.edges, graph.edges);
  assert.ok(!view.nodes.some(x => x.objectId === "e:missing"));
  assert.ok(!view.edges.some(x => x.targetId === "e:missing"));
});
test("search finds a real match plus immediate recorded neighbors, not two-hop guesses", () => {
  const graph = fixture();
  const view = presentCrossDomainGraph(graph, { query: "Policy" });
  assert.equal(view.matchingCount, 1);
  assert.deepEqual(view.nodes.map(x => x.objectId), ["e:policy", "e:market"]);
  assert.deepEqual(view.edges.map(x => x.relation), ["affects"]);
  assert.equal(presentCrossDomainGraph(graph, { query: "not a real thing" }).nodes.length, 0);
});
test("selected focus isolates only direct relationships and keeps the selected object visible", () => {
  const graph = fixture();
  const view = presentCrossDomainGraph(graph, { selectedId: "e:market", neighborsOnly: true });
  assert.deepEqual(new Set(view.nodes.map(x => x.objectId)), new Set(["e:policy", "e:market", "e:decision"]));
  assert.deepEqual(new Set(view.edges.map(x => x.relation)), new Set(["affects", "supports"]));
  assert.ok(!view.nodes.some(x => x.objectId === "e:unrelated"));
  assert.equal(view.nodes[0]?.objectId, "e:market");
  assert.ok(view.connectedIds.has("e:policy"));
  assert.ok(view.connectedIds.has("e:decision"));
});
test("relationship inspector distinguishes recorded incoming from outgoing and preserves annotations", () => {
  const graph = fixture();
  const connections = graphNodeConnections(graph, "e:market");
  assert.deepEqual(connections.map(x => [x.direction, x.otherId, x.relation, x.explanation]), [
    ["incoming", "e:policy", "affects", "Named in source"],
    ["outgoing", "e:decision", "supports", "Recorded support"],
  ]);
  assert.deepEqual(graphNodeConnections(graph, "e:missing"), []);
});
test("bridge filter only contains real edges with different display domains", () => {
  const graph = fixture();
  const domainOf = new Map(graph.nodes.map(n => [n.objectId, n.domain]));
  const view = presentCrossDomainGraph(graph, { bridgesOnly: true });
  assert.ok(view.edges.every(e => domainOf.get(e.sourceId) !== domainOf.get(e.targetId)));
  assert.ok(view.edges.every(e => graph.edges.includes(e)));
});
test("bounded graph never silently adds more nodes and makes omitted count explicit", () => {
  const many: CrossDomainGraph = {
    nodes: Array.from({ length: 5 }, (_, i) => ({
      objectId: `node:${i}`, label: `Observed ${i}`, domain: "research" as const, strength: .5,
    })),
    edges: [{ sourceId: "node:4", targetId: "node:0", relation: "supports", strength: .5 }],
  };
  const view = presentCrossDomainGraph(many, { maxNodes: 2, selectedId: "node:4" });
  assert.deepEqual(view.nodes.map(x => x.objectId), ["node:4", "node:0"]);
  assert.equal(view.omittedCount, 3);
  assert.deepEqual(view.edges, many.edges);
  assert.equal(presentCrossDomainGraph(many, { query: "unknown" }).omittedCount, 0);
});
test("relation lens uses only recorded links and excludes nodes not participating in that relation", () => {
  const graph = fixture();
  const view = presentCrossDomainGraph(graph, { relation: "supports" });
  assert.deepEqual(view.edges.map(edge => edge.relation), ["supports"]);
  assert.deepEqual(new Set(view.nodes.map(node => node.objectId)), new Set(["e:market", "e:decision"]));
  assert.equal(view.matchingCount, 2);
  assert.deepEqual(presentCrossDomainGraph(graph, { relation: "contradicts" }).nodes, []);
  const focused = presentCrossDomainGraph(graph, { relation: "supports", query: "Market" });
  assert.deepEqual(focused.edges.map(edge => [edge.sourceId, edge.targetId]), [["e:market", "e:decision"]]);
  assert.equal(focused.nodes.length, 2);
});

test("view transforms do not mutate the canonical graph", () => {
  const graph = fixture();
  const before = JSON.stringify(graph);
  presentCrossDomainGraph(graph, { query: "market", selectedId: "e:market", neighborsOnly: true, bridgesOnly: true });
  graphNodeConnections(graph, "e:market");
  assert.equal(JSON.stringify(graph), before);
});

test("B07 saved cross-domain radar finds recorded matches beyond the first 120 without inventing links", () => {
  const list=Array.from({length:220},(_,i)=>object("node:"+i,i===215?"Recorded Solar Evidence":"Saved source "+i));
  list[215].relations=[{targetId:"node:9",kind:"supports",note:"Stored relation"}];
  const chosen=selectRecordedCrossDomainGraphObjects(list,"solar",null,120);
  assert.deepEqual(chosen.map(x=>x.id),["node:215","node:9"]);
  const graph=buildCrossDomainGraph(chosen);
  assert.deepEqual(graph.edges.map(x=>[x.sourceId,x.targetId]),[["node:215","node:9"]]);
  assert.deepEqual(selectRecordedCrossDomainGraphObjects(list,"missing",null),[]);
  assert.equal(selectRecordedCrossDomainGraphObjects(list,"",null).length,120);
  assert.deepEqual(selectRecordedCrossDomainGraphObjects(list,"", "node:215",3).map(x=>x.id),["node:215","node:9"]);
  assert.equal(list[215].relations.length,1);
});
