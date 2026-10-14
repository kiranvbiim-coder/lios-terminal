import assert from "node:assert/strict";
import test from "node:test";
import { PDFParse } from "pdf-parse";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ArtifactContent, ArtifactExportPlan } from "../../../shared/artifactContracts";

import { artifactContentSchema, artifactExportPlanSchema } from "../../../shared/artifactContracts";
import { buildArtifactPdf } from "./exportPdf";

const HASH = "b".repeat(64);

async function parsePdf(bytes: Uint8Array) {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const text = await parser.getText();
    const info = await parser.getInfo();
    return { text: text.text, pages: info.total };
  } finally {
    await parser.destroy();
  }
}

test("SI-04.14 builds a deterministic multi-page professional Artifact PDF that reopens with lineage", async () => {
  const longBlocks = Array.from({ length: 72 }, (_, index) => ({
    id: `block-${index + 1}`,
    type: index % 12 === 0 ? "heading" as const : "paragraph" as const,
    text: index % 12 === 0
      ? `Section ${Math.floor(index / 12) + 1}`
      : `Evidence paragraph ${index + 1}: Revenue < growth & margin > trend remains under review with explicit source support.`,
    attrs: {},
  }));
  const content = artifactContentSchema.parse({
    kind: "research",
    question: "Should we invest in ACME & why?",
    blocks: longBlocks,
    claims: [{
      id: "claim-1",
      text: "Revenue improved",
      sourceRefs: ["source:filing:2026-q2"],
      provenance: "source_backed",
    }],
    evidence: [{
      id: "evidence-1",
      title: "Q2 filing",
      snippet: "Revenue increased while margin remained under review.",
      sourceRef: "source:filing:2026-q2",
      url: "https://example.com/q2",
      sourceType: "filing",
      observedAt: "2026-08-01T00:00:00.000Z",
    }],
  });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "artifact:research:acme",
    version: 4,
    kind: "research",
    formats: ["json", "md", "pdf"],
    filenameStem: "ACME Investment Research",
    contentHash: HASH,
    sourceRefs: ["source:project:brief", "source:filing:2026-q2"],
  });

  const first = buildArtifactPdf(plan, content);
  const second = buildArtifactPdf(plan, content);

  assert.equal(first.filename, "ACME Investment Research-v4.pdf");
  assert.ok(first.pageCount >= 2, "long professional output must paginate");
  assert.deepEqual(first.bytes, second.bytes, "same Artifact version must publish byte-identical PDF output");
  assert.equal(new TextDecoder().decode(first.bytes.slice(0, 5)), "%PDF-");
  assert.match(new TextDecoder().decode(first.bytes.slice(-16)), /%%EOF/);

  const reopened = await parsePdf(first.bytes);
  assert.equal(reopened.pages, first.pageCount);
  assert.match(reopened.text, /ACME Investment Research/);
  assert.match(reopened.text, /Should we invest in ACME & why\?/);
  assert.match(reopened.text, /Revenue < growth & margin > trend/);
  assert.match(reopened.text, /artifact:research:acme/);
  assert.match(reopened.text, /Version: 4/);
  assert.match(reopened.text, new RegExp(HASH));
  assert.match(reopened.text, /source:project:brief/);
  assert.match(reopened.text, /source:filing:2026-q2/);
  assert.match(reopened.text, /source_backed/);
  assert.match(reopened.text, /Page 1 of /);
});

test("SI-04.14 fails closed when the export plan and Artifact content disagree", () => {
  const content = artifactContentSchema.parse({
    kind: "report",
    blocks: [{ id: "b1", type: "paragraph", text: "Report body", attrs: {} }],
  });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "artifact:research:mismatch",
    version: 1,
    kind: "research",
    formats: ["pdf"],
    filenameStem: "Mismatch",
    contentHash: HASH,
    sourceRefs: [],
  });

  assert.throws(
    () => buildArtifactPdf(plan, content),
    /Artifact export plan kind "research" does not match content kind "report"/,
  );
});

test("SI-04.14 rejects unsupported non-document/chart publishing kinds", () => {
  const content = artifactContentSchema.parse({ kind: "table", columns: [], rows: [] });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "artifact:table:1", version: 1, kind: "table", formats: ["pdf"],
    filenameStem: "Table", contentHash: HASH, sourceRefs: [],
  });
  assert.throws(() => buildArtifactPdf(plan, content), /Professional Artifact PDF publishing is not supported for kind "table"/);
});

