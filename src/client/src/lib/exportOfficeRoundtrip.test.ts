import assert from "node:assert/strict";
import test from "node:test";
import { posix } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { artifactContentSchema, artifactExportPlanSchema, tableArtifactContentSchema, type ArtifactContent } from "../../../shared/artifactContracts";
import { officeArtifactMetadataSchema, readOfficeArtifactRoundtrip, type OfficeArtifactMetadata } from "../../../shared/officeArtifactRoundtrip";
import { buildArtifactDocx } from "./exportDocx";
import { buildNativeArtifactPptx } from "./nativeArtifactPptx";

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false });
const HASH = "a".repeat(64);
const ZIP_MTIME = new Date(1980, 0, 1);
const report = artifactContentSchema.parse({
  kind: "report", sections: [{ id: "section", title: "Canonical section", blockIds: ["narrative", "list", "table"] }],
  blocks: [
    { id: "narrative", type: "paragraph", text: "Original Office narrative", attrs: { richText: { version: 1, text: "Original Office narrative", runs: [{ from: 0, to: 8, marks: [{ type: "bold" }] }] }, sourceRef: "source:actual:filing", receiptId: "receipt:canonical:7" } },
    { id: "list", type: "ordered_list", text: "First item\n\nThird item", attrs: { start: 4 } },
    { id: "table", type: "table", text: "Recorded table caption", attrs: { table: { kind: "table", columns: [{ key: "period", label: "Period" }, { key: "amount", label: "Exact amount", type: "currency" }], rows: [{ period: "FY26", amount: "9007199254740993.250000000000000001" }, { period: "FY27", amount: -0 }] }, sourceRef: "source:table:1", sourceHash: "b".repeat(64), unit: "USD millions" } },
  ],
}) as Extract<ArtifactContent, { kind: "report" }>;

function nativeTable(content: ArtifactContent) {
  assert.ok(content.kind === "report");
  return tableArtifactContentSchema.parse(content.blocks[2].attrs.table);
}

function plan(content: ArtifactContent, format: "docx" | "pptx", version = 7) {
  return artifactExportPlanSchema.parse({ artifactId: "artifact:office:owned", version, kind: content.kind, formats: [format], filenameStem: "Canonical Office return", contentHash: HASH, sourceRefs: ["source:actual:filing"] });
}
function metadata(files: Record<string, Uint8Array>): OfficeArtifactMetadata {
  const root = parser.parse(strFromU8(files["customXml/liosArtifact.xml"])).liosArtifact;
  assert.equal(root["@_xmlns"], "urn:lios:artifact:office-roundtrip:1");
  return officeArtifactMetadataSchema.parse(JSON.parse(root.payload));
}
function closePackage(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  for (const [part, data] of Object.entries(files)) {
    if (!/\.(xml|rels)$/.test(part)) continue;
    assert.equal(XMLValidator.validate(strFromU8(data)), true, part);
    if (!part.endsWith(".rels")) continue;
    const owner = part === "_rels/.rels" ? "" : posix.dirname(part).replace(/\/_rels$/, "");
    for (const relation of strFromU8(data).matchAll(/<Relationship\b([^>]+)\/>/g)) {
      if (/TargetMode="External"/.test(relation[1])) continue;
      const target = relation[1].match(/\bTarget="([^"]+)"/)?.[1];
      assert.ok(target);
      const path = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(owner, target));
      assert.ok(files[path], `${part} must resolve ${path}`);
    }
  }
  const binding = metadata(files);
  assert.equal(binding.sourceArtifactId, "artifact:office:owned");
  assert.equal(binding.sourceVersion, 7);
  assert.equal(binding.sourceHash, HASH);
  assert.equal(new Set(binding.bindings.map(value => value.id)).size, binding.bindings.length);
  assert.match(strFromU8(files["[Content_Types].xml"]), /PartName="\/customXml\/liosArtifact.xml" ContentType="application\/xml"/);
  return { files, binding };
}
function edited(bytes: Uint8Array, parts: Record<string, (xml: string) => string>): Uint8Array {
  const files = unzipSync(bytes);
  for (const [part, change] of Object.entries(parts)) {
    const before = strFromU8(files[part]);
    const after = change(before);
    assert.notEqual(after, before, `${part} fixture must change actual Office XML`);
    files[part] = strToU8(after);
  }
  return zipSync(files, { level: 6, mtime: ZIP_MTIME });
}

