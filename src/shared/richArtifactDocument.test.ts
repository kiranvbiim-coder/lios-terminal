import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { reportArtifactContentSchema, researchArtifactContentSchema, type RichArtifactBlock } from "./artifactContracts";
import { fromTiptapDocumentProjection, readRecordedDocumentTable, readRichDocumentFormatting, reconcileReportBlockSections, recordedDocumentTablePreview, recordedDocumentValue, safeRichDocumentHref, toTiptapDocumentProjection } from "./richArtifactDocument";

const block = (id: string, type: RichArtifactBlock["type"], text = "", attrs: Record<string, unknown> = {}): RichArtifactBlock => ({ id, type, text, attrs });

const report = () => reportArtifactContentSchema.parse({
  kind: "report", templateId: "investment-memo", editorPreference: "tiptap",
  sections: [{ id: "sec", title: "Findings", blockIds: ["h", "p", "bul", "ord", "q", "c", "t", "call", "chart", "ref"] }],
  blocks: [
    block("h", "heading", "Heading", { level: 3, sourceRefs: ["source:1"], unknown: { deeply: [1, null, { version: "custom" }] } }),
    block("p", "paragraph", "first\n\nlast\n", { citation: { receiptId: "receipt:1", page: 4 } }),
    block("bul", "bullet_list", "one\n\nthree\n", { listMetadata: "not donor-owned" }),
    block("ord", "ordered_list", "one\ntwo", { start: 4 }),
    block("q", "quote", "quoted\ntext", { sourceRef: "source:2" }),
    block("c", "code", "const x = 1;\n\n", { language: "javascript", custom: true }),
    block("t", "table", "table caption", { columns: ["a"], rows: [[1]], unknown: { nested: "kept" } }),
    block("call", "callout", "Important", { severity: "warning" }),
    block("chart", "chart_ref", "Market", { artifactId: "chart:123", sourceRefs: ["source:3"] }),
    block("ref", "artifact_ref", "Appendix", { artifactId: "report:456", href: "javascript:alert(1)" }),
  ],
});

test("every canonical block type roundtrips unchanged including attrs, citations, empty list lines, code and report sections", () => {
  const canonical = report();
  const projected = toTiptapDocumentProjection(canonical);
  assert.deepEqual(projected.content.map(node => node.type), ["heading", "paragraph", "bulletList", "orderedList", "blockquote", "codeBlock", "canonicalBlock", "canonicalBlock", "canonicalBlock", "canonicalBlock"]);
  assert.equal(projected.content[2].content?.length, 4);
  assert.equal(projected.content[3].attrs?.start, 4);
  assert.deepEqual(fromTiptapDocumentProjection(projected, canonical), canonical);
});

test("research evidence, claims, source policy, receipts and planning remain canonical during document edits", () => {
  const canonical = researchArtifactContentSchema.parse({ kind: "research", question: "What changed?", blocks: [block("p", "paragraph", "answer")], claims: [{ id: "claim", text: "answer", provenance: "source_backed", sourceRefs: ["source:1"] }], evidence: [{ id: "ev", title: "Filing", sourceRef: "source:1" }], executionTrail: [{ at: "2026-10-07T00:00:00Z", action: "read", receiptId: "receipt:1" }], sourcePolicy: { mode: "only_refs", allowedSourceRefs: ["source:1"] } });
  const projected = toTiptapDocumentProjection(canonical);
  projected.content[0].content = [{ type: "text", text: "edited" }];
  const updated = fromTiptapDocumentProjection(projected, canonical);
  assert.deepEqual({ ...updated, blocks: canonical.blocks }, canonical);
  assert.equal(updated.blocks[0].text, "edited");
});

