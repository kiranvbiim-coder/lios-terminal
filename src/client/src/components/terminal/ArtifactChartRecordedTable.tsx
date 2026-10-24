// A full, keyboard-readable alternate view for exactly the same canonical
// source observations used by Recharts/ECharts; never a second data generator.
import * as React from "react";
import { useState } from "react";
import type { ArtifactChartProjection } from "@/lib/artifactChartProjection";
import { selectArtifactChartViewport } from "@/lib/artifactChartProjection";
import { chartRecordedContext, exactChartValue } from "@/lib/artifactChartContext";
import type { ArtifactContent } from "@shared/artifactContracts";

type ChartContent = Extract<ArtifactContent, { kind: "chart" }>;
const TABLE_PAGE = 40;
const CONTROL = "min-h-9 rounded border border-border/50 px-3 py-2 font-ui text-[12px] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300";

/**
 * The table includes ALL recorded series, even those hidden only in the
 * visualization. A null point is labelled missing, never rendered as zero.
 * Paging runs across the entire canonical union-X, independent of chart zoom.
 */
export default function ArtifactChartRecordedTable({ projection, content }: {
  projection: ArtifactChartProjection; content: ChartContent;
}) {
  const [offset, setOffset] = useState(0);
  const viewport = selectArtifactChartViewport(projection, { offset, limit: TABLE_PAGE });
  const context = chartRecordedContext(content);
  return <section aria-label="Exact chart comparison table" data-testid="artifact-chart-comparison-table" className="space-y-2 rounded border border-border/50 p-3">
    <h3 className="font-ui text-[14px] font-semibold">Exact recorded comparison</h3>
    <p className="font-ui text-[12px] text-muted-foreground">Keyboard-readable alternative to the plot. All saved series, including hidden plot series, are shown side by side. Empty observations mean no recorded point—not zero. No values are interpolated, converted or aggregated.</p>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" aria-live="polite" className="font-terminal text-[12px] text-muted-foreground">
        {viewport.rows.length ? `X positions ${viewport.offset + 1}–${viewport.endExclusive} of ${viewport.totalDistinctPoints}` : "No saved observations"} · {projection.series.length} recorded series
      </p>
      <nav aria-label="Exact comparison table pages" className="flex gap-2">
        <button type="button" className={CONTROL} disabled={!viewport.hasPrevious} onClick={() => setOffset(Math.max(0, viewport.offset - TABLE_PAGE))}>Previous table page</button>
        <button type="button" className={CONTROL} disabled={!viewport.hasNext} onClick={() => setOffset(viewport.endExclusive)}>Next table page</button>
      </nav>
    </div>
    <div className="max-h-[400px] overflow-auto" tabIndex={0} role="region" aria-label="Scroll exact chart observations">
      <table className="w-full border-collapse text-left font-terminal text-[12px]">
        <caption className="sr-only">Saved X values and exact Y values for every recorded series. Table pages cover all recorded observations.</caption>
        <thead><tr>
          <th scope="col" className="sticky left-0 top-0 z-20 min-w-28 border border-border/40 bg-[#111] p-2">{context.xLabel}{context.xUnit ? ` (${context.xUnit})` : ""}</th>
          {projection.series.map(series => <th key={series.index} scope="col" className="sticky top-0 z-10 min-w-28 border border-border/40 bg-[#111] p-2">{series.label}<span className="block font-normal text-muted-foreground">{context.yLabel}{context.yUnit ? ` (${context.yUnit})` : ""}</span></th>)}
        </tr></thead>
        <tbody>{viewport.rows.map(row => <tr key={row.xIndex}>
          <th scope="row" className="sticky left-0 border border-border/40 bg-[#101010] p-2">{typeof row.x === "string" ? JSON.stringify(row.x) : exactChartValue(row.x)}</th>
          {projection.series.map(series => {
            const point = series.points.get(row.x);
            return <td key={series.index} className="border border-border/40 p-2" data-testid={point ? "chart-table-exact-point" : "chart-table-missing-point"}>
              {point ? <>{exactChartValue(point.y)}<span className="sr-only"> · recorded point {point.sourcePointIndex + 1} in this series</span></> : <span className="text-muted-foreground">Not recorded (gap)</span>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
