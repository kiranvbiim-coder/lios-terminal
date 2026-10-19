import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { artifactContentSchema, artifactExportPlanSchema, type ArtifactContent } from "./artifactContracts";
import { buildOfficeArtifactMetadataXml, OFFICE_ARTIFACT_METADATA_PART, OFFICE_ARTIFACT_LIMITS, readOfficeArtifactRoundtrip, type OfficeArtifactBinding } from "./officeArtifactRoundtrip";
import { buildArtifactDocx } from "../client/src/lib/exportDocx";
import { buildArtifactPptx } from "../client/src/lib/exportPptx";
import { readArtifactImage } from "./artifactImage";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/main";
const CHART = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const SOURCE = "source:filing:roundtrip";
const source = artifactContentSchema.parse({ kind: "report", templateId: "template:roundtrip", sections: [{ id: "intro", title: "Executive summary", blockIds: ["quote", "list", "heading"] }], blocks: [
  { id: "heading", type: "heading", text: "Native heading", attrs: { level: 3 } },
  { id: "quote", type: "quote", text: "Original quoted text & value 12.50%", attrs: { sourceRef: SOURCE, evidenceId: "e1", contentHash: "d".repeat(64), provenance: { sourceUrl: "https://example.test/filing", observedAt: "2026-10-08T00:00:00Z" }, truth: { sourceQuality: { tier: "primary", claimVerification: "not_verified_by_digest" } }, unit: "percent", richText: { version: 1, text: "Original quoted text & value 12.50%", runs: [{ from: 0, to: 8, marks: [{ type: "bold" }] }] } } },
  { id: "list", type: "ordered_list", text: "First item\n\nThird item", attrs: { start: 4 } },
  { id: "table", type: "table", text: "Typed recorded values", attrs: { caption: "Keep original units", table: { kind: "table", columns: [{ key: "n", label: "Amount", type: "number" }, { key: "literal", label: "Literal", type: "string" }, { key: "flag", label: "Flag", type: "boolean" }, { key: "items", label: "Items", type: "string" }, { key: "blank", label: "Blank", type: "string" }], rows: [{ n: -0, literal: "001.50", flag: true, items: [1, "two", null], blank: null }, { n: 12.5, literal: "preserve", flag: false, items: { value: "007", count: 2 } }] } } },
] });
function plan(content: ArtifactContent) { return artifactExportPlanSchema.parse({ artifactId: "artifact:office:return", version: 7, kind: content.kind, formats: ["docx", "pptx"], filenameStem: "Roundtrip integrity", contentHash: "a".repeat(64), sourceRefs: [SOURCE] }); }
function repack(files: Record<string, Uint8Array>): Uint8Array { return zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) }); }
function mutateXml(files: Record<string, Uint8Array>, part: string, change: (document: Document) => void): void {
  assert.ok(files[part], part);
  const document = new DOMParser().parseFromString(strFromU8(files[part]), "application/xml") as unknown as Document;
  change(document); files[part] = strToU8(new XMLSerializer().serializeToString(document));
}
function replaceNativeText(files: Record<string, Uint8Array>, format: "docx" | "pptx", before: string, after: string): void {
  let changed = 0;
  const metadata = new DOMParser().parseFromString(strFromU8(files[OFFICE_ARTIFACT_METADATA_PART]), "application/xml");
  const bindings = JSON.parse(metadata.getElementsByTagName("payload")[0].textContent!).bindings as OfficeArtifactBinding[];
  const byId = new Map(bindings.map(binding => [binding.id, binding]));
  const mutate = (element: Element) => { if (element.textContent?.includes(before)) { element.textContent = element.textContent.replace(before, after); changed++; } };
  for (const part of Object.keys(files).filter(part => format === "docx" ? part === "word/document.xml" : /^ppt\/slides\/slide\d+\.xml$/.test(part))) mutateXml(files, part, document => {
    if (format === "docx") {
      let active: OfficeArtifactBinding | undefined;
      const visit = (node: Node) => {
        const element = node.nodeType === 1 ? node as Element : undefined;
        if (element?.namespaceURI === WORD && element.localName === "bookmarkStart") active = byId.get(element.getAttributeNS(WORD, "name")!);
        if (element?.namespaceURI === WORD && element.localName === "t" && active && (active.kind === "table" || active.editable !== false && active.path.length)) mutate(element);
        // xmldom leaf text/processing-instruction nodes have childNodes=null.
        if (node.childNodes) for (const child of Array.from(node.childNodes)) visit(child);
        if (element?.namespaceURI === WORD && element.localName === "bookmarkEnd") active = undefined;
      }; visit(document);
    } else {
      const presentation = "http://schemas.openxmlformats.org/presentationml/2006/main";
      for (const shape of [...Array.from(document.getElementsByTagNameNS(presentation, "sp")), ...Array.from(document.getElementsByTagNameNS(presentation, "graphicFrame"))]) {
        const binding = byId.get(shape.getElementsByTagNameNS(presentation, "cNvPr")[0]?.getAttribute("name") ?? ""); if (!binding) continue;
        const paragraphs = Array.from(shape.getElementsByTagNameNS(DRAWING, "p"));
        paragraphs.forEach((paragraph, index) => {
          const segment = binding.segments?.find(segment => index >= segment.paragraphStart && index < segment.paragraphStart + segment.paragraphCount);
          const editable = binding.kind === "table" || (segment ? segment.editable !== false && segment.path.length : binding.editable !== false && binding.path.length);
          if (editable) Array.from(paragraph.getElementsByTagNameNS(DRAWING, "t")).forEach(mutate);
        });
      }
    }
  });
  assert.ok(changed, `native text ${before} must actually be changed`);
}
async function generated(format: "docx" | "pptx", content = source) { return format === "docx" ? buildArtifactDocx(plan(content), content).bytes : (await buildArtifactPptx(plan(content), content)).bytes; }
for (const format of ["docx", "pptx"] as const) {
  test(`${format}: genuine generated bytes reopen without changing canonical identity, types, citations, sections or rich marks`, async () => {
    const bytes = await generated(format), result = await readOfficeArtifactRoundtrip(bytes, format);
    assert.equal(result.sourceArtifactId, "artifact:office:return"); assert.equal(result.sourceVersion, 7); assert.equal(result.sourceHash, "a".repeat(64));
    assert.match(result.fileHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.sourceContent, source); assert.deepEqual(result.content, source); assert.deepEqual(result.warnings, []);
    if (result.content.kind !== "report") assert.fail("report expected");
    const table = result.content.blocks[3].attrs.table as Extract<ArtifactContent, { kind: "table" }>;
    assert.ok(Object.is(table.rows[0].n, -0));
  });
  test(`${format}: actual native quote edit is proposed, not overwritten by embedded source restoration`, async () => {
    const files = unzipSync(await generated(format)); replaceNativeText(files, format, "quoted text", "edited quotation");
    const result = await readOfficeArtifactRoundtrip(repack(files), format);
    assert.equal(result.content.kind, "report"); if (result.content.kind !== "report" || source.kind !== "report") return;
    const edited = result.content.blocks.find(block => block.id === "quote")!, baseline = source.blocks.find(block => block.id === "quote")!;
    assert.equal(edited.text, baseline.text.replace("quoted text", "edited quotation")); assert.equal(edited.attrs.sourceQuoteEdited, true); assert.equal(edited.attrs.officeEditProvenance, "user_asserted");
    assert.equal(edited.attrs.sourceRef, SOURCE); assert.deepEqual(edited.attrs.provenance, baseline.attrs.provenance); assert.deepEqual(edited.attrs.truth, baseline.attrs.truth); assert.equal(edited.attrs.contentHash, baseline.attrs.contentHash);
    assert.deepEqual(result.content.sections, source.sections); assert.deepEqual(result.sourceContent, source); assert.ok(result.warnings.some(value => value.includes("user_asserted")));
    const reopened = await readOfficeArtifactRoundtrip(await generated(format, result.content), format); assert.deepEqual(reopened.content, result.content);
  });
  test(`${format}: native table edits preserve scalar/structured types and exact unchanged numeric text`, async () => {
    const files = unzipSync(await generated(format)); replaceNativeText(files, format, "12.5", "16.75"); replaceNativeText(files, format, '[1, "two", null]', '[3, "four", null]');
    const result = await readOfficeArtifactRoundtrip(repack(files), format);
    if (result.content.kind !== "report") assert.fail("report expected");
    const table = result.content.blocks.find(block => block.id === "table")!.attrs.table as Extract<ArtifactContent, { kind: "table" }>;
    assert.equal(table.rows[1].n, 16.75); assert.deepEqual(table.rows[0].items, [3, "four", null]); assert.equal(table.rows[0].literal, "001.50"); assert.equal(table.rows[0].flag, true); assert.equal(table.rows[0].blank, null); assert.ok(!Object.hasOwn(table.rows[1], "blank"));
  });
  test(`${format}: ambiguous typed numeric changes fail closed`, async () => {
    const files = unzipSync(await generated(format)); replaceNativeText(files, format, "12.5", "$16,750"); await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /numeric.*unambiguous/);
  });
  test(`${format}: native list edits preserve original empty lines and start`, async () => {
    const files = unzipSync(await generated(format)); replaceNativeText(files, format, "Third item", "Updated final item"); const result = await readOfficeArtifactRoundtrip(repack(files));
    if (result.content.kind !== "report") assert.fail("report expected"); const list = result.content.blocks.find(block => block.id === "list")!; assert.equal(list.text, "First item\n\nUpdated final item"); assert.equal(list.attrs.start, 4); assert.equal(list.type, "ordered_list");
  });
  test(`${format}: external network relationships are rejected without fetching`, async () => {
    const files = unzipSync(await generated(format)), part = format === "docx" ? "word/_rels/document.xml.rels" : "ppt/_rels/presentation.xml.rels";
    mutateXml(files, part, document => { const relation = document.createElementNS("http://schemas.openxmlformats.org/package/2006/relationships", "Relationship"); relation.setAttribute("Id", "evil"); relation.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"); relation.setAttribute("Target", "https://127.0.0.1/private"); relation.setAttribute("TargetMode", "External"); document.documentElement.appendChild(relation); });
    await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /External Office network/);
  });
}

