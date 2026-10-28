import type { CrossDomainNode, CrossDomainNodeDomain } from "./terminalCrossDomainGraph";

/**
 * Strict B08 grouping of already displayed, retained Intelligence Objects.
 * Display domains are heuristic labels, never source-verified exposure.
 * No synthetic metrics, hidden weights or inferred edges.
 */
export const GRAPH_TREEMAP_DOMAINS = [
  "finance","market","macro","policy","supply-chain","sustainability","portfolio","research",
] as const satisfies readonly CrossDomainNodeDomain[];

export function recordedGraphDomainCounts(
  nodes: readonly CrossDomainNode[],
): Array<{ domain: CrossDomainNodeDomain; count: number }> {
  const unique = new Set<string>();
  const counts = new Map<CrossDomainNodeDomain, number>();
  for (const node of nodes.slice(0, 120)) {
    if (!node.objectId || unique.has(node.objectId) || !GRAPH_TREEMAP_DOMAINS.includes(node.domain)) continue;
    unique.add(node.objectId);
    counts.set(node.domain, (counts.get(node.domain) ?? 0) + 1);
  }
  return GRAPH_TREEMAP_DOMAINS.flatMap(domain => {
    const count=counts.get(domain) ?? 0;
    return count > 0 ? [{domain,count}] : [];
  });
}
