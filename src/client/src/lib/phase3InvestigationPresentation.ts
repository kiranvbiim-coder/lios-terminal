import { z } from "zod";
import type { P7ContextGraph, P7ContextNode, P7Insight } from "@shared/p7ResearchContracts";

export const investigationViewIntentSchema = z.object({
  projectId: z.number().int().positive(),
  kind: z.enum(["evidence", "relationships", "geography"]),
  insightId: z.string().trim().min(1).max(500),
}).strict();
export type InvestigationViewIntent = z.infer<typeof investigationViewIntentSchema>;

export interface RecordedRelationship {
  id: string;
  relation: string;
  from: P7ContextNode;
  to: P7ContextNode;
  evidenceRefs: string[];
}

function finiteCoordinate(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** Source-confirmed geographic metadata only. No name geocoding, IP geolocation or guesswork. */
export function recordedGeographicPoints(projectId: number, graph: P7ContextGraph | null | undefined) {
  if (!graph || graph.projectId !== projectId) return [];
  return graph.nodes.flatMap(node => {
    if (node.kind !== "geography") return [];
    const latitude = finiteCoordinate(node.metadata.latitude, -90, 90);
    const longitude = finiteCoordinate(node.metadata.longitude, -180, 180);
    if (latitude === null || longitude === null) return [];
    return [{
      id: node.id, label: node.label, latitude, longitude,
      sourceRef: node.sourceRef,
      occurredAt: node.occurredAt,
    }];
  });
}

/**
 * Prove a relationship only from the current Project's stored P7 edge. Do not
 * manufacture cause/effect, exposure or economic impact from adjacency.
 */
export function recordedConsequenceTrail(
  projectId: number,
  graph: P7ContextGraph | null | undefined,
  insight: P7Insight | null | undefined,
  maxEdges = 20,
) {
  const empty = { links: [] as RecordedRelationship[], matchedNodes: [] as P7ContextNode[], totalLinks: 0, omittedLinks: 0, sourceRefs: [] as string[] };
  if (!graph || graph.projectId !== projectId || !insight) return empty;
  const index = new Map(graph.nodes.map(node => [node.id, node]));
  const sourceRefs = new Set(insight.sourceRefs);
  const entityRefs = new Set(insight.entityRefs);
  const matchedNodes = graph.nodes.filter(node =>
    entityRefs.has(node.id) || (node.sourceRef !== null && sourceRefs.has(node.sourceRef))
  );
  const ids = new Set(matchedNodes.map(node => node.id));
  const links = graph.edges.flatMap(edge => {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (!from || !to || (!ids.has(edge.from) && !ids.has(edge.to))) return [];
    return [{ id: edge.id, relation: edge.type, from, to, evidenceRefs: edge.evidenceRefs }];
  });
  const limit = Number.isFinite(maxEdges) ? Math.max(1, Math.min(48, Math.floor(maxEdges))) : 20;
  return {
    links: links.slice(0, limit),
    matchedNodes: matchedNodes.slice(0, 30),
    totalLinks: links.length,
    omittedLinks: Math.max(0, links.length - limit),
    sourceRefs: [...insight.sourceRefs],
  };
}

/** An investigative draft, not an assertion or a model/tool invocation. */
export function consequenceTrailChatPrompt(insight: P7Insight, projectId: number): string {
  const refs = insight.sourceRefs.slice(0, 5).map(ref => JSON.stringify(ref.slice(0, 300))).join(", ");
  return `Investigate this saved Project insight (Project ${projectId}): ${JSON.stringify(insight.title.slice(0, 280))}.\nRecorded source identifiers: ${refs || "none"}.\nVerify actual supporting and contradicting evidence in this Project, check timestamps and rights, distinguish graph relationships from proven causal consequences, and propose actions for review only. State missing links and do not assume impacts, run tools or change a saved Artifact without my permission.`;
}
