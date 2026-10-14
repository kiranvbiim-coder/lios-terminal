import { useEffect, useState } from "react";

/**
 * Opt-in ambient signal for the "LiOS Power" clean landing (and any other
 * surface that wants it): polls the existing Wave D Action Inbox
 * (LIOS_MASTER_PLAN.md continuous-intelligence concept, already backed by
 * real routes/data in server/waveDRoutes.ts -- this hook adds no new
 * backend, it only makes the existing signal visible outside the dense
 * Workbench/Pulse surfaces).
 *
 * Deliberately does nothing when `enabled` is false: LIOS-P9-09 requires a
 * relevance/threshold policy so automation does not become noisy, and the
 * simplest such policy is "the user must opt in before LiOS proactively
 * surfaces anything at all".
 */
export interface ProactivePulseState {
  count: number;
  status: "loading" | "ready" | "unavailable";
}

const POLL_INTERVAL_MS = 60_000;

/** Pure so it can be tested without mocking fetch/timers -- see useProactivePulse.test.ts. */
export function parseActionInboxResponse(data: unknown): ProactivePulseState {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { count: 0, status: "unavailable" };
  const items = (data as { items?: unknown }).items;
  return { count: Array.isArray(items) ? items.length : 0, status: "ready" };
}

export function useProactivePulse(enabled: boolean): ProactivePulseState {
  const [state, setState] = useState<ProactivePulseState>({ count: 0, status: "loading" });

  useEffect(() => {
    if (!enabled) {
      setState({ count: 0, status: "loading" });
      return;
    }
    let cancelled = false;
    const load = () => {
      fetch("/api/wave-d/action-inbox")
        .then((response) => (response.ok ? response.json() : null))
        .then((data: unknown) => {
          if (cancelled) return;
          setState(parseActionInboxResponse(data));
        })
        .catch(() => {
          if (!cancelled) setState({ count: 0, status: "unavailable" });
        });
    };
    load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled]);

  return state;
}