for (const format of ["docx", "pptx"] as const) {
  test(`SI-04.19 ${format} metadata closes real OPC bindings and unchanged native content preserves source semantics`, async () => {
    const sourcePlan = plan(report, format);
    const first = format === "docx" ? buildArtifactDocx(sourcePlan, report) : await buildNativeArtifactPptx(sourcePlan, report);
    const second = format === "docx" ? buildArtifactDocx(sourcePlan, report) : await buildNativeArtifactPptx(sourcePlan, report);
    assert.deepEqual(second.bytes, first.bytes);
    const { files, binding } = closePackage(first.bytes);
    assert.equal(binding.format, format);
    const document = format === "docx" ? strFromU8(files["word/document.xml"]) : Object.entries(files).filter(([part]) => /^ppt\/slides\/slide\d+\.xml$/.test(part)).map(([, bytes]) => strFromU8(bytes)).join("");
    for (const value of binding.bindings) {
      assert.equal([...document.matchAll(new RegExp(format === "docx" ? `w:name="${value.id}"` : `name="${value.id}"`, "g"))].length, 1, value.id);
      if (format === "pptx") assert.ok(value.part && files[value.part]);
    }
    if (format === "pptx") {
      for (const [part, bytes] of Object.entries(files)) {
        if (!/^ppt\/slides\/slide\d+\.xml$/.test(part)) continue;
        const numericIds = [...strFromU8(bytes).matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map(match => match[1]);
        assert.equal(new Set(numericIds).size, numericIds.length, `${part} numeric native IDs cannot collide`);
      }
    }
    const reopened = await readOfficeArtifactRoundtrip(first.bytes, format);
    assert.deepEqual(reopened.content, report);
    assert.deepEqual(reopened.sourceContent, report);
    assert.ok(Object.is(nativeTable(reopened.content).rows[1].amount, -0));
  });
}

test("SI-04.19 Word edits bound narrative/list/table rather than restoring embedded source", async () => {
  const sourcePlan = plan(report, "docx");
  const file = buildArtifactDocx(sourcePlan, report);
  const bytes = edited(file.bytes, { "word/document.xml": xml => xml.replace("Office narrative", "Word revision").replace("Third item", "Third item revised").replace("9007199254740993.250000000000000001", "9007199254740999.250000000000000007") });
  assert.deepEqual(unzipSync(bytes)["customXml/liosArtifact.xml"], unzipSync(file.bytes)["customXml/liosArtifact.xml"], "fixture never edits the source snapshot");
  const result = await readOfficeArtifactRoundtrip(bytes, "docx");
  const content = result.content as typeof report;
  assert.equal(content.blocks[0].text, "Original Word revision");
  assert.equal(content.blocks[1].text, "First item\n\nThird item revised");
  assert.equal(nativeTable(content).rows[0].amount, "9007199254740999.250000000000000007");
  assert.equal(content.blocks[0].attrs.sourceRef, report.blocks[0].attrs.sourceRef);
  assert.equal(content.blocks[0].attrs.receiptId, report.blocks[0].attrs.receiptId);
  assert.equal(content.blocks[2].attrs.unit, "USD millions");
  const next = buildArtifactDocx(plan(content, "docx", 8), content);
  assert.deepEqual((await readOfficeArtifactRoundtrip(next.bytes, "docx")).content, content);
});

test("SI-04.19 native PowerPoint narrative/table edits survive canonical re-export and reopen", async () => {
  const file = await buildNativeArtifactPptx(plan(report, "pptx"), report);
  const { files, binding } = closePackage(file.bytes);
  const textBinding = binding.bindings.find(value => value.segments?.some(segment => segment.text === "Original Office narrative"));
  const tableBinding = binding.bindings.find(value => value.kind === "table");
  assert.ok(textBinding?.part && tableBinding?.part);
  const changes: Record<string, (xml: string) => string> = {
    [textBinding.part]: xml => xml.replace("Original Office narrative", "PowerPoint revised narrative"),
    [tableBinding.part]: xml => xml.replace("9007199254740993.250000000000000001", "9007199254740998.000000000000000009"),
  };
  const result = await readOfficeArtifactRoundtrip(edited(file.bytes, changes), "pptx");
  const content = result.content as typeof report;
  assert.equal(content.blocks[0].text, "PowerPoint revised narrative");
  assert.equal(nativeTable(content).rows[0].amount, "9007199254740998.000000000000000009");
  assert.deepEqual(result.sourceContent, report);
  assert.deepEqual(files["customXml/liosArtifact.xml"], unzipSync(file.bytes)["customXml/liosArtifact.xml"]);
  const next = await buildNativeArtifactPptx(plan(content, "pptx", 8), content);
  assert.deepEqual((await readOfficeArtifactRoundtrip(next.bytes, "pptx")).content, content);
});

test("SI-04.19 chart bindings resolve normalized chart and nested XLSX source indices after module-global counters move", async () => {
  const chart = artifactContentSchema.parse({ kind: "chart", chartType: "line", series: [{ id: "source-series", label: "Source series", points: [{ x: 2, y: 20 }, { x: 0, y: 10 }] }] }) as Extract<ArtifactContent, { kind: "chart" }>;
  const first = await buildNativeArtifactPptx(plan(chart, "pptx"), chart);
  const second = await buildNativeArtifactPptx(plan(chart, "pptx"), chart);
  assert.deepEqual(first.bytes, second.bytes, "normalized nested XLSX is byte deterministic too");
  const { files, binding } = closePackage(first.bytes);
  const chartBinding = binding.bindings.find(value => value.kind === "chart");
  assert.ok(chartBinding?.chartPart && chartBinding.workbookPart);
  assert.equal(chartBinding.chartPart, "ppt/charts/chart1.xml");
  assert.equal(chartBinding.workbookPart, "ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx");
  assert.deepEqual(chartBinding.sourceIndices, [[1, 0]], "native sorted x indices refer to the original unsorted canonical points");
  const workbook = unzipSync(files[chartBinding.workbookPart]);
  const sheet = strFromU8(workbook["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<c r="B2"><v>10<\/v><\/c>/);
  workbook["xl/worksheets/sheet1.xml"] = strToU8(sheet.replace('<c r="B2"><v>10</v></c>', '<c r="B2"><v>42</v></c>'));
  files[chartBinding.workbookPart] = zipSync(workbook, { level: 6, mtime: ZIP_MTIME });
  files[chartBinding.chartPart] = strToU8(strFromU8(files[chartBinding.chartPart]).replace('<c:pt idx="0"><c:v>10</c:v></c:pt>', '<c:pt idx="0"><c:v>42</c:v></c:pt>'));
  const result = await readOfficeArtifactRoundtrip(zipSync(files, { level: 6, mtime: ZIP_MTIME }), "pptx");
  const content = result.content as typeof chart;
  assert.deepEqual(content.series[0].points, [{ x: 2, y: 20 }, { x: 0, y: 42 }]);
  assert.deepEqual(result.sourceContent, chart);
  const next = await buildNativeArtifactPptx(plan(content, "pptx", 8), content);
  assert.deepEqual((await readOfficeArtifactRoundtrip(next.bytes, "pptx")).content, content);
});

for (const source of [
  { kind: "research", question: "What changed?", blocks: [], claims: [{ id: "claim", text: "Recorded claim" }], evidence: [{ id: "evidence", title: "Evidence title", snippet: "Evidence snippet", sourceRef: "source:evidence" }], contradictions: [{ id: "contradiction", summary: "Contradiction summary" }], plan: { steps: [{ id: "step", objective: "Review filing" }] }, executionTrail: [{ at: "2026-10-08T00:00:00Z", action: "Observed evidence" }] },
  { kind: "decision", objective: "Select an alternative", whatChanged: ["New observation"], why: ["Recorded reason"], scenarios: [{ id: "scenario", label: "Base scenario", kind: "base", summary: "Scenario summary" }], alternatives: [{ id: "alternative", label: "Selected choice", expectedOutcomes: ["Expected outcome"], risks: ["Recorded risk"], tradeoffs: ["Recorded tradeoff"] }], selectedAlternativeId: "alternative", nextActions: ["Review action"] },
  { kind: "thesis", summary: "Thesis summary", expectedOutcomes: [{ id: "outcome", text: "Expected result" }], claims: [{ id: "claim", text: "Thesis claim", confidence: 0.5 }], risks: [{ id: "risk", text: "Thesis risk" }], refresh: { contradictions: ["Refresh contradiction"], changes: ["Refresh change"] } },
]) {
  for (const format of ["docx", "pptx"] as const) test(`SI-04.19 ${source.kind} ${format} semantic paths preserve decorated text without rewriting status/identity`, async () => {
    const content = artifactContentSchema.parse(source);
    const file = format === "docx" ? buildArtifactDocx(plan(content, format), content) : await buildNativeArtifactPptx(plan(content, format), content);
    const { binding } = closePackage(file.bytes);
    const paths = binding.bindings.flatMap(value => value.segments?.filter(segment => segment.editable).map(segment => segment.path) ?? (value.editable ? [value.path] : []));
    assert.ok(paths.length > 2);
    assert.deepEqual((await readOfficeArtifactRoundtrip(file.bytes, format)).content, content);
  });
}

test("SI-04.19 existing invalid XML export defenses remain fail-closed before metadata packaging", async () => {
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "bad", type: "paragraph", text: "Control\u0001text" }] });
  assert.throws(() => buildArtifactDocx(plan(content, "docx"), content), /valid Office XML/);
  await assert.rejects(buildNativeArtifactPptx(plan(content, "pptx"), content), /valid Office XML/);
});

