import test from "node:test";
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import { prepareArtifactPdfChart, renderArtifactChartPdf } from "./artifactPdfChart";
import type { ChartArtifactContent } from "./artifactChartProjection";

const series = [
  { id: "small", label: "Signed small", points: [{ x: -2, y: -5 }, { x: 2, y: 0 }] },
  { id: "large", label: "Signed large", points: [{ x: 0, y: 500 }, { x: 2, y: -100 }] },
];
const payload = (chartType: string, data: ChartArtifactContent["series"] = series) => ({ kind: "chart", chartType, series: data });
const document = () => new jsPDF({ unit: "pt", format: "a4", compress: false, precision: 5 });

// Parse real uncompressed PDF content streams, rather than substituting a mocked renderer.
function streams(pdf: jsPDF): string[] {
  const bytes = pdf.output();
  assert.ok(bytes.startsWith("%PDF-"));
  assert.match(bytes, /\/Type \/Page\b/);
  return [...bytes.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => match[1]);
}
function visibleText(pdf: jsPDF): string {
  return streams(pdf).join("\n").replace(/\\([()\\])/g, "$1");
}

for (const type of ["line", "area", "bar", "scatter"]) {
  test(`native ${type} PDF uses real vector operators and exact full-source statistics`, () => {
    const pdf = document();
    const plan = prepareArtifactPdfChart(payload(type));
    const result = renderArtifactChartPdf(pdf, plan, { x: 40, y: 62, width: 515 });
    assert.equal(result.representedSourcePoints, 4);
    assert.equal(result.totalDistinctPoints, 3);
    assert.deepEqual(plan.projection.yDomain, [-100, 500]);
    const content = streams(pdf).join("\n");
    assert.match(content, /\bre\b/);
    assert.match(content, /\bm\b/);
    assert.match(content, type === "bar" ? /\bf\b/ : /\bc\b/);
    assert.doesNotMatch(pdf.output(), /\/Subtype \/Image/);
    assert.match(visibleText(pdf), /Full source: 4 observations; 3 distinct x values/);
    assert.match(visibleText(pdf), /Shared y domain: -100 to 500/);
    assert.match(visibleText(pdf), /Signed large \[large\]/);
    assert.equal(result.bottomY, 362);
  });
}

test("actual numeric spacing differs from categorical spacing and absent union values break lines", () => {
  const pdf = document();
  const plan = prepareArtifactPdfChart(payload("line", [
    { id: "a", label: "A", points: [{ x: 0, y: 1 }, { x: 10, y: 2 }] },
    { id: "b", label: "B", points: [{ x: 1, y: -1 }] },
  ]));
  renderArtifactChartPdf(pdf, plan, { x: 40, y: 62, width: 515 });
  const content = streams(pdf).join("\n");
  // Three isolated points: no data line can bridge the missing observation at x=1.
  // Rectangle contributes its own re; only the zero axis contributes a standalone l.
  assert.equal([...content.matchAll(/^[-\d.]+ [-\d.]+ l$/gm)].length, 1);
  const circleStarts = [...content.matchAll(/^([-\d.]+) ([-\d.]+) m\n[-\d. ]+ c/gm)].map(match => Number(match[1]));
  assert.equal(circleStarts.length, 3);
  assert.ok(Math.abs((circleStarts[2] - circleStarts[0]) / (circleStarts[1] - circleStarts[0]) - 0.1) < 0.00001);
});

test("signed area crosses true zero as separate native triangles", () => {
  const pdf = document();
  const plan = prepareArtifactPdfChart(payload("area", [{ id: "a", label: "Area", points: [{ x: 0, y: -5 }, { x: 3, y: 10 }] }]));
  renderArtifactChartPdf(pdf, plan, { x: 40, y: 62, width: 515 });
  assert.equal([...streams(pdf).join("\n").matchAll(/^h\nf$/gm)].length, 2);
});

