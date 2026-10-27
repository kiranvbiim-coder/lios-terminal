import type { P7ContextGraph, P7ContextNode, P7Insight } from "@shared/p7ResearchContracts";
import { recordedConsequenceTrail } from "./phase3InvestigationPresentation";

export interface EvidenceGraphNode {
  id: string;
  label: string;
  kind: P7ContextNode["kind"];
  sourceRef: string | null;
  occurredAt: string | null;
  directlyMatched: boolean;
  x: number;
  y: number;
}
export interface EvidenceGraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  evidenceRefs: string[];
  fromX: number; fromY: number; toX: number; toY: number;
}
export interface EvidenceGraphProjection {
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  totalRecordedEdges: number;
  omittedEdges: number;
  omittedNodes: number;
  matchedCount: number;
}
const EMPTY: EvidenceGraphProjection = {
  nodes: [], edges: [], totalRecordedEdges: 0, omittedEdges: 0, omittedNodes: 0, matchedCount: 0,
};

/**
 * Exact P7-Project adjacency only. This view is an interactive projection of
 * the existing P7 consequence-trail selector, never another relation engine.
 * Node placement is stable and deterministic, not a causal or metric encoding.
 */
export function projectEvidenceGraphProjection(
  projectId: number,
  graph: P7ContextGraph | null | undefined,
  insight: P7Insight | null | undefined,
): EvidenceGraphProjection {
  if (!graph || graph.projectId !== projectId || !insight) return { ...EMPTY };
  const trail = recordedConsequenceTrail(projectId, graph, insight, 48);
  const matched = new Set(trail.matchedNodes.map(node => node.id));
  const ids = new Set([...matched, ...trail.links.flatMap(edge => [edge.from.id, edge.to.id])]);
  const allById = new Map(graph.nodes.filter(node => ids.has(node.id)).map(node => [node.id, node]));
  const ordered = [
    ...trail.matchedNodes.map(node => node.id),
    ...trail.links.flatMap(edge => [edge.from.id, edge.to.id]),
  ].filter((id, index, values) => values.indexOf(id) === index && allById.has(id));
  const MAX_NODES = 40;
  const chosen = ordered.slice(0, MAX_NODES);
  const columns = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(chosen.length * 1.5))));
  const rows = Math.ceil(chosen.length / columns);
  const nodes = chosen.map((id, index) => {
    const node = allById.get(id)!;
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: node.id, label: node.label, kind: node.kind, sourceRef: node.sourceRef,
      occurredAt: node.occurredAt, directlyMatched: matched.has(node.id),
      x: columns === 1 ? 450 : 120 + column * (660 / (columns - 1)),
      y: rows === 1 ? 260 : 90 + row * (340 / (rows - 1)),
    };
  });
  const positions = new Map(nodes.map(node => [node.id, node]));
  const edges = trail.links.flatMap(edge => {
    const from = positions.get(edge.from.id), to = positions.get(edge.to.id);
    if (!from || !to) return [];
    return [{
      id: edge.id, from: from.id, to: to.id,
      type: edge.relation, evidenceRefs: edge.evidenceRefs.slice(0, 30),
      fromX: from.x, fromY: from.y, toX: to.x, toY: to.y,
    }];
  });
  return {
    nodes, edges,
    totalRecordedEdges: trail.totalLinks,
    omittedEdges: Math.max(0, trail.totalLinks - edges.length),
    omittedNodes: Math.max(0, ordered.length - nodes.length),
    matchedCount: trail.matchedNodes.length,
  };
}
