import { chartArtifactContentSchema, dataArtifactContentSchema } from "./artifactContracts";

export { toUniverWorkbookProjection } from "./univerArtifact";

export { toTiptapDocumentProjection, fromTiptapDocumentProjection } from "./richArtifactDocument";

export function toEChartsOptionProjection(raw: unknown) {
  const chart = chartArtifactContentSchema.parse(raw);
  const xValues = chart.series[0]?.points.map((point) => point.x) ?? [];
  return {
    xAxis: { type: "category", data: xValues },
    yAxis: { type: "value" },
    series: chart.series.map((series) => ({
      name: series.label,
      type: chart.chartType === "bar" ? "bar" : "line",
      data: series.points.map((point) => point.y),
    })),
    ...chart.options,
  };
}

export function toPerspectiveProjection(raw: unknown) {
  const data = dataArtifactContentSchema.parse(raw);
  return {
    schema: Object.fromEntries(data.columns.map((column) => [column.name, column.type])),
    rows: data.previewRows,
    rowCount: data.rowCount,
    columnarArtifactId: data.columnarArtifactId,
  };
}