test("inline runs roundtrip exactly and native marks become coherent canonical UTF-16 ranges", () => {
  const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [block("p", "paragraph", "A😀\nBold", { richText: { version: 1, text: "A😀\nBold", runs: [{ from: 1, to: 3, marks: [{ type: "italic" }] }, { from: 4, to: 8, marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.test/evidence", target: "_blank" } }] }] }, sourceRefs: ["source:1"] })] });
  const projected = toTiptapDocumentProjection(canonical);
  assert.deepEqual(fromTiptapDocumentProjection(projected, canonical), canonical);
  projected.content[0].content = [{ type: "text", text: "new ", marks: [{ type: "bold" }] }, { type: "text", text: "text" }];
  const edited = fromTiptapDocumentProjection(projected, canonical);
  assert.deepEqual(edited.blocks[0].attrs.richText, { version: 1, text: "new text", runs: [{ from: 0, to: 4, marks: [{ type: "bold" }] }] });
  assert.deepEqual(edited.blocks[0].attrs.sourceRefs, ["source:1"]);
});

test("shared native formatting reader returns validated UTF-16 runs and safe links without rewriting recorded attrs", () => {
  const text = "A😀 linked";
  const attrs = {
    richText: { version: 1, text, runs: [
      { from: 1, to: 3, marks: [{ type: "underline" }, { type: "strike" }, { type: "italic" }, { type: "code" }, { type: "bold" }] },
      { from: 4, to: text.length, marks: [{ type: "link", attrs: { href: "https://example.test/exact?q=1&x=2", target: "_self" } }] },
    ] },
    citation: { sourceRef: "source:1", versionRef: "artifact:report@v4", receiptId: "receipt:1" },
    unknown: { retained: ["all", "attrs"] },
  };
  const original = structuredClone(attrs);
  const item = block("formatted", "paragraph", text, attrs);
  const result = readRichDocumentFormatting(item);
  assert.deepEqual(result, { version: 1, text, runs: [
    { from: 1, to: 3, marks: [{ type: "bold" }, { type: "code" }, { type: "italic" }, { type: "strike" }, { type: "underline" }] },
    { from: 4, to: text.length, marks: [{ type: "link", attrs: { href: "https://example.test/exact?q=1&x=2", target: "_self" } }] },
  ] });
  assert.deepEqual(attrs, original);
  assert.equal(readRichDocumentFormatting({ ...item, text: "changed snapshot" }), null);
  assert.equal(readRichDocumentFormatting(block("plain", "paragraph", text)), null);
  const links = block("links", "paragraph", "xy", { richText: { version: 1, text: "xy", runs: [
    { from: 0, to: 1, marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "bold" }] },
    { from: 1, to: 2, marks: [{ type: "link", attrs: { href: "#recorded-bookmark" } }] },
  ] } });
  const recordedLinks = structuredClone(links.attrs);
  assert.deepEqual(readRichDocumentFormatting(links)?.runs, [
    { from: 0, to: 1, marks: [{ type: "bold" }] },
    { from: 1, to: 2, marks: [{ type: "link", attrs: { href: "#recorded-bookmark", target: "_blank" } }] },
  ]);
  assert.deepEqual(links.attrs, recordedLinks);
});

test("shared native formatting reader applies the editor's malformed-run and Unicode guards", () => {
  for (const runs of [
    [{ from: 0, to: 1, marks: [{ type: "bold" }] }],
    [{ from: 0, to: 4, marks: [{ type: "bold" }] }],
    [{ from: 0, to: 2, marks: [{ type: "bold" }] }, { from: 1, to: 3, marks: [] }],
    [{ from: 0, to: 2, marks: [{ type: "bold" }, { type: "bold" }] }],
    [{ from: 0, to: 2, marks: [{ type: "unknown" }] }],
    [{ from: 0, to: 2, marks: [{ type: "link", attrs: { href: "https://example.test", target: "frame" } }] }],
  ]) assert.throws(() => readRichDocumentFormatting(block("invalid", "paragraph", "😀x", { richText: { version: 1, text: "😀x", runs } })));
});

test("text-only edits remove stale marks instead of attaching formatting to unrelated text", () => {
  const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [block("p", "paragraph", "edited", { richText: { version: 1, text: "old", runs: [{ from: 0, to: 3, marks: [{ type: "bold" }] }] }, other: "retained" })] });
  const projected = toTiptapDocumentProjection(canonical);
  assert.equal(projected.content[0].content?.[0].marks, undefined);
  assert.deepEqual(fromTiptapDocumentProjection(projected, canonical).blocks[0].attrs, { other: "retained" });
});

test("inserted IDs are stable across saves, donor metadata is not inherited and deletion updates only section references", () => {
  const canonical = report();
  const projected = toTiptapDocumentProjection(canonical);
  projected.content = projected.content.filter(node => node.attrs?.canonicalId !== "h");
  projected.content.push({ type: "paragraph", attrs: { canonicalAttrs: { sourceRefs: ["forged"], receiptId: "copied" } }, content: [{ type: "text", text: "new" }] });
  const updated = fromTiptapDocumentProjection(projected, canonical, { createBlockId: () => "inserted" });
  assert.equal(projected.content.at(-1)?.attrs?.canonicalId, "inserted");
  assert.deepEqual(updated.blocks.at(-1), block("inserted", "paragraph", "new"));
  assert.deepEqual(fromTiptapDocumentProjection(projected, updated), updated);
  assert.equal(updated.kind, "report");
  if (updated.kind !== "report") throw new Error("Expected report.");
  assert.deepEqual(updated.sections, [{ ...canonical.sections[0], blockIds: [...canonical.sections[0].blockIds.filter(id => id !== "h"), "inserted"] }]);
});

test("duplicate pasted canonical IDs and colliding factories are blocked without source mutation", () => {
  const canonical = report();
  const projected = toTiptapDocumentProjection(canonical);
  projected.content.push(structuredClone(projected.content[0]));
  assert.throws(() => fromTiptapDocumentProjection(projected, canonical), /identity/);
  const collision = toTiptapDocumentProjection(canonical);
  collision.content.push({ type: "paragraph" });
  assert.throws(() => fromTiptapDocumentProjection(collision, canonical, { createBlockId: () => "h" }), /identity/);
  assert.deepEqual(canonical, report());
  assert.throws(() => toTiptapDocumentProjection({ ...canonical, blocks: [canonical.blocks[0], canonical.blocks[0]] }), /identity/);
});

test("opaque edits preserve full original attrs, but foreign insertion, impersonation and flattening fail closed", () => {
  const canonical = report();
  const projected = toTiptapDocumentProjection(canonical);
  projected.content[6].attrs!.canonicalText = "updated caption";
  projected.content[6].attrs!.canonicalAttrs = { receiptId: "forged" };
  const updated = fromTiptapDocumentProjection(projected, canonical);
  assert.equal(updated.blocks[6].text, "updated caption");
  assert.deepEqual(updated.blocks[6].attrs, canonical.blocks[6].attrs);
  projected.content[6].attrs!.canonicalId = "foreign";
  assert.throws(() => fromTiptapDocumentProjection(projected, canonical), /Opaque/);
  const flattened = toTiptapDocumentProjection(canonical);
  flattened.content[6] = { type: "paragraph", attrs: { canonicalId: "t" }, content: [{ type: "text", text: "lost table" }] };
  assert.throws(() => fromTiptapDocumentProjection(flattened, canonical), /flattened/);
});

test("unsupported nested structures, raw HTML, unknown marks and malformed nodes never silently delete content", () => {
  const canonical = report();
  for (const node of [
    { type: "image", attrs: { src: "https://example.test" } },
    { type: "html", text: "<script>bad()</script>" },
    { type: "paragraph", content: [{ type: "text", text: 12 }] },
    { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "unknown" }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "bulletList" }] }] },
    { type: "paragraph", content: [{ type: "text", text: "x", content: [] }] },
  ]) assert.throws(() => fromTiptapDocumentProjection({ type: "doc", content: [node] }, canonical));
});

