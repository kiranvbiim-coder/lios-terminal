import { useOwnedP9Notifications } from "@/lib/useP9Automation";

/** Authenticated owner-wide discovery; the selected Project is not a delivery filter. */
export function P9DesktopNotificationBridge({ enabled }: { enabled: boolean }) {
  useOwnedP9Notifications(enabled);
  return null;
}