test("DOCX: style-only edits update actual native rich runs", async () => {
  const files = unzipSync(await generated("docx"));
  mutateXml(files, "word/document.xml", document => { const t = Array.from(document.getElementsByTagNameNS(WORD, "t")).find(item => item.textContent === "Original")!; const run = t.parentNode as Element; const props = run.getElementsByTagNameNS(WORD, "rPr")[0]; const italic = document.createElementNS(WORD, "w:i"); props.appendChild(italic); });
  const result = await readOfficeArtifactRoundtrip(repack(files)); if (result.content.kind !== "report") assert.fail("report expected"); const quote = result.content.blocks.find(block => block.id === "quote")!; const rich = quote.attrs.richText as { runs: { marks: { type: string }[] }[] }; assert.ok(rich.runs[0].marks.some(mark => mark.type === "italic")); assert.equal(quote.attrs.sourceQuoteEdited, undefined);
});
test("DOCX: actual heading level and native numbering start changes are imported", async () => {
  const files = unzipSync(await generated("docx"));
  mutateXml(files, "word/document.xml", document => { const paragraph = Array.from(document.getElementsByTagNameNS(WORD, "p")).find(item => item.textContent?.includes("Native heading"))!; paragraph.getElementsByTagNameNS(WORD, "pStyle")[0].setAttributeNS(WORD, "w:val", "Heading5"); });
  mutateXml(files, "word/numbering.xml", document => { Array.from(document.getElementsByTagNameNS(WORD, "startOverride")).forEach(item => item.setAttributeNS(WORD, "w:val", "9")); });
  const result = await readOfficeArtifactRoundtrip(repack(files)); if (result.content.kind !== "report") assert.fail("report expected"); assert.equal(result.content.blocks.find(block => block.id === "heading")!.attrs.level, 5); assert.equal(result.content.blocks.find(block => block.id === "list")!.attrs.start, 9);
});
test("DOCX: missing, reordered or unknown canonical bookmarks reject structural edits", async () => {
  const bytes = await generated("docx");
  for (const mutation of ["missing", "unknown", "reordered"]) {
    const files = unzipSync(bytes); mutateXml(files, "word/document.xml", document => { const marks = Array.from(document.getElementsByTagNameNS(WORD, "bookmarkStart")); if (mutation === "missing") marks[0].parentNode!.removeChild(marks[0]); else if (mutation === "unknown") marks[0].setAttributeNS(WORD, "w:name", "lios_unknown"); else { const first = marks[0].getAttributeNS(WORD, "name")!, second = marks[1].getAttributeNS(WORD, "name")!; marks[0].setAttributeNS(WORD, "w:name", second); marks[1].setAttributeNS(WORD, "w:name", first); } }); await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /binding|Unbound/);
  }
});
test("DOCX: merged table changes fail explicitly", async () => {
  const files = unzipSync(await generated("docx")); mutateXml(files, "word/document.xml", document => { const props = document.getElementsByTagNameNS(WORD, "tcPr")[0], span = document.createElementNS(WORD, "w:gridSpan"); span.setAttributeNS(WORD, "w:val", "2"); props.appendChild(span); }); await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /Merged Office tables/);
});
test("Office: DOCTYPE/entities, macro parts, path escapes, forged size and missing metadata are rejected", async () => {
  const bytes = await generated("docx");
  const entityFiles = unzipSync(bytes); entityFiles["word/document.xml"] = strToU8('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + strFromU8(entityFiles["word/document.xml"])); await assert.rejects(readOfficeArtifactRoundtrip(repack(entityFiles)), /DOCTYPE/);
  const macroFiles = unzipSync(bytes); macroFiles["word/vbaProject.bin"] = new Uint8Array([1]); await assert.rejects(readOfficeArtifactRoundtrip(repack(macroFiles)), /macro/);
  const escapeFiles = unzipSync(bytes); escapeFiles["../outside.xml"] = strToU8("<outside/>"); await assert.rejects(readOfficeArtifactRoundtrip(repack(escapeFiles)), /Unsafe Office ZIP path/);
  const missing = unzipSync(bytes); delete missing[OFFICE_ARTIFACT_METADATA_PART]; mutateXml(missing, "word/_rels/document.xml.rels", document => { for (const item of Array.from(document.getElementsByTagName("Relationship"))) if (item.getAttribute("Type")?.endsWith("/customXml")) item.parentNode!.removeChild(item); }); await assert.rejects(readOfficeArtifactRoundtrip(repack(missing)), /no LiOS Artifact/);
  const oversized = bytes.slice(); const view = new DataView(oversized.buffer); let central = 0; while (view.getUint32(central, true) !== 0x02014b50) central++; view.setUint32(central + 24, OFFICE_ARTIFACT_LIMITS.partBytes + 1, true); await assert.rejects(readOfficeArtifactRoundtrip(oversized), /oversized/);
});
test("Office: declared source hash/version shape and canonical snapshot schema are checked", async () => {
  const bytes = await generated("docx");
  for (const mutate of [(value: Record<string, unknown>) => { value.sourceHash = "not-a-digest"; }, (value: Record<string, unknown>) => { value.sourceVersion = 0; }, (value: Record<string, unknown>) => { value.content = { kind: "report", blocks: [{ id: "bad", type: "made_up" }] }; }]) {
    const files = unzipSync(bytes); mutateXml(files, OFFICE_ARTIFACT_METADATA_PART, document => { const payload = document.getElementsByTagName("payload")[0], value = JSON.parse(payload.textContent!); mutate(value); payload.textContent = JSON.stringify(value); }); await assert.rejects(readOfficeArtifactRoundtrip(repack(files)));
  }
});
test("PPTX: chart return reads actual cached values AND actual embedded workbook; disagreement rejects", async () => {
  const chart = artifactContentSchema.parse({ kind: "chart", chartType: "line", series: [{ id: "s1", label: "Revenue", points: [{ x: "2025", y: 12.5 }, { x: "2026", y: -0 }] }], options: { unit: "USD million", evidenceRefs: [SOURCE] } });
  const bytes = await generated("pptx", chart); const unchanged = await readOfficeArtifactRoundtrip(bytes); assert.deepEqual(unchanged.content, chart);
  const files = unzipSync(bytes), chartPart = Object.keys(files).find(part => /^ppt\/charts\/chart\d+\.xml$/.test(part))!, workbookPart = Object.keys(files).find(part => /^ppt\/embeddings\/.*\.xlsx$/.test(part))!;
  mutateXml(files, chartPart, document => { const cache = document.getElementsByTagNameNS(CHART, "numCache")[0], point = Array.from(cache.getElementsByTagNameNS(CHART, "pt")).find(item => item.getElementsByTagNameNS(CHART, "v")[0].textContent === "12.5")!; point.getElementsByTagNameNS(CHART, "v")[0].textContent = "18.75"; });
  await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /workbook\/cache mismatch/);
  const workbook = unzipSync(files[workbookPart]); let edited = false;
  for (const part of Object.keys(workbook).filter(part => /^xl\/worksheets\/sheet\d+\.xml$/.test(part))) mutateXml(workbook, part, document => { for (const value of Array.from(document.getElementsByTagName("v"))) if (value.textContent === "12.5") { value.textContent = "18.75"; edited = true; } }); assert.ok(edited); files[workbookPart] = repack(workbook);
  const result = await readOfficeArtifactRoundtrip(repack(files)); if (result.content.kind !== "chart") assert.fail("chart expected"); assert.equal(result.content.series[0].points[0].y, 18.75); assert.ok(Object.is(result.content.series[0].points[1].y, -0)); assert.deepEqual(result.content.options, chart.kind === "chart" ? chart.options : {});
  assert.deepEqual((await readOfficeArtifactRoundtrip(await generated("pptx", result.content))).content, result.content);
});
test("PPTX: missing/unknown native shape bindings do not fall back to embedded source", async () => {
  const files = unzipSync(await generated("pptx")), part = Object.keys(files).find(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))!;
  mutateXml(files, part, document => { const properties = Array.from(document.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main", "cNvPr")).find(item => item.getAttribute("name")?.startsWith("lios_"))!; properties.setAttribute("name", "lios_unknown"); }); await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /unbound|binding|shape/);
});

const research = artifactContentSchema.parse({ kind: "research", question: "What does the source establish?", blocks: [{ id: "finding", type: "paragraph", text: "Research body", attrs: { sourceRef: SOURCE } }], claims: [{ id: "claim1", text: "Revenue improved", provenance: "source_backed", sourceRefs: [SOURCE] }], evidence: [{ id: "e1", title: "Primary filing", sourceRef: SOURCE, sourceType: "filing", snippet: "Source quotation remains exact." }], contradictions: [{ id: "c1", summary: "Margin weakened", status: "open", claimRefs: ["claim1"], evidenceRefs: ["e1"] }] });
const decision = artifactContentSchema.parse({ kind: "decision", objective: "Choose an allocation", whatChanged: ["Decision delta"], why: ["Review recorded evidence"], constraints: ["Liquidity"], assumptions: { unit: "12.50%", period: "2026-Q3" }, scenarios: [{ id: "s1", label: "Base scenario", kind: "base", summary: "Baseline outcome", artifactRef: "artifact:model:1" }], alternatives: [{ id: "a1", label: "Hold", expectedOutcomes: ["Maintain allocation"], risks: ["Miss upside"], tradeoffs: ["Avoid churn"] }], selectedAlternativeId: "a1", linkedRefs: { sources: [SOURCE] } });
const thesis = artifactContentSchema.parse({ kind: "thesis", entityRef: "entity:office", summary: "Preserve the investment thesis", claims: [{ id: "t1", text: "Margin can recover", status: "supported", confidence: 0, evidenceRefs: ["e1"], counterEvidenceRefs: ["e2"] }], risks: [{ id: "r1", text: "Demand weakens", evidenceRefs: ["e3"] }], expectedOutcomes: [{ id: "o1", text: "Recovery", evidenceRefs: ["e1"] }] });
for (const format of ["docx", "pptx"] as const) {
  test(`${format}: research, thesis and decision fields/arrays/evidence survive genuine unchanged return`, async () => {
    for (const content of [research, decision, thesis]) assert.deepEqual((await readOfficeArtifactRoundtrip(await generated(format, content))).content, content);
  });
  test(`${format}: actual research claim edit is user_asserted with evidence/source arrays preserved`, async () => {
    const files = unzipSync(await generated(format, research)); replaceNativeText(files, format, "Revenue improved", "Revenue may improve");
    const result = await readOfficeArtifactRoundtrip(repack(files));
    if (result.content.kind !== "research" || research.kind !== "research") assert.fail("research expected");
    assert.equal(result.content.claims[0].text, "Revenue may improve"); assert.equal(result.content.claims[0].provenance, "user_asserted"); assert.deepEqual(result.content.claims[0].sourceRefs, research.claims[0].sourceRefs); assert.deepEqual(result.content.evidence, research.evidence); assert.deepEqual(result.content.contradictions, research.contradictions);
  });
  test(`${format}: actual decision array item edits address the same canonical array element`, async () => {
    const files = unzipSync(await generated(format, decision)); replaceNativeText(files, format, "Decision delta", "New allocation information");
    const result = await readOfficeArtifactRoundtrip(repack(files));
    if (result.content.kind !== "decision" || decision.kind !== "decision") assert.fail("decision expected");
    assert.deepEqual(result.content.whatChanged, ["New allocation information"]); assert.deepEqual(result.content.alternatives, decision.alternatives); assert.deepEqual(result.content.linkedRefs, decision.linkedRefs); assert.deepEqual(result.content.assumptions, decision.assumptions);
  });
}
test("DOCX: native newline normalization preserves unchanged canonical CRLF/CR and mark offsets", async () => {
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "p", type: "paragraph", text: "First\r\nSecond\rThird", attrs: { richText: { version: 1, text: "First\r\nSecond\rThird", runs: [{ from: 7, to: 13, marks: [{ type: "bold" }] }] } } }, { id: "list", type: "ordered_list", text: "One\r\nTwo\r\n", attrs: { start: 2 } }] });
  assert.deepEqual((await readOfficeArtifactRoundtrip(await generated("docx", content))).content, content);
});
test("DOCX: native table newline normalization preserves unchanged canonical CRLF/CR headers and string cells", async () => {
  const content = artifactContentSchema.parse({
    kind: "report",
    blocks: [{
      id: "literal-lines", type: "table", text: "Literal table line endings",
      attrs: { table: {
        kind: "table",
        columns: [{ key: "literal", label: "Header\r\ncontinuation\rfinal", type: "string" }],
        rows: [{ literal: "First\r\nSecond\rThird\nFourth" }],
      } },
    }],
  });
  const bytes = await generated("docx", content);
  assert.match(strFromU8(unzipSync(bytes)["word/document.xml"]), /<w:br\/>/, "fixture must contain actual native Word line breaks");
  const result = await readOfficeArtifactRoundtrip(bytes, "docx");
  assert.deepEqual(result.sourceContent, content);
  assert.deepEqual(result.content, content);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.sourceArtifactId, plan(content).artifactId);
  assert.equal(result.sourceVersion, plan(content).version);
  assert.equal(result.sourceHash, plan(content).contentHash);
});
test("Office: invalid/duplicate table bindings and source identities are not guessed", async () => {
  const files = unzipSync(await generated("docx"));
  mutateXml(files, OFFICE_ARTIFACT_METADATA_PART, document => { const payload = document.getElementsByTagName("payload")[0], value = JSON.parse(payload.textContent!); value.bindings[1].id = value.bindings[0].id; payload.textContent = JSON.stringify(value); });
  await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /Duplicate Office Artifact binding/);
});