test("malformed formatting offsets, versions, types, overlap and bounds fail before projection", () => {
  for (const richText of [
    { version: 2, text: "abc", runs: [] },
    { version: 1, text: "abc", runs: [{ from: -1, to: 1, marks: [] }] },
    { version: 1, text: "abc", runs: [{ from: 0, to: 4, marks: [] }] },
    { version: 1, text: "abc", runs: [{ from: 0.5, to: 2, marks: [] }] },
    { version: 1, text: "abc", runs: [{ from: 0, to: 2, marks: [] }, { from: 1, to: 3, marks: [] }] },
    { version: 1, text: "abc", runs: [{ from: 0, to: 3, marks: [{ type: "bold", attrs: { onclick: "bad()" } }] }] },
  ]) assert.throws(() => toTiptapDocumentProjection({ kind: "report", blocks: [block("p", "paragraph", "abc", { richText })] }));
});

test("link rendering rejects executable, encoded whitespace, protocol-relative and file schemes without dropping opaque metadata", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "//example.test", " javaScript:alert(1)", "java\nscript:alert(1)", "/\\evil", "vbscript:msgbox(1)"]) assert.equal(safeRichDocumentHref(href), null);
  for (const href of ["https://example.test/a", "http://localhost:5052/a", "mailto:test@example.test", "tel:+15555555555", "#claim-1", "/artifacts/1"]) assert.equal(safeRichDocumentHref(href), href);
  const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [block("p", "paragraph", "link", { richText: { version: 1, text: "link", runs: [{ from: 0, to: 4, marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] } })] });
  const projected = toTiptapDocumentProjection(canonical);
  assert.equal(projected.content[0].content?.[0].marks, undefined);
  assert.deepEqual(fromTiptapDocumentProjection(projected, canonical), canonical);
  projected.content[0].content = [{ type: "text", text: "different", marks: [{ type: "link", attrs: { href: "data:text/html,x" } }] }];
  assert.equal(fromTiptapDocumentProjection(projected, canonical).blocks[0].attrs.richText, undefined);
});

