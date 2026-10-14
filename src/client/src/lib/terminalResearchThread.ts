import type { ViewMode } from "./terminalTypes";
import { getTerminalCapability } from "./terminalCatalog";

export type ResearchThreadEventKind = "visit" | "pin" | "evidence" | "decision" | "scene";

export interface ResearchThreadEvent {
  id: string;
  kind: ResearchThreadEventKind;
  view: ViewMode;
  symbol: string;
  label: string;
  detail: string;
  createdAt: number;
}

const STORAGE_KEY = "limuria-terminal-research-thread-v1";
const EVENT_NAME = "lios:research-thread";
const MAX_EVENTS = 240;
const VISIT_DEDUPE_WINDOW_MS = 15_000;

function id(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSymbol(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase().slice(0, 32);
}

function isEvent(value: unknown): value is ResearchThreadEvent {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ResearchThreadEvent>;
  return typeof item.id === "string" &&
    (item.kind === "visit" || item.kind === "pin" || item.kind === "evidence" || item.kind === "decision" || item.kind === "scene") &&
    typeof item.view === "string" && typeof item.symbol === "string" && typeof item.label === "string" &&
    typeof item.detail === "string" && typeof item.createdAt === "number";
}

export function loadResearchThread(): ResearchThreadEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isEvent).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

function save(events: readonly ResearchThreadEvent[]): void {
  if (typeof window === "undefined") return;
  const normalized = [...events].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_EVENTS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function subscribeResearchThread(listener: (events: ResearchThreadEvent[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent) || !Array.isArray(event.detail)) return;
    listener(event.detail.filter(isEvent));
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

export function appendResearchThreadEvent(input: {
  kind: ResearchThreadEventKind;
  view: ViewMode;
  symbol?: string;
  label?: string;
  detail?: string;
}): ResearchThreadEvent[] {
  const capability = getTerminalCapability(input.view);
  const symbol = capability.symbolAware ? normalizeSymbol(input.symbol) : "";
  const current = loadResearchThread();
  const createdAt = Date.now();
  const label = (input.label ?? (symbol ? `${symbol} · ${capability.label}` : capability.label)).trim().slice(0, 140);
  const detail = (input.detail ?? capability.description).trim().slice(0, 320);

  if (input.kind === "visit") {
    const latest = current[0];
    if (latest && latest.kind === "visit" && latest.view === input.view && latest.symbol === symbol && createdAt - latest.createdAt < VISIT_DEDUPE_WINDOW_MS) return current;
  }

  const next: ResearchThreadEvent[] = [{ id: id(), kind: input.kind, view: input.view, symbol, label, detail, createdAt }, ...current].slice(0, MAX_EVENTS);
  save(next);
  return next;
}

export function recordResearchThreadVisit(view: ViewMode, symbol?: string): ResearchThreadEvent[] {
  return appendResearchThreadEvent({ kind: "visit", view, symbol });
}

export function clearResearchThread(): void {
  save([]);
}

export function groupResearchThreadByDay(events: readonly ResearchThreadEvent[]): Array<{ dateKey: string; label: string; events: ResearchThreadEvent[] }> {
  const groups = new Map<string, ResearchThreadEvent[]>();
  for (const event of events) {
    const date = new Date(event.createdAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(event);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries()).map(([dateKey, bucket]) => ({
    dateKey,
    label: new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    events: bucket,
  }));
}
