export interface CachePolicy {
  freshMs: number;
  staleMs: number;
}

interface Entry<T> {
  value: T;
  freshUntil: number;
  staleUntil: number;
}

export class ProviderResponseCache<T> {
  private readonly values = new Map<string, Entry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(private readonly now: () => number = Date.now) {}

  private async refresh(key: string, policy: CachePolicy, loader: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = loader().then((value) => {
      const at = this.now();
      this.values.set(key, {
        value,
        freshUntil: at + Math.max(0, policy.freshMs),
        staleUntil: at + Math.max(policy.freshMs, policy.staleMs),
      });
      return value;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  async getOrLoad(
    key: string,
    policy: CachePolicy,
    loader: () => Promise<T>,
    options: { staleWhileRevalidate?: boolean } = {},
  ): Promise<T> {
    const current = this.values.get(key);
    const now = this.now();
    if (current && now <= current.freshUntil) return current.value;
    if (current && now <= current.staleUntil && options.staleWhileRevalidate !== false) {
      void this.refresh(key, policy, loader).catch(() => undefined);
      return current.value;
    }
    return this.refresh(key, policy, loader);
  }

  async prefetch(key: string, policy: CachePolicy, loader: () => Promise<T>): Promise<void> {
    const current = this.values.get(key);
    if (current && this.now() <= current.freshUntil) return;
    await this.refresh(key, policy, loader);
  }

  clear(key?: string): void {
    if (key) this.values.delete(key);
    else this.values.clear();
  }

  size(): number { return this.values.size; }
}

export function pointInTimeCachePolicy(mode: "latest" | "as_known_on" | "revision_exact"): CachePolicy {
  if (mode === "revision_exact") return { freshMs: 60 * 60_000, staleMs: 24 * 60 * 60_000 };
  if (mode === "as_known_on") return { freshMs: 5 * 60_000, staleMs: 60 * 60_000 };
  return { freshMs: 15_000, staleMs: 60_000 };
}
