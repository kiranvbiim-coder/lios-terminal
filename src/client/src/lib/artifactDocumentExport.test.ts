import assert from "node:assert/strict";
import { posix } from "node:path";
import test from "node:test";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { PDFParse } from "pdf-parse";
import { artifactContentSchema, artifactExportPlanSchema, type ArtifactContent } from "../../../shared/artifactContracts";
import { officeArtifactMetadataSchema } from "../../../shared/officeArtifactRoundtrip";
import { buildArtifactMarkdown } from "./exportMarkdown";
import { buildArtifactPptx } from "./exportPptx";
import { buildArtifactDocx } from "./exportDocx";
import { exportArtifactLocal } from "./artifactExport";
import { buildArtifactPdf } from "./exportPdf";
import { artifactDocumentItems, artifactDocumentParagraphs } from "./artifactDocumentExport";
import { authoredPng } from "../../../shared/artifactImage.test-fixtures";
import { createHash } from "node:crypto";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readOfficeArtifactRoundtrip } from "../../../shared/officeArtifactRoundtrip";
import { zipSync } from "fflate";

const HASH = "b".repeat(64);
const SOURCE_HASH = "c".repeat(64);
const SOURCE = "source:filing:acme_2026-q2";
const EVIDENCE = "artifact:research:acme@v4#evidence:e1";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, trimValues: false });

const research = artifactContentSchema.parse({
  kind: "research", question: "Should we invest in ACME & why?",
  blocks: [
    { id: "finding", type: "heading", text: "Investment finding", attrs: {} },
    { id: "quote-0", type: "quote", text: "Revenue < growth & margin > trend", attrs: {
      sourceRef: SOURCE, evidenceId: "e1", contentHash: SOURCE_HASH, evidenceVersionRef: EVIDENCE, excerptSha256: "d".repeat(64),
      provenance: { sourceUrl: "https://example.test/q2", retrievedAt: "2026-10-07T12:00:00Z", extractionCompleteness: "partial" },
      truth: { sourceQuality: { tier: "primary", claimVerification: "not_verified_by_digest" }, temporal: { modelPeriod: "2026-Q2" } },
    } },
    { id: "citation-0", type: "paragraph", text: `Source: ${SOURCE} · primary · not_verified_by_digest`, attrs: {} },
    { id: "ordered", type: "ordered_list", text: "Inspect filing\nCompare margin", attrs: {} },
  ],
  claims: [{ id: "claim1", text: "Revenue improved", provenance: "source_backed", sourceRefs: [SOURCE] }, { id: "claim2", text: "Margin may recover", provenance: "explicit_inference", sourceRefs: [] }],
  evidence: [{ id: "e1", title: "Q2 filing", snippet: "Revenue increased.", sourceRef: SOURCE, sourceType: "filing", url: "https://example.test/q2", observedAt: "2026-08-01T00:00:00.000Z" }],
  contradictions: [{ id: "contra1", summary: "Margin pressure remains", status: "open", claimRefs: ["claim2"], evidenceRefs: [EVIDENCE] }],
  executionTrail: [{ at: "2026-10-07T12:00:00.000Z", action: "Inspect filing", sourceRefs: [SOURCE], receiptId: "receipt:filing:1" }],
});
const report = artifactContentSchema.parse({
  kind: "report", templateId: "template:investment",
  sections: [{ id: "s1", title: "Executive summary", blockIds: ["b1", "b2"] }],
  blocks: [{ id: "b2", type: "quote", text: "Quoted filing evidence", attrs: { sourceRef: SOURCE, contentHash: SOURCE_HASH } }, { id: "b1", type: "paragraph", text: "Recommendation after review", attrs: {} }, { id: "citation-0", type: "paragraph", text: `Source: ${SOURCE}`, attrs: {} }],
});
const decision = artifactContentSchema.parse({
  kind: "decision", objective: "Choose the investment plan", whatChanged: ["New filing arrived"], why: ["Margin is uncertain"], constraints: ["Keep liquidity"], assumptions: { growth: "12.50%", period: "2026-Q2" },
  scenarios: [{ id: "base", label: "Base case", kind: "base", artifactRef: "artifact:model:acme@v2", summary: "Stable margin" }],
  alternatives: [{ id: "wait", label: "Wait for evidence", expectedOutcomes: ["Reduce uncertainty"], risks: ["Miss upside"], tradeoffs: ["Preserve capital"] }], selectedAlternativeId: "wait",
  uncertainties: ["Demand recovery"], nextActions: ["Read next filing"], implementation: ["Retain cash"], monitoring: ["Track margin"], linkedRefs: { sources: [SOURCE], models: ["artifact:model:acme@v2"], monitors: ["monitor:margin"] },
});
const thesis = artifactContentSchema.parse({
  kind: "thesis", entityRef: "entity:acme", status: "active", summary: "Margin recovery thesis",
  expectedOutcomes: [{ id: "outcome1", text: "Margin recovers", dueAt: "2027-01-01T00:00:00.000Z", evidenceRefs: [EVIDENCE] }],
  claims: [{ id: "tclaim1", text: "Recovery is possible", status: "supported", confidence: 0, evidenceRefs: [EVIDENCE], counterEvidenceRefs: ["source:counter:margin"], updatedAt: "2026-10-07T00:00:00.000Z" }],
  catalysts: [{ id: "cat1", text: "New product", evidenceRefs: [EVIDENCE] }], risks: [{ id: "risk1", text: "Weak demand", evidenceRefs: [EVIDENCE] }],
  invalidationConditions: [{ id: "inv1", text: "Margin falls", triggered: true, evidenceRefs: [EVIDENCE] }], openQuestions: [{ id: "q1", text: "How durable is demand?", evidenceRefs: [EVIDENCE] }],
  refresh: { lastRefreshedAt: "2026-10-07T00:00:00.000Z", snapshotId: "snapshot:1", changes: ["Demand improved"], contradictions: ["Margin weakened"] },
  postmortems: [{ at: "2026-10-07T00:00:00.000Z", outcome: "partially_validated", summary: "Mixed outcome", whatWorked: ["Revenue signal"], whatFailed: ["Margin signal"], evidenceRefs: [EVIDENCE] }],
});

