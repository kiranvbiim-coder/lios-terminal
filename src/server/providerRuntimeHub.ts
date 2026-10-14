export interface ProviderCacheEntry<T> {
  value: T;
  expiresAt: number;
  touchedAt: number;
}
export interface ProviderRuntimeHubOptions {
  maxEntries?: number;
  now?: () => number;
}
/**
 * Provider-neutral cache/prefetch/stream coordination. LiOS owns this state;
 * provider and donor runtimes remain replaceable implementation details.
 */
export class ProviderRuntimeHub<T> {
  private readonly cache = new Map<string, ProviderCacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly listeners = new Map<string, Set<(value: T) => void>>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  constructor(options: ProviderRuntimeHubOptions = {}) {
    this.maxEntries = Math.max(16, options.maxEntries ?? 500);
    this.now = options.now ?? Date.now;
  }
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(key);
      return null;
    }
    entry.touchedAt = this.now();
    return entry.value;
  }
  set(key: string, value: T, ttlMs: number): T {
    const now = this.now();
    this.cache.set(key, { value, expiresAt: now + Math.max(1, ttlMs), touchedAt: now });
    this.evict();
    return value;
  }
  async getOrFetch(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = fetcher()
      .then((value) => this.set(key, value, ttlMs))
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }
  async prefetch(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<void> {
    await this.getOrFetch(key, ttlMs, fetcher);
  }
  publish(channel: string, value: T): void {
    for (const listener of this.listeners.get(channel) ?? []) listener(value);
  }
  subscribe(channel: string, listener: (value: T) => void): () => void {
    const set = this.listeners.get(channel) ?? new Set<(value: T) => void>();
    set.add(listener);
    this.listeners.set(channel, set);
    return () => {
      const current = this.listeners.get(channel);
      current?.delete(listener);
      if (current?.size === 0) this.listeners.delete(channel);
    };
  }
  stats() {
    return { cacheEntries: this.cache.size, inFlight: this.inFlight.size, streamChannels: this.listeners.size };
  }
  private evict(): void {
    if (this.cache.size <= this.maxEntries) return;
    const victims = [...this.cache.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    for (let i = 0; i < victims.length && this.cache.size > this.maxEntries; i += 1) this.cache.delete(victims[i][0]);
  }
}
