import type { ViewMode } from "./terminalTypes";

export type IntelligenceObjectKind =
  | "entity" | "metric" | "document" | "event" | "model" | "scenario"
  | "evidence" | "hypothesis" | "risk" | "decision" | "monitor" | "dataset"
  | "chart" | "table" | "note" | "portfolio" | "policy" | "location";

export type IntelligenceObjectStatus = "live" | "stable" | "warning" | "critical" | "archived" | "draft";
export type IntelligenceRelationKind =
  | "supports" | "contradicts" | "depends-on" | "derived-from" | "affects"
  | "monitors" | "compares-with" | "explains" | "contains" | "references" | "replaces";

export interface IntelligenceObjectValue {
  raw: string | number | boolean | null;
  display?: string;
  unit?: string;
  currency?: string;
}

export interface IntelligenceObjectSource {
  label: string;
  provider?: string;
  sourceId?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  effectiveAt?: string;
  freshness?: string;
}

export interface IntelligenceObjectRelation {
  targetId: string;
  kind: IntelligenceRelationKind;
  weight?: number;
  note?: string;
}

export interface IntelligenceObject {
  id: string;
  kind: IntelligenceObjectKind;
  label: string;
  description?: string;
  symbol?: string;
  view?: ViewMode;
  status: IntelligenceObjectStatus;
  value?: IntelligenceObjectValue;
  tags: string[];
  source?: IntelligenceObjectSource;
  assumptions: Record<string, string | number | boolean | null>;
  metadata: Record<string, string | number | boolean | null>;
  relations: IntelligenceObjectRelation[];
  createdAt: number;
  updatedAt: number;
}

export interface IntelligenceGraph {
  objects: IntelligenceObject[];
  edges: Array<{ sourceId: string; targetId: string; kind: IntelligenceRelationKind; weight?: number }>;
}

const STORAGE_KEY = "limuria-terminal-intelligence-objects-v1";
const EVENT_NAME = "lios:intelligence-objects";
const MAX_OBJECTS = 800;

function normalizeSymbol(symbol?: string): string | undefined {
  const value = symbol?.trim().toUpperCase();
  return value || undefined;
}

function makeId(kind: IntelligenceObjectKind): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${kind}:${crypto.randomUUID()}`;
  return `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
}

function cloneObject(object: IntelligenceObject): IntelligenceObject {
  return {
    ...object,
    value: object.value ? { ...object.value } : undefined,
    source: object.source ? { ...object.source } : undefined,
    tags: [...object.tags],
    assumptions: { ...object.assumptions },
    metadata: { ...object.metadata },
    relations: object.relations.map((relation) => ({ ...relation })),
  };
}

export function loadIntelligenceObjects(): IntelligenceObject[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as IntelligenceObject[];
    return Array.isArray(parsed) ? parsed.map(cloneObject).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_OBJECTS) : [];
  } catch { return []; }
}

export function saveIntelligenceObjects(objects: readonly IntelligenceObject[]): void {
  if (typeof window === "undefined") return;
  const normalized = objects.map(cloneObject).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_OBJECTS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function createIntelligenceObject(input: Omit<IntelligenceObject, "id" | "createdAt" | "updatedAt" | "symbol" | "tags" | "assumptions" | "metadata" | "relations"> & {
  symbol?: string;
  tags?: string[];
  assumptions?: IntelligenceObject["assumptions"];
  metadata?: IntelligenceObject["metadata"];
  relations?: IntelligenceObjectRelation[];
}): IntelligenceObject {
  const now = Date.now();
  return {
    ...input,
    id: makeId(input.kind),
    symbol: normalizeSymbol(input.symbol),
    tags: Array.from(new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 24),
    assumptions: { ...(input.assumptions ?? {}) },
    metadata: { ...(input.metadata ?? {}) },
    relations: (input.relations ?? []).map((relation) => ({ ...relation })),
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertIntelligenceObject(objects: readonly IntelligenceObject[], candidate: IntelligenceObject, dedupeKey?: (object: IntelligenceObject) => string): IntelligenceObject[] {
  const keyFor = dedupeKey ?? ((object: IntelligenceObject) => `${object.kind}|${object.symbol ?? ""}|${object.label.toLowerCase()}`);
  const candidateKey = keyFor(candidate);
  const existing = objects.find((object) => keyFor(object) === candidateKey);
  if (!existing) return [candidate, ...objects].slice(0, MAX_OBJECTS);
  return objects.map((object) => object.id === existing.id ? {
    ...cloneObject(candidate), id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now(),
  } : cloneObject(object)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function relateIntelligenceObjects(objects: readonly IntelligenceObject[], sourceId: string, relation: IntelligenceObjectRelation): IntelligenceObject[] {
  return objects.map((object) => {
    if (object.id !== sourceId) return cloneObject(object);
    const relations = [relation, ...object.relations.filter((item) => !(item.targetId === relation.targetId && item.kind === relation.kind))].slice(0, 80);
    return { ...cloneObject(object), relations, updatedAt: Date.now() };
  });
}

export function buildIntelligenceGraph(objects: readonly IntelligenceObject[]): IntelligenceGraph {
  const ids = new Set(objects.map((object) => object.id));
  return {
    objects: objects.map(cloneObject),
    edges: objects.flatMap((object) => object.relations
      .filter((relation) => ids.has(relation.targetId))
      .map((relation) => ({ sourceId: object.id, targetId: relation.targetId, kind: relation.kind, weight: relation.weight }))),
  };
}

export function queryIntelligenceObjects(objects: readonly IntelligenceObject[], input: { kind?: IntelligenceObjectKind; symbol?: string; tag?: string; text?: string }): IntelligenceObject[] {
  const symbol = normalizeSymbol(input.symbol);
  const text = input.text?.trim().toLowerCase();
  const tag = input.tag?.trim().toLowerCase();
  return objects.filter((object) => {
    if (input.kind && object.kind !== input.kind) return false;
    if (symbol && object.symbol !== symbol) return false;
    if (tag && !object.tags.includes(tag)) return false;
    if (text && !`${object.label} ${object.description ?? ""} ${object.symbol ?? ""} ${object.tags.join(" ")}`.toLowerCase().includes(text)) return false;
    return true;
  }).map(cloneObject);
}

export function subscribeIntelligenceObjects(listener: (objects: IntelligenceObject[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = event instanceof CustomEvent && Array.isArray(event.detail) ? event.detail : loadIntelligenceObjects();
    listener(detail.map(cloneObject));
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