function planFor(content: ArtifactContent) {
  return artifactExportPlanSchema.parse({ artifactId: `artifact:${content.kind}:acme`, version: 4, kind: content.kind, formats: ["md", "pptx", "docx"], filenameStem: "ACME Evidence", contentHash: HASH, sourceRefs: ["source:project:brief", SOURCE] });
}

function xmlText(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(xmlText);
  return Object.entries(value).flatMap(([key, item]) => key === "a:t" ? [typeof item === "object" && item !== null ? String((item as Record<string, unknown>)["#text"] ?? "") : String(item)] : xmlText(item));
}

function reopenPptx(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const metadata = parser.parse(strFromU8(files["customXml/liosArtifact.xml"])).liosArtifact;
  const bindings = officeArtifactMetadataSchema.parse(JSON.parse(metadata.payload)).bindings;
  const narrativeIds = new Set(bindings.filter(binding => binding.kind === "text" && binding.segments).map(binding => binding.id));
  for (const [path, body] of Object.entries(files)) {
    if (!path.endsWith(".xml") && !path.endsWith(".rels")) continue;
    const xml = strFromU8(body);
    assert.equal(XMLValidator.validate(xml), true, `generated part must be well-formed: ${path}`);
    if (path.endsWith(".rels")) {
      const parsed = parser.parse(xml).Relationships.Relationship;
      const relations = Array.isArray(parsed) ? parsed : [parsed];
      const owner = path === "_rels/.rels" ? "" : path.replace("/_rels/", "/").replace(/\.rels$/, "");
      for (const relation of relations) {
        if (relation["@TargetMode"] === "External") continue;
        const target = relation["@Target"].startsWith("/") ? relation["@Target"].slice(1) : posix.normalize(posix.join(owner ? posix.dirname(owner) : "", relation["@Target"]));
        assert.ok(files[target], `relationship ${path} must resolve to ${target}`);
      }
    }
  }
  const slidePaths = Object.keys(files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]));
  const text: string[] = [];
  const body: string[] = [];
  for (const path of slidePaths) {
    const parsed = parser.parse(strFromU8(files[path]));
    text.push(xmlText(parsed).join(""));
    const shapes = parsed["p:sld"]["p:cSld"]["p:spTree"]["p:sp"];
    for (const shape of shapes ? (Array.isArray(shapes) ? shapes : [shapes]) : []) {
      if (narrativeIds.has(shape["p:nvSpPr"]["p:cNvPr"]["@name"])) body.push(...xmlText(shape));
    }
  }
  const ids = parser.parse(strFromU8(files["ppt/presentation.xml"]))["p:presentation"]["p:sldIdLst"]["p:sldId"];
  assert.equal((Array.isArray(ids) ? ids : [ids]).length, slidePaths.length);
  assert.equal(Number(parser.parse(strFromU8(files["docProps/app.xml"])).Properties.Slides), slidePaths.length);
  return { files, slideCount: slidePaths.length, text: `${text.join("\n")}\n${body.join("")}`, body: body.join("") };
}

