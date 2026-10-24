import type { ViewMode } from "./terminalTypes";
import { getTerminalCapability } from "./terminalCatalog";

export type ResearchTrayItemKind = "context" | "evidence" | "output" | "note";

export interface ResearchTrayItem {
  id: string;
  kind: ResearchTrayItemKind;
  view: ViewMode;
  symbol: string;
  title: string;
  description: string;
  note: string;
  tags: string[];
  group: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "limuria-terminal-research-tray-v1";
const EVENT_NAME = "lios:research-tray";
/** One device-local research store is bounded, so the UI can prevent unannounced eviction. */
export const MAX_RESEARCH_TRAY_ITEMS = 120;
const MAX_ITEMS = MAX_RESEARCH_TRAY_ITEMS;

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `research-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSymbol(symbol: string | undefined): string {
  return (symbol ?? "").trim().toUpperCase().slice(0, 32);
}

function cleanText(value: string | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

function cleanTags(tags: readonly string[] | undefined): string[] {
  return Array.from(new Set((tags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)))
    .slice(0, 12)
    .map((tag) => tag.slice(0, 28));
}

function isItem(value: unknown): value is ResearchTrayItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ResearchTrayItem>;
  return typeof item.id === "string" &&
    (item.kind === "context" || item.kind === "evidence" || item.kind === "output" || item.kind === "note") &&
    typeof item.view === "string" && typeof item.symbol === "string" && typeof item.title === "string" &&
    typeof item.description === "string" && typeof item.note === "string" && Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === "string") && typeof item.group === "string" &&
    typeof item.createdAt === "number" && typeof item.updatedAt === "number";
}

/** Parse the saved local document without trusting external storage events or mutating their arrays. */
function parseResearchTray(raw: string | null): ResearchTrayItem[] {
  const parsed: unknown = JSON.parse(raw || "[]");
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isItem).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ITEMS);
}

export function loadResearchTray(): ResearchTrayItem[] {
  if (typeof window === "undefined") return [];
  try {
    return parseResearchTray(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveResearchTray(items: readonly ResearchTrayItem[]): void {
  if (typeof window === "undefined") throw new Error("Device-local research storage is unavailable.");
  // Never mutate caller-owned React arrays, even when storage.setItem throws.
  const normalized = [...items]
    .filter(isItem)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ITEMS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  // Only publish to the current window AFTER the local write succeeds.
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function clearResearchTray(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: [] }));
}

export function subscribeResearchTray(listener: (items: ResearchTrayItem[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent) || !Array.isArray(event.detail)) return;
    listener([...event.detail].filter(isItem).slice(0, MAX_ITEMS));
  };
  // The browser does not emit "storage" in the writing tab, so both paths
  // are needed. Same-device edits/deletions in another tab must not be hidden.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    try {
      listener(parseResearchTray(event.key === null ? localStorage.getItem(STORAGE_KEY) : event.newValue));
    } catch {
      // A malformed/blocked external storage event must not erase visible
      // research or pretend that no pinned items exist.
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", onStorage);
  };
}

export function createResearchContextItem(input: {
  view: ViewMode;
  symbol?: string;
  note?: string;
  group?: string;
  tags?: string[];
  kind?: ResearchTrayItemKind;
  title?: string;
  description?: string;
}): ResearchTrayItem {
  const capability = getTerminalCapability(input.view);
  const symbol = capability.symbolAware ? normalizeSymbol(input.symbol) : "";
  const now = Date.now();
  const title = cleanText(input.title, 120) || (symbol ? `${symbol} · ${capability.label}` : capability.label);
  return {
    id: createId(),
    kind: input.kind ?? "context",
    view: input.view,
    symbol,
    title,
    description: cleanText(input.description, 280) || capability.description,
    note: cleanText(input.note, 1200),
    tags: cleanTags(input.tags),
    group: cleanText(input.group, 60),
    createdAt: now,
    updatedAt: now,
  };
}

export function pinResearchContext(
  items: readonly ResearchTrayItem[],
  input: Parameters<typeof createResearchContextItem>[0],
): ResearchTrayItem[] {
  const candidate = createResearchContextItem(input);
  const existing = items.find((item) => item.kind === candidate.kind && item.view === candidate.view && item.symbol === candidate.symbol);
  if (existing) {
    return items
      .map((item) => item.id === existing.id
        ? { ...item, title: candidate.title, description: candidate.description, updatedAt: Date.now() }
        : item)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return [candidate, ...items].slice(0, MAX_ITEMS);
}

export function updateResearchTrayItem(
  items: readonly ResearchTrayItem[],
  itemId: string,
  patch: Partial<Pick<ResearchTrayItem, "title" | "note" | "tags" | "group">>,
): ResearchTrayItem[] {
  return items.map((item) => {
    if (item.id !== itemId) return item;
    return {
      ...item,
      title: patch.title === undefined ? item.title : cleanText(patch.title, 120) || item.title,
      note: patch.note === undefined ? item.note : cleanText(patch.note, 1200),
      tags: patch.tags === undefined ? item.tags : cleanTags(patch.tags),
      group: patch.group === undefined ? item.group : cleanText(patch.group, 60),
      updatedAt: Date.now(),
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeResearchTrayItem(items: readonly ResearchTrayItem[], itemId: string): ResearchTrayItem[] {
  return items.filter((item) => item.id !== itemId);
}

export function clearResearchTrayGroup(items: readonly ResearchTrayItem[], group: string): ResearchTrayItem[] {
  const normalized = group.trim();
  if (!normalized) return Array.from(items);
  return items.filter((item) => item.group !== normalized);
}

export function getResearchTrayGroups(items: readonly ResearchTrayItem[]): string[] {
  return Array.from(new Set(items.map((item) => item.group).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
