import { isObservedQuote } from "./quoteObservation";
import { queryClient } from "./queryClient";
type PrefetchTask = {
  id: string;
  queryKey: readonly unknown[];
  url: string;
  transform?: (payload: unknown) => unknown;
  staleTime?: number;
};

const WARM_TTL_MS = 60_000;
const MAX_INFLIGHT = 3;
const warmed = new Map<string, number>();
const queue: PrefetchTask[] = [];
let inflight = 0;

function task(queryKey: readonly unknown[], url: string, transform?: PrefetchTask["transform"], staleTime = 30_000): PrefetchTask {
  return { id: JSON.stringify(queryKey), queryKey, url, transform, staleTime };
}

function quoteTask(symbol: string): PrefetchTask {
  const normalized = symbol.trim().toUpperCase();
  return task(
    ["/api/finance/quote", normalized],
    `/api/finance/quotes?symbols=${encodeURIComponent(normalized)}`,
    (payload) => { const quote = Array.isArray(payload) ? payload[0] : payload; return isObservedQuote(quote) ? quote : null; },
    8_000,
  );
}

function newsTask(symbol?: string): PrefetchTask {
  const normalized = symbol?.trim().toUpperCase();
  return task(
    ["/api/finance/news", normalized || "market", ""],
    normalized ? `/api/finance/news?symbol=${encodeURIComponent(normalized)}` : "/api/finance/news",
    undefined,
    55_000,
  );
}

function fundamentalsTask(symbol: string): PrefetchTask {
  const normalized = symbol.trim().toUpperCase();
  return task(
    ["/api/finance/fundamentals", normalized],
    `/api/finance/fundamentals?symbol=${encodeURIComponent(normalized)}`,
    (payload) => payload && typeof payload === "object" && "error" in payload ? null : payload,
    60 * 60_000,
  );
}

function ohlcvTask(symbol: string): PrefetchTask {
  const normalized = symbol.trim().toUpperCase();
  return task(
    ["/api/finance/ohlcv", normalized, "1Y", "1d"],
    `/api/finance/ohlcv?symbol=${encodeURIComponent(normalized)}&range=1Y&interval=1d`,
    undefined,
    60_000,
  );
}

function lseCompanyTasks(symbol: string): PrefetchTask[] {
  const normalized = symbol.trim().toUpperCase();
  const financial = (reportType: "income" | "balance" | "cashflow") => task(
    ["/api/lse/financials", normalized, reportType, "FY"],
    `/api/lse/financials/${encodeURIComponent(normalized)}?reportType=${reportType}&period=FY`,
  );
  return [
    task(["/api/lse/status"], "/api/lse/status", undefined, 5 * 60_000),
    task(["/api/lse/company", normalized], `/api/lse/company/${encodeURIComponent(normalized)}`),
    financial("income"),
    financial("balance"),
    financial("cashflow"),
    task(["/api/lse/dividends", normalized], `/api/lse/dividends/${encodeURIComponent(normalized)}`),
    task(["/api/lse/splits", normalized], `/api/lse/splits/${encodeURIComponent(normalized)}`),
  ];
}

const BASE_PREFETCH_PLAN: Record<string, () => PrefetchTask[]> = {
  market: () => [
    newsTask(),
    task(["/api/finance/gainers", undefined], "/api/finance/gainers", undefined, 25_000),
    task(["/api/finance/losers", undefined], "/api/finance/losers", undefined, 25_000),
    task(["/api/finance/breadth"], "/api/finance/breadth", undefined, 5 * 60_000),
    task(["/api/finance/sentiment"], "/api/finance/sentiment", undefined, 25_000),
  ],
  news: () => [newsTask(), task(["/api/finance/sentiment"], "/api/finance/sentiment", undefined, 25_000)],
  economics: () => [task(["/api/economics/indicators"], "/api/economics/indicators", undefined, 30_000)],
  macrodashboard: () => [
    task(["/api/economics/indicators"], "/api/economics/indicators", undefined, 30_000),
    task(["/api/fred/yieldcurve", "live"], "/api/fred/yieldcurve", undefined, 30_000),
  ],
  portfolio: () => [quoteTask("SPY")],
  companyfundamentals: () => [task(["/api/lse/status"], "/api/lse/status", undefined, 5 * 60_000)],
  screener: () => [
    task(["/api/finance/sentiment"], "/api/finance/sentiment", undefined, 25_000),
    task(["/api/finance/breadth"], "/api/finance/breadth", undefined, 5 * 60_000),
  ],
  alerts: () => [task(["/api/finance/sentiment"], "/api/finance/sentiment", undefined, 25_000)],
};

