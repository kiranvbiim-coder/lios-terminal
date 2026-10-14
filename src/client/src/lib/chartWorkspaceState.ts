import type { ChartInterval } from "./chartSeries";

export interface ChartWorkspacePreset {
  range: "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y";
  interval: ChartInterval;
  overlays: string[];
  oscillator: "none" | "RSI" | "MACD" | "ADX";
  chartType: "LINE" | "CANDLE" | "AREA";
  compareSymbols: string[];
  dataFabricSeriesIds: string[];
  indicatorParams: Record<string, number>;
  chartLayout: 1 | 2 | 4;
  updatedAt: string;
}

const KEY = "lios:chart-workspace:";

export function loadChartWorkspacePreset(symbol: string): ChartWorkspacePreset | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(`${KEY}${symbol.trim().toUpperCase()}`) ?? "null") as Partial<ChartWorkspacePreset> | null;
    if (!parsed || !Array.isArray(parsed.overlays) || !Array.isArray(parsed.compareSymbols)) return null;
    return {
      range: parsed.range ?? "1Y",
      interval: parsed.interval ?? "1d",
      overlays: parsed.overlays.filter((value): value is string => typeof value === "string"),
      oscillator: parsed.oscillator ?? "none",
      chartType: parsed.chartType ?? "LINE",
      compareSymbols: parsed.compareSymbols.filter((value): value is string => typeof value === "string"),
      dataFabricSeriesIds: Array.isArray(parsed.dataFabricSeriesIds) ? parsed.dataFabricSeriesIds.filter((value): value is string => typeof value === "string").slice(0, 24) : [],
      indicatorParams: Object.fromEntries(Object.entries(parsed.indicatorParams ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))),
      chartLayout: parsed.chartLayout === 2 || parsed.chartLayout === 4 ? parsed.chartLayout : 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch { return null; }
}

export function saveChartWorkspacePreset(symbol: string, preset: Omit<ChartWorkspacePreset, "updatedAt">): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`${KEY}${symbol.trim().toUpperCase()}`, JSON.stringify({ ...preset, updatedAt: new Date().toISOString() }));
}
