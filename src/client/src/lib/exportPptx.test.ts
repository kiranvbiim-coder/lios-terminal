import test from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { artifactContentSchema, artifactExportPlanSchema } from "../../../shared/artifactContracts";
import type { ArtifactContent } from "../../../shared/artifactContracts";
import { buildArtifactPptx, buildPptxBytes } from "./exportPptx";

test("P6 PPTX export produces a valid OOXML package with provenance metadata", () => {
  const bytes = buildPptxBytes("P6 Backtest", [{ name: "Summary", rows: [["Metric", "Value"], ["Sharpe", 1.2]] }], {
    model: "backtest Artifact",
    modelHash: "a".repeat(64),
    provenance: ["provider:test", "dataset:ohlcv"],
  });
  const files = unzipSync(bytes);
  assert.ok(files["[Content_Types].xml"]);
  assert.ok(files["ppt/presentation.xml"]);
  assert.ok(files["ppt/slides/slide1.xml"]);
  assert.ok(files["ppt/slides/slide2.xml"]);
  const slide = strFromU8(files["ppt/slides/slide1.xml"]);
  assert.match(slide, /P6 Backtest/);
  assert.match(slide, /aaaaaaaaaaaaaaaa/);
  assert.match(slide, /provider:test/);
});

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, trimValues: false });
const HASH = "a".repeat(64);
const SOURCE_HASH = "b".repeat(64);
const chartFixture = artifactContentSchema.parse({
  kind: "chart", chartType: "line", series: [
    { id: "series:a", label: "A", points: [{ x: 0, y: -10 }, { x: 1, y: 0 }, { x: 2, y: 20 }] },
    { id: "series:b", label: "B", points: [{ x: 0, y: 30 }, { x: 2, y: -5 }] },
  ],
}) as Extract<ArtifactContent, { kind: "chart" }>;

function planFor(content: ArtifactContent) {
  return artifactExportPlanSchema.parse({ artifactId: "artifact:native:proof", version: 4, kind: content.kind, formats: ["pptx", "json"], filenameStem: "Native evidence", contentHash: HASH, sourceRefs: ["source:canonical:filing"] });
}

function textRuns(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(textRuns);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => key === "a:t" ? [String(item)] : textRuns(item));
}

function reopen(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  for (const [path, data] of Object.entries(files)) {
    if (!path.endsWith(".xml") && !path.endsWith(".rels")) continue;
    const xml = strFromU8(data);
    assert.equal(XMLValidator.validate(xml), true, path);
    if (!path.endsWith(".rels")) continue;
    assert.doesNotMatch(xml, /TargetMode="External"/, `${path} must not activate remote content`);
    for (const relationship of xml.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\/>/g)) {
      const base = path === "_rels/.rels" ? "" : posix.dirname(path).replace(/\/_rels$/, "");
      const target = relationship[1].startsWith("/") ? relationship[1].slice(1) : posix.normalize(posix.join(base, relationship[1]));
      assert.ok(files[target], `${path} references real local part ${target}`);
    }
  }
  const slidePaths = Object.keys(files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
  const slideXml = slidePaths.map(path => strFromU8(files[path]));
  const text = slideXml.map(xml => textRuns(parser.parse(xml)).join("")).join("\n");
  return { files, slideXml, text };
}

