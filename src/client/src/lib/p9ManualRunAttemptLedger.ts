import { authSessionStateSchema, type AuthSessionState } from "@shared/identityContracts";

/**
 * This is a local *reconciliation bookmark*, never an offline execution
 * queue.  Only a previously human-confirmed manual POST uses its stored UUID.
 * Restoring a bookmark can issue GET requests only, never another POST.
 */
export interface P9ManualRunAttempt {
  projectId: number;
  workflowId: string;
  requestKey: string;
  preparedAt: number;
}

export type P9ManualRunReceiptCheck =
  | { state: "completed" | "in_progress"; runId: string }
  | { state: "unconfirmed" | "blocked"; runId: null };

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
const PREFIX = "lios.p9-manual-run-receipt-bookmarks.v1.";
const EVENT_NAME = "lios:p9-manual-receipt-bookmarks";
const WORKFLOW_ID = /^workflow:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 32;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
let ownerKey: string | null = null;
let ownerOnline = false;
let generation = 0;
const inflight = new Map<string, AbortController>();

function keyFor(session: unknown, requireOnline = false): string | null {
  const parsed = authSessionStateSchema.safeParse(session);
  if (!parsed.success) return null;
  if (parsed.data.state !== "authenticated_online"
    && (requireOnline || parsed.data.state !== "authenticated_offline")) return null;
  const principal = parsed.data.principal;
  return principal ? `${PREFIX}${principal.userId}.${principal.organizationId ?? "internal"}` : null;
}

function announce(): void {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new Event(EVENT_NAME)); } catch { /* no persisted-state claims */ }
}

export function setP9ManualRunAttemptOwner(session: AuthSessionState | null): void {
  const next = keyFor(session);
  const online = Boolean(keyFor(session, true));
  if (next === ownerKey && online === ownerOnline) return;
  generation += 1;
  for (const task of inflight.values()) task.abort();
  inflight.clear();
  ownerKey = next;
  ownerOnline = online;
  announce();
}

function valid(entry: unknown, now: number): entry is P9ManualRunAttempt {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const e = entry as Partial<P9ManualRunAttempt>;
  return typeof e.projectId === "number" && Number.isSafeInteger(e.projectId) && e.projectId > 0
    && typeof e.workflowId === "string" && WORKFLOW_ID.test(e.workflowId)
    && typeof e.requestKey === "string" && REQUEST_UUID.test(e.requestKey)
    && typeof e.preparedAt === "number" && Number.isSafeInteger(e.preparedAt)
    && e.preparedAt <= now && now - e.preparedAt <= MAX_AGE_MS;
}

function read(key: string): P9ManualRunAttempt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const now = Date.now();
    return raw.filter((row): row is P9ManualRunAttempt => valid(row, now))
      .filter(row => {
        const id = `${row.projectId}:${row.workflowId}:${row.requestKey}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, MAX_ITEMS);
  } catch { return []; }
}

function write(key: string, items: P9ManualRunAttempt[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (items.length) localStorage.setItem(key, JSON.stringify(items));
    else localStorage.removeItem(key);
    announce();
    return true;
  } catch { return false; }
}

export function listP9ManualRunAttempts(projectId?: number): P9ManualRunAttempt[] {
  const records = ownerKey ? read(ownerKey) : [];
  return projectId === undefined ? records : records.filter(entry => entry.projectId === projectId);
}

/**
 * Persist the exact request key BEFORE the execution POST. If storage is
 * unavailable, the caller MUST NOT submit: it cannot safely reconcile an
 * ambiguous acknowledgement after a process/browser crash.
 */
export function prepareP9ManualRunAttempt(projectId: number, workflowId: string, requestKey: string): boolean {
  const key = ownerKey;
  const now = Date.now();
  const row = { projectId, workflowId, requestKey, preparedAt: now };
  if (!key || !ownerOnline || !valid(row, now)) return false;
  const records = read(key);
  if (records.some(x => x.projectId === projectId && x.workflowId === workflowId && x.requestKey === requestKey)) return true;
  if (records.length >= MAX_ITEMS) return false;
  return write(key, [...records, row]);
}

export function discardP9ManualRunAttempt(projectId: number, workflowId: string, requestKey: string): boolean {
  const key = ownerKey;
  if (!key) return false;
  return write(key, read(key).filter(x =>
    x.projectId !== projectId || x.workflowId !== workflowId || x.requestKey !== requestKey));
}

export function clearP9ManualRunAttempts(): void {
  const key = ownerKey;
  generation += 1;
  for (const task of inflight.values()) task.abort();
  inflight.clear();
  if (key) write(key, []);
}

export function subscribeP9ManualRunAttempts(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

const blocked = (): P9ManualRunReceiptCheck => ({ state: "blocked", runId: null });
const unconfirmed = (): P9ManualRunReceiptCheck => ({ state: "unconfirmed", runId: null });

/**
 * Read-only reconciliation on explicit user request: first an uncached,
 * server-restored identity, then the canonical owner/project-scoped P9 GET.
 * 404 and network ambiguity NEVER authorize an execution retry.
 */
export async function checkP9ManualRunAttempt(
  projectId: number,
  workflowId: string,
  requestKey: string,
  fetcher: FetchLike = fetch,
): Promise<P9ManualRunReceiptCheck> {
  const key = ownerKey;
  const originalGeneration = generation;
  const id = `${projectId}:${workflowId}:${requestKey}`;
  if (!key || !ownerOnline || (typeof navigator !== "undefined" && navigator.onLine === false)
      || inflight.has(id) || !listP9ManualRunAttempts(projectId).some(x =>
        x.workflowId === workflowId && x.requestKey === requestKey)) return blocked();

  const controller = new AbortController();
  inflight.set(id, controller);
  const owned = () => ownerKey === key && ownerOnline && generation === originalGeneration && !controller.signal.aborted;
  try {
    const identity = await fetcher("/api/auth/me", {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
    });
    if (!identity.ok || !owned()) return blocked();
    const identityBody: unknown = await identity.json();
    const state = identityBody && typeof identityBody === "object"
      ? (identityBody as { authState?: unknown }).authState : null;
    if (keyFor(state, true) !== key || !owned()) return blocked();

    const receipt = await fetcher(
      `/api/projects/${projectId}/automation/workflows/${encodeURIComponent(workflowId)}/manual-requests/${encodeURIComponent(requestKey)}`,
      { credentials: "same-origin", cache: "no-store", signal: controller.signal },
    );
    if (!owned()) return blocked();
    if (receipt.status === 404) return unconfirmed();
    if (!receipt.ok) return blocked();
    const response: unknown = await receipt.json();
    if (!owned() || !response || typeof response !== "object") return blocked();
    const { run, receiptStatus } = response as {
      run?: { id?: unknown; projectId?: unknown; workflowId?: unknown };
      receiptStatus?: unknown;
    };
    if (!run || typeof run.id !== "string" || run.projectId !== projectId
        || run.workflowId !== workflowId
        || (receiptStatus !== "in_progress" && receiptStatus !== "completed")) return blocked();
    if (receiptStatus === "completed") {
      // Do not discard a possibly-submitted attempt if removal fails.
      discardP9ManualRunAttempt(projectId, workflowId, requestKey);
    }
    return { state: receiptStatus, runId: run.id };
  } catch {
    return owned() ? unconfirmed() : blocked();
  } finally {
    if (inflight.get(id) === controller) inflight.delete(id);
  }
}
