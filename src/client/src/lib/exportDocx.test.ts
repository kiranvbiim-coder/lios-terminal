import assert from "node:assert/strict";
import test from "node:test";
import { posix } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";

import { artifactContentSchema, artifactExportPlanSchema } from "../../../shared/artifactContracts";
import { buildArtifactDocx } from "./exportDocx";
import { authoredJpeg } from "../../../shared/artifactImage.test-fixtures";
import { createHash } from "node:crypto";
import { readOfficeArtifactRoundtrip } from "../../../shared/officeArtifactRoundtrip";

const HASH = "a".repeat(64);
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, trimValues: false });
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

function docxPlan(kind: "report" | "research" = "report") {
  return artifactExportPlanSchema.parse({
    artifactId: `artifact:${kind}:native`, version: 4, kind, formats: ["docx"],
    filenameStem: "Native & recorded", contentHash: HASH, sourceRefs: ["source:project:brief@v3"],
  });
}

function report(blocks: unknown[], sections: unknown[] = []) {
  return artifactContentSchema.parse({ kind: "report", blocks, sections });
}

function openDocx(content: ReturnType<typeof artifactContentSchema.parse>) {
  const file = buildArtifactDocx(docxPlan(content.kind === "research" ? "research" : "report"), content);
  const entries = unzipSync(file.bytes);
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) assert.equal(XMLValidator.validate(strFromU8(bytes)), true, `${name} must be well-formed XML`);
  }
  const document = strFromU8(entries["word/document.xml"]!);
  const body = xmlParser.parse(document)["w:document"]["w:body"];
  const relationships = array<Record<string, string>>(xmlParser.parse(strFromU8(entries["word/_rels/document.xml.rels"]!)).Relationships.Relationship);
  const relationshipIds = new Set(relationships.map(value => value["@Id"]));
  assert.equal(relationshipIds.size, relationships.length, "relationship IDs must be unique");
  for (const relationship of relationships) {
    if (relationship["@TargetMode"] === "External") continue;
    assert.ok(entries[posix.join("word", relationship["@Target"]!)], `internal relationship ${relationship["@Id"]} must resolve`);
  }
  for (const reference of document.matchAll(/r:id="([^"]+)"/g)) assert.ok(relationshipIds.has(reference[1]!), "every hyperlink must have a relationship");
  return { file, entries, document, body, relationships };
}

function paragraphText(value: unknown): string {
  if (!value || typeof value !== "object") return typeof value === "string" ? value : "";
  return Object.entries(value).filter(([key]) => !key.startsWith("@") && key !== "w:pPr" && key !== "w:rPr").map(([key, child]) => key === "#text" ? String(child) : key === "w:br" ? "\n" : key === "w:tab" ? "\t" : array(child).map(paragraphText).join("")).join("");
}