test("SI-04 native report PPTX retains every paginated table row and exact decimal text without duplicate paragraph rows", async () => {
  const rows = Array.from({ length: 151 }, (_, index) => ({ period: `period-${index}`, value: index === 150 ? "9007199254740993.25000000000000001" : String(index) }));
  const content = artifactContentSchema.parse({
    kind: "report",
    sections: [{ id: "summary", title: "Recorded findings", blockIds: ["narrative", "table", "chart", "citation"] }],
    blocks: [
      { id: "narrative", type: "paragraph", text: "Recorded negative, zero and positive observations; no recommendation inferred." },
      { id: "table", type: "table", text: "Exact recorded periods", attrs: { table: { kind: "table", columns: [{ key: "period", label: "Period" }, { key: "value", label: "Exact value", type: "currency" }], rows }, sourceRef: "source:canonical:filing", receiptId: "receipt:table:1" } },
      { id: "chart", type: "chart_ref", text: "Recorded chart", attrs: { chartRef: "artifact:chart:actual@v1", chart: chartFixture, contentHash: SOURCE_HASH } },
      { id: "citation", type: "paragraph", text: "Exact citation", attrs: { sourceRef: "source:canonical:filing", evidenceVersionRef: "artifact:research:actual@v3#evidence:1", contentHash: SOURCE_HASH } },
    ],
  });
  const original = structuredClone(content);
  const file = await buildArtifactPptx(planFor(content), content);
  const result = reopen(file.bytes);
  assert.equal(file.filename, "Native evidence-v4.pptx");
  assert.equal(file.slideCount, result.slideXml.length);
  const tables = result.slideXml.filter(xml => xml.includes("<a:tbl>"));
  assert.ok(tables.length > 1);
  for (const xml of tables) {
    const height = [...xml.matchAll(/<a:tr h="(\d+)">/g)].reduce((total, row) => total + Number(row[1]), 0);
    assert.ok(height <= 5.7 * 914400 + 1, "native table rows stay within bounded slide body");
    assert.match(xml, /<a:off x="502920" y="960120"\/>/);
  }
  const cells = tables.flatMap(xml => [...xml.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map(match => textRuns(parser.parse(`<cell>${match[1]}</cell>`)).join("")));
  assert.equal(cells.filter(cell => cell === "Period").length, tables.length, "each continuation repeats the period header");
  assert.equal(cells.filter(cell => cell === "Exact value").length, tables.length, "each continuation repeats the declared numeric header");
  for (const row of rows) assert.equal(cells.filter(cell => cell === row.period).length, 1, row.period);
  assert.ok(cells.includes(rows[150].value), "decimal strings cannot pass through IEEE-754 conversion");
  assert.doesNotMatch(result.text, /Row 151:|Columns: Period|9007199254740992/);
  for (const text of ["no recommendation inferred.", "Exact citation", "receipt:table:1", "artifact:chart:actual@v1", "artifact:research:actual@v3#evidence:1", SOURCE_HASH, HASH, "source:canonical:filing"]) assert.ok(result.text.includes(text), text);
  assert.ok(result.slideXml.some(xml => xml.includes("<c:chart")));
  assert.ok(Object.keys(result.files).some(path => path.endsWith(".xlsx")));
  const core = parser.parse(strFromU8(result.files["docProps/core.xml"]))["cp:coreProperties"];
  assert.equal(core["dc:identifier"], planFor(content).artifactId);
  assert.equal(core["dc:subject"], "report Artifact v4");
  assert.equal(core["cp:keywords"], HASH);
  assert.deepEqual(content, original);
});

for (const type of ["line", "area", "bar", "scatter"] as const) {
  test(`SI-04 native ${type} chart PPTX has editable OOXML and XLSX with signed values, actual zero and absent gap`, async () => {
    const content = { ...chartFixture, chartType: type };
    const result = reopen((await buildArtifactPptx(planFor(content), content)).bytes);
    const chartPath = Object.keys(result.files).find(path => /^ppt\/charts\/chart\d+\.xml$/.test(path));
    assert.ok(chartPath);
    const chart = strFromU8(result.files[chartPath]);
    assert.match(chart, new RegExp(`<c:${type}Chart>`));
    assert.match(chart, /<c:dispBlanksAs val="gap"\/>/);
    assert.doesNotMatch(chart, /<c:dateAx>/, "recorded numeric labels are not inferred Excel dates");
    if (type !== "scatter") {
      assert.match(chart, /<c:catAx>/);
      assert.match(chart, /<c:cat>\s*<c:(?:strRef|multiLvlStrRef)>/);
    }
    const series = [...chart.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map(match => match[1]);
    assert.equal(series.length, 2);
    if (type !== "scatter") {
      const categories = series[0].match(/<c:cat>([\s\S]*?)<\/c:cat>/)?.[1] ?? "";
      const points = [...categories.matchAll(/<c:pt idx="(\d+)"><c:v>([\s\S]*?)<\/c:v><\/c:pt>/g)].map(match => ({ index: Number(match[1]), label: parser.parse(`<label>${match[2]}</label>`).label }));
      assert.deepEqual(points, [{ index: 0, label: "0" }, { index: 1, label: "1" }, { index: 2, label: "2" }]);
    }
    const valueTag = type === "scatter" ? "yVal" : "val";
    const first = series[0].match(new RegExp(`<c:${valueTag}>([\\s\\S]*?)</c:${valueTag}>`))?.[1] ?? "";
    const second = series[1].match(new RegExp(`<c:${valueTag}>([\\s\\S]*?)</c:${valueTag}>`))?.[1] ?? "";
    assert.match(first, /<c:pt idx="0"><c:v>-10<\/c:v><\/c:pt>/);
    assert.match(first, /<c:pt idx="1"><c:v>0<\/c:v><\/c:pt>/);
    assert.match(second, /<c:pt idx="0"><c:v>30<\/c:v><\/c:pt>/);
    assert.match(second, /<c:pt idx="2"><c:v>-5<\/c:v><\/c:pt>/);
    assert.doesNotMatch(second, /<c:pt idx="1">/);
    const embedding = Object.keys(result.files).find(path => path.endsWith(".xlsx"));
    assert.ok(embedding);
    const workbook = unzipSync(result.files[embedding]);
    const sheet = strFromU8(workbook["xl/worksheets/sheet1.xml"]);
    assert.match(sheet, /<c r="B2"><v>-10<\/v><\/c>/);
    assert.match(sheet, /<c r="B3"><v>0<\/v><\/c>/);
    assert.match(sheet, /<c r="C3"><v><\/v><\/c>/);
    assert.match(sheet, /<c r="C4"><v>-5<\/v><\/c>/);
    if (type === "scatter") assert.match(sheet, /<c r="A3"><v>1<\/v><\/c>/);
    for (const [path, data] of Object.entries(workbook)) if (path.endsWith(".xml") || path.endsWith(".rels")) assert.equal(XMLValidator.validate(strFromU8(data)), true, path);
  });
}

test("SI-04 native chart category union retains textual labels and distinguishes number 1 from string 1", async () => {
  const content = { ...chartFixture, series: [
    { id: "numeric", label: "Same label", points: [{ x: 1, y: -0 }, { x: "", y: -2 }] },
    { id: "text", label: "Same label", points: [{ x: "1", y: 3 }, { x: "Q & <2>", y: 4 }] },
  ] };
  const result = reopen((await buildArtifactPptx(planFor(content), content)).bytes);
  const chart = strFromU8(result.files["ppt/charts/chart1.xml"]);
  assert.match(chart, /<c:ptCount val="4"\/>/);
  const category = chart.match(/<c:cat>([\s\S]*?)<\/c:cat>/)?.[1] ?? "";
  const categories = [...category.matchAll(/<c:pt idx="(\d+)"><c:v>([\s\S]*?)<\/c:v><\/c:pt>/g)].map(match => ({ index: Number(match[1]), label: parser.parse(`<label>${match[2]}</label>`).label }));
  assert.deepEqual(categories, [{ index: 0, label: "1" }, { index: 1, label: "" }, { index: 2, label: "1" }, { index: 3, label: "Q & <2>" }]);
  assert.match(chart, /<c:pt idx="0"><c:v>-0<\/c:v><\/c:pt>/);
  assert.match(chart, /<c:pt idx="1"><c:v><\/c:v><\/c:pt>/, "empty recorded categorical labels are not numeric gaps");
  assert.match(chart, /Q &amp; &lt;2&gt;/);
  const series = [...chart.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map(match => match[1]);
  assert.match(series[1], /<c:pt idx="2"><c:v>3<\/c:v><\/c:pt>/);
});

test("SI-04 native table horizontal paging retains columns past eight, absent/null/boolean values and metadata", async () => {
  const columns = Array.from({ length: 10 }, (_, i) => ({ key: `c${i}`, label: `Column ${i}` }));
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "wide", type: "table", attrs: { table: { kind: "table", columns, rows: [{ c0: null, c1: false, c2: 0, c9: "=HYPERLINK(\"https://example.test\")" }] } } }] });
  const result = reopen((await buildArtifactPptx(planFor(content), content)).bytes);
  const tableText = result.slideXml.filter(xml => xml.includes("<a:tbl>")).map(xml => textRuns(parser.parse(xml)).join("")).join("");
  for (const text of ["Column 9", "null", "false", "Not recorded", '=HYPERLINK("https://example.test")']) assert.ok(tableText.includes(text), text);
  assert.equal(result.slideXml.filter(xml => xml.includes("<a:tbl>")).length, 2);
  assert.doesNotMatch(result.slideXml.join(""), /<a:hlinkClick/);
});