test("Office: actual high-ratio ZIP expansion and mismatched requested format fail closed", async () => {
  const bomb = repack({ "bomb.xml": strToU8("x".repeat(2_000_000)) });
  await assert.rejects(readOfficeArtifactRoundtrip(bomb), /oversized|expansion/);
  await assert.rejects(readOfficeArtifactRoundtrip(await generated("docx"), "pptx"), /format mismatch/);
});
test("Office: edited structured table cells cannot introduce deeper ambiguous canonical types", async () => {
  const files = unzipSync(await generated("docx")); replaceNativeText(files, "docx", '[1, "two", null]', '[[1], {"nested": true}]');
  await assert.rejects(readOfficeArtifactRoundtrip(repack(files)));
});
test("Office: duplicate ZIP local/central names are rejected before XML import", async () => {
  const bytes = repack({ "a.xml": strToU8("<same/>"), "b.xml": strToU8("<same/>") });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 0, second = -1;
  while (offset + 46 < bytes.length) { if (view.getUint32(offset, true) === 0x02014b50) { if (second === -1) second = offset; else break; } offset++; }
  assert.notEqual(second, -1); const local = view.getUint32(offset + 42, true);
  bytes.set(strToU8("a.xml"), offset + 46); bytes.set(strToU8("a.xml"), local + 30);
  await assert.rejects(readOfficeArtifactRoundtrip(bytes), /Ambiguous Office ZIP entry/);
});
for (const format of ["docx", "pptx"] as const) test(`${format}: edited thesis claims reopen instead of inheriting stale supported confidence`, async () => {
  const files = unzipSync(await generated(format, thesis)); replaceNativeText(files, format, "Margin can recover", "Margin recovery is uncertain");
  const result = await readOfficeArtifactRoundtrip(repack(files)); if (result.content.kind !== "thesis") assert.fail("thesis expected");
  assert.equal(result.content.claims[0].text, "Margin recovery is uncertain"); assert.equal(result.content.claims[0].status, "open"); assert.equal(result.content.claims[0].confidence, null); assert.deepEqual(result.content.claims[0].evidenceRefs, ["e1"]); assert.ok(result.warnings.some(warning => warning.includes("user_asserted")));
});

