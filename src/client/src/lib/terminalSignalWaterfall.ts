export type SignalStage = "data" | "signal" | "evidence" | "model" | "challenge" | "thesis" | "decision" | "monitor";

export interface SignalWaterfallNode {
  id: string;
  stage: SignalStage;
  label: string;
  description?: string;
  objectId?: string;
  confidence?: number;
  createdAt: number;
}

export interface SignalWaterfallEdge {
  from: string;
  to: string;
  rationale?: string;
}

export interface SignalWaterfall {
  id: string;
  title: string;
  symbol?: string;
  nodes: SignalWaterfallNode[];
  edges: SignalWaterfallEdge[];
  updatedAt: number;
}

export const SIGNAL_STAGE_ORDER: readonly SignalStage[] = ["data", "signal", "evidence", "model", "challenge", "thesis", "decision", "monitor"];

function makeId(prefix: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? `${prefix}:${crypto.randomUUID()}` : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function createSignalWaterfall(title: string, symbol?: string): SignalWaterfall {
  return { id: makeId("waterfall"), title: title.trim(), symbol: symbol?.trim().toUpperCase() || undefined, nodes: [], edges: [], updatedAt: Date.now() };
}

export function appendWaterfallNode(waterfall: SignalWaterfall, node: Omit<SignalWaterfallNode, "id" | "createdAt">, connectFromId?: string): SignalWaterfall {
  const nextNode: SignalWaterfallNode = { ...node, id: makeId(node.stage), createdAt: Date.now() };
  const edge = connectFromId ? [{ from: connectFromId, to: nextNode.id }] : [];
  return { ...waterfall, nodes: [...waterfall.nodes, nextNode], edges: [...waterfall.edges, ...edge], updatedAt: Date.now() };
}

export function validateSignalWaterfall(waterfall: SignalWaterfall): string[] {
  const ids = new Set(waterfall.nodes.map((node) => node.id));
  const issues: string[] = [];
  for (const edge of waterfall.edges) {
    if (!ids.has(edge.from)) issues.push(`Missing edge source: ${edge.from}`);
    if (!ids.has(edge.to)) issues.push(`Missing edge target: ${edge.to}`);
  }
  for (const node of waterfall.nodes) {
    if (node.confidence !== undefined && (node.confidence < 0 || node.confidence > 100)) issues.push(`Confidence out of range: ${node.label}`);
  }
  return issues;
}

export function stageCoverage(waterfall: SignalWaterfall): Record<SignalStage, number> {
  return Object.fromEntries(SIGNAL_STAGE_ORDER.map((stage) => [stage, waterfall.nodes.filter((node) => node.stage === stage).length])) as Record<SignalStage, number>;
}

export function decisionReadiness(waterfall: SignalWaterfall): { score: number; missing: SignalStage[] } {
  const coverage = stageCoverage(waterfall);
  const required: SignalStage[] = ["data", "evidence", "model", "challenge", "thesis", "decision", "monitor"];
  const missing = required.filter((stage) => coverage[stage] === 0);
  const score = Math.round(((required.length - missing.length) / required.length) * 100);
  return { score, missing };
}