test("generated identities are committed only after the complete document is accepted", () => {
  const canonical = report();
  const first = { type: "paragraph", content: [{ type: "text", text: "new" }] };
  const projected = { type: "doc", content: [first, { type: "unknown" }] };
  assert.throws(() => fromTiptapDocumentProjection(projected, canonical, { createBlockId: () => "inserted" }));
  assert.equal("attrs" in first, false);
});

test("type changes keep identity and citations while recording native heading/list presentation", () => {
  const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [block("p", "paragraph", "same", { sourceRef: "source:1", receiptId: "receipt:1" })] });
  const projected = toTiptapDocumentProjection(canonical);
  projected.content[0].type = "heading";
  projected.content[0].attrs!.level = 4;
  const updated = fromTiptapDocumentProjection(projected, canonical);
  assert.deepEqual(updated.blocks[0], block("p", "heading", "same", { sourceRef: "source:1", receiptId: "receipt:1", level: 4 }));
});

test("preexisting unresolved section references and empty documents survive unchanged", () => {
  const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [], sections: [{ id: "sec", title: "Unresolved reference", blockIds: ["missing"] }] });
  assert.deepEqual(fromTiptapDocumentProjection(toTiptapDocumentProjection(canonical), canonical), canonical);
});

test("canonical opaque insertion and undo can use explicitly seeded P4 metadata", () => {
  const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [block("inserted", "table", "caption", { rows: [["verified data"]], sourceRefs: ["explicit:seed"] })] });
  const projected = toTiptapDocumentProjection(canonical);
  const returned = fromTiptapDocumentProjection(projected, canonical);
  assert.deepEqual(returned, canonical);
  const donorAttrs = projected.content[0].attrs!.canonicalAttrs;
  donorAttrs.rows[0][0] = "mutated donor payload";
  assert.deepEqual(canonical.blocks[0].attrs.rows, [["verified data"]]);
  assert.deepEqual(fromTiptapDocumentProjection(projected, canonical), canonical);
});

