export type CacheLike<T> = {
  get(key: string): { expiresAt: number; value: T } | undefined;
  set(key: string, entry: { expiresAt: number; value: T }): void;
  delete(key: string): void;
};

export function getCached<T>(cache: CacheLike<T>, key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function setCached<T>(cache: CacheLike<T>, key: string, value: T, ttlMs: number): T {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

// Rotate browser UA strings to avoid rate-limiting
const UA_POOL = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];
let _uaIdx = 0;
function nextUA() { return UA_POOL[(_uaIdx++) % UA_POOL.length]; }

// Status codes worth retrying — transient upstream/rate-limit conditions.
// Anything else (400/401/403/404/etc.) fails fast so fallback chains kick in
// immediately instead of burning the retry budget on a request that will
// never succeed.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch with exponential backoff + jitter on transient failures (429/5xx/timeout).
 * Caps at `maxAttempts` tries so a persistently-down upstream still fails within
 * a bounded time and lets the caller's own fallback chain (e.g. Yahoo -> Stooq)
 * take over rather than hanging indefinitely.
 */
export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxAttempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timer);
      if (response.ok) return response;
      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts - 1) {
        throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
      }
      lastError = new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt === maxAttempts - 1) throw err;
    }
    const backoffMs = Math.min(300 * 3 ** attempt, 4000) + Math.random() * 200;
    await sleep(backoffMs);
  }
  throw lastError;
}

// In-flight dedup map for text fetches
const _textInflight = new Map<string, Promise<string>>();

export async function fetchText(url: string): Promise<string> {
  const existing = _textInflight.get(url);
  if (existing) return existing;

  const promise = fetchWithRetry(url, {
    "User-Agent": nextUA(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,text/csv,application/rss+xml,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
  })
    .then((response) => response.text())
    .finally(() => {
      _textInflight.delete(url);
    });

  _textInflight.set(url, promise);
  return promise;
}
