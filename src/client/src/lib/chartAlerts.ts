export type ChartAlertOperator = "above" | "below";

export interface ChartAlert {
  id: string;
  symbol: string;
  operator: ChartAlertOperator;
  price: number;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
}

const KEY = "lios:chart-alerts-v1";

function normalize(alert: ChartAlert): ChartAlert {
  return { ...alert, symbol: alert.symbol.trim().toUpperCase(), price: Number(alert.price) };
}

export function loadChartAlerts(): ChartAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as ChartAlert[];
    return Array.isArray(parsed) ? parsed.filter(alert => alert && typeof alert.id === "string" && typeof alert.symbol === "string" && (alert.operator === "above" || alert.operator === "below") && Number.isFinite(alert.price)).map(normalize) : [];
  } catch { return []; }
}

export function saveChartAlerts(alerts: readonly ChartAlert[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(alerts.map(normalize).slice(0, 200)));
}

export function chartAlertTriggered(alert: Pick<ChartAlert, "operator" | "price" | "enabled">, currentPrice: number): boolean {
  if (!alert.enabled || !Number.isFinite(currentPrice) || !Number.isFinite(alert.price)) return false;
  return alert.operator === "above" ? currentPrice >= alert.price : currentPrice <= alert.price;
}
