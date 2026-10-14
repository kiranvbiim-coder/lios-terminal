import type { ViewMode } from "./terminalTypes";

export type ThesisCaseId = "bull" | "base" | "bear";
export type ThesisEvidencePolarity = "supports" | "weakens" | "neutral";

export interface ThesisEvidenceLink {
  id: string;
  title: string;
  view: ViewMode;
  symbol: string;
  polarity: ThesisEvidencePolarity;
  weight: number;
  note: string;
  updatedAt: number;
}

export interface ThesisCase {
  id: ThesisCaseId;
  title: string;
  probability: number;
  target?: number | null;
  narrative: string;
  evidence: ThesisEvidenceLink[];
}

export interface ThesisMap {
  id: string;
  symbol: string;
  title: string;
  horizon: string;
  cases: Record<ThesisCaseId, ThesisCase>;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "limuria-terminal-thesis-maps-v1";
const EVENT_NAME = "lios:thesis-map";

function makeId(prefix: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProbability(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function emptyCase(id: ThesisCaseId, probability: number): ThesisCase {
  return { id, title: id === "bull" ? "Bull Case" : id === "bear" ? "Bear Case" : "Base Case", probability, target: null, narrative: "", evidence: [] };
}

export function createThesisMap(symbol?: string): ThesisMap {
  const now = Date.now();
  const normalized = (symbol ?? "").trim().toUpperCase();
  return {
    id: makeId("thesis"),
    symbol: normalized,
    title: normalized ? `${normalized} Thesis` : "Untitled Thesis",
    horizon: "12 months",
    cases: { bull: emptyCase("bull", 20), base: emptyCase("base", 60), bear: emptyCase("bear", 20) },
    createdAt: now,
    updatedAt: now,
  };
}

function loadAll(): ThesisMap[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ThesisMap[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveAll(items: readonly ThesisMap[]): void {
  if (typeof window === "undefined") return;
  const next = [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function loadThesisMaps(): ThesisMap[] {
  return loadAll().map((item) => ({ ...item, cases: {
    bull: { ...item.cases.bull, evidence: [...item.cases.bull.evidence] },
    base: { ...item.cases.base, evidence: [...item.cases.base.evidence] },
    bear: { ...item.cases.bear, evidence: [...item.cases.bear.evidence] },
  } }));
}

export function saveThesisMap(map: ThesisMap): ThesisMap {
  const probabilities = Object.values(map.cases).map((item) => normalizeProbability(item.probability));
  const total = probabilities.reduce((sum, value) => sum + value, 0) || 100;
  const normalizedCases = (Object.keys(map.cases) as ThesisCaseId[]).reduce((acc, id, index) => {
    const current = map.cases[id];
    acc[id] = { ...current, probability: Math.round((probabilities[index] / total) * 1000) / 10, evidence: current.evidence.slice(0, 40) };
    return acc;
  }, {} as Record<ThesisCaseId, ThesisCase>);
  const next = { ...map, symbol: map.symbol.trim().toUpperCase(), title: map.title.trim().slice(0, 100), horizon: map.horizon.trim().slice(0, 60), cases: normalizedCases, updatedAt: Date.now() };
  const all = loadAll();
  saveAll([next, ...all.filter((item) => item.id !== next.id)]);
  return next;
}

export function addThesisEvidence(map: ThesisMap, caseId: ThesisCaseId, input: Omit<ThesisEvidenceLink, "id" | "updatedAt" | "symbol"> & { symbol?: string }): ThesisMap {
  const link: ThesisEvidenceLink = { ...input, id: makeId("evidence"), symbol: (input.symbol ?? map.symbol).trim().toUpperCase(), weight: Math.max(0, Math.min(5, input.weight)), note: input.note.trim().slice(0, 800), updatedAt: Date.now() };
  return saveThesisMap({ ...map, cases: { ...map.cases, [caseId]: { ...map.cases[caseId], evidence: [link, ...map.cases[caseId].evidence] } } });
}

export function thesisCaseScore(thesisCase: ThesisCase): number {
  if (!thesisCase.evidence.length) return 0;
  const raw = thesisCase.evidence.reduce((sum, item) => sum + (item.polarity === "supports" ? item.weight : item.polarity === "weakens" ? -item.weight : 0), 0);
  return Math.max(-100, Math.min(100, (raw / Math.max(1, thesisCase.evidence.length * 5)) * 100));
}

export function subscribeThesisMaps(listener: (maps: ThesisMap[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(loadThesisMaps());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
