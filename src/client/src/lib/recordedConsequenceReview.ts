import type { P7ContextGraph, P7ContextNode, P7Insight } from "@shared/p7ResearchContracts";

export type ConsequenceStep = { id: string; from: string; to: string; relation: string; forward: boolean; evidenceRefs: string[] };
export type ConsequenceTarget = { id: string; kind: "decision" | "portfolio" | "scenario" | "assumption" | "thesis"; label: string; steps: ConsequenceStep[] };
export type ConsequenceReview = { status: "ready" | "unavailable" | "no_sources" | "too_large"; graphHash: string | null; targets: ConsequenceTarget[]; total: number; omitted: number };
const targetKinds = new Set(["decision", "portfolio", "scenario", "assumption", "thesis"]);
const noResult = (status: ConsequenceReview["status"], graphHash: string | null = null): ConsequenceReview => ({ status, graphHash, targets: [], total: 0, omitted: 0 });

/** Recorded P7 adjacency only: even a complete path proves neither causality nor economic exposure. */
export function reviewRecordedConsequences(projectId: number, graph: P7ContextGraph | null | undefined, insight: P7Insight | null | undefined, limit = 12): ConsequenceReview {
  if (!Number.isInteger(projectId) || projectId < 1 || graph?.projectId !== projectId || !insight) return noResult("unavailable");
  if (graph.nodes.length > 10000 || graph.edges.length > 10000) return noResult("too_large", graph.contentHash);
  const eligibleNodes = graph.nodes.filter(n => n.kind !== "project" && n.metadata.external !== true);
  const byId = new Map(eligibleNodes.map(n => [n.id, n]));
  // A named entity/portfolio context node is not, by itself, a saved source.
  const sourceRefs = new Set(eligibleNodes.filter(n => n.contentHash && n.sourceRef).map(n => n.sourceRef as string));
  const selectedRefs = new Set(insight.sourceRefs.filter(r => sourceRefs.has(r)));
  const seeds = eligibleNodes.filter(n => n.contentHash && n.sourceRef && selectedRefs.has(n.sourceRef)).slice(0, 25);
  if (!seeds.length) return noResult("no_sources", graph.contentHash);
  const adjacency = new Map<string, Array<{ id: string; step: ConsequenceStep }>>();
  for (const edge of [...graph.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (edge.type === "contains" || edge.from === edge.to || !byId.has(edge.from) || !byId.has(edge.to)) continue;
    if (!edge.evidenceRefs.length || !edge.evidenceRefs.every(r => sourceRefs.has(r))) continue;
    for (const [at, next, forward] of [[edge.from, edge.to, true], [edge.to, edge.from, false]] as const) {
      const arr = adjacency.get(at) ?? [];
      arr.push({ id: next, step: { id: edge.id, from: edge.from, to: edge.to, relation: edge.type, forward, evidenceRefs: [...edge.evidenceRefs] } });
      adjacency.set(at, arr);
    }
  }
  const discovered = new Map<string, ConsequenceTarget>();
  const seedIds = new Set(seeds.map(n => n.id));
  for (const seed of seeds) {
    const seen = new Set([seed.id]);
    const queue: Array<{ id: string; steps: ConsequenceStep[] }> = [{ id: seed.id, steps: [] }];
    for (let i = 0; i < queue.length; i++) {
      const point = queue[i];
      if (point.steps.length >= 2) continue;
      for (const neighbor of adjacency.get(point.id) ?? []) {
        if (seen.has(neighbor.id)) continue;
        seen.add(neighbor.id);
        const next = byId.get(neighbor.id) as P7ContextNode;
        const steps = [...point.steps, neighbor.step];
        if (!seedIds.has(next.id) && targetKinds.has(next.kind) && !discovered.has(next.id))
          discovered.set(next.id, { id: next.id, kind: next.kind as ConsequenceTarget["kind"], label: next.label, steps });
        if (steps.length < 2) queue.push({ id: next.id, steps });
      }
    }
  }
  const kinds = ["decision", "portfolio", "scenario", "assumption", "thesis"];
  const sorted = [...discovered.values()].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.steps.length - b.steps.length || a.id.localeCompare(b.id));
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(24, Math.floor(limit))) : 12;
  return { status: "ready", graphHash: graph.contentHash, targets: sorted.slice(0, n), total: sorted.length, omitted: Math.max(0, sorted.length - n) };
}

/** The existing Project Chat must independently recheck permission and require approval before acting. */
export function consequenceReviewPrompt(projectId: number, graphHash: string, insight: P7Insight, target: ConsequenceTarget): string {
  const paths = target.steps.map(s => s.from + " " + s.relation + " " + s.to + " [edge:" + s.id + ", " + (s.forward ? "forward" : "reverse inspection") + ", refs:" + s.evidenceRefs.map(v => JSON.stringify(v.slice(0, 180))).join(", ") + "]").join("; ");
  return "Review this saved P7 Project " + projectId + " evidence path from graph hash " + graphHash + ". Insight " + JSON.stringify(insight.title.slice(0, 200)) +
    ". Target " + target.kind + " " + JSON.stringify(target.label.slice(0, 200)) + ". Stored path: " + paths.slice(0, 1200) +
    ". Recheck current ownership, source permission, freshness, contradictory evidence, and actual decision relevance. " +
    "Shared graph references do not prove causality, portfolio holdings, quantified exposure or financial effect. " +
    "Offer reviewable options only; do not run tools, save Artifacts, send communications or launch automations without explicit approval.";
}