test("SI-04.19 Word style-only native edits preserve text and update canonical inline marks", async () => {
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "plain", type: "paragraph", text: "Native style target" }] });
  const file = buildArtifactDocx(plan(content, "docx"), content);
  const bytes = edited(file.bytes, { "word/document.xml": xml => xml.replace('<w:r><w:t xml:space="preserve">Native style target</w:t></w:r>', '<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Native style target</w:t></w:r>') });
  const result = await readOfficeArtifactRoundtrip(bytes, "docx");
  assert.ok(result.content.kind === "report");
  assert.equal(result.content.blocks[0].text, "Native style target");
  assert.deepEqual(result.content.blocks[0].attrs.richText, { version: 1, text: "Native style target", runs: [{ from: 0, to: 19, marks: [{ type: "italic" }] }] });
  const next = buildArtifactDocx(plan(result.content, "docx", 8), result.content);
  assert.deepEqual((await readOfficeArtifactRoundtrip(next.bytes, "docx")).content, result.content);
});

test("SI-04.19 paginated PowerPoint tables bind every source row/column exactly once and return final-slice native edits", async () => {
  const columns = Array.from({ length: 10 }, (_, index) => ({ key: `c${index}`, label: `Column ${index}` }));
  const rows = Array.from({ length: 50 }, (_, row) => Object.fromEntries(columns.map((column, index) => [column.key, `slice:${row}:${index}`])));
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "wide", type: "table", attrs: { table: { kind: "table", columns, rows } } }] });
  const file = await buildNativeArtifactPptx(plan(content, "pptx"), content);
  const { binding } = closePackage(file.bytes);
  const slices = binding.bindings.filter(value => value.kind === "table");
  assert.ok(slices.length > 2, "both horizontal and vertical pagination must be exercised");
  const seen = new Set<string>();
  for (const slice of slices) {
    assert.deepEqual(slice.path, ["blocks", 0, "attrs", "table"]);
    assert.ok(slice.rowStart !== undefined && slice.rowCount !== undefined && slice.columnStart !== undefined && slice.columnCount !== undefined);
    for (let row = slice.rowStart; row < slice.rowStart + slice.rowCount; row++) {
      for (let column = slice.columnStart; column < slice.columnStart + slice.columnCount; column++) {
        const key = `${row}:${column}`;
        assert.ok(!seen.has(key), `canonical cell ${key} is not duplicated across slices`);
        seen.add(key);
      }
    }
  }
  assert.equal(seen.size, 500);
  const final = slices.find(value => value.columnStart === 8 && value.rowStart !== undefined && value.rowCount !== undefined && value.rowStart + value.rowCount === 50);
  assert.ok(final?.part);
  const bytes = edited(file.bytes, { [final.part]: xml => xml.replace("slice:49:9", "final native edit") });
  const result = await readOfficeArtifactRoundtrip(bytes, "pptx");
  assert.ok(result.content.kind === "report");
  const table = tableArtifactContentSchema.parse(result.content.blocks[0].attrs.table);
  assert.equal(table.rows[49].c9, "final native edit");
  assert.equal(table.rows[49].c0, "slice:49:0");
  assert.deepEqual(result.sourceContent, content);
});

