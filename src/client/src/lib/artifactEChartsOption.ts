import type {
  ArtifactChartProjection, ArtifactChartType, ArtifactChartViewport,
} from "./artifactChartProjection";

/** Strict, lossless data-to-renderer bridge: only P4 canonical chart records
 * are translated. Donor option objects are NOT loaded from Artifact.options.
 * ECharts handles drawing, not data authority, business math or interactions.
 */
export interface EChartsArtifactSeries {
  id: string;
  name: string;
  type: "line" | "bar" | "scatter";
  data: Array<number | null | [number, number | null]>;
  connectNulls?: false;
  showSymbol?: boolean;
  smooth?: false;
  areaStyle?: { opacity: number };
}
export interface EChartsArtifactOption {
  animation: false;
  backgroundColor: "transparent";
  grid: { top:number;right:number;bottom:number;left:number;containLabel:true };
  xAxis: { type:"value" | "category"; data?:string[]; scale?:true };
  yAxis: { type:"value"; min:number;max:number; scale:true };
  series: EChartsArtifactSeries[];
}

function safeCategory(x: string | number): string {
  // Category labels must distinguish number 1 from text "1".
  return typeof x === "string" ? JSON.stringify(x) : String(x);
}

export function buildArtifactEChartsOption(
  projection: ArtifactChartProjection,
  viewport: ArtifactChartViewport,
  chartType: ArtifactChartType,
  visibleIndices: readonly number[],
): EChartsArtifactOption {
  // chartType may intentionally differ from projection.chartType while the
  // existing P4 UI previews an unsaved chart-type revision. The projection
  // remains the canonical recorded data source; only the drawing mode changes.
  if (viewport.limit > 1000 || viewport.rows.length > 1000 || projection.series.length > 100) {
    throw new Error("ECharts projection exceeds the bounded P4 chart viewport.");
  }
  const indices = new Set(visibleIndices);
  if (indices.size !== visibleIndices.length ||
      visibleIndices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= projection.series.length)) {
    throw new Error("ECharts requires exact visible P4 series indices.");
  }
  const numeric = projection.xKind === "number";
  const area = chartType === "area";
  const type = chartType === "bar" ? "bar" : chartType === "scatter" ? "scatter" : "line";
  const series: EChartsArtifactSeries[] = projection.series.filter(item => indices.has(item.index)).map(item => ({
    id: item.dataKey,
    name: item.label,
    type,
    // Nulls preserve missing observations. Never infer a zero, resample or
    // interpolate a missing source value.
    data: viewport.rows.map(row => {
      const y = row[item.dataKey];
      if (y !== null && (typeof y !== "number" || !Number.isFinite(y))) {
        throw new Error("ECharts refuses non-finite or non-numeric source observations.");
      }
      if (numeric) {
        if (typeof row.x !== "number" || !Number.isFinite(row.x)) {
          throw new Error("ECharts requires finite numeric x in value-axis mode.");
        }
        return [row.x, y] as [number, number | null];
      }
      return chartType === "scatter" ? [row.xIndex - viewport.offset, y] as [number, number | null] : y;
    }),
    ...((type === "line") ? { connectNulls:false as const, showSymbol: viewport.rows.length <= 80, smooth:false as const } : {}),
    ...(area ? { areaStyle: { opacity:0.16 } } : {}),
  }));
  const domain = viewport.yDomain ?? [0,1];
  if (!domain.every(Number.isFinite) || domain[0] > domain[1]) {
    throw new Error("ECharts requires a finite, ordered P4 source-wide Y domain.");
  }
  return {
    animation:false,
    backgroundColor:"transparent",
    grid:{ top:15,right:18,bottom:40,left:20,containLabel:true },
    xAxis:numeric ? {type:"value",scale:true} : {
      type:"category",data:viewport.rows.map(row=>safeCategory(row.x)),scale:true,
    },
    yAxis:{type:"value",min:domain[0],max:domain[1],scale:true},
    series,
  };
}
