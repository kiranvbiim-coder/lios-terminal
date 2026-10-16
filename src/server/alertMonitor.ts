import { evaluateAlerts } from "./alertsEngine";

interface AlertRecord {
  id: number;
  userId?: number;
  symbol: string;
  condition: string;
  price: number;
  triggered: boolean;
}

interface QuoteRecord {
  symbol: string;
  price: number;
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToBook?: number | null;
  beta?: number | null;
  debtToEquity?: number | null;
  returnOnEquity?: number | null;
  dividendYield?: number | null;
}

interface AlertMonitorDependencies {
  loadAlerts: () => Promise<AlertRecord[]>;
  fetchQuotes: (symbols: string[]) => Promise<QuoteRecord[]>;
  triggerAlert: (id: number, details: { triggerPrice: number; triggeredAt: Date }) => Promise<void>;
  onTriggered?: (details: { id: number; userId?: number; symbol: string; metric: string; triggerPrice: number; triggeredAt: Date }) => Promise<void>;
  now?: () => Date;
}

export async function runAlertEvaluationCycle(deps: AlertMonitorDependencies) {
  const alerts = await deps.loadAlerts();
  const pending = alerts.filter((alert) => !alert.triggered);
  if (!pending.length) return 0;

  const quotes = await deps.fetchQuotes(pending.map((alert) => alert.symbol));
  const triggered = evaluateAlerts(pending, quotes);
  if (!triggered.length) return 0;

  const now = deps.now?.() ?? new Date();
  await Promise.all(triggered.map(async (item) => {
    await deps.triggerAlert(item.id, {
      triggerPrice: item.triggerPrice,
      triggeredAt: now,
    });
    const source = pending.find((alert) => alert.id === item.id);
    await deps.onTriggered?.({
      id: item.id,
      userId: source?.userId,
      symbol: item.symbol,
      metric: item.metric,
      triggerPrice: item.triggerPrice,
      triggeredAt: now,
    });
  }));

  return triggered.length;
}

/**
 * Resilient, non-overlapping polling for the existing alert, decision and
 * ingestion monitors. Failures remain visible via an optional operator-owned
 * reporter; a failed tick must not become an unhandled rejection or prevent
 * future polling. No external action, alert or task is accepted by this helper.
 */
export function createAlertMonitor(
  startCycle: () => Promise<number>,
  intervalMs: number,
  onError?: (error: unknown) => void | Promise<void>,
) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Monitor polling interval must be a positive integer.");
  }
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await startCycle();
    } catch (error) {
      try {
        if (onError) await onError(error);
        else console.warn("LiOS monitoring cycle failed; the next tick will retry.");
      } catch {
        // Never let an operator diagnostics failure crash the monitor loop.
        console.warn("LiOS monitoring error reporter failed; the next tick will retry.");
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