test("Office metadata bytes are deterministic across canonical object insertion order while arrays and negative zero remain typed", () => {
  const first = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "p", type: "paragraph", text: "Snapshot", attrs: { z: -0, a: { right: -0, left: ["first", -0, "third"] } } }] });
  const second = artifactContentSchema.parse({ kind: "report", blocks: [{ text: "Snapshot", attrs: { a: { left: ["first", -0, "third"], right: -0 }, z: -0 }, type: "paragraph", id: "p" }] });
  const firstBindings: OfficeArtifactBinding[] = [{ id: "lios_p", kind: "text", path: ["blocks", 0, "text"], text: "Snapshot", editable: true }];
  const secondBindings: OfficeArtifactBinding[] = [{ editable: true, text: "Snapshot", path: ["blocks", 0, "text"], kind: "text", id: "lios_p" }];
  const xml = buildOfficeArtifactMetadataXml(plan(first), first, "docx", firstBindings);
  assert.equal(xml, buildOfficeArtifactMetadataXml(plan(second), second, "docx", secondBindings));
  const document = new DOMParser().parseFromString(xml, "application/xml"), metadata = JSON.parse(document.getElementsByTagName("payload")[0].textContent!);
  assert.deepEqual(metadata.negativeZeroPaths, [["blocks", 0, "attrs", "a", "left", 1], ["blocks", 0, "attrs", "a", "right"], ["blocks", 0, "attrs", "z"]]);
  assert.deepEqual(metadata.content.blocks[0].attrs.a.left, ["first", 0, "third"]);
});