function canUseNetworkPrefetch(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!navigator.onLine) return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData) return false;
  return connection?.effectiveType !== "slow-2g";
}

function recentlyWarmed(id: string, now = Date.now()): boolean {
  const last = warmed.get(id);
  return typeof last === "number" && now - last < WARM_TTL_MS;
}

async function fetchTaskPayload(item: PrefetchTask): Promise<unknown> {
  const response = await fetch(item.url, { method: "GET", credentials: "same-origin" });
  if (!response.ok) throw new Error(`Prefetch failed with ${response.status}`);
  const payload: unknown = await response.json();
  return item.transform ? item.transform(payload) : payload;
}

async function warmTask(item: PrefetchTask): Promise<void> {
  if (recentlyWarmed(item.id) || !canUseNetworkPrefetch()) return;
  warmed.set(item.id, Date.now());
  try {
    // The current LiOS service worker intentionally self-retires. Warm the
    // actual TanStack Query cache so navigation benefits even when HTTP cache
    // headers are conservative and there is no active service worker.
    await queryClient.prefetchQuery({
      queryKey: item.queryKey,
      queryFn: () => fetchTaskPayload(item),
      staleTime: item.staleTime ?? 30_000,
    });
  } catch {
    warmed.delete(item.id);
  }
}

function drainQueue(): void {
  while (inflight < MAX_INFLIGHT && queue.length) {
    const item = queue.shift()!;
    inflight += 1;
    void warmTask(item).finally(() => {
      inflight -= 1;
      drainQueue();
    });
  }
}

function scheduleTasks(tasks: readonly PrefetchTask[]): void {
  for (const item of tasks) {
    if (recentlyWarmed(item.id) || queue.some((queued) => queued.id === item.id)) continue;
    queue.push(item);
  }
  if (!queue.length || typeof window === "undefined") return;
  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (callback: () => void, options?: { timeout: number }) => number })
      .requestIdleCallback(drainQueue, { timeout: 350 });
  } else {
    setTimeout(drainQueue, 0);
  }
}

function buildPrefetchPlan(view: string, symbol?: string): PrefetchTask[] {
  const plan = BASE_PREFETCH_PLAN[view]?.() ?? [];
  const normalized = symbol?.trim().toUpperCase();
  if (!normalized) return plan;

  if (view === "quote") plan.unshift(quoteTask(normalized), newsTask(normalized));
  if (view === "entity") plan.unshift(quoteTask(normalized), fundamentalsTask(normalized), newsTask(normalized));
  if (view === "chart") plan.unshift(quoteTask(normalized), ohlcvTask(normalized));
  if (view === "news") plan.unshift(newsTask(normalized));
  if (view === "companyfundamentals") plan.unshift(...lseCompanyTasks(normalized));

  const seen = new Set<string>();
  return plan.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function getPanelPrefetchUrls(currentView: string): string[] {
  return buildPrefetchPlan(currentView).map((item) => item.url);
}

export function getPrefetchPlanForTests(view: string, symbol?: string): Array<{ queryKey: readonly unknown[]; url: string }> {
  return buildPrefetchPlan(view, symbol).map(({ queryKey, url }) => ({ queryKey, url }));
}

export function prefetchPanelData(currentView: string): void {
  scheduleTasks(buildPrefetchPlan(currentView));
}

export function prefetchLikelyDestination(view: string, symbol?: string): void {
  scheduleTasks(buildPrefetchPlan(view, symbol));
}

export function clearPrefetchMemoryForTests(): void {
  warmed.clear();
  queue.splice(0, queue.length);
  inflight = 0;
}