test("UTF-16 formatting must not bisect a surrogate pair and direct block marks cannot be discarded", () => {
  assert.throws(() => toTiptapDocumentProjection({ kind: "report", blocks: [block("p", "paragraph", "😀", { richText: { version: 1, text: "😀", runs: [{ from: 0, to: 1, marks: [{ type: "bold" }] }] } })] }), /Unicode/);
  const canonical = report();
  assert.throws(() => fromTiptapDocumentProjection({ type: "doc", content: [{ type: "paragraph", text: "cannot silently disappear" }] }, canonical), /directly/);
  assert.throws(() => fromTiptapDocumentProjection({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] }] }, canonical), /Code blocks/);
});

test("typed table recognition displays exact recorded values without changing labels, decimals, references or payload", () => {
  const table = { kind: "table", columns: [{ key: "value", label: " Recorded value ", type: "currency" }], rows: [{ value: "0012.3400" }, { value: -0 }, { value: false }, { value: null }, { value: ["12.50%", 0, null] }, { value: { amount: "123.4500", recorded: true } }] };
  const attrs = { table, sourceRef: "source:filing:1", versionRef: "artifact:table@v3", receiptId: "receipt:1" };
  const result = readRecordedDocumentTable(attrs);
  assert.equal(result.status, "recognized");
  if (result.status !== "recognized") throw new Error(result.reason);
  assert.equal(result.table, table, "validation must not replace the canonical record with schema-normalized data");
  assert.equal(result.table.columns[0].label, " Recorded value ");
  assert.deepEqual(result.table.rows.map(row => recordedDocumentValue(row.value)), ["0012.3400", "-0", "false", "null", '["12.50%", 0, null]', '{"amount": "123.4500", "recorded": true}']);
  const canonical = reportArtifactContentSchema.parse({ kind: "report", sections: [{ id: "section-exact", title: "Exact values", blockIds: ["exact-table"] }], blocks: [block("exact-table", "table", "Recorded caption", attrs)] });
  const projection = toTiptapDocumentProjection(canonical);
  projection.content[0].attrs!.canonicalText = "Edited caption only";
  projection.content[0].attrs!.canonicalAttrs = { table: { kind: "table", columns: [], rows: [] }, sourceRef: "forged" };
  const updated = fromTiptapDocumentProjection(projection, canonical);
  assert.deepEqual(updated.blocks[0].attrs, attrs);
  assert.equal(updated.blocks[0].text, "Edited caption only");
  assert.deepEqual(updated.kind === "report" && updated.sections, canonical.sections);
});

test("typed table preview is bounded to 100 rows without discarding the remaining recorded payload", () => {
  const table = { kind: "table", columns: [{ key: "value", label: "Value", type: "string" }], rows: Array.from({ length: 151 }, (_, index) => ({ value: `exact-${index}` })) };
  const result = readRecordedDocumentTable({ table });
  assert.equal(result.status, "recognized");
  if (result.status !== "recognized") throw new Error(result.reason);
  const preview = recordedDocumentTablePreview(result.table);
  assert.equal(preview.shown, 100);
  assert.equal(preview.total, 151);
  assert.equal(preview.rows.length, 100);
  assert.equal(preview.rows.at(-1)?.value, "exact-99");
  assert.equal(result.table.rows.at(-1)?.value, "exact-150");
  assert.deepEqual(recordedDocumentTablePreview({ ...result.table, rows: [] }), { rows: [], shown: 0, total: 0 });
});

