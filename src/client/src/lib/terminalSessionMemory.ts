import { authSessionStateSchema, type AuthSessionState } from "@shared/identityContracts";
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

// Legacy v1 used one shared device-wide key. Never migrate it into an
// authenticated user's history: it has no trustworthy owner evidence.
const LEGACY_STORAGE_KEY = "limuria-terminal-session-memory-v1";
const STORAGE_PREFIX = "limuria-terminal-session-memory-v2.";
const EVENT_NAME = "lios:session-memory";
let activeStorageKey: string | null = null;

/**
 * Called only with the server-restored identity from /api/auth/me.
 * This client storage namespace is a privacy/UX boundary, NOT an authorization
 * mechanism. Protected data must remain server-authoritative.
 */
export function setSessionMemoryOwner(session: AuthSessionState | null): void {
  const parsed = authSessionStateSchema.safeParse(session);
  const state = parsed.success ? parsed.data : null;
  const principal = state && (state.state === "authenticated_online" || state.state === "authenticated_offline")
    ? state.principal : null;
  const next = principal
    ? `${STORAGE_PREFIX}${principal.userId}.${principal.organizationId ?? "internal"}`
    : null;
  if (activeStorageKey === next) return;
  activeStorageKey = next;
  if (typeof window === "undefined") return;
  // Clear unscoped historic data instead of attributing it to the next login.
  // If storage access is blocked, no unscoped data is ever read by this module.
  try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* best effort */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: loadSessionMemory() }));
  } catch { /* failure of a UI listener cannot authorize data access */ }
}

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
  const storageKey = activeStorageKey;
  if (typeof window === "undefined" || !storageKey) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
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
  const storageKey = activeStorageKey;
  if (typeof window !== "undefined" && storageKey) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(result));
      // A reentrant account change must never broadcast an obsolete owner's
      // history to subscribers or claim that it belongs to the new session.
      if (activeStorageKey === storageKey) {
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: result }));
      }
    } catch {
      // Privacy-restricted storage or a full quota must not interrupt the
      // user's analytical action. No persistence/notification is claimed.
    }
  }
  return next;
}

export function clearSessionMemory(): void {
  if (typeof window === "undefined") return;
  const storageKey = activeStorageKey;
  // No current authenticated owner means no saved account history can be
  // selected for deletion; never delete another user's scoped records.
  if (!storageKey) return;
  try {
    localStorage.removeItem(storageKey);
    if (activeStorageKey === storageKey) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: [] }));
    }
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