for (const [content, expected] of [
  [research, ["Research question", "Investment finding", "Revenue improved", "explicit_inference", "Research evidence", "Margin pressure remains", "receipt:filing:1", SOURCE_HASH, EVIDENCE, "not_verified_by_digest"]],
  [report, ["Executive summary", "Recommendation after review", "Quoted filing evidence", SOURCE_HASH]],
  [decision, ["Objective", "Wait for evidence (selected)", "12.50%", "Stable margin", "artifact:model:acme@v2", "Read next filing", "Track margin"]],
  [thesis, ["Margin recovery thesis", "Counter-evidence", "source:counter:margin", "Confidence: 0", "Margin falls", "snapshot:1", "Mixed outcome", "Revenue signal", "Margin signal", EVIDENCE]],
] as const) {
  test(`SI-04 evidence-preserving ${content.kind} Markdown publishes deterministic readable bytes`, () => {
    const plan = planFor(content);
    const file = buildArtifactMarkdown(plan, content);
    assert.equal(file.filename, "ACME Evidence-v4.md");
    assert.deepEqual(file.bytes, buildArtifactMarkdown(plan, content).bytes);
    const text = strFromU8(file.bytes);
    assert.match(text, /^# ACME Evidence\n/);
    for (const value of [...expected, plan.artifactId, "Version: 4", HASH, SOURCE, "source:project:brief"]) assert.ok(text.includes(value), `Markdown must retain ${value}`);
    assert.ok(text.endsWith("\n"));
    if (content.kind === "research") {
      assert.ok(text.includes("1. Inspect filing") && text.includes("2. Compare margin"));
      assert.ok(text.includes("> Revenue \\< growth & margin \\> trend"));
      assert.ok(text.includes("https://example.test/q2"));
    }
  });

  test(`SI-04 semantic ${content.kind} PPTX reopens with evidence and complete OOXML relationships`, async () => {
    const plan = planFor(content);
    const file = await buildArtifactPptx(plan, content);
    assert.equal(file.filename, "ACME Evidence-v4.pptx");
    assert.deepEqual(file.bytes, (await buildArtifactPptx(plan, content)).bytes);
    const reopened = reopenPptx(file.bytes);
    assert.equal(reopened.slideCount, file.slideCount);
    assert.ok(!reopened.text.includes("Artifact JSON"));
    for (const value of [...expected, plan.artifactId, "Version: 4", HASH, SOURCE, "source:project:brief"]) assert.ok(reopened.text.includes(value), `PPTX must retain ${value}`);
    const core = parser.parse(strFromU8(reopened.files["docProps/core.xml"]))["cp:coreProperties"];
    assert.equal(core["dc:identifier"], plan.artifactId);
    assert.equal(core["dc:subject"], `${content.kind} Artifact v4`);
    assert.equal(core["cp:keywords"], HASH);
  });
}

test("SI-04 report sections reorder only their referenced blocks and retain unsectioned citations", () => {
  const text = strFromU8(buildArtifactMarkdown(planFor(report), report).bytes);
  assert.ok(text.indexOf("Recommendation after review") < text.indexOf("Quoted filing evidence"));
  assert.ok(text.includes(`Source: ${SOURCE}`));
});

test("SI-04 long PPTX paragraphs continue without dropping text or splitting surrogate pairs", async () => {
  const longText = "START " + "業績改善🙂 margin recovery ".repeat(180) + " END";
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "long", type: "paragraph", text: longText, attrs: {} }] });
  const file = await buildArtifactPptx(planFor(content), content);
  const reopened = reopenPptx(file.bytes);
  assert.ok(file.slideCount > 1);
  assert.ok(reopened.body.includes(longText), "all long-text characters must survive exported slide bodies in order");
  assert.ok(!reopened.text.includes("\uFFFD"));
});

test("SI-04 exporters fail closed on kind, format and document/slide bounds without partial files", async () => {
  const plan = planFor(research);
  const huge = artifactContentSchema.parse({ kind: "report", blocks: Array.from({ length: 21 }, (_, index) => ({ id: `b${index}`, type: "paragraph", text: "x".repeat(200_000), attrs: {} })) });
  assert.throws(() => buildArtifactMarkdown(plan, report), /does not match content kind/);
  assert.throws(() => buildArtifactMarkdown({ ...plan, formats: ["json"] }, research), /not enabled/);
  const chart = artifactContentSchema.parse({ kind: "chart", chartType: "line", series: [] });
  assert.throws(() => buildArtifactMarkdown({ ...plan, kind: "chart" }, chart), /not supported for kind "chart"/);
  assert.throws(() => buildArtifactMarkdown(planFor(huge), huge), /document layout limit/);
  await assert.rejects(buildArtifactPptx(plan, report), /does not match content kind/);
  await assert.rejects(buildArtifactPptx({ ...plan, formats: ["json"] }, research), /not enabled/);
  await assert.rejects(buildArtifactPptx(planFor(huge), huge), /document layout limit/);
  const many = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "b", type: "paragraph", text: "x".repeat(120_000), attrs: {} }] });
  await assert.rejects(buildArtifactPptx(planFor(many), many), /200-slide layout limit/);
});

test("SI-04 code fences, raw reference identifiers and filenames survive Markdown export", () => {
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "code", type: "code", text: "```\nvalue = '<tag>'\n```", attrs: { sourceRef: "source:raw:[id]_1", contentHash: SOURCE_HASH } }] });
  const file = buildArtifactMarkdown({ ...planFor(content), filenameStem: "Unsafe/Title: Research" }, content);
  const text = strFromU8(file.bytes);
  assert.equal(file.filename, "Unsafe-Title- Research-v4.md");
  assert.ok(text.includes("````\n```\nvalue = '<tag>'\n```\n````"));
  assert.ok(text.includes("source:raw:[id]_1"));
  assert.ok(text.includes(SOURCE_HASH));
});