test("legacy, malformed, nonfinite and ambiguous tables remain explicit opaque records, never lossy typed tables", () => {
  for (const attrs of [
    { columns: ["Value"], rows: [[1]], unknown: { source: "legacy" } },
    { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: [{ v: NaN }] } },
    { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: [{ v: { nested: Infinity } }] } },
    { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: [{ v: [-Infinity] }] } },
    { table: { kind: "table", columns: [{ key: "v", label: "One" }, { key: "v", label: "Two" }], rows: [{ v: 1 }] } },
    { table: { kind: "table", columns: [{ key: "v", label: "Value" }], rows: [{ v: 1, unlisted: "must not vanish" }] } },
  ]) {
    assert.equal(readRecordedDocumentTable(attrs).status, "legacy");
    const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [block("legacy", "table", "Legacy caption", attrs)] });
    assert.deepEqual(fromTiptapDocumentProjection(toTiptapDocumentProjection(canonical), canonical), canonical);
  }
  assert.equal(recordedDocumentValue({ values: [NaN, Infinity, -Infinity, -0] }), '{"values": [NaN, Infinity, -Infinity, -0]}');
});

test("table labels and cells remain literal untrusted text, not fetched resources or HTML", () => {
  const html = '<img src="https://remote.test/x" onerror="alert(1)">';
  const table = { kind: "table", columns: [{ key: "v", label: html }], rows: [{ v: html }, { v: "javascript:alert(1)" }, { v: "https://remote.test/secret" }] };
  const result = readRecordedDocumentTable({ table });
  assert.equal(result.status, "recognized");
  if (result.status !== "recognized") throw new Error(result.reason);
  assert.equal(result.table.columns[0].label, html);
  assert.equal(recordedDocumentValue(result.table.rows[0].v), html);
  assert.equal(recordedDocumentValue(result.table.rows[1].v), "javascript:alert(1)");
  assert.equal(safeRichDocumentHref(result.table.rows[1].v), null);
  const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [block("unsafe", "table", html, { table })] });
  const node = toTiptapDocumentProjection(canonical).content[0];
  assert.equal(node.type, "canonicalBlock");
  assert.equal(node.content, undefined, "table strings must never be parsed into donor HTML or link nodes");
});

test("SI-04.20 captured image is opaque: caption edits preserve exact bytes/source and donor attrs cannot inject or replace media", () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
  const image = { mimeType: "image/png", dataBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, width: 1, height: 1, sourceRef: "source:project:attachment:owned" };
  const canonical = reportArtifactContentSchema.parse({ kind: "report", blocks: [block("image", "image", "Recorded image caption", { image, sourceRefs: [image.sourceRef], receiptId: "receipt:captured" })] });
  const projected = toTiptapDocumentProjection(canonical);
  assert.equal(projected.content[0].type, "canonicalBlock");
  assert.equal(projected.content[0].attrs?.canonicalType, "image");
  assert.deepEqual(fromTiptapDocumentProjection(projected, canonical), canonical);
  projected.content[0].attrs!.canonicalText = "Edited caption <script>literal</script>";
  projected.content[0].attrs!.canonicalAttrs = { image: { mimeType: "image/svg+xml", dataBase64: "<svg onload='evil'/>", sourceRef: "https://evil.test/image" } };
  const edited = fromTiptapDocumentProjection(projected, canonical);
  assert.equal(edited.blocks[0].text, "Edited caption <script>literal</script>");
  assert.deepEqual(edited.blocks[0].attrs, canonical.blocks[0].attrs);
  const flattened = { type: "doc", content: [{ type: "paragraph", attrs: { canonicalId: "image" }, content: [{ type: "text", text: "replace image" }] }] };
  assert.throws(() => fromTiptapDocumentProjection(flattened, canonical), /cannot be flattened/);
  assert.throws(() => fromTiptapDocumentProjection({ type: "doc", content: [{ type: "canonicalBlock", attrs: { canonicalId: "forged", canonicalType: "image", canonicalText: "forged", canonicalAttrs: { image } } }] }, canonical), /retain their canonical identity/);
});

