import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ARTIFACT_CHART_VIEWPORT_POINTS,
  prepareArtifactChart,
  selectArtifactChartViewport,
  type ArtifactChartProjection,
  type ChartArtifactContent,
} from "./artifactChartProjection";

function chart(series: ChartArtifactContent["series"], chartType = "line"): ChartArtifactContent {
  return { kind: "chart", chartType, rendererPreference: "recharts", options: {}, series };
}

function ready(content: ChartArtifactContent): ArtifactChartProjection {
  const result = prepareArtifactChart(content);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw new Error(result.message);
  return result;
}

const signedUnevenSeries: ChartArtifactContent["series"] = [
  { id: "a", label: "Small", points: [{ x: -2, y: -5 }, { x: 2, y: 0 }] },
  { id: "b", label: "Large", points: [{ x: 0, y: 500 }, { x: 2, y: -100 }] },
];

test("chart projection unions actual numeric x values, keeps signed values and null gaps", () => {
  const prepared = ready(chart(signedUnevenSeries));
  const view = selectArtifactChartViewport(prepared);
  assert.equal(prepared.xKind, "number");
  assert.deepEqual(prepared.xValues, [-2, 0, 2]);
  assert.deepEqual(view.rows, [
    { x: -2, xIndex: 0, series_0: -5, series_1: null },
    { x: 0, xIndex: 1, series_0: null, series_1: 500 },
    { x: 2, xIndex: 2, series_0: 0, series_1: -100 },
  ]);
  assert.deepEqual(view.yDomain, [-100, 500]);
  assert.equal(view.totalSourcePoints, 4);
  assert.equal(view.totalDistinctPoints, 3);
  assert.deepEqual(view.series[0].points, [
    { x: -2, xIndex: 0, y: -5, sourcePointIndex: 0 },
    { x: 2, xIndex: 2, y: 0, sourcePointIndex: 1 },
  ]);
});

test("numeric ordering retains original point indices, with no source mutation or normalization", () => {
  const content = chart([{ id: "first", label: "First", points: [{ x: 10, y: 20 }, { x: -10, y: -4 }, { x: 0, y: 1 }] }]);
  const before = structuredClone(content);
  const prepared = ready(content);
  assert.deepEqual(selectArtifactChartViewport(prepared).series[0].points, [
    { x: -10, xIndex: 0, y: -4, sourcePointIndex: 1 },
    { x: 0, xIndex: 1, y: 1, sourcePointIndex: 2 },
    { x: 10, xIndex: 2, y: 20, sourcePointIndex: 0 },
  ]);
  assert.deepEqual(content, before);
  assert.deepEqual(prepared.series[0].points.get(-10), { x: -10, y: -4, sourcePointIndex: 1 });
});

test("category union uses first encounter order and never merges numeric and textual x", () => {
  const prepared = ready(chart([
    { id: "same.id", label: "Same label", points: [{ x: "Q2", y: 2 }, { x: 1, y: 10 }, { x: "", y: 0 }] },
    { id: "same.id", label: "Same label", points: [{ x: "1", y: -10 }, { x: "Q1", y: 1 }, { x: "Q2", y: 3 }] },
  ]));
  assert.equal(prepared.xKind, "category");
  assert.deepEqual(prepared.xValues, ["Q2", 1, "", "1", "Q1"]);
  const view = selectArtifactChartViewport(prepared);
  assert.deepEqual(view.series.map(({ index, dataKey }) => ({ index, dataKey })), [
    { index: 0, dataKey: "series_0" }, { index: 1, dataKey: "series_1" },
  ]);
  assert.deepEqual(view.rows[1], { x: 1, xIndex: 1, series_0: 10, series_1: null });
  assert.deepEqual(view.rows[3], { x: "1", xIndex: 3, series_0: null, series_1: -10 });
  assert.equal(view.series[1].points[0].sourcePointIndex, 2);
});