test("SI-04 shared evidence projection keeps existing DOCX lineage and precise citation metadata", () => {
  const files = unzipSync(buildArtifactDocx(planFor(research), research).bytes);
  const document = strFromU8(files["word/document.xml"]);
  for (const value of [SOURCE_HASH, EVIDENCE, "not_verified_by_digest", "Compare margin", "receipt:filing:1"]) assert.ok(document.includes(value));
  assert.ok(document.includes("<w:numPr>"), "recorded ordered lists must remain editable native numbering");
});

test("SI-04 local download routing delivers generated semantic bytes while retaining strategy and table paths", async (t) => {
  const downloads: Array<{ filename: string; blob: Blob }> = [];
  let activeBlob: Blob;
  t.mock.method(URL, "createObjectURL", (blob: Blob) => { activeBlob = blob; return "blob:lios-export-test"; });
  t.mock.method(URL, "revokeObjectURL", () => {});
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ href: "", download: "", click() { downloads.push({ filename: this.download, blob: activeBlob }); } }) } });
  try {
    const plan = planFor(research);
    await exportArtifactLocal(plan, research, "md");
    await exportArtifactLocal(plan, research, "pptx");
    assert.equal(downloads[0].filename, "ACME Evidence-v4.md");
    assert.equal(downloads[0].blob.type, "text/markdown;charset=utf-8");
    assert.deepEqual(new Uint8Array(await downloads[0].blob.arrayBuffer()), buildArtifactMarkdown(plan, research).bytes);
    assert.equal(downloads[1].blob.type, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    assert.ok(reopenPptx(new Uint8Array(await downloads[1].blob.arrayBuffer())).text.includes(SOURCE_HASH));
    const strategy = artifactContentSchema.parse({ kind: "strategy", source: "buy when x > 1" });
    await exportArtifactLocal({ ...planFor(strategy), formats: ["md"] }, strategy, "md");
    assert.equal(await downloads[2].blob.text(), strategy.kind === "strategy" ? strategy.source : "");
    const table = artifactContentSchema.parse({ kind: "table", columns: [{ key: "metric", label: "Metric" }], rows: [{ metric: "Revenue" }] });
    await exportArtifactLocal({ ...planFor(table), formats: ["pptx"] }, table, "pptx");
    const tableFiles = unzipSync(new Uint8Array(await downloads[3].blob.arrayBuffer()));
    assert.ok(strFromU8(tableFiles["ppt/slides/slide2.xml"]).includes("Revenue"));
    await assert.rejects(exportArtifactLocal(plan, report, "md"), /does not match content kind/);
    assert.equal(downloads.length, 4, "mismatch must not download a file");
    const chart = artifactContentSchema.parse({ kind: "chart", chartType: "line", series: [{ id: "revenue", label: "Revenue", points: [{ x: "2026-Q1", y: 10 }, { x: "2026-Q2", y: 12 }] }] });
    await exportArtifactLocal(planFor(chart), chart, "pptx");
    const chartFiles = reopenPptx(new Uint8Array(await downloads[4].blob.arrayBuffer())).files;
    assert.ok(Object.keys(chartFiles).some(path => /^ppt\/charts\/chart\d+\.xml$/.test(path)), "direct chart exports must contain an editable native chart");
    let guards = 0;
    await assert.rejects(exportArtifactLocal(plan, research, "pptx", () => {
      guards += 1;
      if (guards === 2) throw new Error("Revision changed while generating.");
    }), /Revision changed while generating/);
    assert.equal(guards, 2, "revision must be checked again after asynchronous generation");
    assert.equal(downloads.length, 5, "stale generation must not download a file");
    const unsupported = artifactContentSchema.parse({ ...chart, chartType: "pie" });
    await assert.rejects(exportArtifactLocal(planFor(unsupported), unsupported, "pptx"), /unsupported|not supported/i);
    assert.equal(downloads.length, 5, "failed native generation must not download a file");
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => { throw new Error("Download unavailable."); } } });
    await assert.rejects(exportArtifactLocal(plan, research, "pptx"), /Download unavailable/);
    assert.equal(downloads.length, 5, "download delivery failures must reject without claiming success");
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("SI-04 Markdown retains unsafe evidence URLs literally without creating active HTML or links", () => {
  const content = artifactContentSchema.parse({
    kind: "research",
    blocks: [
      { id: "quote", type: "quote", text: "<img src=x onerror=alert(1)>", attrs: { sourceRef: "source:unsafe", provenance: { sourceUrl: "javascript:alert(1)" } } },
      { id: "code", type: "code", text: "```</script>", attrs: {} },
    ],
    evidence: [{ id: "unsafe", title: "Untrusted URL", sourceRef: "source:unsafe", url: "javascript:alert(1)", snippet: "<script>alert(1)</script>" }],
  });
  const text = strFromU8(buildArtifactMarkdown(planFor(content), content).bytes);
  assert.ok(text.includes("` URL: javascript:alert(1) `"));
  assert.ok(text.includes("\\<img src=x onerror=alert(1)\\>"));
  assert.ok(text.includes("\\<script\\>alert(1)\\</script\\>"));
  assert.ok(!text.includes("](javascript:") && !text.includes("<javascript:"));
});

