import test from "node:test";
import assert from "node:assert/strict";
import type { P7ContextGraph, P7Insight } from "@shared/p7ResearchContracts";
import {
  consequenceTrailChatPrompt, investigationViewIntentSchema,
  recordedConsequenceTrail, recordedGeographicPoints,
} from "./phase3InvestigationPresentation";

const checksum = "a".repeat(64);
const graph: P7ContextGraph = {
  schemaVersion: "1", projectId: 17, generatedAt: "2026-10-27T06:30:00Z", contentHash: checksum,
  nodes: [
    { id: "event-1", kind: "event", label: "Recorded change", sourceRef: "source:change", occurredAt: "2026-10-27T06:00:00Z", contentHash: checksum, metadata: {} },
    { id: "entity-1", kind: "entity", label: "Recorded exposed entity", sourceRef: null, occurredAt: null, contentHash: null, metadata: {} },
    { id: "place-1", kind: "geography", label: "Recorded place", sourceRef: "geo:known", occurredAt: "2026-10-27T06:00:00Z", contentHash: checksum, metadata: { latitude: 9.92, longitude: 78.12 } },
    { id: "place-2", kind: "geography", label: "Unverified place", sourceRef: "geo:unknown", occurredAt: null, contentHash: checksum, metadata: { latitude: "9.92", longitude: 78.12 } },
    { id: "place-3", kind: "geography", label: "Outside globe", sourceRef: null, occurredAt: null, contentHash: checksum, metadata: { latitude: 91, longitude: 181 } },
  ],
  edges: [
    { id: "link-1", from: "event-1", to: "entity-1", type: "mentions", evidenceRefs: ["source:change"], metadata: {} },
    { id: "link-2", from: "entity-1", to: "place-1", type: "references", evidenceRefs: ["geo:known"], metadata: {} },
    { id: "link-3", from: "place-1", to: "nonexistent", type: "references", evidenceRefs: [], metadata: {} },
  ],
};
const insight: P7Insight = {
  id: "insight-1", kind: "change", title: "A recorded issuer development", summary: "Recorded, not causal",
  severity: "watch", sourceRefs: ["source:change"], entityRefs: [],
  deterministic: true, occurredAt: null,
};

test("coordinate projection displays only valid numeric, Project-owned recorded geography", () => {
  assert.deepEqual(recordedGeographicPoints(17, graph).map(item => item.id), ["place-1"]);
  assert.deepEqual(recordedGeographicPoints(18, graph), []);
  assert.deepEqual(recordedGeographicPoints(17, null), []);
  assert.deepEqual(graph.nodes[2].metadata, { latitude: 9.92, longitude: 78.12 });
});

test("consequence trail reads one-hop retained graph edges but never fabricates causality", () => {
  const trail = recordedConsequenceTrail(17, graph, insight);
  assert.deepEqual(trail.matchedNodes.map(item => item.id), ["event-1"]);
  assert.deepEqual(trail.links.map(item => item.id), ["link-1"]);
  assert.equal(trail.links[0].relation, "mentions");
  assert.deepEqual(trail.links[0].evidenceRefs, ["source:change"]);
  assert.deepEqual(trail.sourceRefs, ["source:change"]);
  assert.equal(trail.totalLinks, 1);
  assert.deepEqual(recordedConsequenceTrail(18, graph, insight).links, []);
  assert.deepEqual(recordedConsequenceTrail(17, null, insight).links, []);
});

test("the projection does not invent evidence for unrelated or orphan relationships", () => {
  const none = recordedConsequenceTrail(17, graph, { ...insight, sourceRefs: ["missing"], entityRefs: [] });
  assert.deepEqual(none.links, []);
  assert.deepEqual(none.matchedNodes, []);
  const fromEntity = recordedConsequenceTrail(17, graph, { ...insight, sourceRefs: [], entityRefs: ["entity-1"] });
  assert.deepEqual(fromEntity.links.map(item => item.id), ["link-1", "link-2"]);
  assert.deepEqual(fromEntity.sourceRefs, []);
});

test("bounded relationship projection reports omissions truthfully", () => {
  const data = { ...graph, edges: Array.from({ length: 50 }, (_, i) => ({ ...graph.edges[0], id: "edge-" + i })) };
  const t = recordedConsequenceTrail(17, data, insight, 4);
  assert.equal(t.totalLinks, 50);
  assert.equal(t.links.length, 4);
  assert.equal(t.omittedLinks, 46);
});

test("only approved structured investigation intents and reviewed Chat questions are produced", () => {
  assert.deepEqual(investigationViewIntentSchema.parse({ projectId: 17, kind: "geography", insightId: "insight-1" }),
    { projectId: 17, kind: "geography", insightId: "insight-1" });
  assert.equal(investigationViewIntentSchema.safeParse({ projectId: 17, kind: "execute_script", insightId: "insight-1" }).success, false);
  assert.equal(investigationViewIntentSchema.safeParse({ projectId: 17, kind: "evidence", insightId: "insight-1", unsafe: true }).success, false);
  const prompt = consequenceTrailChatPrompt(insight, 17);
  assert.match(prompt, /source:change/);
  assert.match(prompt, /distinguish graph relationships from proven causal consequences/);
  assert.match(prompt, /without my permission/);
});