test("categorical labels preserve exact types and every bounded window is exported", () => {
  const data = [{ id: "category", label: "Category", points: Array.from({ length: 13 }, (_, i) => ({ x: i === 1 ? 1 : i === 2 ? "1" : `Q${i}`, y: i - 6 })) }];
  const pdf = document();
  const plan = prepareArtifactPdfChart(payload("bar", data));
  assert.equal(plan.windowCount, 3);
  const result = renderArtifactChartPdf(pdf, plan, { x: 40, y: 62, width: 515, newPage: () => { pdf.addPage(); return 62; } });
  assert.equal(pdf.getNumberOfPages(), 3);
  assert.equal(result.representedSourcePoints, 13);
  assert.match(visibleText(pdf), /2: 1/);
  assert.match(visibleText(pdf), /3: "1"/);
  assert.match(visibleText(pdf), /window 3 of 3/);
  assert.equal([...visibleText(pdf).matchAll(/Shared y domain: -6 to 6/g)].length, 3);
});

test("numeric pagination counts every original source point with one global y domain", () => {
  const pdf = document();
  const data = [{ id: "many", label: "Many", points: Array.from({ length: 49 }, (_, x) => ({ x, y: x - 24 })) }];
  const plan = prepareArtifactPdfChart(payload("scatter", data));
  const result = renderArtifactChartPdf(pdf, plan, { x: 40, y: 62, width: 515, newPage: () => { pdf.addPage(); return 62; } });
  assert.equal(result.representedSourcePoints, 49);
  assert.equal(pdf.getNumberOfPages(), 3);
  assert.equal([...visibleText(pdf).matchAll(/Full source: 49 observations; 49 distinct x values/g)].length, 3);
});

test("invalid, unsupported, unresolved and oversized payloads reject explicitly", () => {
  assert.throws(() => prepareArtifactPdfChart(undefined), /canonical chart payload/);
  assert.throws(() => prepareArtifactPdfChart({ artifactId: "reference" }), /unresolved chart references/);
  assert.throws(() => prepareArtifactPdfChart(payload("pie")), /not supported/);
  assert.throws(() => prepareArtifactPdfChart(payload("line", [{ id: "a", label: "A", points: [{ x: 1, y: 2 }, { x: 1, y: 3 }] }])), /duplicate x/);
  assert.throws(() => prepareArtifactPdfChart(payload("line", [{ id: "a", label: "A", points: [{ x: 1, y: Infinity }] }])), /canonical chart payload|finite/);
  assert.throws(() => prepareArtifactPdfChart(payload("line", [{ id: "a", label: "A", points: Array.from({ length: 2401 }, (_, x) => ({ x, y: x })) }])), /more than 100 windows/);
});

test("layout, missing continuation and unsupported glyph failures occur before chart drawing", () => {
  const pdf = document();
  const before = pdf.output();
  const plan = prepareArtifactPdfChart(payload("line"));
  assert.throws(() => renderArtifactChartPdf(pdf, plan, { x: 40, y: 62, width: 515, height: 110 }), /bounds/);
  const unicode = prepareArtifactPdfChart(payload("line", [{ id: "a", label: "\u4ef7\u683c", points: [{ x: 1, y: 2 }] }]));
  assert.throws(() => renderArtifactChartPdf(pdf, unicode, { x: 40, y: 62, width: 515 }), /embedded font/);
  const many = prepareArtifactPdfChart(payload("line", [{ id: "a", label: "A", points: Array.from({ length: 25 }, (_, x) => ({ x, y: x })) }]));
  assert.throws(() => renderArtifactChartPdf(pdf, many, { x: 40, y: 62, width: 515 }), /page callback/);
  assert.equal(pdf.output(), before);
});

test("native chart streams are deterministic and vector vertices stay within content bounds", () => {
  const outputs = Array.from({ length: 2 }, () => {
    const pdf = document();
    renderArtifactChartPdf(pdf, prepareArtifactPdfChart(payload("area")), { x: 40, y: 62, width: 515 });
    const content = streams(pdf).join("\n");
    const pageHeight = pdf.internal.pageSize.getHeight();
    for (const match of content.matchAll(/^([-\d.]+) ([-\d.]+) [ml]$/gm)) {
      const x = Number(match[1]);
      const y = pageHeight - Number(match[2]);
      assert.ok(x >= 40 && x <= 555, `vector x ${x}`);
      assert.ok(y >= 62 && y <= 362, `vector y ${y}`);
    }
    return content;
  });
  assert.equal(outputs[0], outputs[1]);
});