test("SI-04 semantic PPTX preserves consecutive heading-only sections and long headings", async () => {
  const longHeading = "Long heading with complete meaning ".repeat(6);
  const content = artifactContentSchema.parse({
    kind: "report",
    blocks: [
      { id: "h1", type: "heading", text: "First empty section", attrs: {} },
      { id: "h2", type: "heading", text: "Second empty section", attrs: {} },
      { id: "h3", type: "heading", text: longHeading, attrs: {} },
    ],
  });
  const reopened = reopenPptx((await buildArtifactPptx(planFor(content), content)).bytes);
  assert.ok(reopened.text.includes("First empty section") && reopened.text.includes("Second empty section"));
  assert.ok(reopened.body.includes(longHeading));
});

test("SI-04 recorded metadata insertion order does not change deterministic Markdown/PPTX bytes", async () => {
  const first = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "q", type: "quote", text: "Evidence", attrs: { sourceRef: SOURCE, provenance: { retrievedAt: "2026-10-07", sourceUrl: "https://example.test/q2" } } }] });
  const reordered = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "q", type: "quote", text: "Evidence", attrs: { provenance: { sourceUrl: "https://example.test/q2", retrievedAt: "2026-10-07" }, sourceRef: SOURCE } }] });
  assert.deepEqual(buildArtifactMarkdown(planFor(first), first).bytes, buildArtifactMarkdown(planFor(reordered), reordered).bytes);
  assert.deepEqual((await buildArtifactPptx(planFor(first), first)).bytes, (await buildArtifactPptx(planFor(reordered), reordered)).bytes);
});

const recordedTableReport = () => artifactContentSchema.parse({
  kind: "report",
  sections: [{ id: "section-values", title: "Recorded financial values", blockIds: ["table-values"] }],
  blocks: [{
    id: "table-values", type: "table", text: "Source values, without financial formatting",
    attrs: {
      sourceRef: SOURCE, sourceVersionRef: EVIDENCE, receiptId: "receipt:table:exact", custom: { retained: "all recorded attributes" },
      table: {
        kind: "table",
        columns: [{ key: "metric", label: "Metric", type: "string" }, { key: "value", label: "Exact value", type: "currency" }, { key: "flag", label: "Recorded flag", type: "boolean" }],
        rows: [{ metric: "Revenue", value: "00123.4500", flag: false }, { metric: "Margin", value: "12.5000%", flag: true }, { metric: "Signed zero", value: -0, flag: null }, { metric: "Missing value", flag: false }],
      },
    },
  }],
});

test("SI-04 table projection emits every recorded column and row, exact values and provenance through existing paragraph layout", () => {
  const content = recordedTableReport();
  const paragraphs = artifactDocumentParagraphs(planFor(content), content);
  const rows = paragraphs.filter(paragraph => paragraph.text.startsWith("Row "));
  assert.deepEqual(rows.map(paragraph => paragraph.text), [
    "Row 1: Metric: Revenue | Exact value: 00123.4500 | Recorded flag: false",
    "Row 2: Metric: Margin | Exact value: 12.5000% | Recorded flag: true",
    "Row 3: Metric: Signed zero | Exact value: -0 | Recorded flag: null",
    "Row 4: Metric: Missing value | Exact value: Not recorded | Recorded flag: false",
  ]);
  assert.ok(paragraphs.some(paragraph => paragraph.text === "Columns: Metric [metric] | Exact value [value] | Recorded flag [flag]"));
  const metadata = paragraphs.filter(paragraph => paragraph.style === "meta").map(paragraph => paragraph.text).join("\n");
  for (const value of [SOURCE, EVIDENCE, "receipt:table:exact", "all recorded attributes", "00123.4500", '"value": -0']) assert.ok(metadata.includes(value));
  assert.equal(content.kind === "report" && content.sections[0].id, "section-values");
});

test("SI-04 recorded tables survive native PPTX and readable Markdown, DOCX and PDF exports", async () => {
  const content = recordedTableReport();
  const plan = planFor(content);
  plan.formats.push("pdf");
  const markdown = strFromU8(buildArtifactMarkdown(plan, content).bytes);
  const pptx = reopenPptx((await buildArtifactPptx(plan, content)).bytes);
  const docx = unzipSync(buildArtifactDocx(plan, content).bytes);
  const document = strFromU8(docx["word/document.xml"]);
  const pdf = new PDFParse({ data: buildArtifactPdf(plan, content).bytes });
  try {
    const pdfText = (await pdf.getText()).text;
    for (const text of [markdown, pptx.text, document, pdfText]) {
      for (const value of ["Recorded financial values", "00123.4500", "12.5000%", "Signed zero", "Not recorded", "receipt:table:exact", SOURCE, EVIDENCE]) assert.ok(text.includes(value), `semantic document must retain ${value}`);
    }
    assert.ok(document.includes("<w:tbl>"), "DOCX must contain an editable native table");
    assert.ok(Object.entries(pptx.files).some(([path, bytes]) => /^ppt\/slides\/slide\d+\.xml$/.test(path) && strFromU8(bytes).includes("<a:tbl>")), "PPTX must contain an editable native table");
  } finally {
    await pdf.destroy();
  }
});