test("SI-04.13 builds a deterministic, reopenable DOCX with visible evidence lineage", () => {
  const content = artifactContentSchema.parse({
    kind: "research",
    question: "Should we invest in ACME & why?",
    blocks: [
      { id: "b1", type: "heading", text: "Finding <one>", attrs: {} },
      { id: "b2", type: "paragraph", text: "Revenue improved year over year.", attrs: {} },
    ],
    claims: [
      {
        id: "c1",
        text: "Revenue improved",
        sourceRefs: ["source:filing:2026-q2"],
        provenance: "source_backed",
      },
    ],
    evidence: [
      {
        id: "e1",
        title: "Q2 filing",
        snippet: "Revenue increased.",
        sourceRef: "source:filing:2026-q2",
        url: "https://example.com/q2",
        sourceType: "filing",
        observedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "artifact:research:1",
    version: 3,
    kind: "research",
    formats: ["json", "md", "docx"],
    filenameStem: "ACME Research",
    contentHash: HASH,
    sourceRefs: ["source:project:brief", "source:filing:2026-q2"],
  });

  const first = buildArtifactDocx(plan, content);
  const second = buildArtifactDocx(plan, content);

  assert.equal(first.filename, "ACME Research-v3.docx");
  assert.ok(first.bytes.length > 1_000);
  assert.deepEqual(first.bytes, second.bytes, "same Artifact version must produce byte-identical DOCX output");

  const files = unzipSync(first.bytes);
  for (const required of [
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "word/document.xml",
    "word/styles.xml",
    "word/_rels/document.xml.rels",
  ]) {
    assert.ok(files[required], `DOCX package must contain ${required}`);
  }

  const documentXml = strFromU8(files["word/document.xml"]!);
  assert.match(documentXml, /ACME Research/);
  assert.match(documentXml, /Should we invest in ACME &amp; why\?/);
  assert.match(documentXml, /Finding &lt;one&gt;/);
  assert.match(documentXml, /Revenue improved/);
  assert.match(documentXml, /source:filing:2026-q2/);
  assert.match(documentXml, /source:project:brief/);
  assert.match(documentXml, /source_backed/);
  assert.match(documentXml, /https:\/\/example\.com\/q2/);
  assert.match(documentXml, new RegExp(HASH));
});

test("SI-04.13 rejects Artifact kinds that do not claim DOCX fidelity", () => {
  const content = artifactContentSchema.parse({
    kind: "chart",
    chartType: "line",
    series: [],
  });
  const plan = artifactExportPlanSchema.parse({
    artifactId: "artifact:chart:1",
    version: 1,
    kind: "chart",
    formats: ["docx"],
    filenameStem: "Chart",
    contentHash: HASH,
    sourceRefs: [],
  });

  assert.throws(
    () => buildArtifactDocx(plan, content),
    /DOCX export is not supported for Artifact kind "chart"/,
  );
});

test("SI-04.13 publishes every recorded table row as editable Word cells in report order", () => {
  const rows = Array.from({ length: 151 }, (_, index) => ({
    name: `Recorded row ${index + 1}`, amount: index === 150 ? "9007199254740993.25" : `${index}.000000000000000001`,
  }));
  const content = report([
    { id: "after", type: "paragraph", text: "After native table", attrs: {} },
    { id: "native", type: "table", text: "Recorded table caption", attrs: {
      table: { kind: "table", columns: [{ key: "name", label: "Name" }, { key: "amount", label: "Amount", type: "currency" }], rows },
      sourceRef: "source:filing:q2@v7", sourceHash: "b".repeat(64), receiptId: "receipt:table:7", unknownAttr: { retained: "literal & untouched" },
    } },
    { id: "before", type: "paragraph", text: "Before native table", attrs: {} },
  ], [{ id: "main", title: "Report narrative", blockIds: ["before", "native", "after"] }]);
  const { file, document, body, entries } = openDocx(content);
  assert.deepEqual(buildArtifactDocx(docxPlan(), content).bytes, file.bytes);
  const table = body["w:tbl"];
  assert.ok(table, "table must be native w:tbl, not a JSON/prose rendering");
  assert.equal(array(body["w:tbl"]).length, 1);
  const nativeRows = array<Record<string, any>>(table["w:tr"]);
  assert.equal(nativeRows.length, 152, "the 100-row preview is never the export source");
  assert.ok(Object.hasOwn(nativeRows[0]!["w:trPr"], "w:tblHeader"), "header repeats across Word pages");
  assert.deepEqual(array<any>(nativeRows[0]!["w:tc"]).map(cell => paragraphText(cell["w:p"])), ["Name", "Amount"]);
  assert.deepEqual(array<any>(nativeRows.at(-1)!["w:tc"]).map(cell => paragraphText(cell["w:p"])), ["Recorded row 151", "9007199254740993.25"]);
  for (let index = 0; index < rows.length; index++) {
    assert.deepEqual(array<any>(nativeRows[index + 1]!["w:tc"]).map(cell => paragraphText(cell["w:p"])), [rows[index]!.name, rows[index]!.amount]);
  }
  assert.equal(table["w:tblPr"]["w:tblLayout"]["@w:type"], "fixed");
  const widths = array<Record<string, string>>(table["w:tblGrid"]["w:gridCol"]).map(column => Number(column["@w:w"]));
  assert.equal(widths.reduce((sum, width) => sum + width, 0), 9360);
  assert.ok(widths.every(width => width >= 240));
  assert.ok(document.indexOf("Before native table") < document.indexOf("<w:tbl>"));
  assert.ok(document.indexOf("<w:tbl>") < document.indexOf("After native table"));
  assert.ok(document.indexOf("Recorded table caption") < document.indexOf("<w:tbl>"));
  assert.doesNotMatch(document, /Row 1:|&quot;rows&quot;:/, "table rows must not be duplicated as body JSON/prose");
  assert.equal(document.match(/9007199254740993\.25/g)?.length, 1);
  for (const literal of ["source:filing:q2@v7", "b".repeat(64), "receipt:table:7", "unknownAttr", "literal &amp; untouched", "source:project:brief@v3", HASH, "Version: 4"]) assert.ok(document.includes(literal), literal);
  const core = strFromU8(entries["docProps/core.xml"]!);
  assert.match(core, /artifact:report:native/);
  assert.match(core, /report Artifact v4/);
  assert.match(core, /1980-01-01T00:00:00Z/);
  assert.doesNotMatch(core, /2026-/);
});

test("SI-04.13 retains literal missing/null/negative-zero/nested table values and empty native headers", () => {
  const columns = [{ key: "value", label: "Literal" }, { key: "missing", label: "Missing" }, { key: "null", label: "Null" }];
  const content = report([{ id: "literals", type: "table", text: "", attrs: {
    table: { kind: "table", columns, rows: [
      { value: -0, null: null },
      { value: { z: "001.2500", a: false }, missing: "", null: ["9007199254740993.25", null] },
    ] },
  } }]);
  const { body } = openDocx(content);
  const rows = array<any>(body["w:tbl"]["w:tr"]);
  assert.deepEqual(array<any>(rows[1]["w:tc"]).map(cell => paragraphText(cell["w:p"])), ["-0", "Not recorded", "null"]);
  assert.deepEqual(array<any>(rows[2]["w:tc"]).map(cell => paragraphText(cell["w:p"])), ['{"a": false, "z": "001.2500"}', "", '["9007199254740993.25", null]']);
  const empty = openDocx(report([{ id: "empty", type: "table", text: "", attrs: { table: { kind: "table", columns, rows: [] } } }]));
  assert.equal(array(empty.body["w:tbl"]["w:tr"]).length, 1, "zero rows still produce the recorded headers");
});

test("SI-04.13 renders bounded recorded rich runs and safe links as native Word formatting", () => {
  const text = "Bold italic under strike code link & link";
  const marks = [
    { from: 0, to: 4, marks: [{ type: "bold" }] },
    { from: 5, to: 11, marks: [{ type: "italic" }] },
    { from: 12, to: 17, marks: [{ type: "underline" }] },
    { from: 18, to: 24, marks: [{ type: "strike" }] },
    { from: 25, to: 29, marks: [{ type: "code" }] },
    { from: 30, to: 34, marks: [{ type: "link", attrs: { href: "https://example.com/filing?a=1&b=2" } }, { type: "bold" }] },
    { from: 37, to: 41, marks: [{ type: "link", attrs: { href: "https://example.com/filing?a=1&b=2" } }] },
  ];
  const content = report([{ id: "rich", type: "paragraph", text, attrs: { richText: { version: 1, text, runs: marks } } }]);
  const { body, relationships, entries } = openDocx(content);
  const paragraph = array<any>(body["w:p"]).find(value => value["w:hyperlink"]);
  assert.ok(paragraph);
  const nativeRuns = array<any>(paragraph["w:r"]);
  const formatted = (literal: string) => nativeRuns.find(value => paragraphText(value) === literal)["w:rPr"];
  assert.ok(Object.hasOwn(formatted("Bold"), "w:b"));
  assert.ok(Object.hasOwn(formatted("italic"), "w:i"));
  assert.equal(formatted("under")["w:u"]["@w:val"], "single");
  assert.ok(Object.hasOwn(formatted("strike"), "w:strike"));
  assert.equal(formatted("code")["w:rFonts"]["@w:ascii"], "Courier New");
  const nativeLinks = array<any>(paragraph["w:hyperlink"]);
  assert.equal(nativeLinks.length, 2);
  assert.equal(nativeLinks[0]["@r:id"], nativeLinks[1]["@r:id"], "repeated recorded URLs share a deterministic relationship");
  assert.ok(Object.hasOwn(nativeLinks[0]["w:r"]["w:rPr"], "w:b"), "links retain simultaneous marks");
  assert.deepEqual(relationships.filter(value => value["@TargetMode"] === "External").map(value => value["@Target"]), ["https://example.com/filing?a=1&b=2"]);
  assert.match(strFromU8(entries["word/styles.xml"]!), /w:styleId="Hyperlink"/);
});

test("SI-04.13 applies all heading levels, native list numbering, quote/code styles and literal breaks", () => {
  const listText = "First\n\nThird";
  const content = report([
    ...Array.from({ length: 6 }, (_, index) => ({ id: `h${index + 1}`, type: "heading", text: `Heading level ${index + 1}`, attrs: { level: index + 1 } })),
    { id: "ordered", type: "ordered_list", text: listText, attrs: { start: 7, richText: { version: 1, text: listText, runs: [{ from: 7, to: 12, marks: [{ type: "bold" }] }] } } },
    { id: "bullets", type: "bullet_list", text: "Bullet one\nBullet two", attrs: {} },
    { id: "restart", type: "ordered_list", text: "New first", attrs: { start: 3 } },
    { id: "quote", type: "quote", text: "Recorded quotation", attrs: { sourceRef: "source:quote:1" } },
    { id: "code", type: "code", text: "x\t=\t1\nprint(x)", attrs: { language: "python" } },
  ]);
  const { body, entries, document } = openDocx(content);
  const paragraphs = array<any>(body["w:p"]);
  for (let level = 1; level <= 6; level++) {
    const heading = paragraphs.find(value => paragraphText(value) === `Heading level ${level}`);
    assert.equal(heading["w:pPr"]["w:pStyle"]["@w:val"], `Heading${level}`);
  }
  const numbered = paragraphs.filter(value => value["w:pPr"]["w:numPr"]);
  assert.equal(numbered.length, 6, "blank authored list items remain numbered");
  const ids = numbered.map(value => value["w:pPr"]["w:numPr"]["w:numId"]["@w:val"]);
  assert.deepEqual(ids.slice(0, 3), [ids[0], ids[0], ids[0]]);
  assert.equal(paragraphText(numbered[1]), "");
  assert.ok(Object.hasOwn(numbered[2]["w:r"]["w:rPr"], "w:b"), "list formatting offsets must be rebased");
  assert.notEqual(ids[0], ids[3]);
  assert.notEqual(ids[0], ids[5]);
  const numbering = xmlParser.parse(strFromU8(entries["word/numbering.xml"]!))["w:numbering"];
  const nums = array<any>(numbering["w:num"]);
  assert.equal(nums.find(value => value["@w:numId"] === ids[0])["w:lvlOverride"]["w:startOverride"]["@w:val"], "7");
  assert.equal(nums.find(value => value["@w:numId"] === ids[5])["w:lvlOverride"]["w:startOverride"]["@w:val"], "3");
  assert.deepEqual(array<any>(numbering["w:abstractNum"]).map(value => value["w:lvl"]["w:numFmt"]["@w:val"]), ["bullet", "decimal"]);
  assert.equal(paragraphs.find(value => paragraphText(value) === "Recorded quotation")["w:pPr"]["w:pStyle"]["@w:val"], "Quote");
  const code = paragraphs.find(value => value["w:pPr"]["w:pStyle"]["@w:val"] === "Code");
  assert.ok(code["w:r"]["w:tab"]);
  assert.ok(Object.hasOwn(code["w:r"], "w:br"));
  const styles = strFromU8(entries["word/styles.xml"]!);
  assert.match(styles, /w:styleId="Code"/);
  assert.match(styles, /w:styleId="Quote"/);
  assert.match(styles, /Courier New/);
  assert.match(document, /source:quote:1/);
  assert.doesNotMatch(document, />7\. First</);
});

test("SI-04.13 never activates inferred/unsafe URLs or stale formatting and retains opaque attrs", () => {
  const content = report([
    { id: "unsafe", type: "paragraph", text: "Unsafe link", attrs: { richText: { version: 1, text: "Unsafe link", runs: [{ from: 0, to: 11, marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] } } },
    { id: "plain", type: "paragraph", text: "https://example.com/plain", attrs: { url: "https://example.com/metadata", arbitrary: { untouched: true } } },
    { id: "stale", type: "paragraph", text: "Current text", attrs: { richText: { version: 1, text: "Old text", runs: [{ from: 0, to: 3, marks: [{ type: "bold" }] }] } } },
  ]);
  const { relationships, document, body } = openDocx(content);
  assert.equal(relationships.filter(value => value["@TargetMode"] === "External").length, 0);
  assert.doesNotMatch(document, /<w:hyperlink/);
  const stale = array<any>(body["w:p"]).find(value => paragraphText(value) === "Current text");
  assert.equal(stale["w:r"]["w:rPr"], undefined);
  for (const literal of ["javascript:alert(1)", "arbitrary", "untouched", "Old text", "https://example.com/metadata"]) assert.ok(document.includes(literal));
});

test("SI-04.13 rejects invalid recorded tables but retains legacy opaque table payloads with warning", () => {
  const columns = [{ key: "value", label: "Value" }];
  const invalid = [
    { kind: "table", columns, rows: [{ extra: 1 }] },
    { kind: "table", columns: [columns[0], columns[0]], rows: [] },
    { kind: "table", columns, rows: [{ value: Infinity }] },
    { kind: "table", columns, rows: "not rows" },
    { kind: "table", columns, rows: [], unexpected: true },
  ];
  for (const table of invalid) {
    assert.throws(() => buildArtifactDocx(docxPlan(), report([{ id: "invalid", type: "table", text: "Invalid", attrs: { table } }])), /Invalid recorded table invalid/);
  }
  const legacy = openDocx(report([{ id: "legacy", type: "table", text: "Original literal", attrs: { table: { oldRows: ["literal row"] }, unknown: "retain" } }]));
  assert.doesNotMatch(legacy.document, /<w:tbl>/);
  assert.match(legacy.document, /Legacy or unrecognized table payload/);
  assert.match(legacy.document, /Original literal/);
  assert.match(legacy.document, /literal row/);
  assert.match(legacy.document, /retain/);
});

test("SI-04.13 fails clearly at native layout/formatting/XML bounds instead of truncating", () => {
  const native = (columns: unknown[], rows: unknown[]) => report([{ id: "bounds", type: "table", text: "", attrs: { table: { kind: "table", columns, rows } } }]);
  assert.throws(() => buildArtifactDocx(docxPlan(), native([], [])), /column.*layout limit/);
  assert.throws(() => buildArtifactDocx(docxPlan(), native(Array.from({ length: 33 }, (_, index) => ({ key: `c${index}`, label: `Column ${index}` })), [])), /column.*layout limit/);
  assert.throws(() => buildArtifactDocx(docxPlan(), native([{ key: "c", label: "Cell" }], [{ c: "x".repeat(200_001) }])), /cell exceeds the text layout limit/);
  assert.throws(() => buildArtifactDocx(docxPlan(), report([{ id: "num", type: "ordered_list", text: "Item", attrs: { start: 2_147_483_648 } }])), /numbering limit/);
  for (const text of ["Bad\u0001text", "Bad\ud800text", "Bad\ufffetext"]) {
    assert.throws(() => buildArtifactDocx(docxPlan(), report([{ id: "xml", type: "paragraph", text, attrs: {} }])), /not valid Office XML/);
  }
  const invalidRuns = [
    [{ from: 0, to: 99, marks: [{ type: "bold" }] }],
    [{ from: 0, to: 3, marks: [{ type: "bold" }] }, { from: 2, to: 4, marks: [{ type: "italic" }] }],
    [{ from: 0, to: 1, marks: [{ type: "unrecorded-style" }] }],
  ];
  for (const runs of invalidRuns) {
    assert.throws(() => buildArtifactDocx(docxPlan(), report([{ id: "runs", type: "paragraph", text: "Text", attrs: { richText: { version: 1, text: "Text", runs } } }])), /format offsets|Unsupported inline mark/);
  }
  assert.throws(() => buildArtifactDocx(docxPlan(), report([{ id: "unicode", type: "paragraph", text: "😀", attrs: { richText: { version: 1, text: "😀", runs: [{ from: 0, to: 1, marks: [{ type: "bold" }] }] } } }])), /must not split a Unicode character/);
  const huge = Array.from({ length: 21 }, (_, index) => ({ id: `huge${index}`, type: "paragraph", text: "x".repeat(200_000), attrs: {} }));
  assert.throws(() => buildArtifactDocx(docxPlan(), report(huge)), /document layout limit/);
});

test("SI-04.13 closes native styles/numbering relationships and fixes ZIP timestamps", () => {
  const { file, entries, document, body } = openDocx(report([
    { id: "h", type: "heading", text: "Heading", attrs: { level: 4 } },
    { id: "list", type: "ordered_list", text: "One\nTwo", attrs: { start: 9 } },
  ]));
  const view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50, "package starts with a ZIP local header");
  assert.equal(view.getUint16(10, true), 0, "DOS timestamp is fixed midnight");
  assert.equal(view.getUint16(12, true), 33, "DOS date is fixed 1980-01-01");
  const styles = xmlParser.parse(strFromU8(entries["word/styles.xml"]!))["w:styles"];
  const styleIds = new Set(array<Record<string, string>>(styles["w:style"]).map(style => style["@w:styleId"]));
  for (const match of document.matchAll(/<w:(?:pStyle|rStyle) w:val="([^"]+)"/g)) assert.ok(styleIds.has(match[1]!), `style ${match[1]} resolves`);
  const numbers = xmlParser.parse(strFromU8(entries["word/numbering.xml"]!))["w:numbering"];
  const numberIds = new Set(array<Record<string, string>>(numbers["w:num"]).map(number => number["@w:numId"]));
  for (const paragraph of array<any>(body["w:p"])) {
    if (paragraph["w:pPr"]["w:numPr"]) assert.ok(numberIds.has(paragraph["w:pPr"]["w:numPr"]["w:numId"]["@w:val"]));
  }
  const types = xmlParser.parse(strFromU8(entries["[Content_Types].xml"]!)).Types;
  assert.ok(array<Record<string, string>>(types.Override).some(value => value["@PartName"] === "/word/numbering.xml" && value["@ContentType"]?.endsWith("numbering+xml")));
});

test("SI-04.13 starts a repeated authored list block anew in every recorded report section", () => {
  const content = report([{ id: "ordered", type: "ordered_list", text: "First\nSecond", attrs: { start: 5 } }], [
    { id: "s1", title: "First occurrence", blockIds: ["ordered"] },
    { id: "s2", title: "Second occurrence", blockIds: ["ordered"] },
  ]);
  const { body, entries } = openDocx(content);
  const numbered = array<any>(body["w:p"]).filter(value => value["w:pPr"]["w:numPr"]);
  assert.equal(numbered.length, 4);
  assert.notEqual(numbered[0]["w:pPr"]["w:numPr"]["w:numId"]["@w:val"], numbered[2]["w:pPr"]["w:numPr"]["w:numId"]["@w:val"]);
  const numbering = xmlParser.parse(strFromU8(entries["word/numbering.xml"]!))["w:numbering"];
  assert.deepEqual(array<any>(numbering["w:num"]).map(value => value["w:lvlOverride"]["w:startOverride"]["@w:val"]), ["5", "5"]);
});

for (const chartType of ["line", "area", "bar", "scatter"] as const) {
  test(`SI-04.20 DOCX ${chartType} reference is a native local chart with signed exact zero and missing gaps`, async () => {
    const chart = { kind: "chart", chartType, series: [
      { id: "a", label: "A & exact", points: [{ x: 2, y: 4 }, { x: 0, y: -3 }, { x: 1, y: 0 }] },
      { id: "b", label: "B", points: [{ x: 0, y: 2 }, { x: 2, y: -1 }] },
    ] };
    const content = report([{ id: "chart", type: "chart_ref", text: "Actual chart caption", attrs: { chart } }]);
    const { file, document, entries, relationships } = openDocx(content);
    const chartPath = Object.keys(entries).find(path => /^word\/charts\/chart\d+\.xml$/.test(path));
    assert.ok(chartPath);
    const xml = strFromU8(entries[chartPath]);
    assert.match(xml, new RegExp(`<c:${chartType}Chart>`));
    assert.match(xml, /<c:pt idx="1"><c:v>0<\/c:v><\/c:pt>/);
    assert.match(xml, /<c:pt idx="0"><c:v>-3<\/c:v><\/c:pt>/);
    assert.match(xml, /<c:dispBlanksAs val="gap"\/>/);
    assert.doesNotMatch(xml, /externalData|externalLink|<c:v><\/c:v>/);
    const series = xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g)!;
    assert.equal(series.length, 2);
    assert.doesNotMatch(series[1].split(chartType === "scatter" ? "<c:yVal>" : "<c:val>")[1], /<c:pt idx="1">/);
    assert.match(document, /<w:drawing>|<c:chart/);
    assert.ok(relationships.some(relation => relation["@Type"].endsWith("/chart")));
    assert.deepEqual((await readOfficeArtifactRoundtrip(file.bytes, "docx")).content, content);
  });
}

test("SI-04.20 DOCX captures exact JPEG bytes in a local OPC picture without stretching or visible base64", async () => {
  const bytes = authoredJpeg(24, 48);
  const image = { mimeType: "image/jpeg", dataBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, width: 24, height: 48, sourceRef: "source:project:jpeg:owned" };
  const content = report([{ id: "photo", type: "image", text: "<img onerror=evil> literal caption", attrs: { image } }]);
  const { file, document, entries, relationships } = openDocx(content);
  const part = Object.keys(entries).find(path => /^word\/media\/image\d+\.jpeg$/.test(path));
  assert.ok(part);
  assert.deepEqual(entries[part], new Uint8Array(bytes));
  assert.match(document, /&lt;img onerror=evil&gt; literal caption/);
  assert.ok(!document.includes(image.dataBase64));
  assert.match(document, /<wp:extent cx="228600" cy="457200"\/>/);
  assert.ok(relationships.some(relation => relation["@Type"].endsWith("/image") && !relation["@TargetMode"]));
  assert.deepEqual((await readOfficeArtifactRoundtrip(file.bytes, "docx")).content, content);
});
