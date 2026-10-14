export type TraceKind = "source" | "dataset_version" | "transformation" | "model_input" | "valuation" | "ai";
export interface TraceNode { id: string; kind: TraceKind; label: string; resourceId: string; metadata?: Record<string, string | number | null>; }
export interface ProvenanceTrace { root: TraceNode; nodes: TraceNode[]; edges: Array<{ from: string; to: string; relationship: string }>; }

export function buildProvenanceTrace(root: TraceNode, nodes: TraceNode[], edges: ProvenanceTrace["edges"]): ProvenanceTrace {
  const ids = new Set([root.id]);
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error("DUPLICATE_TRACE_NODE");
    ids.add(node.id);
  }
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error("INVALID_TRACE_EDGE");
  }
  return { root, nodes: [...nodes], edges: [...edges] };
}

export function traceToTimeline(trace: ProvenanceTrace): TraceNode[] {
  const incoming = new Map<string, number>();
  for (const node of [trace.root, ...trace.nodes]) incoming.set(node.id, 0);
  for (const edge of trace.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const queue = [trace.root.id];
  const ordered: TraceNode[] = [];
  const byId = new Map([trace.root, ...trace.nodes].map((node) => [node.id, node]));
  while (queue.length) {
    const id = queue.shift()!; const node = byId.get(id); if (node) ordered.push(node);
    for (const edge of trace.edges.filter((e) => e.from === id)) {
      const next = (incoming.get(edge.to) ?? 1) - 1; incoming.set(edge.to, next);
      if (next === 0) queue.push(edge.to);
    }
  }
  return ordered;
}