test("WS-37 report insertion belongs to nearest recorded section in visible document order", () => {
  const sections = [
    { id: "s1", title: "Introduction", blockIds: ["a", "b"] },
    { id: "s2", title: "Evidence", blockIds: ["c", "d"] },
  ];
  const from = ["a", "b", "c", "d"];
  const next = ["before", "a", "middle", "b", "c", "near-evidence", "d", "after"];
  const result = reconcileReportBlockSections(sections, from, next);
  assert.deepEqual(result, [
    { ...sections[0], blockIds: ["before", "a", "middle", "b"] },
    { ...sections[1], blockIds: ["c", "near-evidence", "d", "after"] },
  ]);
  assert.deepEqual(sections[0].blockIds, ["a", "b"], "original P4 input cannot be mutated");
  assert.deepEqual(sections[1].blockIds, ["c", "d"]);
  assert.deepEqual(reconcileReportBlockSections(result, next, next), result, "repeated editor projection is stable");
});

test("WS-37 deleted blocks release section membership, unresolved refs survive, and orphan older blocks do not get auto-minted provenance", () => {
  const sections = [
    { id: "a", title: "Recorded", blockIds: ["old", "unresolved-ref"] },
    { id: "b", title: "Appendix", blockIds: ["appendix"] },
  ];
  const result = reconcileReportBlockSections(sections, ["old", "orphan", "appendix"], ["orphan", "authored", "appendix"]);
  assert.deepEqual(result, [
    { ...sections[0], blockIds: ["unresolved-ref"] },
    { ...sections[1], blockIds: ["authored", "appendix"] },
  ], "new block receives nearby recorded section, not a fabricated citation or link");
  assert.equal(result.flatMap(item => item.blockIds).includes("orphan"), false);
  assert.deepEqual(reconcileReportBlockSections([], ["old"], ["added"]), [],
    "documents without sections do not get a fabricated section");
});

test("WS-37 insertion through canonical report decoder retains section IDs and separate evidence metadata", () => {
  const canonical = reportArtifactContentSchema.parse({
    kind: "report", templateId: "investment-memo", editorPreference: "tiptap",
    sections: [
      { id: "facts", title: "Verified sources", blockIds: ["a"] },
      { id: "findings", title: "Analysis", blockIds: ["b"] },
    ],
    blocks: [
      block("a", "paragraph", "Recorded", { sourceRefs: ["filing:v1"], receiptId: "receipt:1" }),
      block("b", "paragraph", "Assessment", { sourceRefs: ["filing:v2"] }),
    ],
  });
  const projected = toTiptapDocumentProjection(canonical);
  projected.content.splice(1, 0, { type: "paragraph", content: [{ type: "text", text: "A user note, not sourced" }] });
  const updated = fromTiptapDocumentProjection(projected, canonical, { createBlockId: () => "note" });
  assert.equal(updated.kind, "report");
  if (updated.kind !== "report") return;
  assert.deepEqual(updated.sections.map(section => section.blockIds), [["a", "note"], ["b"]]);
  assert.deepEqual(updated.blocks[0].attrs, canonical.blocks[0].attrs);
  assert.deepEqual(updated.blocks[1].attrs, {});
  assert.deepEqual(updated.blocks[2].attrs, canonical.blocks[1].attrs);
  assert.equal(updated.blocks[1].text, "A user note, not sourced");
  assert.deepEqual(fromTiptapDocumentProjection(projected, updated), updated, "save/reopen preserves the same canonical IDs");
});

test("WS-37 report section limit rejects inserts rather than silently dropping user-authored content", () => {
  const ids = Array.from({ length: 5_000 }, (_, i) => `id-${i}`);
  const sections = [{ id: "full", title: "Full", blockIds: ids }];
  assert.throws(
    () => reconcileReportBlockSections(sections, ids, [...ids, "new-authored"]),
    /Report section block limit exceeded/,
  );
  assert.equal(sections[0].blockIds.length, 5_000);
});