for (const format of ["docx", "pptx"] as const) {
  for (const target of ["quote", "claim"] as const) test(`${format}: stringified metadata array indices cannot bypass native ${target} provenance classification`, async () => {
    const content = target === "quote" ? source : research;
    const files = unzipSync(await generated(format, content));
    // Change real Office body first while the valid typed bindings still locate
    // the native run, then forge ONLY its array-index spelling in metadata.
    replaceNativeText(files, format, target === "quote" ? "quoted text" : "Revenue improved", target === "quote" ? "forged quotation" : "Unverified replacement");
    mutateXml(files, OFFICE_ARTIFACT_METADATA_PART, document => {
      const payload = document.getElementsByTagName("payload")[0], metadata = JSON.parse(payload.textContent!);
      let changed = 0;
      const forge = (binding: OfficeArtifactBinding | NonNullable<OfficeArtifactBinding["segments"]>[number]) => {
        if (binding.editable !== false && binding.path[0] === (target === "quote" ? "blocks" : "claims") && binding.path[2] === "text" && binding.text?.includes(target === "quote" ? "quoted text" : "Revenue improved")) {
          binding.path[1] = String(binding.path[1]); changed++;
        }
      };
      for (const binding of metadata.bindings as OfficeArtifactBinding[]) { forge(binding); binding.segments?.forEach(forge); }
      assert.ok(changed, "must forge the actual edited native target binding");
      payload.textContent = JSON.stringify(metadata);
    });
    await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /array indices must be numeric/);
  });
  test(`${format}: edited body cannot target a canonical provenance/status field even when baseline hash is unchanged`, async () => {
    const files = unzipSync(await generated(format, research));
    mutateXml(files, OFFICE_ARTIFACT_METADATA_PART, document => {
      const payload = document.getElementsByTagName("payload")[0], metadata = JSON.parse(payload.textContent!);
      const editable: (OfficeArtifactBinding | NonNullable<OfficeArtifactBinding["segments"]>[number])[] = metadata.bindings.flatMap((binding: OfficeArtifactBinding) => binding.segments ?? [binding]);
      const target = editable.find(binding => binding.editable !== false && binding.path[0] === "claims")!;
      assert.ok(target); target.path = ["claims", 0, "provenance"]; target.text = "source_backed";
      payload.textContent = JSON.stringify(metadata);
    });
    await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /Unsupported canonical editable Office binding path/);
  });
}

const captureBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
const captureBytes = Buffer.from(captureBase64, "base64");
const capturedImage = readArtifactImage({ mimeType: "image/png", dataBase64: captureBase64, sha256: createHash("sha256").update(captureBytes).digest("hex"), byteLength: captureBytes.length, width: 1, height: 1, sourceRef: "capture:roundtrip:image" });
const nativeComposed = artifactContentSchema.parse({ kind: "report", blocks: [
  { id: "intro", type: "paragraph", text: "Composed native image, table, chart and evidence", attrs: {} },
  { id: "capture", type: "image", text: "Source screenshot", attrs: { image: capturedImage, sourceRef: capturedImage.sourceRef, truth: { provenance: "captured_source" } } },
  { id: "table", type: "table", text: "Typed observations", attrs: { table: { kind: "table", columns: [{ key: "v", label: "Value", type: "number" }], rows: [{ v: 12.5 }, { v: -0 }] } } },
  { id: "native-chart", type: "chart_ref", text: "Native comparison chart", attrs: { chart: { kind: "chart", chartType: "line", series: [{ id: "first", label: "Recorded series", points: [{ x: 2, y: 12.5 }, { x: 1, y: -0 }] }, { id: "sparse", label: "Sparse series", points: [{ x: 2, y: 7 }] }], options: { unit: "USD million" } }, sourceRef: SOURCE } },
  { id: "quote", type: "quote", text: "Canonical cited explanation", attrs: { sourceRef: SOURCE, evidenceId: "e1" } },
], sections: [{ id: "composition", title: "Composition", blockIds: ["intro", "capture", "table", "native-chart", "quote"] }] });
function metadataBindings(files: Record<string, Uint8Array>): OfficeArtifactBinding[] {
  const xml = new DOMParser().parseFromString(strFromU8(files[OFFICE_ARTIFACT_METADATA_PART]), "application/xml");
  return JSON.parse(xml.getElementsByTagName("payload")[0].textContent!).bindings;
}
for (const format of ["docx", "pptx"] as const) {
  test(`${format}: bounded native captured image/table/chart/evidence composition returns exact immutable source`, async () => {
    const result = await readOfficeArtifactRoundtrip(await generated(format, nativeComposed), format);
    assert.deepEqual(result.sourceContent, nativeComposed); assert.deepEqual(result.content, nativeComposed); assert.deepEqual(result.warnings, []);
    assert.deepEqual((await readOfficeArtifactRoundtrip(await generated(format, result.content))).content, nativeComposed);
  });
  test(`${format}: changed actual native media bytes cannot be ignored in favor of embedded capture metadata`, async () => {
    const files = unzipSync(await generated(format, nativeComposed)), image = metadataBindings(files).find(binding => binding.kind === "image")!;
    assert.ok(image.mediaPart); const altered = files[image.mediaPart!].slice(); altered[altered.length - 1] ^= 1; files[image.mediaPart!] = altered;
    await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /Modified Office image bytes/);
  });
  test(`${format}: extra unbound native drawings/pictures reject instead of dropping Office edits`, async () => {
    const files = unzipSync(await generated(format, nativeComposed));
    const part = format === "docx" ? "word/document.xml" : metadataBindings(files).find(binding => binding.kind === "image")!.part!;
    mutateXml(files, part, document => {
      if (format === "docx") {
        const drawing = document.getElementsByTagNameNS(WORD, "drawing")[0], paragraph = Array.from(document.getElementsByTagNameNS(WORD, "p")).find(node => node.textContent?.includes("Composed native image"))!;
        const run = document.createElementNS(WORD, "w:r"); run.appendChild(drawing.cloneNode(true)); paragraph.appendChild(run);
      } else {
        const presentation = "http://schemas.openxmlformats.org/presentationml/2006/main", picture = document.getElementsByTagNameNS(presentation, "pic")[0];
        const copied = picture.cloneNode(true) as Element; copied.getElementsByTagNameNS(presentation, "cNvPr")[0].setAttribute("name", "lios_unbound_capture"); picture.parentNode!.appendChild(copied);
      }
    });
    await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /Unsupported Office|Unknown|unbound|duplicate/);
  });
  test(`${format}: cropping or resizing captured pictures cannot silently retain the original capture`, async () => {
    const files = unzipSync(await generated(format, nativeComposed)), image = metadataBindings(files).find(binding => binding.kind === "image")!;
    mutateXml(files, image.part!, document => {
      const presentation = "http://schemas.openxmlformats.org/presentationml/2006/main", picture = format === "docx" ? document.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/picture", "pic")[0] : document.getElementsByTagNameNS(presentation, "pic")[0];
      const extent = picture.getElementsByTagNameNS(DRAWING, "ext")[0]; extent.setAttribute("cx", String(Number(extent.getAttribute("cx")) + 9525));
    });
    await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /media geometry/);
  });
  test(`${format}: remote captured image relationship is rejected before any media fetch`, async () => {
    const files = unzipSync(await generated(format, nativeComposed)), image = metadataBindings(files).find(binding => binding.kind === "image")!, owner = image.part!;
    const relPart = owner.slice(0, owner.lastIndexOf("/") + 1) + "_rels/" + owner.slice(owner.lastIndexOf("/") + 1) + ".rels";
    mutateXml(files, relPart, document => { const relationship = Array.from(document.getElementsByTagName("Relationship")).find(item => item.getAttribute("Type")?.endsWith("/image"))!; relationship.setAttribute("TargetMode", "External"); relationship.setAttribute("Target", "https://127.0.0.1/private-capture"); });
    await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /External Office network/);
  });
}
test("DOCX: readonly actual native chart cache edits fail rather than restoring canonical chart", async () => {
  const files = unzipSync(await generated("docx", nativeComposed)), binding = metadataBindings(files).find(binding => binding.kind === "chart")!;
  mutateXml(files, binding.chartPart!, document => { const point = Array.from(document.getElementsByTagNameNS(CHART, "numLit")).flatMap(cache => Array.from(cache.getElementsByTagNameNS(CHART, "v"))).find(value => value.textContent === "12.5")!; assert.ok(point); point.textContent = "99"; });
  await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /Modified readonly Word chart cache values/);
});
test("DOCX: readonly native charts require complete literal cache indices and matching labels", async () => {
  const bytes = await generated("docx", nativeComposed);
  for (const mutation of ["label", "point", "type"] as const) {
    const files = unzipSync(bytes), binding = metadataBindings(files).find(binding => binding.kind === "chart")!;
    mutateXml(files, binding.chartPart!, document => {
      if (mutation === "label") document.getElementsByTagNameNS(CHART, "tx")[0].getElementsByTagNameNS(CHART, "v")[0].textContent = "Replaced source series";
      else if (mutation === "point") { const point = document.getElementsByTagNameNS(CHART, "numLit")[0].getElementsByTagNameNS(CHART, "pt")[0]; point.parentNode!.removeChild(point); }
      else { const plot = document.getElementsByTagNameNS(CHART, "lineChart")[0], replacement = document.createElementNS(CHART, "c:areaChart"); while (plot.firstChild) replacement.appendChild(plot.firstChild); plot.parentNode!.replaceChild(replacement, plot); }
    });
    await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /Modified readonly Word chart/);
  }
});

