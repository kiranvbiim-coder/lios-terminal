// Written for LiOS, GM-10a. Replaces the private OpenClaw workspace package @openclaw/normalization-core
// (not on npm) with only the helpers the supervisor and decoded-output call sites use.

const MAX_TIMER_TIMEOUT_MS = 2_147_483_647;

/** Floor a delay to an integer, never below minMs and never above Node's timer cap. */
export function resolveTimerTimeoutMs(value: number, minMs: number): number {
  const floored = Number.isFinite(value) ? Math.floor(value) : minMs;
  return Math.min(MAX_TIMER_TIMEOUT_MS, Math.max(minMs, floored));
}

/** Trimmed string, or undefined when the input is not a string or is blank. */
export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** String.prototype.slice that never leaves a lone surrogate at either cut. */
export function sliceUtf16Safe(value: string, start: number, end?: number): string {
  const length = value.length;
  const from = start < 0 ? Math.max(0, length + start) : Math.min(start, length);
  const to = end === undefined ? length : end < 0 ? Math.max(0, length + end) : Math.min(end, length);
  let lo = from;
  let hi = to;
  if (lo < hi && lo > 0 && isLowSurrogate(value.charCodeAt(lo)) && isHighSurrogate(value.charCodeAt(lo - 1))) {
    lo += 1;
  }
  if (lo < hi && hi < length && isHighSurrogate(value.charCodeAt(hi - 1)) && isLowSurrogate(value.charCodeAt(hi))) {
    hi -= 1;
  }
  return lo < hi ? value.slice(lo, hi) : "";
}

/** Coerce any thrown value to an Error, preserving Error instances. */
export function toErrorObject(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" && error ? error : fallbackMessage, { cause: error });
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