test("SI-04.19 wrapped PowerPoint decorative suffixes stay outside canonical label intervals", async () => {
  const label = "x".repeat(519);
  const content = artifactContentSchema.parse({ kind: "decision", objective: "Test wrapped native labels", scenarios: [{ id: "base", kind: "base", label }] });
  const file = await buildNativeArtifactPptx(plan(content, "pptx"), content);
  assert.deepEqual((await readOfficeArtifactRoundtrip(file.bytes, "pptx")).content, content);
});

for (const format of ["docx", "pptx"] as const) test(`SI-04.19 ${format} native line-break projections retain exact untouched canonical CR/LF source`, async () => {
  const content = artifactContentSchema.parse({
    kind: "report", blocks: [
      { id: "line-breaks", type: "paragraph", text: "First\r\nSecond\rThird\nFourth\tcolumn" },
      { id: "list-breaks", type: "bullet_list", text: "First list\r\n\r\nThird list\r\n" },
    ],
  });
  const file = format === "docx" ? buildArtifactDocx(plan(content, format), content) : await buildNativeArtifactPptx(plan(content, format), content);
  assert.deepEqual((await readOfficeArtifactRoundtrip(file.bytes, format)).content, content);
});

test("SI-04.19 trailing blank PowerPoint narrative paragraphs before a native table remain bound native paragraphs", async () => {
  const content = artifactContentSchema.parse({
    kind: "report", blocks: [
      { id: "narrative", type: "paragraph", text: "Native trailing blanks\n\n" },
      { id: "table", type: "table", attrs: { table: { kind: "table", columns: [{ key: "value", label: "Value" }], rows: [{ value: "literal" }] } } },
    ],
  });
  const file = await buildNativeArtifactPptx(plan(content, "pptx"), content);
  assert.deepEqual((await readOfficeArtifactRoundtrip(file.bytes, "pptx")).content, content);
});

