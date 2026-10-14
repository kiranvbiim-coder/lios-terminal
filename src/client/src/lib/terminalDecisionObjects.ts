export type DecisionStatus = "draft" | "active" | "reversed" | "closed";
export type DecisionDirection = "buy" | "sell" | "hold" | "avoid" | "allocate" | "deallocate" | "approve" | "reject" | "monitor" | "custom";

export interface DecisionEvidenceLink {
  objectId: string;
  role: "support" | "contradiction" | "context";
  weight?: number;
  note?: string;
}

export interface ReversalCondition {
  id: string;
  label: string;
  description: string;
  objectId?: string;
  comparator?: "gt" | "gte" | "lt" | "lte" | "eq" | "changed";
  threshold?: number | string;
  triggeredAt?: number;
}

export interface DecisionObject {
  id: string;
  title: string;
  symbol?: string;
  direction: DecisionDirection;
  status: DecisionStatus;
  thesis: string;
  confidence: number;
  scenarioId?: string;
  evidence: DecisionEvidenceLink[];
  reversalConditions: ReversalCondition[];
  modelObjectIds: string[];
  notes: string;
  decidedAt?: number;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "limuria-terminal-decisions-v1";
const EVENT_NAME = "lios:decision-objects";

function makeId(prefix: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? `${prefix}:${crypto.randomUUID()}` : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function cloneDecision(decision: DecisionObject): DecisionObject {
  return {
    ...decision,
    evidence: decision.evidence.map((item) => ({ ...item })),
    reversalConditions: decision.reversalConditions.map((item) => ({ ...item })),
    modelObjectIds: [...decision.modelObjectIds],
  };
}

export function createDecisionObject(input: Omit<DecisionObject, "id" | "createdAt" | "updatedAt" | "confidence" | "evidence" | "reversalConditions" | "modelObjectIds" | "notes" | "symbol"> & {
  symbol?: string;
  confidence?: number;
  evidence?: DecisionEvidenceLink[];
  reversalConditions?: ReversalCondition[];
  modelObjectIds?: string[];
  notes?: string;
}): DecisionObject {
  const now = Date.now();
  return {
    ...input,
    id: makeId("decision"),
    symbol: input.symbol?.trim().toUpperCase() || undefined,
    confidence: Math.max(0, Math.min(100, input.confidence ?? 50)),
    evidence: (input.evidence ?? []).map((item) => ({ ...item })),
    reversalConditions: (input.reversalConditions ?? []).map((item) => ({ ...item, id: item.id || makeId("reversal") })),
    modelObjectIds: [...(input.modelObjectIds ?? [])],
    notes: input.notes ?? "",
    createdAt: now,
    updatedAt: now,
  };
}

export function loadDecisionObjects(): DecisionObject[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as DecisionObject[];
    return Array.isArray(parsed) ? parsed.map(cloneDecision).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch { return []; }
}

export function saveDecisionObjects(decisions: readonly DecisionObject[]): void {
  if (typeof window === "undefined") return;
  const next = decisions.map(cloneDecision).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 240);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function upsertDecisionObject(decisions: readonly DecisionObject[], candidate: DecisionObject): DecisionObject[] {
  const existing = decisions.find((decision) => decision.id === candidate.id);
  const normalized = { ...cloneDecision(candidate), updatedAt: Date.now() };
  return (existing ? decisions.map((decision) => decision.id === candidate.id ? normalized : cloneDecision(decision)) : [normalized, ...decisions])
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function patchDecisionObject(decision: DecisionObject, patch: Partial<Pick<DecisionObject, "title" | "direction" | "status" | "thesis" | "confidence" | "scenarioId" | "notes">>): DecisionObject {
  return {
    ...cloneDecision(decision),
    ...patch,
    confidence: patch.confidence === undefined ? decision.confidence : Math.max(0, Math.min(100, patch.confidence)),
    updatedAt: Date.now(),
  };
}

export function addDecisionEvidence(decision: DecisionObject, evidence: DecisionEvidenceLink): DecisionObject {
  return {
    ...cloneDecision(decision),
    evidence: [evidence, ...decision.evidence.filter((item) => !(item.objectId === evidence.objectId && item.role === evidence.role))],
    updatedAt: Date.now(),
  };
}

export function removeDecisionEvidence(decision: DecisionObject, objectId: string, role?: DecisionEvidenceLink["role"]): DecisionObject {
  return {
    ...cloneDecision(decision),
    evidence: decision.evidence.filter((item) => !(item.objectId === objectId && (!role || item.role === role))),
    updatedAt: Date.now(),
  };
}

export function addReversalCondition(decision: DecisionObject, input: Omit<ReversalCondition, "id">): DecisionObject {
  return {
    ...cloneDecision(decision),
    reversalConditions: [{ ...input, id: makeId("reversal") }, ...decision.reversalConditions],
    updatedAt: Date.now(),
  };
}

export function removeReversalCondition(decision: DecisionObject, conditionId: string): DecisionObject {
  return { ...cloneDecision(decision), reversalConditions: decision.reversalConditions.filter((item) => item.id !== conditionId), updatedAt: Date.now() };
}

export function decisionEvidenceBalance(decision: DecisionObject): { support: number; contradiction: number; net: number } {
  const support = decision.evidence.filter((item) => item.role === "support").reduce((sum, item) => sum + (item.weight ?? 1), 0);
  const contradiction = decision.evidence.filter((item) => item.role === "contradiction").reduce((sum, item) => sum + (item.weight ?? 1), 0);
  return { support, contradiction, net: support - contradiction };
}

export function activateDecision(decision: DecisionObject): DecisionObject {
  return { ...cloneDecision(decision), status: "active", decidedAt: decision.decidedAt ?? Date.now(), updatedAt: Date.now() };
}

export function subscribeDecisionObjects(listener: (decisions: DecisionObject[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => listener(event instanceof CustomEvent && Array.isArray(event.detail) ? event.detail.map(cloneDecision) : loadDecisionObjects());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
