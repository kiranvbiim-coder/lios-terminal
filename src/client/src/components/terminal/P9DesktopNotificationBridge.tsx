import { useEffect, useState } from "react";
import { getActiveProjectId } from "@/lib/useProjects";
import { useP9Notifications } from "@/lib/useP9Automation";

const ACTIVE_PROJECT_SYNC_MS = 1_000;

/**
 * Headless authenticated bridge for P9 desktop notifications.
 *
 * ProjectExperienceShell owns the canonical same-tab Project selection state,
 * while the selected Project id is persisted for restart/address continuity.
 * A separate useProjectSelection() instance would not observe same-tab setter
 * calls, so this bridge observes that persisted id instead. It never mutates
 * Project selection and React Query still owns the canonical notification
 * fetch/cache through useP9Notifications().
 */
export function P9DesktopNotificationBridge({ enabled }: { enabled: boolean }) {
  const [projectId, setProjectId] = useState<number | null>(() => enabled ? getActiveProjectId() : null);

  useEffect(() => {
    if (!enabled) {
      setProjectId(null);
      return;
    }

    const sync = () => setProjectId((current) => {
      const next = getActiveProjectId();
      return current === next ? current : next;
    });
    sync();
    const interval = window.setInterval(sync, ACTIVE_PROJECT_SYNC_MS);
    window.addEventListener("hashchange", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("storage", sync);
    };
  }, [enabled]);

  useP9Notifications(enabled ? projectId : null);
  return null;
}