for (const format of ["docx", "pptx"] as const) test(`Decision lifecycle ${format} edits authored recommendation while retaining dissent, outcomes and reference-only approval semantics`, async () => {
  const content = artifactContentSchema.parse({
    kind: "decision", objective: "Authored committee decision",
    recommendation: "Original recommendation", dissent: ["Keep the exact 9007199254740993.25 assumption under review."],
    caseRef: "decision:7",
    actions: [{ id: "action", description: "Review the source period", status: "planned", sourceRefs: ["source:actual:filing"] }],
    outcome: { summary: "Outcome remains pending", status: "pending" },
    followUp: [{ id: "follow", description: "Reconcile the authored inputs", status: "open" }],
    linkedRefs: { sources: ["source:actual:filing"] },
  });
  const file = format === "docx" ? buildArtifactDocx(plan(content, format), content) : await buildNativeArtifactPptx(plan(content, format), content);
  const files = unzipSync(file.bytes);
  const parts = Object.keys(files).filter(part => format === "docx" ? part === "word/document.xml" : /^ppt\/slides\/slide\d+\.xml$/.test(part));
  const target = parts.find(part => strFromU8(files[part]).includes("Original recommendation"));
  assert.ok(target);
  const returned = await readOfficeArtifactRoundtrip(edited(file.bytes, { [target]: xml => xml.replace("Original recommendation", "Revised authored recommendation") }), format);
  if (returned.content.kind !== "decision" || content.kind !== "decision") throw new Error("Expected Decision content.");
  assert.equal(returned.content.recommendation, "Revised authored recommendation");
  assert.deepEqual(returned.content.dissent, content.dissent);
  assert.deepEqual(returned.content.actions, content.actions);
  assert.deepEqual(returned.content.outcome, content.outcome);
  assert.deepEqual(returned.content.followUp, content.followUp);
  assert.equal(returned.content.caseRef, "decision:7");
  assert.ok(parts.map(part => strFromU8(files[part])).join("\n").includes("reference only; current canonical approval must be inspected separately"));
});

test("historical Decision native return retains the original snapshot without manufacturing absent lifecycle fields", async () => {
  const old = artifactContentSchema.parse({ kind: "decision", objective: "Historical immutable body" });
  assert.equal(Object.hasOwn(old, "recommendation"), false);
  assert.equal(Object.hasOwn(old, "actions"), false);
  const bytes = buildArtifactDocx(plan(old, "docx"), old).bytes;
  const returned = await readOfficeArtifactRoundtrip(bytes, "docx");
  assert.deepEqual(returned.content, old);
  assert.equal(Object.hasOwn(returned.content, "caseRef"), false);
});