for (const format of ["docx", "pptx"] as const) test(`${format}: actual captured-image cropping is an explicit unsupported edit`, async () => {
  const files = unzipSync(await generated(format, nativeComposed)), binding = metadataBindings(files).find(item => item.kind === "image")!;
  mutateXml(files, binding.part!, document => {
    const namespace = format === "docx" ? "http://schemas.openxmlformats.org/drawingml/2006/picture" : "http://schemas.openxmlformats.org/presentationml/2006/main";
    const picture = document.getElementsByTagNameNS(namespace, "pic")[0], fill = picture.getElementsByTagNameNS(namespace, "blipFill")[0];
    const crop = document.createElementNS(DRAWING, "a:srcRect"); crop.setAttribute("l", "10000"); fill.appendChild(crop);
  });
  await assert.rejects(readOfficeArtifactRoundtrip(repack(files)), /picture crop/);
});
for (const chartType of ["line", "area", "bar", "scatter"] as const) test(`DOCX: readonly ${chartType} caches preserve unsorted numeric source indices and sparse nonzero observations`, async () => {
  const content = artifactContentSchema.parse({ kind: "report", blocks: [{ id: "native", type: "chart_ref", text: "Native readonly chart", attrs: { chart: { kind: "chart", chartType, series: [{ id: "s1", label: "Source series", points: [{ x: 4, y: 0 }, { x: 2, y: 16.75 }, { x: 3, y: -0 }] }, { id: "s2", label: "Sparse source", points: [{ x: 2, y: -5.25 }] }], options: { unit: "USD" } } } }] });
  assert.deepEqual((await readOfficeArtifactRoundtrip(await generated("docx", content))).content, content);
});