test("SI-04 native serialization deterministically normalizes outer and embedded ZIP/core timestamps", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2030-01-01T00:00:00Z") });
  const plan = planFor(chartFixture);
  const first = await buildArtifactPptx(plan, chartFixture);
  context.mock.timers.setTime(new Date("2040-06-15T23:59:59Z").getTime());
  const second = await buildArtifactPptx(plan, chartFixture);
  assert.deepEqual(first.bytes, second.bytes);
  const inspect = (bytes: Uint8Array) => {
    const files = unzipSync(bytes);
    for (const [path, data] of Object.entries(files)) {
      if (path.endsWith(".xlsx")) inspect(data);
      if (path.endsWith("docProps/core.xml")) {
        const xml = strFromU8(data);
        assert.match(xml, /<dcterms:created[^>]*>1980-01-01T00:00:00Z<\/dcterms:created>/);
        assert.match(xml, /<dcterms:modified[^>]*>1980-01-01T00:00:00Z<\/dcterms:modified>/);
      }
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      assert.equal(view.getUint16(offset + 10, true), 0, "ZIP DOS time");
      assert.equal(view.getUint16(offset + 12, true), 33, "ZIP DOS date 1980-01-01");
      offset += 30 + view.getUint32(offset + 18, true) + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    }
  };
  inspect(first.bytes);
});