function publishingPlan(kind: ArtifactExportPlan["kind"] = "report"): ArtifactExportPlan {
  return artifactExportPlanSchema.parse({
    artifactId: "artifact:native:151", version: 7, kind, formats: ["pdf"],
    filenameStem: "Native professional report", contentHash: HASH,
    sourceRefs: ["source:table:uuid@v1", "source:chart:uuid@v3"],
  });
}

async function inspectNativePdf(bytes: Uint8Array) {
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const pages: { text: string; items: { text: string; font: string; x: number; y: number; width: number }[]; width: number; height: number; vectorPaths: number; links: string[] }[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const operators = await page.getOperatorList();
      const annotations = await page.getAnnotations();
      const items = content.items.flatMap(item => {
        if (!("str" in item)) return [];
        const font = page.commonObjs.get(item.fontName) as { name: string };
        return [{ text: item.str, font: font.name, x: item.transform[4], y: item.transform[5], width: item.width }];
      });
      pages.push({
        text: items.map(item => item.text).join(" "), items, width: viewport.width, height: viewport.height,
        vectorPaths: operators.fnArray.filter(operator => operator === OPS.constructPath).length,
        links: annotations.flatMap(annotation => annotation.subtype === "Link" && annotation.url ? [String(annotation.url)] : []),
      });
    }
    return pages;
  } finally { await document.destroy(); }
}

function signedChart(): Extract<ArtifactContent, { kind: "chart" }> {
  return artifactContentSchema.parse({
    kind: "chart", chartType: "line",
    series: [
      { id: "complete", label: "Complete signed series", points: [{ x: 0, y: -10 }, { x: 1, y: 0 }, { x: 2, y: 20 }] },
      { id: "sparse", label: "Sparse signed series", points: [{ x: 0, y: 30 }, { x: 2, y: -5 }] },
    ],
    options: { sourceVersion: "source:chart:uuid@v3", contentHash: HASH, truth: "source_backed" },
  }) as Extract<ArtifactContent, { kind: "chart" }>;
}

test("SI-04.14 native PDF preserves all 151 table rows, literal cells and horizontal/vertical pagination", async () => {
  const columns = Array.from({ length: 8 }, (_, index) => ({ key: `c${index}`, label: `Header${index}`, type: index === 7 ? "currency" : "string" }));
  const rows = Array.from({ length: 151 }, (_, row) => Object.fromEntries(columns.map((column, columnIndex) => [
    column.key, row === 150 && columnIndex === 7 ? "9007199254740993.25" : `cell-${row}-${columnIndex}`,
  ])));
  const content = artifactContentSchema.parse({
    kind: "report", blocks: [
      { id: "native-table", type: "table", text: "Complete literal source table", attrs: {
        table: { kind: "table", columns, rows }, sourceRef: "source:table:uuid@v1", truth: "source_backed", contentHash: HASH,
      } },
      { id: "after-table", type: "paragraph", text: "END OF COMPLETE TABLE", attrs: {} },
    ],
  });
  const built = buildArtifactPdf(publishingPlan(), content);
  assert.deepEqual(built.bytes, buildArtifactPdf(publishingPlan(), content).bytes);
  const reopened = await parsePdf(built.bytes);
  const pages = await inspectNativePdf(built.bytes);
  assert.equal(reopened.pages, built.pageCount);
  assert.equal(pages.length, built.pageCount);
  assert.ok(pages.length >= 4, "wide long table must paginate in both dimensions");
  for (let row = 0; row < 151; row++) for (let column = 0; column < 8; column++) {
    const value = row === 150 && column === 7 ? "9007199254740993.25" : `cell-${row}-${column}`;
    assert.ok(reopened.text.includes(value), `missing exact literal ${value}`);
  }
  assert.match(reopened.text, /END OF COMPLETE TABLE/);
  assert.match(reopened.text, /source:table:uuid@v1/);
  assert.match(reopened.text, new RegExp(HASH));
  assert.doesNotMatch(reopened.text, /"rows":/);
  assert.ok(pages.filter(page => page.text.includes("Header0")).length >= 2, "native table repeats its header on vertical continuations");
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    assert.ok(page.text.includes(`Page ${index + 1} of ${pages.length}`));
    for (const item of page.items.filter(item => item.text.trim())) {
      assert.ok(item.x >= 39.5, `left bound ${item.text}: ${item.x}`);
      assert.ok(item.x + item.width <= page.width - 39.5, `right bound ${item.text}: ${item.x + item.width}`);
      assert.ok(item.y >= 20 && item.y <= page.height - 20, `vertical page bound ${item.text}`);
    }
  }
});