test("all supported chart types use the same lossless projection; no fallback for unsupported types", () => {
  for (const chartType of ["line", "area", "bar", "scatter"]) {
    const prepared = ready(chart(signedUnevenSeries, chartType));
    assert.equal(prepared.chartType, chartType);
    assert.deepEqual(selectArtifactChartViewport(prepared).rows, selectArtifactChartViewport(ready(chart(signedUnevenSeries))).rows);
  }
  for (const chartType of ["pie", "candlestick", "stacked-bar", "LINE", "unknown"]) {
    const result = prepareArtifactChart(chart(signedUnevenSeries, chartType));
    assert.equal(result.status, "unsupported");
    if (result.status !== "ready") assert.match(result.message, /not supported/);
  }
});

test("duplicates within a series fail explicitly for every supported type, including outside the viewport", () => {
  for (const chartType of ["line", "area", "bar", "scatter"]) {
    for (const x of ["repeat", -1, 0]) {
      const result = prepareArtifactChart(chart([{ id: "a", label: "A", points: [{ x, y: 1 }, { x, y: 2 }] }], chartType));
      assert.equal(result.status, "invalid");
      if (result.status !== "ready") assert.match(result.message, /duplicate x.*point 2/);
    }
  }
  const points = Array.from({ length: 1_001 }, (_, x) => ({ x, y: x }));
  points.push({ x: 1_000, y: -100 });
  assert.equal(prepareArtifactChart(chart([{ id: "a", label: "A", points }])).status, "invalid");
  assert.equal(prepareArtifactChart(chart([{ id: "a", label: "A", points: [{ x: -0, y: 1 }, { x: 0, y: 2 }] }])).status, "invalid");
});

test("non-finite x/y anywhere in the canonical data fail rather than disappearing or becoming zero", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const point of [{ x: value, y: 1 }, { x: 1, y: value }]) {
      const result = prepareArtifactChart(chart([{ id: "a", label: "A", points: [point] }]));
      assert.equal(result.status, "invalid");
      if (result.status !== "ready") assert.match(result.message, /finite numeric/);
    }
  }
  const points = Array.from({ length: 1_001 }, (_, x) => ({ x, y: x }));
  points[1_000].y = Infinity;
  assert.equal(prepareArtifactChart(chart([{ id: "a", label: "A", points }])).status, "invalid");
});

test("bounded viewport navigation exposes every exact point, complete totals and stable shared domain", () => {
  const points = Array.from({ length: 2_501 }, (_, x) => ({ x, y: x === 2_500 ? -99_999 : x }));
  const prepared = ready(chart([{ id: "long", label: "Long", points }]));
  const first = selectArtifactChartViewport(prepared);
  assert.equal(first.rows.length, MAX_ARTIFACT_CHART_VIEWPORT_POINTS);
  assert.deepEqual([first.offset, first.endExclusive, first.xStart, first.xEnd], [0, 1_000, 0, 999]);
  assert.equal(first.hasPrevious, false);
  assert.equal(first.hasNext, true);
  assert.equal(first.totalDistinctPoints, 2_501);
  assert.equal(first.totalSourcePoints, 2_501);
  const middle = selectArtifactChartViewport(prepared, { offset: first.endExclusive });
  const last = selectArtifactChartViewport(prepared, { offset: middle.endExclusive });
  assert.deepEqual([last.offset, last.endExclusive, last.xStart, last.xEnd], [2_000, 2_501, 2_000, 2_500]);
  assert.equal(last.rows.length, 501);
  assert.equal(last.hasPrevious, true);
  assert.equal(last.hasNext, false);
  assert.deepEqual(first.yDomain, [-99_999, 2_499]);
  assert.deepEqual(last.yDomain, first.yDomain);
  assert.deepEqual([...first.series[0].points, ...middle.series[0].points, ...last.series[0].points].map(({ x, y }) => ({ x, y })), points);
  const custom = selectArtifactChartViewport(prepared, { offset: 17, limit: 250 });
  assert.deepEqual([custom.offset, custom.endExclusive, custom.rows.length], [17, 267, 250]);
  const stale = selectArtifactChartViewport(prepared, { offset: 9_999, limit: 1_000 });
  assert.deepEqual([stale.offset, stale.endExclusive], [2_000, 2_501]);
});

