export interface ChartReceiptDrawing {
  id: string;
  type: "horizontal" | "trendline" | "rectangle";
  points: ReadonlyArray<{ time: number; price: number }>;
  color: string;
  locked: boolean;
  visible: boolean;
}

export interface ChartReceiptInput {
  symbol: string;
  range: string;
  interval: string;
  chartType: string;
  overlays: readonly string[];
  oscillator: string;
  compareSymbols: readonly string[];
  indicatorParams: Readonly<Record<string, number>>;
  barCount: number;
  drawings?: readonly ChartReceiptDrawing[];
  dataFabricSeriesIds?: readonly string[];
  dataProvider?: string;
  dataAsOf?: string;
}

export interface ChartReceipt extends ChartReceiptInput {
  version: 1;
  createdAt: string;
  deterministic: true;
}

export function createChartReceipt(input: ChartReceiptInput, createdAt = new Date().toISOString()): ChartReceipt {
  return {
    ...input,
    drawings: input.drawings ? input.drawings.map(drawing => ({ ...drawing, points: drawing.points.map(point => ({ ...point })) })).sort((a, b) => a.id.localeCompare(b.id)) : undefined,
    dataFabricSeriesIds: input.dataFabricSeriesIds ? [...new Set(input.dataFabricSeriesIds.map(value => value.trim()).filter(Boolean))].sort() : undefined,
    symbol: input.symbol.trim().toUpperCase(),
    overlays: [...input.overlays].sort(),
    compareSymbols: [...new Set(input.compareSymbols.map(value => value.trim().toUpperCase()).filter(Boolean))].sort(),
    indicatorParams: Object.fromEntries(Object.entries(input.indicatorParams).sort(([a], [b]) => a.localeCompare(b))),
    version: 1,
    createdAt,
    deterministic: true,
  };
}
