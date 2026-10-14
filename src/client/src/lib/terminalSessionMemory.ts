import type { ViewMode, WorkspaceState } from "./terminalTypes";

export interface SessionMemoryEntry {
  id: string;
  title: string;
  symbol: string;
  view: ViewMode;
  workspace: WorkspaceState;
  startedAt: number;
  lastActiveAt: number;
  visitCount: number;
}

const STORAGE_KEY = "limuria-terminal-session-memory-v1";
const EVENT_NAME = "lios:session-memory";

function id(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function loadSessionMemory(): SessionMemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as SessionMemoryEntry[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 40) : [];
  } catch { return []; }
}

export function rememberAnalyticalSession(input: { title: string; symbol?: string; view: ViewMode; workspace: WorkspaceState }): SessionMemoryEntry {
  const all = loadSessionMemory();
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  const existing = all.find((item) => item.view === input.view && item.symbol === symbol);
  const now = Date.now();
  const next: SessionMemoryEntry = existing
    ? { ...existing, title: input.title.trim().slice(0, 120) || existing.title, workspace: clone(input.workspace), lastActiveAt: now, visitCount: existing.visitCount + 1 }
    : { id: id(), title: input.title.trim().slice(0, 120), symbol, view: input.view, workspace: clone(input.workspace), startedAt: now, lastActiveAt: now, visitCount: 1 };
  const result = [next, ...all.filter((item) => item.id !== next.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 40);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: result }));
  }
  return next;
}

export function clearSessionMemory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: [] }));
}

export function subscribeSessionMemory(listener: (items: SessionMemoryEntry[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(loadSessionMemory());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