test("SI-04 table export has no preview truncation and fails on existing full-document limits instead of emitting a partial table", async () => {
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "long-table", type: "table", text: "All rows", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: Array.from({ length: 151 }, (_, index) => ({ v: `exact-row-${index}` })) } } }] });
  const rows = artifactDocumentParagraphs(planFor(content), content).filter(paragraph => paragraph.text.startsWith("Row "));
  assert.equal(rows.length, 151);
  assert.equal(rows.at(-1)?.text, "Row 151: Value: exact-row-150");
  const huge = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "huge-table", type: "table", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: Array.from({ length: 41 }, () => ({ v: "x".repeat(100_000) })) } } }] });
  for (const build of [buildArtifactMarkdown, buildArtifactDocx, buildArtifactPdf]) assert.throws(() => build({ ...planFor(huge), formats: ["md", "pptx", "docx", "pdf"] }, huge), /document layout limit/);
  await assert.rejects(buildArtifactPptx(planFor(huge), huge), /document layout limit/);
});

test("SI-04 legacy and nonfinite table exports retain original captions, unknown attributes and literal values with an explicit warning", () => {
  const content = artifactContentSchema.parse({ kind: "report", blocks: [
    { id: "legacy", type: "table", text: "Original opaque table caption", attrs: { rows: [["legacy exact value"]], unknown: { source: SOURCE } } },
    { id: "nonfinite", type: "table", text: "Unprojectable typed values", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: [{ v: NaN }, { v: Infinity }, { v: -Infinity }] }, receiptId: "receipt:legacy" } },
  ] });
  const paragraphs = artifactDocumentParagraphs(planFor(content), content);
  const text = paragraphs.map(paragraph => paragraph.text).join("\n");
  for (const value of ["original text and attributes are retained", "Original opaque table caption", "legacy exact value", SOURCE, "NaN", "Infinity", "-Infinity", "receipt:legacy"]) assert.ok(text.includes(value));
  assert.equal(paragraphs.some(paragraph => paragraph.text.startsWith("Row ")), false);
});

test("SI-04 recorded table strings cannot activate HTML, executable URLs, external fetching or office relationships", async () => {
  const html = '<img src="https://remote.test/private" onerror="alert(1)">';
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "unsafe-table", type: "table", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Unsafe recorded text" }], rows: [{ v: html }, { v: "javascript:alert(1)" }, { v: "https://remote.test/private" }] } } }] });
  const text = strFromU8(buildArtifactMarkdown(planFor(content), content).bytes);
  assert.ok(text.includes("\\<img"));
  assert.ok(text.includes("Row 1: Unsafe recorded text: \\<img"));
  assert.ok(!text.includes("](javascript:") && !text.includes("](https://remote"));
  const reopened = reopenPptx((await buildArtifactPptx(planFor(content), content)).bytes);
  const files = reopened.files;
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith(".rels")) assert.ok(!strFromU8(bytes).includes("https://remote.test") && !strFromU8(bytes).includes("javascript:"));
    if (path.endsWith(".xml")) assert.equal(XMLValidator.validate(strFromU8(bytes)), true);
  }
  assert.ok(reopened.text.includes(html));
});

test("SI-04 native semantic items preserve UTF-16 rich runs, list starts, blank items and canonical metadata", () => {
  const listText = "A😀\n\nBold\n";
  const content = artifactContentSchema.parse({
    kind: "report",
    sections: [{ id: "rich-section", title: "Native formatting", blockIds: ["heading", "list", "stale"] }],
    blocks: [
      { id: "stale", type: "paragraph", text: "New snapshot", attrs: { richText: { version: 1, text: "Old snapshot", runs: [{ from: 0, to: 3, marks: [{ type: "bold" }] }] }, receiptId: "receipt:stale" } },
      { id: "heading", type: "heading", text: "Rich title", attrs: { level: 4, sourceRef: SOURCE, custom: { retained: "unchanged" }, richText: { version: 1, text: "Rich title", runs: [{ from: 0, to: 4, marks: [{ type: "italic" }] }] } } },
      { id: "list", type: "ordered_list", text: listText, attrs: { start: 7, sourceVersionRef: EVIDENCE, richText: { version: 1, text: listText, runs: [
        { from: 1, to: 8, marks: [{ type: "bold" }] },
        { from: 8, to: 9, marks: [{ type: "link", attrs: { href: "https://example.test/evidence", target: "_self" } }] },
      ] } } },
    ],
  });
  const before = structuredClone(content);
  const plan = planFor(content);
  const legacy = artifactDocumentParagraphs(plan, content);
  assert.deepEqual(legacy.filter(item => item.style === "ordered"), [
    { text: "A😀", style: "ordered", ordinal: 1 },
    { text: "Bold", style: "ordered", ordinal: 2 },
  ], "existing plain-format consumers keep their established projection");
  const items = artifactDocumentItems(plan, content);
  const heading = items.find(item => item.kind === "paragraph" && item.block?.id === "heading");
  assert.ok(heading?.kind === "paragraph");
  assert.equal(heading.headingLevel, 4);
  assert.deepEqual(heading.formatting, { version: 1, text: "Rich title", runs: [{ from: 0, to: 4, marks: [{ type: "italic" }] }] });
  const list = items.filter(item => item.kind === "paragraph" && item.block?.id === "list");
  assert.deepEqual(list.map(item => item.kind === "paragraph" && { text: item.text, ordinal: item.ordinal, listId: item.listId, listStart: item.listStart }), [
    { text: "A😀", ordinal: 7, listId: "list", listStart: 7 },
    { text: "", ordinal: 8, listId: "list", listStart: 7 },
    { text: "Bold", ordinal: 9, listId: "list", listStart: 7 },
    { text: "", ordinal: 10, listId: "list", listStart: 7 },
  ]);
  assert.deepEqual(list.map(item => item.kind === "paragraph" && item.formatting), [
    { version: 1, text: "A😀", runs: [{ from: 1, to: 3, marks: [{ type: "bold" }] }] },
    { version: 1, text: "", runs: [] },
    { version: 1, text: "Bold", runs: [{ from: 0, to: 3, marks: [{ type: "bold" }] }, { from: 3, to: 4, marks: [{ type: "link", attrs: { href: "https://example.test/evidence", target: "_self" } }] }] },
    { version: 1, text: "", runs: [] },
  ]);
  const stale = items.find(item => item.kind === "paragraph" && item.block?.id === "stale");
  assert.ok(stale?.kind === "paragraph");
  assert.equal(stale.formatting, undefined);
  const metadata = items.filter(item => item.kind === "paragraph" && item.style === "meta").map(item => item.kind === "paragraph" ? item.text : "").join("\n");
  for (const value of [SOURCE, EVIDENCE, "receipt:stale", "unchanged", '"text": "Old snapshot"']) assert.ok(metadata.includes(value));
  assert.deepEqual(content, before);
});

