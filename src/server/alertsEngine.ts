export type AlertMetric = "price" | "trailingPE" | "forwardPE" | "priceToBook" | "beta" | "debtToEquity" | "returnOnEquity" | "dividendYield";
export type AlertDirection = "above" | "below";

const ALERT_METRICS = new Set<AlertMetric>(["price", "trailingPE", "forwardPE", "priceToBook", "beta", "debtToEquity", "returnOnEquity", "dividendYield"]);

interface AlertCheck {
  condition: string;
  price: number;
}

interface QuoteCheck {
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

interface StoredAlert extends AlertCheck {
  id: number;
  symbol: string;
  triggered: boolean;
}

export function parseAlertCondition(condition: string): { metric: AlertMetric; direction: AlertDirection } | null {
  if (condition === "above" || condition === "below") return { metric: "price", direction: condition };
  const [metric, direction] = condition.split(":");
  if ((direction !== "above" && direction !== "below") || !ALERT_METRICS.has(metric as AlertMetric)) return null;
  return { metric: metric as AlertMetric, direction };
}

export function alertMetricLabel(condition: string) {
  const parsed = parseAlertCondition(condition);
  if (!parsed) return "Price";
  const labels: Record<AlertMetric, string> = {
    price: "Price",
    trailingPE: "Trailing P/E",
    forwardPE: "Forward P/E",
    priceToBook: "Price/Book",
    beta: "Beta",
    debtToEquity: "Debt/Equity",
    returnOnEquity: "ROE",
    dividendYield: "Dividend Yield",
  };
  return labels[parsed.metric];
}

export function evaluateAlertTrigger(alert: AlertCheck, quote: QuoteCheck) {
  const parsed = parseAlertCondition(alert.condition);
  if (!parsed) return { triggered: false, triggerPrice: null };
  const observed = quote[parsed.metric];
  if (typeof observed !== "number" || !Number.isFinite(observed)) return { triggered: false, triggerPrice: null };
  const triggered = parsed.direction === "above"
    ? observed >= alert.price
    : observed <= alert.price;

  return {
    triggered,
    triggerPrice: triggered ? observed : null,
  };
}

export function evaluateAlerts(alerts: StoredAlert[], quotes: QuoteCheck[]) {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));

  return alerts.flatMap((alert) => {
    if (alert.triggered) return [];
    const quote = quoteBySymbol.get(alert.symbol.toUpperCase());
    if (!quote) return [];

    const result = evaluateAlertTrigger(alert, quote);
    if (!result.triggered || result.triggerPrice === null) return [];

    return [{
      id: alert.id,
      symbol: alert.symbol,
      triggerPrice: result.triggerPrice,
      metric: parseAlertCondition(alert.condition)?.metric ?? "price",
    }];
  });
}
