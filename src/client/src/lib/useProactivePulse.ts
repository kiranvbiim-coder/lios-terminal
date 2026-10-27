import { useCallback, useEffect, useState } from "react";
import { parseActionInboxReview, type ActionInboxReview } from "./actionInboxReview";

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
  const review = parseActionInboxReview(data);
  return review.status === "ready" ? { count: review.openCount, status: "ready" }
    : { count: 0, status: "unavailable" };
}

/** Both ambient and detailed review now share one source-validated polling policy. */
export function useProactivePulse(enabled: boolean): ProactivePulseState {
  const { result } = useProactiveInboxReview(enabled);
  return result.state === "ready" ? { count: result.review.openCount, status: "ready" }
    : { count: 0, status: result.state === "unavailable" || result.state === "not_authorized" ? "unavailable" : "loading" };
}

/**
 * Phase 3 review of the SAME Wave D Action Inbox. Fetch only after a foreground
 * opt-in, pause on hidden tabs, abort when closed, and never write alerts to
 * another cache or initiate the suggested (potentially consequential) actions.
 */
export type ProactiveInboxReviewState =
  | { state: "idle" | "loading"; review: null }
  | { state: "ready"; review: ActionInboxReview }
  | { state: "unavailable" | "not_authorized"; review: null };

/**
 * The same server endpoint and parser power passive checks and explicit
 * user-clicked revalidation. Denial is not "zero alerts"; no retry or action
 * submission happens here.
 */
export async function readEntitledActionInbox(signal: AbortSignal): Promise<ProactiveInboxReviewState> {
  const response = await fetch("/api/wave-d/action-inbox", {
    method: "GET", credentials: "same-origin", cache: "no-store", signal,
  });
  if (!response.ok) {
    return { state: response.status === 401 || response.status === 403
      ? "not_authorized" : "unavailable", review: null };
  }
  const parsed = parseActionInboxReview(await response.json() as unknown);
  return parsed.status === "ready" ? { state: "ready", review: parsed }
    : { state: "unavailable", review: null };
}

export function useProactiveInboxReview(enabled: boolean): {
  result: ProactiveInboxReviewState;
  refresh: () => void;
} {
  const [result, setResult] = useState<ProactiveInboxReviewState>({ state: "idle", review: null });
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration(n => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setResult({ state: "idle", review: null });
      return;
    }
    const controller = new AbortController();
    let current = true;
    let pending = false;

    const load = async () => {
      if (!current || controller.signal.aborted || pending || document.visibilityState === "hidden") return;
      pending = true;
      setResult({ state: "loading", review: null });
      try {
        const next = await readEntitledActionInbox(controller.signal);
        if (!current || controller.signal.aborted) return;
        setResult(next);
      } catch {
        if (current && !controller.signal.aborted) setResult({ state: "unavailable", review: null });
      } finally {
        pending = false;
      }
    };

    const visibilityChanged = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visibilityChanged);
    void load();
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      current = false;
      controller.abort();
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.clearInterval(interval);
    };
  }, [enabled, generation]);

  return { result, refresh };
}
