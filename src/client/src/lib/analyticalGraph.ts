import type { AnalyticalModelRun } from "./analyticalCore";

export type AnalyticalNodeKind = "data" | "assumption" | "scenario" | "model" | "output" | "diagnostic" | "evidence";
export type AnalyticalEdgeRelation = "feeds" | "derives" | "shocks" | "supports" | "diagnoses" | "compares";

export interface AnalyticalGraphNode {
  id: string;
  kind: AnalyticalNodeKind;
  label: string;
  domain?: string;
  value?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AnalyticalGraphEdge {
  from: string;
  to: string;
  relation: AnalyticalEdgeRelation;
}

export interface AnalyticalImpactResult {
  roots: string[];
  impactedNodeIds: string[];
  impactedModels: string[];
  impactedOutputs: string[];
}

export class AnalyticalGraph {
  private readonly nodes = new Map<string, AnalyticalGraphNode>();
  private readonly outgoing = new Map<string, AnalyticalGraphEdge[]>();
  private readonly incoming = new Map<string, AnalyticalGraphEdge[]>();

  upsertNode(node: AnalyticalGraphNode): this {
    this.nodes.set(node.id, { ...this.nodes.get(node.id), ...node });
    return this;
  }

  getNode(id: string): AnalyticalGraphNode | undefined {
    return this.nodes.get(id);
  }

  getNodes(): AnalyticalGraphNode[] {
    return Array.from(this.nodes.values());
  }

  getEdges(): AnalyticalGraphEdge[] {
    return Array.from(this.outgoing.values()).flat();
  }

  connect(from: string, to: string, relation: AnalyticalEdgeRelation): this {
    if (from === to) throw new Error(`Analytical graph cannot connect ${from} to itself.`);
    if (!this.nodes.has(from) || !this.nodes.has(to)) throw new Error(`Analytical graph edge references a missing node: ${from} -> ${to}`);
    if (this.hasPath(to, from)) throw new Error(`Analytical graph cycle detected: ${from} -> ${to}`);
    const edge = { from, to, relation };
    const existing = this.outgoing.get(from) ?? [];
    if (!existing.some((candidate) => candidate.to === to && candidate.relation === relation)) {
      this.outgoing.set(from, [...existing, edge]);
      this.incoming.set(to, [...(this.incoming.get(to) ?? []), edge]);
    }
    return this;
  }

  hasPath(from: string, to: string): boolean {
    if (from === to) return true;
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of this.outgoing.get(current) ?? []) {
        if (edge.to === to) return true;
        if (!seen.has(edge.to)) queue.push(edge.to);
      }
    }
    return false;
  }

  upstream(nodeId: string): AnalyticalGraphNode[] {
    return this.walk(nodeId, this.incoming, (edge) => edge.from);
  }

  downstream(nodeId: string): AnalyticalGraphNode[] {
    return this.walk(nodeId, this.outgoing, (edge) => edge.to);
  }

  impactFrom(rootIds: readonly string[]): AnalyticalImpactResult {
    const impacted = new Set<string>();
    for (const rootId of rootIds) {
      for (const node of this.downstream(rootId)) impacted.add(node.id);
    }
    const impactedNodes = Array.from(impacted).map((id) => this.nodes.get(id)).filter((node): node is AnalyticalGraphNode => Boolean(node));
    return {
      roots: [...rootIds],
      impactedNodeIds: impactedNodes.map((node) => node.id),
      impactedModels: impactedNodes.filter((node) => node.kind === "model").map((node) => node.id),
      impactedOutputs: impactedNodes.filter((node) => node.kind === "output").map((node) => node.id),
    };
  }

  topologicalOrder(): AnalyticalGraphNode[] {
    const indegree = new Map(Array.from(this.nodes.keys()).map((id) => [id, 0]));
    for (const edge of this.getEdges()) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const queue = Array.from(indegree.entries()).filter(([, degree]) => degree === 0).map(([id]) => id).sort();
    const ordered: AnalyticalGraphNode[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (node) ordered.push(node);
      for (const edge of this.outgoing.get(current) ?? []) {
        const nextDegree = (indegree.get(edge.to) ?? 0) - 1;
        indegree.set(edge.to, nextDegree);
        if (nextDegree === 0) {
          queue.push(edge.to);
          queue.sort();
        }
      }
    }
    if (ordered.length !== this.nodes.size) throw new Error("Analytical graph contains a cycle.");
    return ordered;
  }

  toJSON(): { nodes: AnalyticalGraphNode[]; edges: AnalyticalGraphEdge[] } {
    return { nodes: this.getNodes(), edges: this.getEdges() };
  }

  private walk(
    nodeId: string,
    edgeMap: Map<string, AnalyticalGraphEdge[]>,
    nextId: (edge: AnalyticalGraphEdge) => string,
  ): AnalyticalGraphNode[] {
    const seen = new Set<string>();
    const queue = [nodeId];
    const result: AnalyticalGraphNode[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of edgeMap.get(current) ?? []) {
        const next = nextId(edge);
        if (seen.has(next)) continue;
        seen.add(next);
        const node = this.nodes.get(next);
        if (node) result.push(node);
        queue.push(next);
      }
    }
    return result;
  }
}