test("SI-04 native semantic tables retain all rows, exact values and original payload without duplicating row metadata", () => {
  const content = recordedTableReport();
  assert.ok(content.kind === "report");
  const original = structuredClone(content);
  const items = artifactDocumentItems(planFor(content), content);
  const table = items.find(item => item.kind === "table");
  assert.ok(table?.kind === "table");
  assert.equal(table.block, content.blocks[0]);
  assert.equal(table.table, content.blocks[0].attrs.table);
  assert.equal(table.table.rows.length, 4);
  assert.deepEqual(table.table.rows[0], { metric: "Revenue", value: "00123.4500", flag: false });
  assert.ok(Object.is(table.table.rows[2].value, -0));
  assert.equal(Object.hasOwn(table.table.rows[3], "value"), false);
  const paragraphs = items.filter(item => item.kind === "paragraph");
  assert.equal(paragraphs.some(item => item.kind === "paragraph" && item.text.startsWith("Row ")), false);
  const metadata = paragraphs.filter(item => item.kind === "paragraph" && item.style === "meta").map(item => item.kind === "paragraph" ? item.text : "").join("\n");
  for (const value of [SOURCE, EVIDENCE, "receipt:table:exact", "all recorded attributes", '"columns"']) assert.ok(metadata.includes(value));
  assert.ok(!metadata.includes('"rows"') && !metadata.includes("00123.4500"), "recorded rows belong to editable native cells, not a duplicate JSON body");
  assert.deepEqual(content, original);
  const long = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "table-all", type: "table", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: Array.from({ length: 151 }, (_, index) => ({ v: `exact-${index}` })) } } }] });
  const allRows = artifactDocumentItems(planFor(long), long).find(item => item.kind === "table");
  assert.ok(allRows?.kind === "table");
  assert.equal(allRows.table.rows.length, 151);
  assert.deepEqual(allRows.table.rows.at(-1), { v: "exact-150" });
});

test("SI-04 native helper rejects incoherent formats and typed invalid tables while preserving legacy warnings and bounds", () => {
  const invalidFormats = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "invalid-rich", type: "paragraph", text: "😀", attrs: { richText: { version: 1, text: "😀", runs: [{ from: 0, to: 1, marks: [{ type: "bold" }] }] } } }] });
  assert.throws(() => artifactDocumentItems(planFor(invalidFormats), invalidFormats), /Unicode/);
  const invalidTable = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "invalid-table", type: "table", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: [{ v: Infinity }] } } }] });
  assert.throws(() => artifactDocumentItems(planFor(invalidTable), invalidTable), /Invalid recorded table invalid-table.*Non-finite/);
  assert.ok(artifactDocumentParagraphs(planFor(invalidTable), invalidTable).some(item => item.text.includes("Non-finite")));
  const legacy = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "legacy-native", type: "table", text: "Opaque caption", attrs: { rows: [["exact legacy value"]], custom: "retained" } }] });
  const legacyItems = artifactDocumentItems(planFor(legacy), legacy);
  assert.equal(legacyItems.some(item => item.kind === "table"), false);
  for (const value of ["Opaque caption", "Legacy or unrecognized", "exact legacy value", "retained"]) assert.ok(legacyItems.some(item => item.kind === "paragraph" && item.text.includes(value)));
  const huge = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "huge-native-table", type: "table", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: Array.from({ length: 41 }, () => ({ v: "x".repeat(100_000) })) } } }] });
  assert.throws(() => artifactDocumentItems(planFor(huge), huge), /document layout limit/);
});

