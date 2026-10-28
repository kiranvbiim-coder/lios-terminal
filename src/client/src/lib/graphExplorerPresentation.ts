import type { CrossDomainEdge, CrossDomainGraph, CrossDomainNode } from "./terminalCrossDomainGraph";
import { inferDomain } from "./terminalCrossDomainGraph";
import type { IntelligenceObject } from "./terminalIntelligenceObjects";

/** This selector is display-only. Every shown line must already exist in the published object graph. */
export interface GraphExplorerPresentation {
  nodes: CrossDomainNode[];
  edges: CrossDomainEdge[];
  matchingCount: number;
  omittedCount: number;
  connectedIds: Set<string>;
}

export interface GraphExplorerConnection {
  direction: "incoming" | "outgoing";
  otherId: string;
  otherLabel: string;
  otherDomain: CrossDomainNode["domain"];
  relation: CrossDomainEdge["relation"];
  explanation: string | null;
}

export function graphNodeConnections(graph: CrossDomainGraph, objectId: string): GraphExplorerConnection[] {
  const byId = new Map(graph.nodes.map(node => [node.objectId, node]));
  if (!byId.has(objectId)) return [];
  return graph.edges.flatMap(edge => {
    const outgoing = edge.sourceId === objectId;
    const incoming = edge.targetId === objectId;
    if (!incoming && !outgoing) return [];
    const other = byId.get(outgoing ? edge.targetId : edge.sourceId);
    if (!other) return [];
    return [{
      direction: outgoing ? "outgoing" : "incoming",
      otherId: other.objectId, otherLabel: other.label, otherDomain: other.domain,
      relation: edge.relation, explanation: edge.explanation ?? null,
    }];
  });
}

/** Search includes direct, *recorded* neighbors so a match still has useful graph context. */
export function presentCrossDomainGraph(
  graph: CrossDomainGraph,
  settings: {
    query?: string;
    selectedId?: string | null;
    neighborsOnly?: boolean;
    bridgesOnly?: boolean;
    relation?: CrossDomainEdge["relation"];
    maxNodes?: number;
  } = {},
): GraphExplorerPresentation {
  const byId = new Map(graph.nodes.map(node => [node.objectId, node]));
  const relationEdges = settings.relation ? graph.edges.filter(edge => edge.relation === settings.relation) : graph.edges;
  // Source-true bridge filtering applies to objects as well as lines.
  const eligibleEdges = settings.bridgesOnly ? relationEdges.filter(edge => {
    const from = byId.get(edge.sourceId)?.domain;
    const to = byId.get(edge.targetId)?.domain;
    return Boolean(from && to && from !== to);
  }) : relationEdges;
  const participating = settings.relation || settings.bridgesOnly
    ? new Set(eligibleEdges.flatMap(edge => [edge.sourceId, edge.targetId]))
    : null;
  const known = new Set(graph.nodes.map(node => node.objectId));
  const query = (settings.query ?? "").trim().toLocaleLowerCase();
  const matchIds = new Set(graph.nodes.filter(node =>
    (!participating || participating.has(node.objectId)) &&
    (!query || [node.label, node.symbol ?? "", node.domain].some(value => value.toLocaleLowerCase().includes(query))),
  ).map(node => node.objectId));
  const eligible = new Set(matchIds);
  if (query) {
    for (const edge of eligibleEdges) {
      if (matchIds.has(edge.sourceId) && known.has(edge.targetId)) eligible.add(edge.targetId);
      if (matchIds.has(edge.targetId) && known.has(edge.sourceId)) eligible.add(edge.sourceId);
    }
  }
  const selectedId = settings.selectedId && known.has(settings.selectedId) && (!participating || participating.has(settings.selectedId)) ? settings.selectedId : null;
  const selectedConnected = new Set<string>(selectedId ? [selectedId] : []);
  if (selectedId) {
    for (const edge of eligibleEdges) {
      if (edge.sourceId === selectedId && known.has(edge.targetId)) selectedConnected.add(edge.targetId);
      if (edge.targetId === selectedId && known.has(edge.sourceId)) selectedConnected.add(edge.sourceId);
    }
  }
  const filtered = graph.nodes.filter(node => eligible.has(node.objectId)
    && (!settings.neighborsOnly || !selectedId || selectedConnected.has(node.objectId)));
  // Keep the explicitly selected node visible when it survives the current filters.
  const selected = filtered.find(node => node.objectId === selectedId);
  const ordered = selected
    ? [selected, ...filtered.filter(node => node.objectId !== selectedId)]
    : filtered;
  const limit = Math.min(120, Math.max(1, Math.trunc(settings.maxNodes ?? 48)));
  const nodes = ordered.slice(0, limit);
  const shown = new Set(nodes.map(node => node.objectId));
  const edges = eligibleEdges.filter(edge => shown.has(edge.sourceId) && shown.has(edge.targetId));
  const connectedIds = new Set<string>(selectedId ? [selectedId] : []);
  for (const edge of edges) {
    if (edge.sourceId === selectedId) connectedIds.add(edge.targetId);
    if (edge.targetId === selectedId) connectedIds.add(edge.sourceId);
  }
  return {
    nodes, edges,
    matchingCount: matchIds.size,
    omittedCount: Math.max(0, ordered.length - nodes.length),
    connectedIds,
  };
}

/**
 * B07/B08 exact recorded connection counts. The domain is a display
 * classification and each saved relation contributes one count. No influence,
 * verified exposure, probability or derived path is calculated.
 */
export function summarizeRecordedGraphLinks(graph: CrossDomainGraph): Array<{
  relation: CrossDomainEdge["relation"]; count: number;
}> {
  const known = new Set(graph.nodes.map(node => node.objectId));
  const counts = new Map<CrossDomainEdge["relation"], number>();
  for (const edge of graph.edges) {
    if (!known.has(edge.sourceId) || !known.has(edge.targetId)) continue;
    counts.set(edge.relation, (counts.get(edge.relation) ?? 0) + 1);
  }
  return [...counts].map(([relation, count]) => ({relation, count}))
    .sort((a, b) => b.count - a.count || a.relation.localeCompare(b.relation));
}

/**
 * B07/B09: preserve source-authorized Intelligence Objects while prioritizing
 * an explicit user search before the visual graph's 120-record memory bound.
 * Neighbor context is admitted only through an actual saved relation.
 */
export function selectRecordedCrossDomainGraphObjects(
  objects: readonly IntelligenceObject[],
  query: string,
  selectedId: string | null,
  max = 120,
): IntelligenceObject[] {
  const limit = Number.isSafeInteger(max) ? Math.max(1, Math.min(120, max)) : 120;
  const needle = query.trim().toLocaleLowerCase().slice(0, 120);
  if (!needle && !selectedId) return objects.slice(0, limit);
  const matches = objects.filter(object =>
    object.id === selectedId || (!!needle && [
      object.id, object.label, object.symbol ?? "", object.kind, inferDomain(object), ...object.tags,
    ].some(value => value.toLocaleLowerCase().includes(needle))));
  if (!matches.length) return needle ? [] : objects.slice(0, limit);
  const focus = new Set(matches.map(object => object.id));
  const neighbors = new Set(matches.flatMap(object => object.relations.map(rel => rel.targetId)));
  for (const object of objects) {
    if (object.relations.some(relation => focus.has(relation.targetId))) neighbors.add(object.id);
  }
  const preferred = [...matches, ...objects.filter(object => !focus.has(object.id) && neighbors.has(object.id))];
  return preferred.slice(0, limit);
}
