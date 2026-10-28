import { authSessionStateSchema, type AuthSessionState } from "@shared/identityContracts";

/**
 * SI-06.22: the only offline-replayable P9 operation in this module is marking
 * an already delivered notification read. Never persist workflow execution,
 * deletion, approval, credential operations or arbitrary HTTP requests here.
 * Server tenant/ownership checks remain authoritative on every replay.
 */
interface ReadIntent {
  projectId: number;
  notificationId: string;
  queuedAt: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
const PREFIX = "lios.p9-notification-read-outbox.v1.";
const LIMIT = 50;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ID = /^workflow-notification:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let activeKey: string | null = null;
let activeOnline = false;
let generation = 0;
let abortReplay: AbortController | null = null;
let pendingReplay: Promise<ReplayResult> | null = null;

export interface ReplayResult {
  confirmed: number;
  remaining: number;
  blocked: boolean;
}

function keyFor(session: unknown, onlineRequired = false): string | null {
  const parsed = authSessionStateSchema.safeParse(session);
  if (!parsed.success) return null;
  if (parsed.data.state !== "authenticated_online"
    && (onlineRequired || parsed.data.state !== "authenticated_offline")) return null;
  const principal = parsed.data.principal;
  if (!principal) return null;
  return `${PREFIX}${principal.userId}.${principal.organizationId ?? "internal"}`;
}

export function setNotificationReadOutboxOwner(session: AuthSessionState | null): void {
  const next = keyFor(session);
  const nextOnline = Boolean(keyFor(session, true));
  if (activeKey === next && activeOnline === nextOnline) return;
  generation += 1;
  abortReplay?.abort();
  abortReplay = null;
  pendingReplay = null;
  activeKey = next;
  activeOnline = nextOnline;
}

function valid(value: unknown, now: number): value is ReadIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<ReadIntent>;
  return typeof row.projectId === "number" && Number.isSafeInteger(row.projectId) && row.projectId > 0
    && typeof row.notificationId === "string" && ID.test(row.notificationId)
    && typeof row.queuedAt === "number" && Number.isSafeInteger(row.queuedAt)
    && row.queuedAt <= now && now - row.queuedAt <= MAX_AGE_MS;
}

function loadFor(key: string, now = Date.now()): ReadIntent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.filter((item): item is ReadIntent => valid(item, now))
      .filter((item) => {
        const id = `${item.projectId}:${item.notificationId}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, LIMIT);
  } catch {
    return [];
  }
}

function saveFor(key: string, items: ReadIntent[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (items.length) localStorage.setItem(key, JSON.stringify(items));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function pendingNotificationReadCount(): number {
  return activeKey ? loadFor(activeKey).length : 0;
}

/** A queue acknowledgment means device-persisted only, NOT server-confirmed. */
export function queueNotificationRead(projectId: number, notificationId: string): boolean {
  const key = activeKey;
  const now = Date.now();
  if (!key || !valid({ projectId, notificationId, queuedAt: now }, now)) return false;
  const existing = loadFor(key, now);
  if (existing.some((item) => item.projectId === projectId && item.notificationId === notificationId)) return true;
  if (existing.length >= LIMIT) return false;
  return saveFor(key, [...existing, { projectId, notificationId, queuedAt: now }]);
}

export function clearNotificationReadOutbox(): void {
  const key = activeKey;
  if (!key) return;
  generation += 1;
  abortReplay?.abort();
  abortReplay = null;
  pendingReplay = null;
  saveFor(key, []);
}

/**
 * Replay only after a fresh /api/auth/me confirms the SAME server-issued owner.
 * HTTP401/403 and transient/network failures stop replay. Missing/deleted404/410
 * intents remain unconfirmed but do not block independent later items.
 * Server ownership checks remain authoritative on every POST.
 */
export function replayNotificationReads(fetcher: FetchLike = fetch): Promise<ReplayResult> {
  if (pendingReplay) return pendingReplay;
  const key = activeKey;
  const currentGeneration = generation;
  const empty = (): ReplayResult => ({ confirmed: 0, remaining: key ? loadFor(key).length : 0, blocked: true });
  if (!key || !activeOnline || typeof window === "undefined" || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return Promise.resolve(empty());
  }
  const controller = new AbortController();
  abortReplay = controller;
  const work = (async (): Promise<ReplayResult> => {
    let confirmed = 0;
    let blocked = false;
    const owned = () => !controller.signal.aborted && activeKey === key && generation === currentGeneration;
    try {
      const identity = await fetcher("/api/auth/me", { credentials: "same-origin", signal: controller.signal, cache: "no-store" });
      if (!identity.ok || !owned()) return empty();
      const data: unknown = await identity.json();
      const restored = data && typeof data === "object" ? (data as { authState?: unknown }).authState : null;
      if (keyFor(restored, true) !== key || !owned()) return empty();

      for (const intent of loadFor(key)) {
        if (!owned()) return { confirmed, remaining: loadFor(key).length, blocked: true };
        const response = await fetcher(
          `/api/projects/${intent.projectId}/automation/notifications/${encodeURIComponent(intent.notificationId)}/read`,
          { method: "POST", credentials: "same-origin", signal: controller.signal },
        );
        if (!owned()) return { confirmed, remaining: loadFor(key).length, blocked: true };
        if (!response.ok) {
          if (response.status === 404 || response.status === 410) { blocked = true; continue; }
          return { confirmed, remaining: loadFor(key).length, blocked: true };
        }
        const remaining = loadFor(key).filter((row) =>
          row.projectId !== intent.projectId || row.notificationId !== intent.notificationId
        );
        if (!saveFor(key, remaining)) return { confirmed, remaining: loadFor(key).length, blocked: true };
        confirmed += 1;
      }
      return { confirmed, remaining: loadFor(key).length, blocked };
    } catch {
      return { confirmed, remaining: loadFor(key).length, blocked: true };
    }
  })();
  pendingReplay = work;
  void work.finally(() => {
    if (pendingReplay === work) pendingReplay = null;
    if (abortReplay === controller) abortReplay = null;
  });
  return work;
}
