import { authSessionStateSchema, type AuthSessionState } from "@shared/identityContracts";

/**
 * SI-06.22: user-owned offline *drafts* for manual P9 runs.
 * Never replay, run, approve or delete a workflow from this module.
 * The UI must require a fresh, deliberate confirm click after reconnect.
 */
export interface P9ManualRunDraft {
  projectId: number;
  workflowId: string;
  expectedUpdatedAt: string;
  queuedAt: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "json">>;
const PREFIX = "lios.p9-manual-run-draft.v1.";
const EVENT = "lios:p9-manual-run-drafts";
const LIMIT = 16;
const MAX_AGE = 24 * 60 * 60 * 1000;
const WORKFLOW_ID = /^workflow:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let currentKey: string | null = null;
let online = false;
let generation = 0;
const verifying = new Map<string, AbortController>();

function keyFor(session: unknown, onlineOnly = false): string | null {
  const value = authSessionStateSchema.safeParse(session);
  if (!value.success) return null;
  const state = value.data.state;
  if (state !== "authenticated_online" && (onlineOnly || state !== "authenticated_offline")) return null;
  const principal = value.data.principal;
  return principal ? `${PREFIX}${principal.userId}.${principal.organizationId ?? "internal"}` : null;
}

function notify(): void {
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new Event(EVENT)); } catch { /* no claims about device storage */ }
  }
}

export function setP9ManualRunDraftOwner(session: AuthSessionState | null): void {
  const next = keyFor(session);
  const onlineNext = Boolean(keyFor(session, true));
  if (next === currentKey && onlineNext === online) return;
  generation += 1;
  for (const controller of verifying.values()) controller.abort();
  verifying.clear();
  currentKey = next;
  online = onlineNext;
  notify();
}

function isDraft(value: unknown, now: number): value is P9ManualRunDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<P9ManualRunDraft>;
  return typeof row.projectId === "number" && Number.isSafeInteger(row.projectId) && row.projectId > 0
    && typeof row.workflowId === "string" && WORKFLOW_ID.test(row.workflowId)
    && typeof row.expectedUpdatedAt === "string" && Number.isFinite(Date.parse(row.expectedUpdatedAt))
    && typeof row.queuedAt === "number" && Number.isSafeInteger(row.queuedAt)
    && row.queuedAt <= now && now - row.queuedAt <= MAX_AGE;
}

function read(key: string): P9ManualRunDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    const now = Date.now();
    const seen = new Set<string>();
    return value.filter((row): row is P9ManualRunDraft => isDraft(row, now))
      .filter((row) => {
        const unique = `${row.projectId}:${row.workflowId}`;
        if (seen.has(unique)) return false;
        seen.add(unique);
        return true;
      }).slice(0, LIMIT);
  } catch {
    return [];
  }
}

function write(key: string, rows: P9ManualRunDraft[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (rows.length) localStorage.setItem(key, JSON.stringify(rows));
    else localStorage.removeItem(key);
    notify();
    return true;
  } catch {
    return false;
  }
}

export function listP9ManualRunDrafts(projectId?: number): P9ManualRunDraft[] {
  const key = currentKey;
  const rows = key ? read(key) : [];
  return projectId === undefined ? rows : rows.filter((row) => row.projectId === projectId);
}

/** Saved on the current device only. Does not schedule or execute anything. */
export function saveP9ManualRunDraft(projectId: number, workflowId: string, expectedUpdatedAt: string): boolean {
  const key = currentKey;
  const now = Date.now();
  const draft = { projectId, workflowId, expectedUpdatedAt, queuedAt: now };
  if (!key || !isDraft(draft, now)) return false;
  const existing = read(key);
  const without = existing.filter((row) => row.projectId !== projectId || row.workflowId !== workflowId);
  if (without.length >= LIMIT) return false;
  return write(key, [...without, draft]);
}

export function discardP9ManualRunDraft(projectId: number, workflowId: string): boolean {
  const key = currentKey;
  if (!key) return false;
  return write(key, read(key).filter((row) => row.projectId !== projectId || row.workflowId !== workflowId));
}

export function clearP9ManualRunDrafts(): void {
  const key = currentKey;
  generation += 1;
  for (const controller of verifying.values()) controller.abort();
  verifying.clear();
  if (key) write(key, []);
}

export function subscribeP9ManualRunDrafts(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/**
 * Preflight for the user's explicit Confirm action. This checks a fresh
 * server-authenticated principal, the live P9 project workflow list and the
 * saved workflow revision. It then CONSUMES the draft BEFORE the caller may
 * issue ONE normal governed `runP9WorkflowNow` request. If that request has
 * an ambiguous network outcome, it must not be silently retried.
 */
export async function prepareP9ManualRunConfirmation(
  projectId: number,
  workflowId: string,
  fetcher: FetchLike = fetch,
): Promise<boolean> {
  const key = currentKey;
  const nowGeneration = generation;
  const identity = `${projectId}:${workflowId}`;
  if (!key || !online || verifying.has(identity)
      || (typeof navigator !== "undefined" && navigator.onLine === false)) return false;
  const draft = read(key).find((row) => row.projectId === projectId && row.workflowId === workflowId);
  if (!draft) return false;
  const controller = new AbortController();
  verifying.set(identity, controller);
  const stillOwned = () => currentKey === key && online
    && generation === nowGeneration && !controller.signal.aborted;
  try {
    const response = await fetcher("/api/auth/me", {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
    });
    if (!response.ok || !stillOwned()) return false;
    const body: unknown = await response.json();
    const authState = body && typeof body === "object"
      ? (body as { authState?: unknown }).authState : null;
    if (keyFor(authState, true) !== key || !stillOwned()) return false;

    const workflows = await fetcher(`/api/projects/${projectId}/automation/workflows`, {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
    });
    if (!workflows.ok || !stillOwned()) return false;
    const raw: unknown = await workflows.json();
    if (!Array.isArray(raw)) return false;
    const match = raw.find((row) => row && typeof row === "object"
      && (row as { id?: unknown }).id === workflowId
      && (row as { projectId?: unknown }).projectId === projectId
      && (row as { updatedAt?: unknown }).updatedAt === draft.expectedUpdatedAt);
    if (!match || !stillOwned()) return false;
    // Only the same unexpired draft is eligible, not a replacement added
    // while the auth/metadata fetches were pending.
    const latest = read(key).find((row) => row.projectId === projectId && row.workflowId === workflowId);
    if (!latest || latest.queuedAt !== draft.queuedAt
      || latest.expectedUpdatedAt !== draft.expectedUpdatedAt) return false;
    return write(key, read(key).filter((row) => row.projectId !== projectId || row.workflowId !== workflowId));
  } catch {
    return false;
  } finally {
    if (verifying.get(identity) === controller) verifying.delete(identity);
  }
}