export function mergeRunIntoAnalyticalGraph(graph: AnalyticalGraph, run: AnalyticalModelRun): AnalyticalGraph {
  const modelNodeId = `model:${run.modelId}:${run.id}`;
  graph.upsertNode({
    id: modelNodeId,
    kind: "model",
    label: run.modelLabel,
    domain: run.domain,
    metadata: { runId: run.id, version: run.modelVersion, status: run.status, reproducibilityHash: run.reproducibilityHash },
  });

  if (run.scenarioId) {
    const scenarioId = `scenario:${run.scenarioId}`;
    graph.upsertNode({ id: scenarioId, kind: "scenario", label: run.scenarioId });
    graph.connect(scenarioId, modelNodeId, "shocks");
  }

  for (const input of run.inputs) {
    const nodeId = `input:${run.id}:${input.id}`;
    graph.upsertNode({
      id: nodeId,
      kind: input.kind === "assumption" || input.kind === "scenario" ? "assumption" : "data",
      label: input.label,
      value: input.value,
      metadata: { unit: input.unit, source: input.source, asOf: input.asOf, locked: input.locked },
    });
    graph.connect(nodeId, modelNodeId, input.kind === "scenario" ? "shocks" : "feeds");
  }

  for (const dependency of run.dependencies) {
    const nodeId = `dependency:${dependency.kind}:${dependency.id}`;
    const kind: AnalyticalNodeKind = dependency.kind === "model" ? "model" : dependency.kind === "scenario" ? "scenario" : dependency.kind === "evidence" ? "evidence" : dependency.kind === "assumption" ? "assumption" : "data";
    graph.upsertNode({ id: nodeId, kind, label: dependency.label ?? dependency.id, metadata: { version: dependency.version, fingerprint: dependency.fingerprint } });
    graph.connect(nodeId, modelNodeId, dependency.kind === "scenario" ? "shocks" : dependency.kind === "evidence" ? "supports" : "feeds");
  }

  for (const output of run.outputs) {
    const nodeId = `output:${run.id}:${output.id}`;
    graph.upsertNode({ id: nodeId, kind: "output", label: output.label, domain: run.domain, value: output.value, metadata: { unit: output.unit, role: output.role, confidence: output.confidence } });
    graph.connect(modelNodeId, nodeId, "derives");
  }

  for (const diagnostic of run.diagnostics) {
    const nodeId = `diagnostic:${run.id}:${diagnostic.id}`;
    graph.upsertNode({ id: nodeId, kind: "diagnostic", label: diagnostic.label, value: diagnostic.metric, metadata: { severity: diagnostic.severity, unit: diagnostic.unit, detail: diagnostic.detail, blocking: diagnostic.blocking } });
    graph.connect(modelNodeId, nodeId, "diagnoses");
  }

  for (const evidence of run.evidence) {
    const nodeId = `evidence:${run.id}:${evidence.id}`;
    graph.upsertNode({ id: nodeId, kind: "evidence", label: evidence.label, metadata: { source: evidence.source, asOf: evidence.asOf, reference: evidence.reference, confidence: evidence.confidence } });
    graph.connect(nodeId, modelNodeId, "supports");
  }

  return graph;
}