test("viewport bounds apply to union x, not per-series positional slices", () => {
  const prepared = ready(chart([
    { id: "even", label: "Even", points: Array.from({ length: 1_001 }, (_, i) => ({ x: i * 2, y: i })) },
    { id: "odd", label: "Odd", points: Array.from({ length: 1_001 }, (_, i) => ({ x: i * 2 + 1, y: -i })) },
  ]));
  const view = selectArtifactChartViewport(prepared, { offset: 1_000 });
  assert.equal(view.rows.length, 1_000);
  assert.equal(view.totalDistinctPoints, 2_002);
  assert.equal(view.series[0].points.length, 500);
  assert.equal(view.series[1].points.length, 500);
  assert.deepEqual(view.rows[0], { x: 1_000, xIndex: 1_000, series_0: 500, series_1: null });
  assert.deepEqual(view.rows[1], { x: 1_001, xIndex: 1_001, series_0: null, series_1: -500 });
  assert.equal(view.series[1].points[0].sourcePointIndex, 500);
  assert.equal(selectArtifactChartViewport(prepared, { offset: view.endExclusive }).rows.length, 2);
});

test("canonical series and point limits are inclusive and never silently truncate", () => {
  const series = Array.from({ length: 100 }, (_, index) => ({ id: `s${index}`, label: `Series ${index}`, points: [{ x: index, y: index }] }));
  assert.equal(ready(chart(series)).series.length, 100);
  assert.equal(prepareArtifactChart(chart([...series, series[0]])).status, "invalid");
  const points = Array.from({ length: 100_000 }, (_, x) => ({ x, y: -x }));
  const prepared = ready(chart([{ id: "long", label: "Long", points }]));
  assert.equal(prepared.totalSourcePoints, 100_000);
  const tail = selectArtifactChartViewport(prepared, { offset: 99_000 });
  assert.equal(tail.rows.length, 1_000);
  assert.equal(tail.rows[999].series_0, -99_999);
  assert.equal(tail.series[0].points[999].sourcePointIndex, 99_999);
  assert.equal(tail.hasNext, false);
  assert.equal(prepareArtifactChart(chart([{ id: "too-long", label: "Too long", points: [...points, { x: 100_000, y: 1 }] }])).status, "invalid");
});

test("empty and zero-valued charts are distinguished without fabricated observations", () => {
  for (const series of [[], [{ id: "empty", label: "Empty", points: [] }]]) {
    const prepared = ready(chart(series));
    const view = selectArtifactChartViewport(prepared, { offset: 50 });
    assert.equal(prepared.yDomain, null);
    assert.deepEqual(view.rows, []);
    assert.deepEqual([view.offset, view.endExclusive, view.totalSourcePoints, view.totalDistinctPoints], [0, 0, 0, 0]);
    assert.equal(view.hasPrevious, false);
    assert.equal(view.hasNext, false);
    assert.equal(view.xStart, null);
    assert.equal(view.xEnd, null);
  }
  const prepared = ready(chart([{ id: "zero", label: "Zero", points: [{ x: -0, y: -0 }] }]));
  const view = selectArtifactChartViewport(prepared);
  assert.deepEqual(view.yDomain, [-0, 0]);
  assert.ok(Object.is(view.rows[0].x, -0));
  assert.ok(Object.is(view.rows[0].series_0, -0));
});

test("shared domain keeps a zero baseline for wholly positive or wholly negative series", () => {
  for (const [values, domain] of [
    [[2, 20], [0, 20]],
    [[-2, -20], [-20, 0]],
  ]) {
    const prepared = ready(chart([
      { id: "values", label: "Values", points: values.map((y, x) => ({ x, y })) },
      { id: "empty", label: "Empty", points: [] },
    ]));
    const view = selectArtifactChartViewport(prepared);
    assert.deepEqual(view.yDomain, domain);
    assert.deepEqual(view.series[1].points, []);
    assert.ok(view.rows.every((row) => row.series_1 === null));
  }
});

test("invalid viewport parameters reject explicitly instead of coercing or unbounded rendering", () => {
  const prepared = ready(chart(signedUnevenSeries));
  for (const limit of [0, -1, 1_001, 1.5, NaN, Infinity]) {
    assert.throws(() => selectArtifactChartViewport(prepared, { limit }), RangeError);
  }
  for (const offset of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => selectArtifactChartViewport(prepared, { offset }), RangeError);
  }
});