for (const format of ["docx", "pptx"] as const) test(`${format}: professionally styled mixed narrative and paginated numeric tables return exact source intervals`, async () => {
  const quote = `First literal 001.5000\r\n\r\n${"Bound quoted text ".repeat(38)}\r\n`;
  const code = "amount = '9007199254740993.25000000000000001'\r\n\r\nreturn amount\r\n";
  const table = {
    kind: "table",
    columns: [
      { key: "period", label: "Recorded period", type: "string" },
      { key: "amount", label: "Declared numeric amount", type: "currency" },
      { key: "literal", label: "Unformatted identifier", type: "string" },
    ],
    rows: Array.from({ length: 151 }, (_, row) => ({
      period: `native-period-${row}`,
      amount: row === 150 ? "9007199254740993.25000000000000001" : row === 0 ? -0 : `00${row}.5000`,
      literal: row === 0 ? "=SUM(A1:A2)" : `identifier-${row}`,
    })),
  };
  const content = artifactContentSchema.parse({
    kind: "report",
    sections: [{ id: "styled", title: "Source interval integrity", blockIds: ["heading", "quote", "code", "callout", "body", "table"] }],
    blocks: [
      { id: "heading", type: "heading", text: "Meaningful authored heading", attrs: { level: 2 } },
      { id: "quote", type: "quote", text: quote, attrs: { sourceRef: SOURCE, richText: { version: 1, text: quote, runs: [{ from: 0, to: 5, marks: [{ type: "bold" }] }] } } },
      { id: "code", type: "code", text: code, attrs: {} },
      { id: "callout", type: "callout", text: "Keep this heading with its explanation", attrs: {} },
      { id: "body", type: "paragraph", text: "\nExact body text\r\n\r\nBody tail\n\n", attrs: { sourceRef: SOURCE } },
      { id: "table", type: "table", text: "Literal numeric source remains unformatted", attrs: { table, sourceRef: SOURCE, receiptId: "receipt:styled:numeric" } },
    ],
  });
  const bytes = await generated(format, content);
  assert.deepEqual(bytes, await generated(format, content));
  const result = await readOfficeArtifactRoundtrip(bytes, format);
  assert.deepEqual(result.sourceContent, content);
  assert.deepEqual(result.content, content);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.sourceArtifactId, plan(content).artifactId);
  assert.equal(result.sourceVersion, plan(content).version);
  assert.equal(result.sourceHash, plan(content).contentHash);
  const files = unzipSync(bytes);
  const bindings = metadataBindings(files).filter(binding => binding.kind === "table");
  if (format === "pptx") {
    assert.ok(bindings.length > 1, "styled table still paginates natively");
    assert.equal(bindings.reduce((count, binding) => count + (binding.rowCount ?? 0), 0), table.rows.length);
  }
  const cells = bindings.flatMap(binding => {
    const document = new DOMParser().parseFromString(strFromU8(files[binding.part ?? "word/document.xml"]), "application/xml");
    const namespace = format === "docx" ? WORD : DRAWING;
    return Array.from(document.getElementsByTagNameNS(namespace, "tc")).map(cell =>
      Array.from(cell.getElementsByTagNameNS(namespace, "t")).map(text => text.textContent ?? "").join(""));
  });
  for (const row of table.rows) assert.equal(cells.filter(cell => cell === row.period).length, 1, row.period);
  for (const column of table.columns) assert.equal(cells.filter(cell => cell === column.label).length, bindings.length, "each native continuation retains its complete table header");
  assert.ok(cells.includes("9007199254740993.25000000000000001"));
  assert.ok(cells.includes("-0"));
  assert.ok(cells.includes("=SUM(A1:A2)"));
});
