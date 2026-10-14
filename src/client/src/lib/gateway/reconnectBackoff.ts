export interface ReconnectBackoffOptions {
  initialMs: number;
  maxMs: number;
  multiplier: number;
  /** Fraction of the delay randomised either way, 0..1. */
  jitter: number;
  random?: () => number;
}

export interface ReconnectBackoff {
  /** Delay before the next attempt; advances the schedule. */
  next(): number;
  reset(): void;
  readonly attempts: number;
}

/** Exponential backoff with symmetric jitter, capped at maxMs. */
export function createReconnectBackoff(options: ReconnectBackoffOptions): ReconnectBackoff {
  const random = options.random ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32);
  let attempts = 0;
  return {
    next() {
      const base = Math.min(options.maxMs, options.initialMs * options.multiplier ** attempts);
      attempts++;
      const factor = 1 + options.jitter * (random() * 2 - 1);
      return Math.min(options.maxMs, Math.max(0, Math.round(base * factor)));
    },
    reset() {
      attempts = 0;
    },
    get attempts() {
      return attempts;
    },
  };
}