test("SI-04.20 one canonical multimodal report projects actual local image, typed table and chart across native outputs", async () => {
  const bytes = authoredPng(64, 32);
  const image = { mimeType: "image/png", dataBase64: bytes.toString("base64"), byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width: 64, height: 32, sourceRef: "source:project:attachment:captured" };
  const chart = { kind: "chart", chartType: "line", series: [
    { id: "a", label: "Observed A", points: [{ x: 0, y: -2 }, { x: 1, y: 0 }, { x: 2, y: 4 }] },
    { id: "b", label: "Observed B", points: [{ x: 0, y: 3 }, { x: 2, y: -1 }] },
  ] };
  const content = artifactContentSchema.parse({ kind: "report", sections: [{ id: "s", title: "Mixed evidence", blockIds: ["text", "table", "chart", "image", "reference"] }], blocks: [
    { id: "text", type: "paragraph", text: "One canonical work product." },
    { id: "table", type: "table", text: "Exact table", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Exact value" }], rows: [{ v: "9007199254740993.25" }] } } },
    { id: "chart", type: "chart_ref", text: "Signed observations", attrs: { chart, sourceRef: SOURCE } },
    { id: "image", type: "image", text: "Captured caption <not HTML>", attrs: { image, sourceRef: image.sourceRef, sourceRefs: [image.sourceRef] } },
    { id: "reference", type: "artifact_ref", text: "Structured reference", attrs: { artifactId: "artifact:source", version: 7, contentHash: SOURCE_HASH } },
  ] });
  const before = structuredClone(content);
  const plan = { ...planFor(content), formats: ["docx", "pptx", "pdf"] as ("docx" | "pptx" | "pdf")[] };
  const items = artifactDocumentItems(plan, content);
  assert.deepEqual(items.filter(item => item.kind !== "paragraph").map(item => item.kind), ["table", "chart", "image"]);
  const paragraphs = items.filter(item => item.kind === "paragraph").map(item => item.text).join("\n");
  assert.ok(!paragraphs.includes(image.dataBase64), "captured bytes must not be duplicated as visible JSON");
  assert.ok(paragraphs.includes(image.sha256) && paragraphs.includes(image.sourceRef));

  for (const [format, built] of [["docx", buildArtifactDocx(plan, content)], ["pptx", await buildArtifactPptx(plan, content)]] as const) {
    const files = unzipSync(built.bytes);
    const metadata = officeArtifactMetadataSchema.parse(JSON.parse(parser.parse(strFromU8(files["customXml/liosArtifact.xml"])).liosArtifact.payload));
    const binding = metadata.bindings.find(binding => binding.kind === "image");
    assert.ok(binding?.mediaPart && binding.geometry);
    assert.equal(binding.mediaSha256, image.sha256);
    assert.deepEqual(files[binding.mediaPart], new Uint8Array(bytes));
    assert.ok(Math.abs(binding.geometry.cx / binding.geometry.cy - 2) < 0.001, "native picture keeps captured aspect ratio");
    for (const [name, data] of Object.entries(files)) if (name.endsWith(".xml") || name.endsWith(".rels")) {
      assert.equal(XMLValidator.validate(strFromU8(data)), true, name);
      if (name.endsWith(".rels")) assert.doesNotMatch(strFromU8(data), /TargetMode="External"/);
    }
    assert.ok(metadata.bindings.some(binding => binding.kind === "chart" && binding.chartPart));
    const reopened = await readOfficeArtifactRoundtrip(built.bytes, format);
    assert.deepEqual(reopened.content, content);
    const changed = { ...files, [binding.mediaPart]: new Uint8Array(bytes).map((byte, index) => index === bytes.length - 1 ? byte ^ 1 : byte) };
    await assert.rejects(readOfficeArtifactRoundtrip(zipSync(changed), format), /image|media|integrity|captured/i);
  }

  const pdf = buildArtifactPdf(plan, content);
  const task = getDocument({ data: new Uint8Array(pdf.bytes), useSystemFonts: true, isEvalSupported: false });
  const document = await task.promise;
  let rasterImages = 0;
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const operations = await page.getOperatorList();
      rasterImages += operations.fnArray.filter(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject).length;
    }
  } finally { await document.destroy(); }
  assert.equal(rasterImages, 1, "PDF contains actual captured raster, not placeholder text");
  assert.deepEqual(content, before);
  const invalid = artifactContentSchema.parse({ ...content, blocks: content.kind === "report" ? content.blocks.map(block => block.type === "image" ? { ...block, attrs: { image: { ...image, sha256: HASH } } } : block) : [] });
  assert.throws(() => buildArtifactDocx(plan, invalid), /integrity/i);
  assert.throws(() => buildArtifactPdf(plan, invalid), /integrity/i);
  await assert.rejects(buildArtifactPptx(plan, invalid), /integrity/i);
});
