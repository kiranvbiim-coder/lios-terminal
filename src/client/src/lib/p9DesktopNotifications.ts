export type P9DesktopNotificationPermission = "granted" | "denied" | "default" | "unsupported";
export type P9DesktopDeliveryClaim = "claimed" | "duplicate" | "unavailable";

export interface CanonicalP9NotificationForDesktop {
  id: string;
  status: "delivered" | "suppressed";
  title: string;
  body: string;
  createdAt: string;
}

export interface P9DesktopNotificationPayload {
  id: string;
  title: string;
  body: string;
}

export interface P9DesktopNotificationPort {
  permission: P9DesktopNotificationPermission;
  requestPermission?(): Promise<P9DesktopNotificationPermission>;
  claimDelivery(id: string): P9DesktopDeliveryClaim;
  show(notification: P9DesktopNotificationPayload): void | Promise<void>;
}

export interface P9DesktopNotificationDeliveryResult {
  delivered: number;
  duplicate: number;
  baselined: number;
  suppressed: number;
  unavailable: number;
  failed: number;
}

export interface P9DesktopNotificationDeliveryOptions {
  now?: Date;
  freshnessMs?: number;
}

const DESKTOP_DELIVERY_STORAGE_KEY = "lios.p9.desktop-notifications.v1";
const MAX_PERSISTED_IDS = 2_000;
const DEFAULT_FRESHNESS_MS = 5 * 60_000;
const DESKTOP_TITLE_MAX_BYTES = 72;
const DESKTOP_BODY_MAX_BYTES = 160;
const CREDENTIAL_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|authorization|cookie|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi;
const OPENAI_STYLE_KEY = /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/gi;
const UTF8 = new TextEncoder();

function sliceUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (UTF8.encode(value).byteLength <= maxBytes) return value;
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const size = UTF8.encode(character).byteLength;
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function sanitizeP9DesktopNotificationText(value: string, maxBytes: number): string {
  const normalized = String(value ?? "")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(OPENAI_STYLE_KEY, "[REDACTED]")
    .replace(CREDENTIAL_ASSIGNMENT, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return sliceUtf8(normalized, Math.max(0, maxBytes));
}

function isFreshNotification(
  createdAt: string,
  now: Date,
  freshnessMs: number,
): boolean {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return false;
  const ageMs = now.getTime() - createdAtMs;
  return ageMs >= 0 && ageMs <= freshnessMs;
}

async function resolvePermission(port: P9DesktopNotificationPort): Promise<P9DesktopNotificationPermission> {
  if (port.permission !== "default") return port.permission;
  if (!port.requestPermission) return "unsupported";
  try {
    return await port.requestPermission();
  } catch {
    return "unsupported";
  }
}

export async function deliverP9DesktopNotifications(
  notifications: readonly CanonicalP9NotificationForDesktop[],
  port: P9DesktopNotificationPort,
  options: P9DesktopNotificationDeliveryOptions = {},
): Promise<P9DesktopNotificationDeliveryResult> {
  const result: P9DesktopNotificationDeliveryResult = {
    delivered: 0,
    duplicate: 0,
    baselined: 0,
    suppressed: 0,
    unavailable: 0,
    failed: 0,
  };
  const now = options.now ?? new Date();
  const freshnessMs = Math.max(0, options.freshnessMs ?? DEFAULT_FRESHNESS_MS);
  let resolvedPermission: P9DesktopNotificationPermission | null = null;

  for (const notification of notifications) {
    if (notification.status !== "delivered") {
      result.suppressed += 1;
      continue;
    }
    if (!notification.id.startsWith("workflow-notification:")) {
      result.failed += 1;
      continue;
    }

    // Old in-app history is canonical and should remain visible inside LiOS,
    // but replaying it as an OS notification after an upgrade/start would
    // create a noisy notification storm. Persist the canonical ids as a local
    // baseline without showing them. Invalid/future timestamps also fail
    // closed into this non-show path.
    if (!isFreshNotification(notification.createdAt, now, freshnessMs)) {
      const claim = port.claimDelivery(notification.id);
      if (claim === "duplicate") result.duplicate += 1;
      else if (claim === "unavailable") result.unavailable += 1;
      else result.baselined += 1;
      continue;
    }

    // Resolve Chromium/Electron's default notification permission before the
    // durable delivery claim. A denied request therefore leaves the canonical
    // id unclaimed and still available inside LiOS rather than pretending an
    // OS alert was attempted.
    if (resolvedPermission === null) resolvedPermission = await resolvePermission(port);
    if (resolvedPermission !== "granted") {
      result.unavailable += 1;
      continue;
    }

    const claim = port.claimDelivery(notification.id);
    if (claim === "duplicate") {
      result.duplicate += 1;
      continue;
    }
    if (claim === "unavailable") {
      result.unavailable += 1;
      continue;
    }

    try {
      await port.show({
        id: notification.id,
        title: sanitizeP9DesktopNotificationText(notification.title || "LiOS", DESKTOP_TITLE_MAX_BYTES) || "LiOS",
        body: sanitizeP9DesktopNotificationText(notification.body, DESKTOP_BODY_MAX_BYTES),
      });
      result.delivered += 1;
    } catch {
      // The durable claim intentionally remains. Retrying the same canonical
      // id after a renderer/app restart could otherwise create duplicate
      // user-visible alerts if the platform threw after partially delivering.
      result.failed += 1;
    }
  }

  return result;
}

function readDeliveredIds(storage: Storage): string[] {
  try {
    const parsed = JSON.parse(storage.getItem(DESKTOP_DELIVERY_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string" && value.startsWith("workflow-notification:"))
      .slice(-MAX_PERSISTED_IDS);
  } catch {
    return [];
  }
}

function unsupportedPort(): P9DesktopNotificationPort {
  return {
    permission: "unsupported",
    claimDelivery: () => "unavailable",
    show: () => undefined,
  };
}

/**
 * Electron renders the standard Web Notification API as a native desktop
 * notification. Keeping this adapter in the renderer avoids adding a new
 * privileged IPC surface. The canonical P9 notification remains the source
 * of truth; localStorage records only delivery ids for restart-safe dedupe.
 */
export function createBrowserP9DesktopNotificationPort(): P9DesktopNotificationPort {
  if (typeof window === "undefined" || !(window as any).limuriaDesktop?.isElectron || typeof window.Notification === "undefined") {
    return unsupportedPort();
  }

  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return unsupportedPort();
  }
  const deliveredIds = new Set(readDeliveredIds(storage));
  const permission = window.Notification.permission as P9DesktopNotificationPermission;

  return {
    permission,
    requestPermission: async () => window.Notification.requestPermission() as Promise<P9DesktopNotificationPermission>,
    claimDelivery: (id) => {
      if (deliveredIds.has(id)) return "duplicate";
      deliveredIds.add(id);
      const values = [...deliveredIds].slice(-MAX_PERSISTED_IDS);
      try {
        storage.setItem(DESKTOP_DELIVERY_STORAGE_KEY, JSON.stringify(values));
        return "claimed";
      } catch {
        deliveredIds.delete(id);
        return "unavailable";
      }
    },
    show: ({ id, title, body }) => {
      new window.Notification(title, { body, tag: id });
    },
  };
}
