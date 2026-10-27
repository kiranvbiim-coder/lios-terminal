import type { ActionInboxItem, PulseEvidence } from "@shared/waveDContracts";

/**
 * Projection of the EXISTING access-controlled Wave D Action Inbox.
 * Never infer a missing alert, silently replace a failed read with "all clear",
 * execute suggested actions, or cache cross-identity content.
 */
export interface ActionInboxReview {
  status: "ready" | "unavailable";
  asOf: string | null;
  items: ActionInboxItem[];
  totalCount: number;
  openCount: number;
  hiddenCount: number;
}

const MAX_RECEIVED = 250;
const MAX_VISIBLE = 40;
const ACTIONS = new Set(["investigate", "recalculate", "update", "dismiss", "snooze", "monitor"]);

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const readable = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const validTime = (value: unknown): value is string =>
  readable(value, 64) && Number.isFinite(Date.parse(value));

/** An unsafe URL is never promoted into a clickable source. */
export function safeInboxEvidenceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function evidenceOf(value: unknown): PulseEvidence | null {
  if (!record(value) || !readable(value.id, 240) || !readable(value.source, 240)) return null;
  if (value.provider !== undefined && typeof value.provider !== "string") return null;
  if (value.snapshotId !== undefined && typeof value.snapshotId !== "string") return null;
  if (value.availableAt !== undefined && !validTime(value.availableAt)) return null;
  return {
    id: value.id,
    source: value.source,
    ...(typeof value.provider === "string" ? { provider: value.provider.slice(0, 120) } : {}),
    ...(typeof value.snapshotId === "string" ? { snapshotId: value.snapshotId.slice(0, 240) } : {}),
    ...(typeof value.availableAt === "string" ? { availableAt: value.availableAt } : {}),
    ...(safeInboxEvidenceUrl(value.url) ? { url: safeInboxEvidenceUrl(value.url)! } : {}),
  };
}

function itemOf(value: unknown): ActionInboxItem | null {
  if (!record(value) || !readable(value.id, 260)
    || !readable(value.sourceCardId, 240) || !readable(value.title, 240)
    || !readable(value.reason, 8_000) || !validTime(value.createdAt)
    || (value.priority !== "critical" && value.priority !== "important")
    || !["open", "snoozed", "resolved"].includes(String(value.status))
    || !Array.isArray(value.suggestedActions) || value.suggestedActions.length > 20
    || !value.suggestedActions.every(action => typeof action === "string" && ACTIONS.has(action))
    || !Array.isArray(value.evidence) || value.evidence.length > 100) return null;
  const evidence = value.evidence.map(evidenceOf);
  if (evidence.some(e => e === null)) return null;
  return {
    id: value.id, sourceCardId: value.sourceCardId, title: value.title, reason: value.reason,
    priority: value.priority as ActionInboxItem["priority"],
    suggestedActions: value.suggestedActions as ActionInboxItem["suggestedActions"],
    createdAt: value.createdAt, status: value.status as ActionInboxItem["status"],
    evidence: evidence as PulseEvidence[],
  };
}

export function parseActionInboxReview(data: unknown): ActionInboxReview {
  const unavailable: ActionInboxReview = { status: "unavailable", asOf: null, items: [], totalCount: 0, openCount: 0, hiddenCount: 0 };
  if (!record(data) || !validTime(data.asOf) || !Array.isArray(data.items) || data.items.length > MAX_RECEIVED
    || (data.status !== "caught_up" && data.status !== "needs_attention")) return unavailable;
  const items = data.items.map(itemOf);
  if (items.some(item => item === null)) return unavailable;
  const ids = items.map(item => item!.id);
  if (new Set(ids).size !== ids.length) return unavailable;
  const typed = items as ActionInboxItem[];
  const openCount = typed.filter(item => item.status === "open").length;
  if ((openCount > 0) !== (data.status === "needs_attention")) return unavailable;
  const sorted = [...typed].sort((a, b) =>
    Number(b.status === "open") - Number(a.status === "open")
    || Number(b.priority === "critical") - Number(a.priority === "critical")
    || Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  return { status: "ready", asOf: data.asOf, items: sorted.slice(0, MAX_VISIBLE),
    totalCount: typed.length, openCount, hiddenCount: Math.max(0, typed.length - MAX_VISIBLE) };
}
