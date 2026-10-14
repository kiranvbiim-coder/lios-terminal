import type { IntelligenceObject, IntelligenceRelationKind } from "./terminalIntelligenceObjects";

export type CrossDomainNodeDomain = "finance" | "macro" | "policy" | "supply-chain" | "sustainability" | "market" | "portfolio" | "research";

export interface CrossDomainNode {
  objectId: string;
  domain: CrossDomainNodeDomain;
  label: string;
  symbol?: string;
  strength: number;
}

export interface CrossDomainEdge {
  sourceId: string;
  targetId: string;
  relation: IntelligenceRelationKind;
  strength: number;
  explanation?: string;
}

export interface CrossDomainGraph {
  nodes: CrossDomainNode[];
  edges: CrossDomainEdge[];
}

function inferDomain(object: IntelligenceObject): CrossDomainNodeDomain {
  const text = `${object.kind} ${object.label} ${object.tags.join(" ")} ${object.view ?? ""}`.toLowerCase();
  if (/portfolio|risk|allocation|holding/.test(text)) return "portfolio";
  if (/macro|gdp|inflation|rate|yield|fx|econom/.test(text)) return "macro";
  if (/policy|regulat|fiscal|budget|scheme/.test(text)) return "policy";
  if (/supply|inventory|logistic|shipping|route|supplier/.test(text)) return "supply-chain";
  if (/carbon|climate|environment|sustain|energy transition/.test(text)) return "sustainability";
  if (/price|market|flow|option|sentiment|trade/.test(text)) return "market";
  if (/evidence|document|research|thesis|decision/.test(text)) return "research";
  return "finance";
}

export function buildCrossDomainGraph(objects: readonly IntelligenceObject[]): CrossDomainGraph {
  const ids = new Set(objects.map((object) => object.id));
  const nodes = objects.map((object) => ({
    objectId: object.id,
    domain: inferDomain(object),
    label: object.label,
    symbol: object.symbol,
    strength: Math.min(1, .35 + object.relations.length * .08),
  }));
  const edges = objects.flatMap((object) => object.relations
    .filter((relation) => ids.has(relation.targetId))
    .map((relation) => ({
      sourceId: object.id,
      targetId: relation.targetId,
      relation: relation.kind,
      strength: Math.max(0, Math.min(1, relation.weight ?? .5)),
      explanation: relation.note,
    })));
  return { nodes, edges };
}

export function crossDomainBridges(graph: CrossDomainGraph): CrossDomainEdge[] {
  const domain = new Map(graph.nodes.map((node) => [node.objectId, node.domain]));
  return graph.edges.filter((edge) => domain.get(edge.sourceId) !== domain.get(edge.targetId));
}

export function domainExposure(graph: CrossDomainGraph): Record<CrossDomainNodeDomain, number> {
  const domains: CrossDomainNodeDomain[] = ["finance","macro","policy","supply-chain","sustainability","market","portfolio","research"];
  const result = Object.fromEntries(domains.map((item) => [item, 0])) as Record<CrossDomainNodeDomain, number>;
  for (const node of graph.nodes) result[node.domain] += node.strength;
  return result;
}
