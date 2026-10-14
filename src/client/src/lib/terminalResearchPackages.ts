import type { WorkspaceState } from "./terminalTypes";
import type { ResearchTrayItem } from "./terminalResearchTray";
import type { ThesisMap } from "./terminalThesisMap";

export interface ResearchPackage {
  id: string;
  title: string;
  symbol: string;
  description: string;
  workspace: WorkspaceState;
  researchItems: ResearchTrayItem[];
  thesis: ThesisMap | null;
  assumptions: string[];
  monitoringRuleIds: string[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "limuria-terminal-research-packages-v1";
const EVENT_NAME = "lios:research-packages";

function createId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `package-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function loadResearchPackages(): ResearchPackage[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ResearchPackage[];
    return Array.isArray(parsed) ? parsed.map(clone).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch { return []; }
}

function saveAll(items: readonly ResearchPackage[]): void {
  if (typeof window === "undefined") return;
  const next = items.map(clone).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 80);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function createResearchPackage(input: {
  title?: string;
  symbol?: string;
  description?: string;
  workspace: WorkspaceState;
  researchItems?: ResearchTrayItem[];
  thesis?: ThesisMap | null;
  assumptions?: string[];
  monitoringRuleIds?: string[];
}): ResearchPackage {
  const now = Date.now();
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  const item: ResearchPackage = {
    id: createId(),
    title: (input.title?.trim() || (symbol ? `${symbol} Research Package` : "Research Package")).slice(0, 120),
    symbol,
    description: (input.description ?? "").trim().slice(0, 1200),
    workspace: clone(input.workspace),
    researchItems: clone(input.researchItems ?? []).slice(0, 120),
    thesis: input.thesis ? clone(input.thesis) : null,
    assumptions: (input.assumptions ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 60),
    monitoringRuleIds: Array.from(new Set(input.monitoringRuleIds ?? [])).slice(0, 80),
    createdAt: now,
    updatedAt: now,
  };
  saveAll([item, ...loadResearchPackages()]);
  return item;
}

export function updateResearchPackage(packageId: string, patch: Partial<Pick<ResearchPackage, "title" | "description" | "assumptions" | "monitoringRuleIds">>): ResearchPackage | null {
  let updated: ResearchPackage | null = null;
  const next = loadResearchPackages().map((item) => {
    if (item.id !== packageId) return item;
    updated = {
      ...item,
      title: patch.title === undefined ? item.title : patch.title.trim().slice(0, 120) || item.title,
      description: patch.description === undefined ? item.description : patch.description.trim().slice(0, 1200),
      assumptions: patch.assumptions === undefined ? item.assumptions : patch.assumptions.map((value) => value.trim()).filter(Boolean).slice(0, 60),
      monitoringRuleIds: patch.monitoringRuleIds === undefined ? item.monitoringRuleIds : Array.from(new Set(patch.monitoringRuleIds)).slice(0, 80),
      updatedAt: Date.now(),
    };
    return updated;
  });
  saveAll(next);
  return updated;
}

export function removeResearchPackage(packageId: string): void {
  saveAll(loadResearchPackages().filter((item) => item.id !== packageId));
}

export function subscribeResearchPackages(listener: (items: ResearchPackage[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(loadResearchPackages());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
