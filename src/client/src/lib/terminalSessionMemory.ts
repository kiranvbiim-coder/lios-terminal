import type { ViewMode, WorkspaceState } from "./terminalTypes";
import { isRegisteredView } from "./featureRegistry";
import { getWorkspacePanes, isWorkspaceState } from "./terminalWorkspace";

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

/** Browser storage is mutable/untrusted. Reject corrupt history before it
 * enters the workspace resume UI or changes visit-count arithmetic. */
function isSessionMemoryEntry(value: unknown): value is SessionMemoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<SessionMemoryEntry>;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 160
    && typeof item.title === "string" && item.title.length <= 120
    && typeof item.symbol === "string" && item.symbol.length <= 80
    && typeof item.view === "string" && isRegisteredView(item.view)
    && isWorkspaceState(item.workspace)
    && getWorkspacePanes(item.workspace).every(({ pane }) => isRegisteredView(pane.view))
    && typeof item.startedAt === "number" && Number.isSafeInteger(item.startedAt) && item.startedAt >= 0
    && typeof item.lastActiveAt === "number" && Number.isSafeInteger(item.lastActiveAt) && item.lastActiveAt >= item.startedAt
    && typeof item.visitCount === "number" && Number.isSafeInteger(item.visitCount) && item.visitCount > 0;
}

export function loadSessionMemory(): SessionMemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSessionMemoryEntry)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 40);
  } catch { return []; }
}

export function rememberAnalyticalSession(input: { title: string; symbol?: string; view: ViewMode; workspace: WorkspaceState }): SessionMemoryEntry {
  const all = loadSessionMemory();
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  const existing = all.find((item) => item.view === input.view && item.symbol === symbol);
  const now = Date.now();
  const next: SessionMemoryEntry = existing
    ? { ...existing, title: input.title.trim().slice(0, 120) || existing.title, workspace: clone(input.workspace), lastActiveAt: now, visitCount: Math.min(Number.MAX_SAFE_INTEGER, existing.visitCount + 1) }
    : { id: id(), title: input.title.trim().slice(0, 120), symbol, view: input.view, workspace: clone(input.workspace), startedAt: now, lastActiveAt: now, visitCount: 1 };
  const result = [next, ...all.filter((item) => item.id !== next.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 40);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: result }));
    } catch {
      // Privacy-restricted storage or a full quota must not interrupt the
      // user's analytical action. No persistence/notification is claimed.
    }
  }
  return next;
}

export function clearSessionMemory(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: [] }));
  } catch {
    // Do not announce a successful clear if the browser refused the mutation.
  }
}

export function subscribeSessionMemory(listener: (items: SessionMemoryEntry[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(loadSessionMemory());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
