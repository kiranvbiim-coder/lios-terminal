// Adapted from OpenClaw packages/retry/src/index.ts (timing primitives only).
// Upstream: https://github.com/openclaw/openclaw/blob/c074824a27c96d3983043f9eeb33823cd1772d8c/packages/retry/src/index.ts
// Release: v2026.9.7. No runtime dependencies; native timers and AbortSignal only.
// LiOS changes: omit RetrySupervisor/retry runners/config/error conversion; never
// read or propagate AbortSignal.reason; simplify Node timer typing/cleanup.
// L5 idempotency/ledger and the canonical runtime retain retry admission authority.
// Timing does not authorize re-dispatch.
//
// MIT License
// Copyright (c) 2026 OpenClaw Foundation
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const MAX_TIMER_TIMEOUT_MS = 2_147_000_000;

export type BackoffPolicy = {
  initialMs: number;
  maxMs: number;
  factor: number;
  jitter: number;
};

export function computeBackoff(policy: BackoffPolicy, attempt: number): number {
  const base = Math.min(policy.maxMs, policy.initialMs * policy.factor ** Math.max(attempt - 1, 0));
  const jitter = base * policy.jitter * Math.random();
  return Math.min(policy.maxMs, Math.round(base + jitter));
}

export function computeBackoffSchedule(scheduleMs: readonly number[], attempt: number): number {
  const index = Math.min(attempt - 1, scheduleMs.length - 1);
  return attempt <= 0 ? 0 : (scheduleMs[index] ?? 0);
}

export function resolveSleepDelayMs(ms: number): number {
  return Number.isFinite(ms) && ms > 0
    ? Math.min(Math.max(Math.floor(ms), 1), MAX_TIMER_TIMEOUT_MS)
    : 0;
}

export async function sleepWithAbort(
  ms: number,
  abortSignal?: AbortSignal,
  options: { ref?: boolean } = {},
): Promise<void> {
  const delayMs = resolveSleepDelayMs(ms);
  if (delayMs === 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => abortSignal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      timer = undefined;
      cleanup();
      // Cancellation reasons can contain private credentials; never inspect them.
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      settled = true;
      cleanup();
      timer = undefined;
      resolve();
    }, delayMs);
    // A wait may be abortable without keeping an otherwise idle process alive.
    if (options.ref === false) {
      timer.unref?.();
    }
    if (abortSignal?.aborted) {
      onAbort();
    }
  });
}