test("SI-04.14 parses native bold/italic/code fonts, safe links, heading/list and bounded text", async () => {
  const text = "Bold Italic Strike Code Link";
  const content = artifactContentSchema.parse({
    kind: "report", blocks: [
      { id: "heading", type: "heading", text: "Authored heading", attrs: { level: 3 } },
      { id: "rich", type: "paragraph", text, attrs: { richText: { version: 1, text, runs: [
        { from: 0, to: 4, marks: [{ type: "bold" }] },
        { from: 5, to: 11, marks: [{ type: "italic" }, { type: "underline" }] },
        { from: 12, to: 18, marks: [{ type: "strike" }] },
        { from: 19, to: 23, marks: [{ type: "code" }] },
        { from: 24, to: 28, marks: [{ type: "link", attrs: { href: "https://example.com/evidence" } }] },
      ] } } },
      { id: "list", type: "ordered_list", text: "First item\nSecond item", attrs: { start: 12 } },
      { id: "code", type: "code", text: "literal_code = 123\nreturn literal_code", attrs: {} },
      { id: "long", type: "paragraph", text: "L".repeat(1800), attrs: {} },
      { id: "unsafe-link", type: "paragraph", text: "Unsafe", attrs: { richText: { version: 1, text: "Unsafe", runs: [
        { from: 0, to: 6, marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
      ] } } },
    ],
  });
  const built = buildArtifactPdf(publishingPlan(), content);
  const pages = await inspectNativePdf(built.bytes);
  const items = pages.flatMap(page => page.items);
  assert.ok(items.some(item => item.text.includes("Bold") && item.font === "Helvetica-Bold"));
  assert.ok(items.some(item => item.text.includes("Italic") && item.font === "Helvetica-Oblique"));
  assert.ok(items.some(item => item.text.includes("Code") && item.font === "Courier"));
  assert.ok(items.some(item => item.text.includes("literal_code") && item.font === "Courier"));
  const reopened = await parsePdf(built.bytes);
  assert.match(reopened.text, /Authored heading/);
  assert.match(reopened.text, /12\.\s*First item/);
  assert.match(reopened.text, /13\.\s*Second item/);
  assert.ok(pages[0].vectorPaths >= 5, "underline, strike and safe-link decoration must be native paths in addition to furniture");
  assert.ok(pages.some(page => page.links.includes("https://example.com/evidence")));
  assert.ok(pages.every(page => page.links.every(link => !link.startsWith("javascript:"))));
  assert.equal(items.filter(item => /^L+$/.test(item.text)).reduce((sum, item) => sum + item.text.length, 0), 1800, "long literal tokens wrap without losing any glyphs");
  for (const page of pages) for (const item of page.items) assert.ok(item.x + item.width <= page.width - 39.5);
});

test("SI-04.14 publishes signed direct and recorded charts with lineage without raw payload duplication", async () => {
  const chart = signedChart();
  const direct = buildArtifactPdf(publishingPlan("chart"), chart);
  const report = artifactContentSchema.parse({
    kind: "report", blocks: [
      { id: "chart", type: "chart_ref", text: "Source-backed signed result", attrs: { chart, sourceRef: "source:chart:uuid@v3", contentHash: HASH } },
      { id: "unknown", type: "chart_ref", text: "Recorded unavailable chart reference", attrs: { artifactId: "chart:unknown", version: 11 } },
    ],
  });
  const embedded = buildArtifactPdf(publishingPlan(), report);
  for (const generated of [direct, embedded]) {
    assert.deepEqual(generated.bytes, generated === direct ? buildArtifactPdf(publishingPlan("chart"), chart).bytes : buildArtifactPdf(publishingPlan(), report).bytes);
    const reopened = await parsePdf(generated.bytes);
    assert.equal(reopened.pages, generated.pageCount);
    assert.ok((await inspectNativePdf(generated.bytes)).some(page => page.vectorPaths >= 9), "signed chart must contain native vector geometry, not only JSON text");
    assert.match(reopened.text, /Complete signed series/);
    assert.match(reopened.text, /Sparse signed series/);
    assert.match(reopened.text, /Full source: 5 observations; 3 distinct x values/);
    assert.match(reopened.text, /Shared y domain: -10 to 30/);
    assert.match(reopened.text, /source:chart:uuid@v3/);
    assert.match(reopened.text, new RegExp(HASH));
    assert.doesNotMatch(reopened.text, /"points":/);
    assert.match(reopened.text, /source_backed/);
  }
  assert.match((await parsePdf(embedded.bytes)).text, /Recorded unavailable chart reference/);
});

test("SI-04.14 fails explicitly before delivery for unsupported glyphs and invalid/unsupported recorded charts", () => {
  for (const text of ["Unsupported emoji \u{1f4c8}", "Unsupported CJK \u7814", "Unsupported combining e\u0301"]) {
    const report = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "b", type: "paragraph", text, attrs: {} }] });
    assert.throws(() => buildArtifactPdf(publishingPlan(), report), /PDF font does not support U\+/);
  }
  for (const chart of [{ ...signedChart(), chartType: "candlestick" }, { kind: "chart", chartType: "line", series: "invalid" }]) {
    const report = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "b", type: "chart_ref", text: "Recorded chart", attrs: { chart } }] });
    assert.throws(() => buildArtifactPdf(publishingPlan(), report), Error);
  }
});

