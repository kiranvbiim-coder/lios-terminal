import React, { useState } from "react";
import type { P9NotificationRecord } from "@/lib/useP9Automation";
import {
  projectNotificationHistory,
  type P9NotificationHistoryFilter,
} from "@/lib/p9NotificationHistory";
import {
  p9DesktopPermissionState,
  requestP9DesktopPermissionFromGesture,
  type P9DesktopNotificationPermission,
} from "@/lib/p9DesktopNotifications";

export function P9NotificationHistory({ projectId, notifications, busy, onRead, onRefetch }: {
  projectId: number;
  notifications: readonly P9NotificationRecord[];
  busy: boolean;
  onRead: (notificationId: string) => void;
  onRefetch: () => void;
}) {
  const [filter, setFilter] = useState<P9NotificationHistoryFilter>("all");
  const [desktopPermission, setDesktopPermission] = useState<P9DesktopNotificationPermission>(() => p9DesktopPermissionState());
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const history = projectNotificationHistory(projectId, notifications, filter);

  const requestDesktopPermission = () => {
    if (permissionBusy || desktopPermission !== "default") return;
    // User gesture is essential: do not request permission from useEffect,
    // polling, or React Query automatic refresh.
    setPermissionBusy(true);
    void requestP9DesktopPermissionFromGesture().then(result => {
      setDesktopPermission(result);
      setPermissionMessage(result === "granted"
        ? "OS permission granted. Fresh unread P9 notifications may appear as generic, private desktop banners. The OS does not provide a verified display receipt."
        : result === "denied" ? "Desktop permission denied by the OS. In-app Project history is still available."
          : "Desktop notifications are unavailable on this target. In-app Project history is unaffected.");
      if (result === "granted") onRefetch();
    }).catch(() => {
      setPermissionMessage("Could not confirm desktop permission. No native notification is guaranteed.");
    }).finally(() => setPermissionBusy(false));
  };

  return <section aria-label="Project monitoring notification history" data-testid="p9-notification-history" className="mt-4 border-t border-border/50 pt-3">
    <h3 className="font-ui text-sm font-semibold text-foreground">Notification delivery and history</h3>
    <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
      {history.delivered} in-app delivered · {history.suppressed} suppressed · {history.unread} unread · {history.read} marked read. Counts reflect only the latest loaded notifications for this Project, not all-time history.
    </p>
    <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
      A canonical in-app delivery record is not proof of a desktop popup, external email, or that an underlying workflow executed successfully. Suppressed P9 records are retained for audit but were not displayed as in-app alerts.
    </p>
    <div aria-label="Desktop notification permission" className="mt-2 rounded border border-border/50 p-3 font-ui text-xs text-muted-foreground">
      <p>Desktop OS permission: {desktopPermission === "default" ? "not requested" : desktopPermission === "granted" ? "granted by OS" : desktopPermission === "denied" ? "denied by OS" : "unsupported on this target"}.</p>
      <p>OS lock-screen banners use generic LiOS text; Project titles, financial findings, credentials and evidence remain inside the authenticated app.</p>
      {desktopPermission === "default" && <button type="button" data-testid="p9-desktop-permission-opt-in"
        onClick={requestDesktopPermission} disabled={permissionBusy}
        className="mt-2 min-h-10 rounded border border-border px-3 py-2 text-xs text-foreground disabled:opacity-40">
        Request desktop notifications on this device
      </button>}
      {permissionMessage && <p role="status" className="mt-1 text-amber-200">{permissionMessage}</p>}
    </div>
    <details className="mt-2 rounded border border-border/50 p-3">
      <summary className="cursor-pointer font-ui text-sm">Inspect Project notification records · {notifications.filter(item => item.projectId === projectId).length} loaded</summary>
      <div role="group" aria-label="Filter notification history" className="mt-3 flex flex-wrap gap-2">
        {(["all", "delivered", "suppressed"] as const).map(value =>
          <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}
            className="min-h-10 rounded border border-border px-3 py-2 font-ui text-xs capitalize aria-pressed:border-amber-300/50 aria-pressed:text-amber-200">
            {value}
          </button>)}
      </div>
      {history.items.length === 0
        ? <p role="status" className="mt-2 font-ui text-sm text-muted-foreground">No matching notifications in this Project's currently loaded history.</p>
        : <ol className="mt-2 space-y-2">
          {history.items.slice(0, 20).map(item => <li key={item.id} className="space-y-1 rounded border border-border/50 p-3 font-ui text-xs">
            <div className="font-semibold">{item.reasonLabel}</div>
            <div className="text-muted-foreground">{item.inAppLabel} · {item.readLabel}</div>
            <div className="text-muted-foreground">Relevance score: {item.relevance === null ? "not recorded" : item.relevance.toFixed(2)} · {item.osLabel}</div>
            <details>
              <summary className="cursor-pointer text-muted-foreground">Server record and run identity</summary>
              <dl className="mt-1 break-all font-terminal text-xs text-muted-foreground">
                <div>Notification: {item.id}</div><div>Run: {item.runId}</div><div>Workflow: {item.workflowId}</div><div>Recorded at: {item.createdAt}</div>
              </dl>
            </details>
            {item.status === "delivered" && !item.readAt && <button type="button"
              disabled={busy} onClick={() => onRead(item.id)} className="min-h-10 rounded border border-border px-3 py-2 text-foreground disabled:opacity-40">
              Mark in-app notification read
            </button>}
          </li>)}
        </ol>}
      {history.items.length > 20 && <p className="mt-2 font-ui text-xs text-muted-foreground">Showing the first 20 filtered records; the original P9 history API remains authoritative.</p>}
    </details>
  </section>;
}
