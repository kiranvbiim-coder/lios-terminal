export type P9DesktopNotificationPermission = "granted" | "denied" | "default" | "unsupported";

export interface CanonicalP9NotificationForDesktop {
  id: string;
  status: "delivered" | "suppressed";
  title: string;
  body: string;
}

export interface P9DesktopNotificationPayload {
  id: string;
  title: string;
  body: string;
}

export interface P9DesktopNotificationPort {
  permission: P9DesktopNotificationPermission;
  hasDelivered(id: string): boolean;
  markDelivered(id: string): void;
  show(notification: P9DesktopNotificationPayload): void | Promise<void>;
}

export interface P9DesktopNotificationDeliveryResult {
  delivered: number;
  duplicate: number;
  suppressed: number;
  unavailable: number;
  failed: number;
}

const DESKTOP_DELIVERY_STORAGE_KEY = "lios.p9.desktop-notifications.v1";
const MAX_PERSISTED_IDS = 2_000;
const CREDENTIAL_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|authorization|cookie|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi;
const OPENAI_STYLE_KEY = /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/gi;

export function sanitizeP9DesktopNotificationText(value: string, maxLength: number): string {
  const normalized = String(value ?? "")
    .replace(CREDENTIAL_ASSIGNMENT, "$1=[REDACTED]")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(OPENAI_STYLE_KEY, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, Math.max(0, maxLength));
}

export async function deliverP9DesktopNotifications(
  notifications: readonly CanonicalP9NotificationForDesktop[],
  port: P9DesktopNotificationPort,
): Promise<P9DesktopNotificationDeliveryResult> {
  const result: P9DesktopNotificationDeliveryResult = {
    delivered: 0,
    duplicate: 0,
    suppressed: 0,
    unavailable: 0,
    failed: 0,
  };

  for (const notification of notifications) {
    if (notification.status !== "delivered") {
      result.suppressed += 1;
      continue;
    }
    if (!notification.id.startsWith("workflow-notification:")) {
      result.failed += 1;
      continue;
    }
    if (port.hasDelivered(notification.id)) {
      result.duplicate += 1;
      continue;
    }
    if (port.permission !== "granted") {
      result.unavailable += 1;
      continue;
    }

    try {
      await port.show({
        id: notification.id,
        title: sanitizeP9DesktopNotificationText(notification.title || "LiOS", 120) || "LiOS",
        body: sanitizeP9DesktopNotificationText(notification.body, 240),
      });
      port.markDelivered(notification.id);
      result.delivered += 1;
    } catch {
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

/**
 * Electron renders the standard Web Notification API as a native desktop
 * notification. Keeping this adapter in the renderer avoids adding a new
 * privileged IPC surface. The canonical P9 notification remains the source
 * of truth; localStorage records only delivery ids for restart-safe dedupe.
 */
export function createBrowserP9DesktopNotificationPort(): P9DesktopNotificationPort {
  if (typeof window === "undefined" || !(window as any).limuriaDesktop?.isElectron || typeof window.Notification === "undefined") {
    return {
      permission: "unsupported",
      hasDelivered: () => false,
      markDelivered: () => undefined,
      show: () => undefined,
    };
  }

  const storage = window.localStorage;
  const deliveredIds = new Set(readDeliveredIds(storage));
  const permission = window.Notification.permission as P9DesktopNotificationPermission;

  return {
    permission,
    hasDelivered: (id) => deliveredIds.has(id),
    markDelivered: (id) => {
      deliveredIds.add(id);
      const values = [...deliveredIds].slice(-MAX_PERSISTED_IDS);
      try {
        storage.setItem(DESKTOP_DELIVERY_STORAGE_KEY, JSON.stringify(values));
      } catch {
        // OS delivery already happened. Storage pressure must not fail P9.
      }
    },
    show: ({ id, title, body }) => {
      new window.Notification(title, { body, tag: id });
    },
  };
}
