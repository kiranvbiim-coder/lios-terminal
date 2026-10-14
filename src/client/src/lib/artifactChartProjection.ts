import type { ArtifactContent } from "@shared/artifactContracts";

export type ChartArtifactContent = Extract<ArtifactContent, { kind: "chart" }>;
export type ArtifactChartX = string | number;
export type ArtifactChartType = "line" | "area" | "bar" | "scatter";

export const MAX_ARTIFACT_CHART_VIEWPORT_POINTS = 1_000;
const MAX_SERIES = 100;
const MAX_POINTS_PER_SERIES = 100_000;

export interface ArtifactChartSourcePoint {
  x: ArtifactChartX;
  y: number;
  sourcePointIndex: number;
}

export interface ArtifactChartProjectionSeries {
  index: number;
  id: string;
  label: string;
  dataKey: string;
  points: ReadonlyMap<ArtifactChartX, ArtifactChartSourcePoint>;
}

export interface ArtifactChartProjection {
  status: "ready";
  chartType: ArtifactChartType;
  xKind: "number" | "category";
  xValues: ArtifactChartX[];
  series: ArtifactChartProjectionSeries[];
  yDomain: [number, number] | null;
  totalDistinctPoints: number;
  totalSourcePoints: number;
}

export type ArtifactChartPreparation = ArtifactChartProjection | {
  status: "invalid" | "unsupported";
  message: string;
};

export interface ArtifactChartRow {
  x: ArtifactChartX;
  xIndex: number;
  [key: string]: ArtifactChartX | null;
}

export interface ArtifactChartViewport {
  rows: ArtifactChartRow[];
  series: Array<Omit<ArtifactChartProjectionSeries, "points"> & {
    points: Array<ArtifactChartSourcePoint & { xIndex: number }>;
  }>;
  offset: number;
  endExclusive: number;
  totalDistinctPoints: number;
  totalSourcePoints: number;
  limit: number;
  hasPrevious: boolean;
  hasNext: boolean;
  xStart: ArtifactChartX | null;
  xEnd: ArtifactChartX | null;
  yDomain: [number, number] | null;
}

/** Index the canonical content once; no coercion, normalization, aggregation or source mutation. */
export function prepareArtifactChart(content: ChartArtifactContent): ArtifactChartPreparation {
  const chartType = content.chartType;
  if (chartType !== "line" && chartType !== "area" && chartType !== "bar" && chartType !== "scatter") {
    return { status: "unsupported", message: `Chart type "${chartType}" is not supported. Supported types: line, area, bar, scatter.` };
  }
  if (content.series.length > MAX_SERIES) {
    return { status: "invalid", message: `Chart has more than ${MAX_SERIES} series.` };
  }

  const xValues: ArtifactChartX[] = [];
  const seenX = new Set<ArtifactChartX>();
  const series: ArtifactChartProjectionSeries[] = [];
  let numericX = true;
  let totalSourcePoints = 0;
  let yMin = 0;
  let yMax = 0;

  for (let index = 0; index < content.series.length; index += 1) {
    const source = content.series[index];
    if (source.points.length > MAX_POINTS_PER_SERIES) {
      return { status: "invalid", message: `Series ${index + 1} has more than ${MAX_POINTS_PER_SERIES} points.` };
    }
    const points = new Map<ArtifactChartX, ArtifactChartSourcePoint>();
    for (let sourcePointIndex = 0; sourcePointIndex < source.points.length; sourcePointIndex += 1) {
      const { x, y } = source.points[sourcePointIndex];
      if ((typeof x !== "string" && typeof x !== "number")
        || (typeof x === "number" && !Number.isFinite(x))
        || typeof y !== "number" || !Number.isFinite(y)) {
        return { status: "invalid", message: `Series ${index + 1}, point ${sourcePointIndex + 1} must have a string or finite numeric x and a finite numeric y.` };
      }
      if (points.has(x)) {
        return { status: "invalid", message: `Series ${index + 1} has duplicate x ${JSON.stringify(x)} at point ${sourcePointIndex + 1}. Duplicate x values cannot be plotted without losing observations.` };
      }
      points.set(x, { x, y, sourcePointIndex });
      if (!seenX.has(x)) {
        seenX.add(x);
        xValues.push(x);
      }
      if (typeof x !== "number") numericX = false;
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
    totalSourcePoints += source.points.length;
    // Source IDs/labels are not object keys: collisions and dots must not merge series.
    series.push({ index, id: source.id, label: source.label, dataKey: `series_${index}`, points });
  }

  if (numericX) xValues.sort((a, b) => (a as number) - (b as number));
  return {
    status: "ready",
    chartType,
    xKind: numericX ? "number" : "category",
    xValues,
    series,
    // One full-source domain keeps comparisons and signs stable across visibility/page changes.
    yDomain: totalSourcePoints === 0 ? null : [yMin, yMax],
    totalDistinctPoints: xValues.length,
    totalSourcePoints,
  };
}

/** Select exact union-x observations. Missing series values stay null, never invented zeroes. */
export function selectArtifactChartViewport(
  projection: ArtifactChartProjection,
  { offset = 0, limit = MAX_ARTIFACT_CHART_VIEWPORT_POINTS }: { offset?: number; limit?: number } = {},
): ArtifactChartViewport {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("Chart viewport offset must be a non-negative safe integer.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ARTIFACT_CHART_VIEWPORT_POINTS) {
    throw new RangeError(`Chart viewport limit must be an integer between 1 and ${MAX_ARTIFACT_CHART_VIEWPORT_POINTS}.`);
  }
  const totalDistinctPoints = projection.totalDistinctPoints;
  const start = totalDistinctPoints === 0 ? 0
    : offset < totalDistinctPoints ? offset : Math.floor((totalDistinctPoints - 1) / limit) * limit;
  const endExclusive = Math.min(start + limit, totalDistinctPoints);
  const rows: ArtifactChartRow[] = [];
  const series: ArtifactChartViewport["series"] = projection.series.map(({ points: _points, ...metadata }) => ({ ...metadata, points: [] }));

  for (let xIndex = start; xIndex < endExclusive; xIndex += 1) {
    const x = projection.xValues[xIndex];
    const row: ArtifactChartRow = { x, xIndex };
    for (let index = 0; index < projection.series.length; index += 1) {
      const source = projection.series[index];
      const point = source.points.get(x);
      row[source.dataKey] = point?.y ?? null;
      if (point) series[index].points.push({ ...point, xIndex });
    }
    rows.push(row);
  }
  return {
    rows,
    series,
    offset: start,
    endExclusive,
    totalDistinctPoints,
    totalSourcePoints: projection.totalSourcePoints,
    limit,
    hasPrevious: start > 0,
    hasNext: endExclusive < totalDistinctPoints,
    xStart: rows[0]?.x ?? null,
    xEnd: rows[rows.length - 1]?.x ?? null,
    yDomain: projection.yDomain,
  };
}