test("SI-04.14 native table keeps formula-like strings, null, booleans, negative zero and absent cells literal", async () => {
  const keys = ["formula", "null", "true", "false", "zero", "decimal", "absent"];
  const report = artifactContentSchema.parse({
    kind: "report", blocks: [{ id: "literal-table", type: "table", text: "Exact literal values", attrs: { table: {
      kind: "table", columns: keys.map(key => ({ key, label: key, type: "string" })),
      rows: [{ formula: "=SUM(A1:A2)", null: null, true: true, false: false, zero: -0, decimal: "9007199254740993.25" }],
    } } }],
  });
  const reopened = await parsePdf(buildArtifactPdf(publishingPlan(), report).bytes);
  for (const value of ["=SUM(A1:A2)", "null", "true", "false", "-0", "9007199254740993.25", "Not recorded"]) assert.ok(reopened.text.includes(value), value);
});

test("SI-04.21 professional PDF keeps page-boundary headings with their following text without losing content", async () => {
  const pairs = Array.from({ length: 32 }, (_, index) => ({
    heading: `Boundary heading ${index}`,
    following: `Following explanation ${index}`,
  }));
  const content = artifactContentSchema.parse({
    kind: "report",
    blocks: pairs.flatMap((pair, index) => [
      { id: `filler-${index}`, type: "paragraph", text: `Filler passage ${index}\nSecond literal line ${index}`, attrs: {} },
      { id: `heading-${index}`, type: index % 2 ? "callout" : "heading", text: pair.heading, attrs: {} },
      { id: `following-${index}`, type: "paragraph", text: pair.following, attrs: {} },
    ]),
  });
  const built = buildArtifactPdf(publishingPlan(), content);
  assert.deepEqual(built.bytes, buildArtifactPdf(publishingPlan(), content).bytes);
  const pages = await inspectNativePdf(built.bytes);
  assert.ok(pages.length > 2, "exercise heading groups across several real pages");
  for (const pair of pairs) {
    const exactHeadingPages = pages.filter(page => page.items.some(item => item.text === pair.heading));
    assert.equal(exactHeadingPages.length, 1, pair.heading);
    assert.ok(exactHeadingPages[0].items.some(item => item.text === pair.following), "following paragraph must share its heading page");
  }
  for (const page of pages) for (const item of page.items.filter(item => item.text.trim())) {
    assert.ok(item.x >= 39.5);
    assert.ok(item.x + item.width <= page.width - 39.5);
    assert.ok(item.y >= 20 && item.y <= page.height - 20);
  }
});