test("SI-04 document chart references remain explicit unavailable text without fetching remote payloads", async () => {
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "remote", type: "chart_ref", text: "Recorded reference", attrs: { chartRef: "https://example.test/private/chart", sourceRef: "source:canonical:filing" } }] });
  const result = reopen((await buildArtifactPptx(planFor(content), content)).bytes);
  assert.ok(result.text.includes("recorded chart payload unavailable"));
  assert.ok(result.text.includes("https://example.test/private/chart"));
  assert.ok(!Object.keys(result.files).some(path => /^ppt\/charts\/chart\d+\.xml$/.test(path)), "empty donor directory entries are not chart payloads");
});

test("SI-04 native PPTX fails closed on invalid kinds, chart fidelity, table cells and slide bounds", async () => {
  const plan = planFor(chartFixture);
  await assert.rejects(buildArtifactPptx({ ...plan, kind: "report" }, chartFixture), /does not match/);
  await assert.rejects(buildArtifactPptx({ ...plan, formats: ["json"] }, chartFixture), /not enabled/);
  const unsupported = { ...chartFixture, chartType: "pie" };
  await assert.rejects(buildArtifactPptx(planFor(unsupported), unsupported), /not supported/);
  const categoricalScatter = { ...chartFixture, chartType: "scatter", series: [{ id: "x", label: "X", points: [{ x: "2", y: 1 }] }] };
  await assert.rejects(buildArtifactPptx(planFor(categoricalScatter), categoricalScatter), /numeric x/);
  const duplicate = { ...chartFixture, series: [{ id: "x", label: "X", points: [{ x: 1, y: -1 }, { x: 1, y: 2 }] }] };
  await assert.rejects(buildArtifactPptx(planFor(duplicate), duplicate), /duplicate x/);
  const nonfinite = { ...chartFixture, series: [{ id: "x", label: "X", points: [{ x: 1, y: Infinity }] }] };
  await assert.rejects(buildArtifactPptx(planFor(nonfinite), nonfinite), /finite/);
  const tooManyPoints = { ...chartFixture, series: [{ id: "x", label: "X", points: Array.from({ length: 10_001 }, (_, x) => ({ x, y: x })) }] };
  await assert.rejects(buildArtifactPptx(planFor(tooManyPoints), tooManyPoints), /series\/point layout limit/);
  const malformed = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "invalid", type: "chart_ref", attrs: { chart: { url: "https://example.test/chart" } } }] });
  await assert.rejects(buildArtifactPptx(planFor(malformed), malformed), /valid recorded chart/);
  const invalidTable = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "invalid", type: "table", attrs: { table: { kind: "table", columns: [{ key: "x", label: "X" }], rows: [{ other: "unrecorded column" }] } } }] });
  await assert.rejects(buildArtifactPptx(planFor(invalidTable), invalidTable), /without recorded columns/);
  const hugeCell = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "huge", type: "table", attrs: { table: { kind: "table", columns: [{ key: "x", label: "X" }], rows: [{ x: "x".repeat(4000) }] } } }] });
  await assert.rejects(buildArtifactPptx(planFor(hugeCell), hugeCell), /cell layout limit/);
  const tooManySlides = artifactContentSchema.parse({ kind: "report", blocks: Array.from({ length: 201 }, (_, i) => ({ id: `heading-${i}`, type: "heading", text: `Heading ${i}` })) });
  await assert.rejects(buildArtifactPptx(planFor(tooManySlides), tooManySlides), /200-slide layout limit/);
  const tableSlides = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "long", type: "table", attrs: { table: { kind: "table", columns: [{ key: "x", label: "X" }], rows: Array.from({ length: 4000 }, (_, x) => ({ x })) } } }] });
  await assert.rejects(buildArtifactPptx(planFor(tableSlides), tableSlides), /200-slide layout limit/);
});
