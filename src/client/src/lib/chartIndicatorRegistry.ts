export type ChartIndicatorId = "SMA20" | "SMA50" | "EMA12" | "EMA26" | "BB" | "DONCHIAN" | "RSI" | "MACD" | "ADX";
export type ChartIndicatorPane = "price" | "oscillator";

export interface ChartIndicatorParameter {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface ChartIndicatorDefinition {
  id: ChartIndicatorId;
  label: string;
  pane: ChartIndicatorPane;
  description: string;
  parameters: ChartIndicatorParameter[];
}

export const CHART_INDICATOR_REGISTRY: readonly ChartIndicatorDefinition[] = [
  { id: "SMA20", label: "SMA", pane: "price", description: "Simple moving average", parameters: [{ id: "period", label: "Period", min: 2, max: 300, step: 1, defaultValue: 20 }] },
  { id: "SMA50", label: "SMA", pane: "price", description: "Simple moving average", parameters: [{ id: "period", label: "Period", min: 2, max: 300, step: 1, defaultValue: 50 }] },
  { id: "EMA12", label: "EMA", pane: "price", description: "Exponential moving average", parameters: [{ id: "period", label: "Period", min: 2, max: 300, step: 1, defaultValue: 12 }] },
  { id: "EMA26", label: "EMA", pane: "price", description: "Exponential moving average", parameters: [{ id: "period", label: "Period", min: 2, max: 300, step: 1, defaultValue: 26 }] },
  { id: "BB", label: "Bollinger", pane: "price", description: "Volatility envelope around a moving average", parameters: [{ id: "period", label: "Period", min: 2, max: 300, step: 1, defaultValue: 20 }, { id: "deviations", label: "Std dev", min: 0.5, max: 5, step: 0.5, defaultValue: 2 }] },
  { id: "DONCHIAN", label: "Donchian", pane: "price", description: "Rolling high/low breakout channel", parameters: [{ id: "period", label: "Period", min: 2, max: 300, step: 1, defaultValue: 20 }] },
  { id: "RSI", label: "RSI", pane: "oscillator", description: "Relative strength index", parameters: [{ id: "period", label: "Period", min: 2, max: 100, step: 1, defaultValue: 14 }] },
  { id: "MACD", label: "MACD", pane: "oscillator", description: "Moving-average convergence divergence", parameters: [{ id: "fast", label: "Fast", min: 2, max: 100, step: 1, defaultValue: 12 }, { id: "slow", label: "Slow", min: 3, max: 300, step: 1, defaultValue: 26 }, { id: "signal", label: "Signal", min: 2, max: 100, step: 1, defaultValue: 9 }] },
  { id: "ADX", label: "ADX", pane: "oscillator", description: "Average directional index", parameters: [{ id: "period", label: "Period", min: 2, max: 100, step: 1, defaultValue: 14 }] },
];

export const CHART_INDICATOR_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(
  CHART_INDICATOR_REGISTRY.flatMap(definition => definition.parameters.map(parameter => [`${definition.id}.${parameter.id}`, parameter.defaultValue])),
);

export function clampIndicatorParameter(definition: ChartIndicatorDefinition, parameterId: string, value: number): number {
  const parameter = definition.parameters.find(item => item.id === parameterId);
  if (!parameter || !Number.isFinite(value)) return parameter?.defaultValue ?? 0;
  return Math.min(parameter.max, Math.max(parameter.min, Math.round(value / parameter.step) * parameter.step));
}
