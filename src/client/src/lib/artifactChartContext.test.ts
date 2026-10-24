import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { ArtifactContent } from "@shared/artifactContracts";
import { chartRecordedContext, chartSourceCaveat, exactChartValue } from "./artifactChartContext";
import { prepareArtifactChart, type ArtifactChartProjection } from "./artifactChartProjection";
import ArtifactChartRecordedTable from "../components/terminal/ArtifactChartRecordedTable";

type Chart = Extract<ArtifactContent, { kind: "chart" }>;
function chart(options: Record<string, unknown> = {}, series: Chart["series"] = [
  { id: "a", label: "Alpha", points: [{ x: "FY2025", y: -0 }, { x: "FY2026", y: 75.125 }] },
  { id: "b", label: "Beta", points: [{ x: "FY2026", y: -12.5 }, { x: "FY2027", y: 0 }] },
]): Chart {
  return { kind: "chart", chartType: "line", rendererPreference: "recharts", options, series };
}
function ready(content: Chart): ArtifactChartProjection {
  const result = prepareArtifactChart(content);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw new Error(result.message);
  return result;
}

test("WS-39 absent units, period and sources stay explicitly unknown, never guessed from x labels", () => {
  const result = chartRecordedContext(chart());
  assert.deepEqual(result, {
    xLabel: "X (label not recorded)", yLabel: "Y (label not recorded)",
    xUnit: null, yUnit: null, period: null, evidenceRefs: [],
  });
  assert.match(chartSourceCaveat(result), /Not recorded: X unit, Y unit, period, source references/);
  assert.match(chartSourceCaveat(result), /not independently verified/);
});

test("WS-39 copied labels and source refs are saved metadata, not verified entitlements", () => {
  const input = chart({
    xAxisLabel: "Fiscal  year", yAxisLabel: " Revenue ",
    xUnit: "FY", yUnit: "USD millions", periodLabel: "FY2025–FY2027",
    sourceRefs: ["filing:v1", "filing:v1", "manual:observation"],
  });
  assert.deepEqual(chartRecordedContext(input), {
    xLabel: "Fiscal year", yLabel: "Revenue",
    xUnit: "FY", yUnit: "USD millions", period: "FY2025–FY2027",
    evidenceRefs: ["filing:v1", "manual:observation"],
  });
  assert.match(chartSourceCaveat(chartRecordedContext(input)), /not independently verified/);
  assert.equal(chartRecordedContext(chart({ xAxisLabel: 4, yAxisLabel: "", periodLabel: null, sourceRefs: [12] })).evidenceRefs.length, 0);
  assert.equal(chartRecordedContext(chart({ xUnit: "x".repeat(201), yUnit: "\nUnsafe" })).yUnit, null);
  assert.equal(exactChartValue(-0), "-0");
  assert.equal(exactChartValue(71.370824940136), "71.370824940136");
});

test("WS-39 SSR fallback is a fully labelled exact 2-series table; gaps are not zeros", () => {
  const input = chart({ xAxisLabel: "Period", yAxisLabel: "Revenue", yUnit: "USD millions" });
  const markup = renderToStaticMarkup(createElement(ArtifactChartRecordedTable, { content: input, projection: ready(input) }));
  assert.match(markup, /aria-label="Exact chart comparison table"/);
  assert.match(markup, /<table /);
  assert.match(markup, /<caption /);
  assert.match(markup, /scope="col"/);
  assert.match(markup, /scope="row"/);
  assert.match(markup, /Period/);
  assert.match(markup, /Revenue \(USD millions\)/);
  assert.match(markup, /Alpha/);
  assert.match(markup, /Beta/);
  assert.match(markup, /75\.125/);
  assert.match(markup, /-12\.5/);
  assert.match(markup, />-0</);
  assert.match(markup, /Not recorded \(gap\)/);
  assert.match(markup, /recorded point 1 in this series/);
  assert.equal((markup.match(/data-testid="chart-table-missing-point"/g) ?? []).length, 2);
  assert.equal((markup.match(/data-testid="chart-table-exact-point"/g) ?? []).length, 4);
  assert.doesNotMatch(markup, /\bNaN\b|undefined|Infinity|Interpolated|verified live/);
});

test("WS-39 table paging uses exact 40-position windows; all hidden plot series remain visible", () => {
  const input = chart({}, [
    { id: "a", label: "Visible in plot", points: Array.from({ length: 101 }, (_, x) => ({ x, y: x * 0.25 })) },
    { id: "b", label: "Hidden from plot", points: [{ x: 100, y: 9999 }] },
  ]);
  const markup = renderToStaticMarkup(createElement(ArtifactChartRecordedTable, { content: input, projection: ready(input) }));
  assert.match(markup, /X positions 1–40 of 101/);
  assert.match(markup, /Hidden from plot/);
  assert.match(markup, /Next table page/);
  assert.match(markup, /Previous table page/);
  assert.equal((markup.match(/<tr/g) ?? []).length, 41, "40 data rows plus table header");
  assert.doesNotMatch(markup, /9999/, "later saved observations must be reachable by paging, never pulled into earlier page");
});

test("WS-39 chart retains original keyboard point inspector and independent full-comparison table", () => {
  const source = readFileSync(new URL("../components/terminal/ArtifactChart.tsx", import.meta.url), "utf8");
  assert.match(source, /<ArtifactChartRecordedTable projection=\{prepared\} content=\{content\}/);
  assert.match(source, /class ChartPlotBoundary extends React.Component/);
  assert.match(source, /artifact-chart-plot-failed/);
  assert.match(source, /<ChartPlotBoundary key=\{`\$\{chartType\}:\$\{content\.rendererPreference\}`\}>/);
  assert.match(source, /data-testid="artifact-chart-recorded-context"/);
  assert.match(source, /chartSourceCaveat\(recordedContext\)/);
  assert.match(source, /Source refs: /);
  assert.match(source, /data-testid="artifact-chart-inspector"/);
  assert.match(source, /aria-label="Exact point values; arrow keys change point, Home and End move within window"/);
  assert.match(source, /connectNulls=\{false\}/);
  assert.doesNotMatch(source, /Math\.round\(point\.y\)|\?\? 0|new Date\(row\.x\)/);
});
