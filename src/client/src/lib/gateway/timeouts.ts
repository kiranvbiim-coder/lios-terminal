// Adapted from OpenClaw packages/gateway-client/src/timeouts.ts (MIT, commit c074824a27c96d3983043f9eeb33823cd1772d8c), Copyright (c) 2026 OpenClaw Foundation.

/** Largest delay setTimeout honours; anything bigger fires immediately in browsers. */
export const MAX_TIMER_MS = 2_147_483_647;

/** Clamps a requested delay into a range setTimeout handles safely; non-finite or negative values use the fallback. */
export function clampTimerMs(value: number | null | undefined, fallbackMs: number): number {
  const ms = typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallbackMs;
  return Math.min(Math.max(0, Math.floor(ms)), MAX_TIMER_MS);
}
