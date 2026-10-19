import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Unzip, UnzipInflate } from "fflate";
import { z } from "zod";
import { artifactContentSchema, type ArtifactContent, type ArtifactExportPlan, type RichArtifactBlock } from "./artifactContracts";
import { readRecordedDocumentTable, readRichDocumentFormatting, recordedDocumentValue, safeRichDocumentHref, type RichDocumentFormatting, type RichDocumentMark } from "./richArtifactDocument";
import { artifactImageBytes, artifactImageDimensions, ARTIFACT_IMAGE_LIMITS, readArtifactImage } from "./artifactImage";

export const OFFICE_ARTIFACT_METADATA_PART = "customXml/liosArtifact.xml";
export const OFFICE_ARTIFACT_NAMESPACE = "urn:lios:artifact:office-roundtrip:1";
export const OFFICE_ARTIFACT_LIMITS = { compressedBytes: 32 * 1024 * 1024, expandedBytes: 96 * 1024 * 1024, partBytes: 16 * 1024 * 1024, metadataBytes: 6 * 1024 * 1024, entries: 2048, xmlNodes: 500_000 } as const;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0;
});
const pathSchema = z.array(z.union([z.string().min(1).max(200).refine(value => !["__proto__", "prototype", "constructor"].includes(value)), z.number().int().nonnegative().max(100_000)])).max(16);
const formattingSchema = z.object({ version: z.literal(1), text: z.string().max(4_000_000), runs: z.array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive(), marks: z.array(z.object({ type: z.enum(["bold", "italic", "strike", "code", "underline", "link"]), attrs: z.object({ href: z.string().max(4000), target: z.enum(["_blank", "_self"]).optional() }).strict().optional() }).strict()).max(6) }).strict()).max(20_000) }).strict();
const textFields = { path: pathSchema, text: z.string().max(4_000_000).optional(), prefix: z.string().max(20_000).optional(), suffix: z.string().max(20_000).optional(), textOffset: z.number().int().nonnegative().max(4_000_000).optional(), editable: z.boolean().optional(), formatting: formattingSchema.optional() };
export const officeArtifactTextSegmentSchema = z.object({ ...textFields, paragraphStart: z.number().int().nonnegative().max(50_000), paragraphCount: z.number().int().positive().max(50_000) }).strict();
export type OfficeArtifactTextSegment = z.infer<typeof officeArtifactTextSegmentSchema>;
export const officeArtifactBindingSchema = z.object({
  id: z.string().regex(/^lios_[A-Za-z0-9_]{1,80}$/), kind: z.enum(["text", "table", "chart", "image"]), ...textFields,
  part: z.string().max(500).optional(), segments: z.array(officeArtifactTextSegmentSchema).min(1).max(50_000).optional(),
  columnStart: z.number().int().nonnegative().optional(), rowStart: z.number().int().nonnegative().optional(), rowCount: z.number().int().nonnegative().optional(), columnCount: z.number().int().positive().optional(),
  chartPart: z.string().max(500).optional(), workbookPart: z.string().max(500).optional(), sourceIndices: z.array(z.array(z.number().int().min(-1).max(100_000)).max(100_000)).max(100).optional(),
  mediaPart: z.string().max(500).optional(), mediaSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  geometry: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), cx: z.number().int().positive(), cy: z.number().int().positive() }).strict().optional(),
}).strict();
export type OfficeArtifactBinding = z.infer<typeof officeArtifactBindingSchema>;
export const officeArtifactMetadataSchema = z.object({ schemaVersion: z.literal(1), format: z.enum(["docx", "pptx"]), sourceArtifactId: z.string().trim().min(1).max(240), sourceVersion: z.number().int().positive(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), content: artifactContentSchema, negativeZeroPaths: z.array(pathSchema).max(100_000).default([]), bindings: z.array(officeArtifactBindingSchema).min(1).max(50_000) }).strict();
export type OfficeArtifactMetadata = z.infer<typeof officeArtifactMetadataSchema>;
export interface OfficeArtifactRoundtrip { sourceArtifactId: string; sourceVersion: number; sourceHash: string; sourceContent: ArtifactContent; content: ArtifactContent; warnings: string[]; format: "docx" | "pptx"; fileHash: string }

function canonicalMetadataJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonicalMetadataJson(item ?? null)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalMetadataJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function buildOfficeArtifactMetadataXml(plan: ArtifactExportPlan, content: ArtifactContent, format: "docx" | "pptx", bindings: OfficeArtifactBinding[]): string {
  if (plan.kind !== content.kind) throw new Error("Office Artifact export kind mismatch.");
  const negativeZeroPaths: (string | number)[][] = [];
  const visit = (value: unknown, path: (string | number)[]) => {
    if (path.length > 16) throw new Error("Office source snapshot nesting exceeds limit.");
    if (typeof value === "number" && Object.is(value, -0)) negativeZeroPaths.push(path);
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...path, index]));
    else if (value && typeof value === "object") Object.keys(value).sort().forEach(key => visit((value as Record<string, unknown>)[key], [...path, key]));
  }; visit(content, []);
  const payload = canonicalMetadataJson(officeArtifactMetadataSchema.parse({ schemaVersion: 1, format, sourceArtifactId: plan.artifactId, sourceVersion: plan.version, sourceHash: plan.contentHash, content, negativeZeroPaths, bindings }));
  if (new TextEncoder().encode(payload).length > OFFICE_ARTIFACT_LIMITS.metadataBytes) throw new Error("Office Artifact source snapshot exceeds metadata limit; export JSON instead.");
  return `<?xml version="1.0" encoding="UTF-8"?><liosArtifact xmlns="${OFFICE_ARTIFACT_NAMESPACE}"><payload>${payload.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</payload></liosArtifact>`;
}

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; value: string };
const local = (name: string) => name.slice(name.lastIndexOf(":") + 1);
const children = (node: XmlNode, name: string) => node.children.filter(child => local(child.name) === name);
function descendants(node: XmlNode, name: string): XmlNode[] { const result: XmlNode[] = []; const visit = (item: XmlNode) => { if (local(item.name) === name) result.push(item); item.children.forEach(visit); }; visit(node); return result; }
function one(node: XmlNode, name: string): XmlNode { const matches = descendants(node, name); if (matches.length !== 1) throw new Error(`Office XML requires exactly one ${name}.`); return matches[0]; }
function attr(node: XmlNode, name: string): string | undefined {
  // p:sldId contains both its numeric id and the relationship's qualified r:id.
  if (name === "id") for (const key in node.attrs) if (Object.hasOwn(node.attrs, key) && key.includes(":") && local(key) === name) return node.attrs[key];
  for (const key in node.attrs) if (Object.hasOwn(node.attrs, key) && local(key) === name) return node.attrs[key];
  return undefined;
}
function text(node: XmlNode): string { return node.value + node.children.map(text).join(""); }
function parseXml(bytes: Uint8Array, label: string): XmlNode {
  if (bytes.length > OFFICE_ARTIFACT_LIMITS.partBytes) throw new Error(`Office XML part exceeds size limit: ${label}.`);
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error("Office XML DOCTYPE/entities are not supported.");
  if (XMLValidator.validate(xml) !== true) throw new Error(`Malformed Office XML: ${label}.`);
  // Installed fast-xml-parser 5.11.0 (MIT): ordered parsing preserves actual rich-run/paragraph order.
  const ordered = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, parseAttributeValue: false, trimValues: false, ignoreDeclaration: true, ignorePiTags: true, processEntities: true, maxNestedTags: 64 }).parse(xml) as Record<string, unknown>[];
  let count = 0;
  const convert = (items: Record<string, unknown>[], depth: number): XmlNode[] => {
    if (depth > 64) throw new Error("Office XML nesting exceeds limit.");
    return items.map(item => {
      if (++count > OFFICE_ARTIFACT_LIMITS.xmlNodes) throw new Error("Office XML node count exceeds limit.");
      const name = Object.keys(item).find(key => key !== ":@")!;
      if (name === "#text") return { name, attrs: {}, children: [], value: String(item[name]) };
      return { name, attrs: (item[":@"] ?? {}) as Record<string, string>, children: convert((item[name] ?? []) as Record<string, unknown>[], depth + 1), value: "" };
    });
  };
  const roots = convert(ordered, 0).filter(node => node.name !== "#text");
  if (roots.length !== 1) throw new Error("Office XML requires a single root.");
  return roots[0];
}
function safePart(name: string): void {
  if (!name || name.length > 500 || name.startsWith("/") || /[\\\u0000-\u001f:?#%]/.test(name) || name.split("/").some(value => value === "." || value === ".." || !value)) throw new Error(`Unsafe Office ZIP path: ${name}.`);
  if (/vbaProject|macro|activeX|oleObject/i.test(name)) throw new Error("Office macros/active content are not supported.");
}
type ZipBudget = { expanded: number; entries: number };
function readZip(bytes: Uint8Array, budget: ZipBudget): Map<string, Uint8Array> {
  if (bytes.length < 22 || bytes.length > OFFICE_ARTIFACT_LIMITS.compressedBytes) throw new Error("Office ZIP compressed size is invalid.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65558) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) throw new Error("Invalid Office ZIP directory.");
  const count = view.getUint16(end + 10, true), directory = view.getUint32(end + 16, true), directorySize = view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count < 1 || count > OFFICE_ARTIFACT_LIMITS.entries || directory + directorySize !== end) throw new Error("Unsupported Office ZIP directory/ZIP64.");
  const expected = new Map<string, { size: number; crc: number }>();
  let offset = directory, total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid Office ZIP entry.");
    const flags = view.getUint16(offset + 8, true), compression = view.getUint16(offset + 10, true), compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true), length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true), start = view.getUint32(offset + 42, true);
    if (offset + 46 + length + extra + comment > end || start + 30 > directory || view.getUint32(start, true) !== 0x04034b50 || flags & 1 || ![0, 8].includes(compression) || size > OFFICE_ARTIFACT_LIMITS.partBytes || compressed > bytes.length || (size > 1_000_000 && size > Math.max(compressed, 1) * 1000)) throw new Error("Unsupported or oversized Office ZIP entry.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + length));
    const directoryEntry = name.endsWith("/"); safePart(directoryEntry ? name.slice(0, -1) : name);
    const localLength = view.getUint16(start + 26, true), localExtra = view.getUint16(start + 28, true), dataStart = start + 30 + localLength + localExtra;
    if (dataStart + compressed > directory || new TextDecoder().decode(bytes.subarray(start + 30, start + 30 + localLength)) !== name || view.getUint16(start + 8, true) !== compression || expected.has(name)) throw new Error("Ambiguous Office ZIP entry.");
    total += size; if (total > OFFICE_ARTIFACT_LIMITS.expandedBytes) throw new Error("Office ZIP expansion exceeds limit.");
    expected.set(name, { size, crc: view.getUint32(offset + 16, true) });
    offset += 46 + length + extra + comment;
  }
  if (offset !== end) throw new Error("Invalid Office ZIP directory size.");
  budget.expanded += total; budget.entries += count;
  if (budget.expanded > OFFICE_ARTIFACT_LIMITS.expandedBytes || budget.entries > OFFICE_ARTIFACT_LIMITS.entries) throw new Error("Office ZIP aggregate expansion exceeds limit.");
  const files = new Map<string, Uint8Array>(); let expanded = 0;
  const archive = new Unzip(file => {
    const spec = expected.get(file.name); if (!spec || files.has(file.name)) throw new Error("Unexpected Office ZIP local entry.");
    const chunks: Uint8Array[] = []; let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length; expanded += chunk.length;
      if (size > spec.size || size > OFFICE_ARTIFACT_LIMITS.partBytes || expanded > OFFICE_ARTIFACT_LIMITS.expandedBytes) { file.terminate?.(); throw new Error("Office ZIP actual expansion exceeds limit."); }
      chunks.push(chunk);
      if (final) {
        if (size !== spec.size) throw new Error("Office ZIP entry size mismatch.");
        const result = new Uint8Array(size); let at = 0; for (const piece of chunks) { result.set(piece, at); at += piece.length; }
        let crc = -1; for (const byte of result) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
        if (((crc ^ -1) >>> 0) !== spec.crc) throw new Error("Office ZIP entry checksum mismatch.");
        files.set(file.name, result);
      }
    }; file.start();
  });
  archive.register(UnzipInflate);
  // Bound each inflation invocation as well as accumulated output; no ZIP-declared allocation is trusted.
  for (let at = 0; at < bytes.length; at += 1024) archive.push(bytes.subarray(at, at + 1024), at + 1024 >= bytes.length);
  if (files.size !== expected.size) throw new Error("Office ZIP is incomplete.");
  for (const name of files.keys()) if (name.endsWith("/")) files.delete(name);
  return files;
}

type Relationship = { id: string; type: string; target: string; external: boolean };
function relationshipOwner(part: string): string { return part === "_rels/.rels" ? "" : part.replace("/_rels/", "/").slice(0, -5); }
function resolvePart(owner: string, target: string): string {
  if (/[\\\u0000-\u001f:?#%]/.test(target)) throw new Error("Unsafe Office relationship target.");
  const pieces = (target.startsWith("/") ? target.slice(1) : `${owner.includes("/") ? owner.slice(0, owner.lastIndexOf("/") + 1) : ""}${target}`).split("/");
  const normalized: string[] = [];
  for (const piece of pieces) { if (piece === "..") { if (!normalized.length) throw new Error("Office relationship escapes package."); normalized.pop(); } else if (piece && piece !== ".") normalized.push(piece); }
  const result = normalized.join("/"); safePart(result); return result;
}
function packageXml(files: Map<string, Uint8Array>): { nodes: Map<string, XmlNode>; relations: Map<string, Relationship[]> } {
  const nodes = new Map<string, XmlNode>(), relations = new Map<string, Relationship[]>();
  for (const [name, bytes] of files) if (/\.(?:xml|rels)$/i.test(name)) nodes.set(name, parseXml(bytes, name));
  for (const [name, node] of nodes) {
    if (name === "[Content_Types].xml" && node.children.some(item => /macroEnabled|vbaProject|activeX|oleObject/i.test(attr(item, "ContentType") ?? ""))) throw new Error("Office macros/active content are not supported.");
    if (!name.endsWith(".rels")) continue;
    const owner = relationshipOwner(name), entries: Relationship[] = [], seen = new Set<string>();
    for (const item of children(node, "Relationship")) {
      const id = attr(item, "Id"), type = attr(item, "Type"), raw = attr(item, "Target");
      if (!id || !type || !raw || seen.has(id)) throw new Error("Invalid/duplicate Office relationship."); seen.add(id);
      const external = attr(item, "TargetMode") === "External";
      if (attr(item, "TargetMode") && !["External", "Internal"].includes(attr(item, "TargetMode")!)) throw new Error("Invalid Office relationship target mode.");
      if (external && (!type.endsWith("/hyperlink") || !safeRichDocumentHref(raw))) throw new Error("External Office network relationships are not supported.");
      const target = external ? raw : resolvePart(owner, raw);
      if (!external && !files.has(target)) throw new Error(`Missing Office relationship part: ${target}.`);
      entries.push({ id, type, target, external });
    } relations.set(owner, entries);
  }
  return { nodes, relations };
}
function getPath(root: unknown, path: (string | number)[]): unknown {
  let cursor = root;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") throw new Error("Office binding references a missing canonical field.");
    if (Array.isArray(cursor) ? typeof key !== "number" || !Number.isSafeInteger(key) || key < 0 || key >= cursor.length : typeof key !== "string") throw new Error("Office binding array indices must be numeric and object keys must be strings.");
    if (!Object.hasOwn(cursor, key)) throw new Error("Office binding references a missing canonical field.");
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}
function assertEditablePath(content: ArtifactContent, path: (string | number)[], kind: OfficeArtifactBinding["kind"]): void {
  const [root, index, field, childIndex] = path;
  const indexed = typeof index === "number";
  if (kind === "image") {
    if (["report", "research"].includes(content.kind) && root === "blocks" && indexed && field === "attrs" && path[3] === "image" && path.length === 4) return;
    throw new Error("Unsupported canonical Office image binding path.");
  }
  if (kind === "table" || kind === "chart") {
    if (!path.length && content.kind === kind || ["report", "research"].includes(content.kind) && root === "blocks" && indexed && field === "attrs" && path[3] === kind && path.length === 4) return;
  } else {
    if (["report", "research"].includes(content.kind) && root === "blocks" && indexed && field === "text" && path.length === 3) return;
    if (content.kind === "report" && root === "sections" && indexed && field === "title" && path.length === 3) return;
    if (content.kind === "research") {
      if (root === "question" && path.length === 1 || indexed && path.length === 3 && (root === "claims" && field === "text" || root === "contradictions" && field === "summary" || root === "executionTrail" && field === "action")) return;
      if (root === "plan" && index === "steps" && typeof field === "number" && childIndex === "objective" && path.length === 4) return;
    }
    if (content.kind === "decision") {
      if (["objective", "recommendation"].includes(String(root)) && path.length === 1 || indexed && path.length === 2 && ["whatChanged", "why", "constraints", "uncertainties", "nextActions", "implementation", "monitoring", "dissent"].includes(String(root))) return;
      if (indexed && path.length === 3 && (root === "scenarios" && ["label", "summary"].includes(String(field)) || root === "alternatives" && field === "label")) return;
      if (root === "alternatives" && indexed && ["expectedOutcomes", "risks", "tradeoffs"].includes(String(field)) && typeof childIndex === "number" && path.length === 4) return;
      if (["actions", "followUp"].includes(String(root)) && indexed && field === "description" && path.length === 3 || root === "outcome" && index === "summary" && path.length === 2) return;
    }
    if (content.kind === "thesis") {
      if (root === "summary" && path.length === 1 || indexed && field === "text" && path.length === 3 && ["expectedOutcomes", "claims", "catalysts", "risks", "invalidationConditions", "openQuestions"].includes(String(root))) return;
      if (root === "refresh" && ["contradictions", "changes"].includes(String(index)) && typeof field === "number" && path.length === 3) return;
      if (root === "postmortems" && indexed && (field === "summary" && path.length === 3 || ["whatWorked", "whatFailed"].includes(String(field)) && typeof childIndex === "number" && path.length === 4)) return;
    }
  }
  throw new Error("Unsupported canonical editable Office binding path.");
}
function setPath(root: ArtifactContent, path: (string | number)[], value: unknown): ArtifactContent {
  if (!path.length) return value as ArtifactContent;
  const owner = getPath(root, path.slice(0, -1)) as Record<string | number, unknown>; owner[path[path.length - 1]] = value; return root;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function nativeNewlines(value: string): { text: string; toSource: number[]; toNative: number[] } {
  let result = ""; const toSource = [0], toNative: number[] = [0];
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "\r") { result += "\n"; if (value[index + 1] === "\n") { toNative[index + 1] = result.length - 1; index++; } }
    else result += value[index];
    toNative[index + 1] = result.length; toSource[result.length] = index + 1;
  }
  return { text: result, toSource, toNative };
}
function compactRuns(runs: RichDocumentFormatting["runs"]): RichDocumentFormatting["runs"] {
  const result: RichDocumentFormatting["runs"] = [];
  for (const run of runs) {
    const marks = [...run.marks].sort((a, b) => a.type.localeCompare(b.type)), last = result[result.length - 1];
    if (last && last.to === run.from && same(last.marks, marks)) last.to = run.to;
    else result.push({ ...run, marks });
  }
  return result;
}
interface NativeText { text: string; runs: RichDocumentFormatting["runs"]; level?: number; list?: "bullet" | "ordered"; listStart?: number; formattingChanged?: boolean }
function readParagraph(node: XmlNode, format: "docx" | "pptx", relations: Relationship[]): NativeText {
  let result = ""; const runs: RichDocumentFormatting["runs"] = [];
  const enabled = (node: XmlNode | undefined) => !!node && !["0", "false", "off", "none"].includes(attr(node, "val") ?? "");
  const append = (value: string, marks: RichDocumentMark[]) => { const from = result.length; result += value; if (value && marks.length) { const last = runs[runs.length - 1]; if (last && last.to === from && same(last.marks, marks)) last.to = result.length; else runs.push({ from, to: result.length, marks }); } };
  const visit = (item: XmlNode, inherited: RichDocumentMark[] = []) => {
    const name = local(item.name);
    if (["del", "ins", "fld", "fldSimple", "instrText", "fldChar", "drawing", "object", "AlternateContent", "sdt", "ruby", "subDoc", "altChunk", "contentPart"].includes(name)) throw new Error("Unsupported Office tracked changes/fields/inline objects.");
    if (name === "hyperlink") {
      const id = attr(item, "id"), anchor = attr(item, "anchor");
      const href = anchor ? `#${anchor}` : relations.find(relation => relation.id === id && relation.type.endsWith("/hyperlink"))?.target;
      if (!href || !safeRichDocumentHref(href)) throw new Error("Invalid Office text hyperlink.");
      item.children.forEach(child => visit(child, [...inherited, { type: "link", attrs: { href, target: "_blank" } }])); return;
    }
    if (name === "r") {
      const props = children(item, "rPr")[0], marks = [...inherited];
      if (props) {
        for (const [key, type] of [["b", "bold"], ["i", "italic"], ["strike", "strike"], ["u", "underline"]] as const) if (format === "docx" ? enabled(children(props, key)[0]) : key === "strike" ? ["sngStrike", "dblStrike"].includes(attr(props, "strike") ?? "") : key === "u" ? !!attr(props, "u") && attr(props, "u") !== "none" : attr(props, key) === "1") marks.push({ type });
        const font = children(props, "rFonts")[0] ?? children(props, "latin")[0]; if (font && /Courier|Consolas|monospace/i.test(attr(font, "ascii") ?? attr(font, "typeface") ?? "")) marks.push({ type: "code" });
        const link = children(props, "hlinkClick")[0]; if (link) { const href = relations.find(relation => relation.id === attr(link, "id"))?.target; if (!href || !safeRichDocumentHref(href)) throw new Error("Invalid Office hyperlink."); marks.push({ type: "link", attrs: { href, target: "_blank" } }); }
      }
      item.children.filter(child => local(child.name) !== "rPr").forEach(child => visit(child, marks.sort((a, b) => a.type.localeCompare(b.type)))); return;
    }
    if (name === "t") append(text(item), inherited);
    else if (name === "tab") append("\t", inherited);
    else if (name === "br" || name === "cr") append("\n", inherited);
    else if (!["pPr", "rPr", "endParaRPr", "bookmarkStart", "bookmarkEnd"].includes(name)) item.children.forEach(child => visit(child, inherited));
  }; visit(node);
  const style = descendants(node, "pStyle")[0]; const heading = style && /^Heading([1-6])$/.exec(attr(style, "val") ?? "");
  return { text: result, runs, ...(heading ? { level: Number(heading[1]) } : {}) };
}
function joinParagraphs(paragraphs: NativeText[]): NativeText {
  let value = ""; const runs: NativeText["runs"] = [];
  if (!paragraphs.length) throw new Error("Missing native Office text paragraphs.");
  paragraphs.forEach((paragraph, index) => { if (index) value += "\n"; const offset = value.length; value += paragraph.text; runs.push(...paragraph.runs.map(run => ({ ...run, from: run.from + offset, to: run.to + offset }))); });
  if (paragraphs.some(paragraph => paragraph.list !== paragraphs[0]?.list)) throw new Error("Mixed Office list structures in a canonical block are unsupported.");
  return { text: value, runs, level: paragraphs.length === 1 ? paragraphs[0].level : undefined, list: paragraphs[0]?.list, listStart: paragraphs[0]?.listStart, formattingChanged: paragraphs.some(paragraph => paragraph.formattingChanged) };
}
function wordBindings(document: XmlNode, bindings: OfficeArtifactBinding[]): Map<string, XmlNode[]> {
  const body = one(document, "body"), result = new Map<string, XmlNode[]>(), expected = new Set(bindings.map(binding => binding.id));
  let active: string | undefined, bookmarkId: string | undefined; const order: string[] = [];
  for (const item of body.children.filter(child => child.name !== "#text")) {
    if (local(item.name) === "sectPr") continue;
    if (!["p", "tbl", "bookmarkStart", "bookmarkEnd"].includes(local(item.name))) throw new Error("Unsupported Word body structure.");
    const starts = descendants(item, "bookmarkStart").filter(mark => (attr(mark, "name") ?? "").startsWith("lios_"));
    const ends = descendants(item, "bookmarkEnd");
    for (const start of starts) { const id = attr(start, "name")!; if (active || !expected.has(id) || result.has(id)) throw new Error("Unknown/duplicate/overlapping Word binding."); active = id; bookmarkId = attr(start, "id"); result.set(id, []); order.push(id); }
    if (["p", "tbl"].includes(local(item.name))) { if (!active) throw new Error("Unbound Word content; structural edits are unsupported."); result.get(active)!.push(item); }
    if (active && ends.some(mark => attr(mark, "id") === bookmarkId)) { active = undefined; bookmarkId = undefined; }
  }
  if (active || !same(order, bindings.map(binding => binding.id))) throw new Error("Missing/reordered Word bindings.");
  return result;
}
function tableGrid(node: XmlNode, format: "docx" | "pptx", relations: Relationship[]): string[][] {
  if (descendants(node, "gridSpan").some(item => (attr(item, "val") ?? "1") !== "1") || descendants(node, "vMerge").length || descendants(node, "hMerge").length || descendants(node, "tc").some(item => ["gridSpan", "rowSpan"].some(key => attr(item, key) && attr(item, key) !== "1") || ["hMerge", "vMerge"].some(key => attr(item, key) === "1"))) throw new Error("Merged Office tables are unsupported.");
  const rows = children(node, "tr");
  return rows.map(row => children(row, "tc").map(cell => joinParagraphs(descendants(cell, "p").map(paragraph => readParagraph(paragraph, format, relations))).text));
}
function cellValue(value: string, original: unknown): unknown {
  // Native breaks/XML normalize CR/CRLF; unchanged table text retains raw source spelling.
  if (value === nativeNewlines(original === undefined ? "Not recorded" : recordedDocumentValue(original)).text) return original;
  if (original === null || original === undefined) throw new Error("Ambiguous edited null/missing Office cell type.");
  if (Array.isArray(original) || typeof original === "object") { let parsed: unknown; try { parsed = JSON.parse(value); } catch { throw new Error("Edited structured Office cell requires literal JSON."); } if (Array.isArray(original) !== Array.isArray(parsed) || parsed === null || typeof parsed !== "object") throw new Error("Edited Office cell changed structured type."); return parsed; }
  if (typeof original === "number") { if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error("Edited Office numeric cell requires an unambiguous finite decimal."); return Number(value); }
  if (typeof original === "boolean") { if (value !== "true" && value !== "false") throw new Error("Edited Office boolean cell requires true/false."); return value === "true"; }
  return value;
}

type TableContent = Extract<ArtifactContent, { kind: "table" }>;
type ChartContent = Extract<ArtifactContent, { kind: "chart" }>;
function readChart(node: XmlNode, binding: OfficeArtifactBinding, original: ChartContent, files: Map<string, Uint8Array>, nodes: Map<string, XmlNode>, relations: Map<string, Relationship[]>, budget: ZipBudget): ChartContent {
  const chartRef = one(node, "chart"), slidePart = binding.part!;
  const chartPart = relations.get(slidePart)?.find(item => item.id === attr(chartRef, "id") && item.type.endsWith("/chart") && !item.external)?.target;
  if (!chartPart || binding.chartPart && binding.chartPart !== chartPart) throw new Error("Missing/mismatched Office chart binding.");
  const chart = nodes.get(chartPart); if (!chart) throw new Error("Missing native Office chart.");
  const chartTypes: Record<string, ChartContent["chartType"]> = { lineChart: "line", areaChart: "area", barChart: "bar", scatterChart: "scatter" };
  const plot = one(chart, "plotArea"), plots = plot.children.filter(item => local(item.name).endsWith("Chart"));
  if (plots.length !== 1 || !chartTypes[local(plots[0].name)]) throw new Error("Unsupported mixed/native Office chart type.");
  const externalData = descendants(chart, "externalData");
  if (externalData.length !== 1) throw new Error("Office chart must retain its local embedded workbook.");
  const workbookPart = relations.get(chartPart)?.find(item => item.id === attr(externalData[0], "id") && !item.external && item.type.endsWith("/package"))?.target;
  if (!workbookPart || binding.workbookPart && binding.workbookPart !== workbookPart) throw new Error("Missing/mismatched chart workbook.");
  const workbookBytes = files.get(workbookPart)!;
  const workbookFiles = readZip(workbookBytes, budget), workbook = packageXml(workbookFiles);
  const workbookNode = workbook.nodes.get("xl/workbook.xml"); if (!workbookNode) throw new Error("Invalid embedded chart workbook.");
  const sheets = new Map<string, XmlNode>();
  for (const sheet of descendants(workbookNode, "sheet")) {
    const part = workbook.relations.get("xl/workbook.xml")?.find(item => item.id === attr(sheet, "id") && item.type.endsWith("/worksheet"))?.target;
    if (!part || !workbook.nodes.has(part) || sheets.has(attr(sheet, "name")!)) throw new Error("Invalid embedded chart worksheet.");
    sheets.set(attr(sheet, "name")!, workbook.nodes.get(part)!);
  }
  const shared = workbook.nodes.get("xl/sharedStrings.xml");
  const strings = shared ? descendants(shared, "si").map(item => descendants(item, "t").map(text).join("")) : [];
  const cellMaps = new Map<string, Map<string, XmlNode>>();
  for (const [name, sheet] of sheets) {
    const cells = new Map<string, XmlNode>();
    for (const cell of descendants(sheet, "c")) { const ref = attr(cell, "r"); if (!ref || cells.has(ref)) throw new Error("Ambiguous chart workbook cell."); cells.set(ref, cell); }
    cellMaps.set(name, cells);
  }
  const columnNumber = (letters: string) => { let value = 0; for (const character of letters) value = value * 26 + character.charCodeAt(0) - 64; return value; };
  const columnLetters = (index: number) => { let value = ""; while (index > 0) { index--; value = String.fromCharCode(65 + index % 26) + value; index = Math.floor(index / 26); } return value; };
  const rangeValues = (formula: string): (string | number | null)[] => {
    const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]+)\$?([1-9]\d*)(?::\$?([A-Z]+)\$?([1-9]\d*))?$/.exec(formula);
    if (!match) throw new Error("Unsupported/external chart workbook formula.");
    const cells = cellMaps.get((match[1]?.replaceAll("''", "'") ?? match[2])); if (!cells) throw new Error("Chart workbook formula references a missing worksheet.");
    const startCol = columnNumber(match[3]), endCol = columnNumber(match[5] ?? match[3]), startRow = Number(match[4]), endRow = Number(match[6] ?? match[4]);
    if (endCol < startCol || endRow < startRow || startCol !== endCol && startRow !== endRow || (endCol - startCol + 1) * (endRow - startRow + 1) > 100_000) throw new Error("Ambiguous/oversized chart workbook range.");
    const values: (string | number | null)[] = [];
    for (let row = startRow; row <= endRow; row++) for (let col = startCol; col <= endCol; col++) {
      const cell = cells.get(`${columnLetters(col)}${row}`);
      if (!cell) { values.push(null); continue; }
      if (descendants(cell, "f").length) throw new Error("Edited chart workbook formula cells require recomputation before return.");
      const type = attr(cell, "t"), v = children(cell, "v")[0];
      if (type === "inlineStr") values.push(descendants(cell, "t").map(text).join(""));
      else if (type === "s") { const value = Number(v && text(v)); if (!Number.isInteger(value) || strings[value] === undefined) throw new Error("Invalid shared chart workbook string."); values.push(strings[value]); }
      else if (type === "str") values.push(v ? text(v) : "");
      else if (type && type !== "n") throw new Error("Unsupported chart workbook cell type.");
      else { const value = v ? text(v) : ""; if (!value) values.push(null); else if (!Number.isFinite(Number(value))) throw new Error("Non-finite chart workbook number."); else values.push(Number(value)); }
    }
    return values;
  };
  const cache = (parent: XmlNode, names: string[]): (string | number | null)[] => {
    const container = parent.children.find(item => names.includes(local(item.name))); if (!container) throw new Error("Missing chart series data.");
    const formula = one(container, "f"), values = rangeValues(text(formula));
    const cached = descendants(container, "numCache").concat(descendants(container, "strCache"), descendants(container, "multiLvlStrCache"));
    if (cached.length !== 1) throw new Error("Unsupported chart data cache.");
    const count = Number(attr(one(cached[0], "ptCount"), "val"));
    if (count !== values.length) throw new Error("Chart workbook/cache size mismatch.");
    const points = new Map<number, string>();
    const levels = children(cached[0], "lvl");
    if (levels.length > 1) throw new Error("Multi-level Office chart categories are unsupported.");
    for (const point of children(levels[0] ?? cached[0], "pt")) { const index = Number(attr(point, "idx")); if (!Number.isInteger(index) || index < 0 || index >= count || points.has(index)) throw new Error("Ambiguous chart cache index."); points.set(index, text(one(point, "v"))); }
    const numeric = local(cached[0].name) === "numCache";
    for (let index = 0; index < count; index++) {
      const value = values[index], actual = points.get(index);
      const mismatch = value === null ? actual !== undefined && actual !== ""
        : actual === undefined || (numeric ? !Number.isFinite(Number(actual)) || Number(actual) !== value : actual !== String(value));
      if (mismatch) throw new Error("Chart workbook/cache mismatch; update both native chart and embedded workbook before return.");
    }
    return values;
  };
  const nativeSeries = descendants(chart, "ser");
  if (nativeSeries.length !== original.series.length) throw new Error("Unsupported Office chart series structural edit.");
  const result = structuredClone(original);
  nativeSeries.forEach((series, seriesIndex) => {
    const x = cache(series, ["cat", "xVal"]), y = cache(series, ["val", "yVal"]);
    if (x.length !== y.length) throw new Error("Chart category/value count mismatch.");
    const indices = binding.sourceIndices?.[seriesIndex] ?? original.series[seriesIndex].points.map((_, index) => index);
    if (indices.length !== x.length) throw new Error("Unsupported Office chart category structural edit.");
    const seen = new Set<number>();
    indices.forEach((index, category) => {
      if (index === -1) { if (y[category] !== null) throw new Error("Office chart added a previously absent point."); return; }
      if (seen.has(index) || !result.series[seriesIndex].points[index] || typeof y[category] !== "number" || x[category] === null) throw new Error("Ambiguous Office chart point binding."); seen.add(index);
      const point = result.series[seriesIndex].points[index];
      let categoryValue = x[category] as string | number;
      // Category charts serialize numeric x as text; the immutable source supplies
      // its type. Decimal edits are parsed only for a recorded numeric category.
      if (typeof point.x === "number" && typeof categoryValue === "string") categoryValue = cellValue(categoryValue, point.x) as number;
      if (typeof point.x !== typeof categoryValue) throw new Error("Office chart category type changed.");
      if (point.x !== categoryValue) point.x = categoryValue;
      if (point.y !== y[category]) point.y = y[category] as number;
    });
    if (seen.size !== result.series[seriesIndex].points.length) throw new Error("Missing Office chart point bindings.");
    const label = cache(series, ["tx"]); if (label.length !== 1 || typeof label[0] !== "string") throw new Error("Invalid Office chart series label."); result.series[seriesIndex].label = label[0];
    if (new Set(result.series[seriesIndex].points.map(point => point.x)).size !== result.series[seriesIndex].points.length) throw new Error("Ambiguous duplicate edited Office chart categories.");
  });
  result.chartType = chartTypes[local(plots[0].name)];
  return result;
}

/** Local-only native reader. Metadata never grants ownership or citation authority:
 * Home must compare sourceContent's canonical hash to the owned immutable version. */
export async function readOfficeArtifactRoundtrip(bytes: Uint8Array, requestedFormat?: "docx" | "pptx"): Promise<OfficeArtifactRoundtrip> {
  const budget: ZipBudget = { expanded: 0, entries: 0 };
  const files = readZip(bytes, budget), { nodes, relations } = packageXml(files);
  const metadataBytes = files.get(OFFICE_ARTIFACT_METADATA_PART);
  if (!metadataBytes) throw new Error("Unsupported Office return: this file has no LiOS Artifact source binding.");
  if (metadataBytes.length > OFFICE_ARTIFACT_LIMITS.partBytes) throw new Error("Office Artifact metadata XML exceeds size limit.");
  const metadataNode = nodes.get(OFFICE_ARTIFACT_METADATA_PART)!;
  if (local(metadataNode.name) !== "liosArtifact" || attr(metadataNode, "xmlns") !== OFFICE_ARTIFACT_NAMESPACE) throw new Error("Invalid LiOS Office Artifact metadata namespace.");
  const payload = one(metadataNode, "payload"); if (payload.children.some(node => node.name !== "#text")) throw new Error("Invalid LiOS Office metadata payload.");
  if (new TextEncoder().encode(text(payload)).length > OFFICE_ARTIFACT_LIMITS.metadataBytes) throw new Error("Office Artifact metadata payload exceeds size limit.");
  const metadata = officeArtifactMetadataSchema.parse(JSON.parse(text(payload)));
  const negativeZeroSeen = new Set<string>();
  for (const path of metadata.negativeZeroPaths) {
    const key = JSON.stringify(path); if (negativeZeroSeen.has(key) || getPath(metadata.content, path) !== 0) throw new Error("Invalid Office negative-zero source binding.");
    negativeZeroSeen.add(key); setPath(metadata.content, path, -0);
  }
  const format = metadata.format;
  if (requestedFormat && requestedFormat !== format || (format === "docx" ? !files.has("word/document.xml") || files.has("ppt/presentation.xml") : !files.has("ppt/presentation.xml") || files.has("word/document.xml"))) throw new Error("Office Artifact format mismatch.");
  const owner = format === "docx" ? "word/document.xml" : "ppt/presentation.xml";
  if (!relations.get(owner)?.some(item => item.type.endsWith("/customXml") && !item.external && item.target === OFFICE_ARTIFACT_METADATA_PART)) throw new Error("Missing Office Artifact metadata relationship.");
  const ids = new Set<string>(), bindingsById = new Map<string, OfficeArtifactBinding>();
  for (const binding of metadata.bindings) { if (ids.has(binding.id)) throw new Error("Duplicate Office Artifact binding."); ids.add(binding.id); bindingsById.set(binding.id, binding); if (binding.part) safePart(binding.part); }
  const sourceContent = metadata.content; let content = structuredClone(sourceContent); const warnings: string[] = [];
  // Validate typed paths before consuming ANY native edits. Stringified array
  // indices cannot alias numeric paths and bypass provenance/edit classification.
  for (const binding of metadata.bindings) {
    if (binding.path.length) getPath(sourceContent, binding.path);
    if (binding.kind !== "text" || binding.editable !== false && binding.path.length) assertEditablePath(sourceContent, binding.path, binding.kind);
    for (const segment of binding.segments ?? []) {
      if (segment.path.length) getPath(sourceContent, segment.path);
      if (segment.editable !== false && segment.path.length) assertEditablePath(sourceContent, segment.path, "text");
    }
  }
  if (sourceContent.kind === "report" || sourceContent.kind === "research") {
    const blockIds = new Set<string>(); let imageBytes = 0;
    for (const block of sourceContent.blocks) {
      if (blockIds.has(block.id)) throw new Error("Ambiguous duplicate canonical Office block identity.");
      blockIds.add(block.id); readRichDocumentFormatting(block);
      if (block.attrs.image !== undefined) imageBytes += readArtifactImage(block.attrs.image).byteLength;
      if (imageBytes > ARTIFACT_IMAGE_LIMITS.totalBytes) throw new Error("Office canonical image composition exceeds aggregate byte limit.");
    }
  }
  const written = new Map<string, unknown>(), textEdits = new Map<string, { path: (string | number)[]; pieces: { offset?: number; original: string; actual: NativeText }[] }>();
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const applyValue = (path: (string | number)[], value: unknown) => { const key = JSON.stringify(path); if (written.has(key) && !same(written.get(key), value)) throw new Error("Conflicting repeated Office binding edits."); written.set(key, value); content = setPath(content, path, value); };
  const applyText = (binding: Pick<OfficeArtifactBinding, "path" | "text" | "prefix" | "suffix" | "textOffset" | "editable" | "formatting">, actual: NativeText) => {
    if (binding.text === undefined) throw new Error("Missing Office text snapshot binding.");
    if (binding.editable === false || !binding.path.length) { if (actual.text !== nativeNewlines(binding.text).text) throw new Error("Unsupported edit to generated/reference Office text."); return; }
    if (binding.path.some(key => typeof key === "string" && (key === "attrs" || key === "id" || key.endsWith("Ref") || key.endsWith("Refs") || key === "contentHash"))) throw new Error("Office body text cannot edit canonical identity/citation attributes.");
    const prefix = binding.prefix ?? "", suffix = binding.suffix ?? "";
    if (!actual.text.startsWith(prefix) || !actual.text.endsWith(suffix)) throw new Error("Unsupported edit to Office semantic text decoration.");
    const end = suffix.length ? actual.text.length - suffix.length : actual.text.length;
    let value = actual.text.slice(prefix.length, end);
    const original = getPath(sourceContent, binding.path); if (typeof original !== "string") throw new Error("Office text binding does not address a canonical string.");
    const baseline = binding.text.slice(prefix.length, suffix.length ? binding.text.length - suffix.length : undefined);
    if (binding.textOffset === undefined ? original !== baseline : original.slice(binding.textOffset, binding.textOffset + baseline.length) !== baseline) throw new Error("Office text snapshot disagrees with canonical source.");
    if (sourceContent.kind === "research" && binding.path[0] === "evidence" && value !== nativeNewlines(baseline).text) throw new Error("Unsupported edit to immutable research evidence snapshot; edit a source-backed body block or claim instead.");
    let runs = actual.runs.flatMap(run => { const from = Math.max(run.from, prefix.length), to = Math.min(run.to, end); return from < to ? [{ ...run, from: from - prefix.length, to: to - prefix.length }] : []; });
    if (binding.formatting) {
      let previousEnd = 0;
      for (const run of binding.formatting.runs) {
        if (run.from < previousEnd || run.to <= run.from || run.to > binding.formatting.text.length || new Set(run.marks.map(mark => mark.type)).size !== run.marks.length || run.marks.some(mark => mark.type === "link" && !safeRichDocumentHref(mark.attrs?.href))) throw new Error("Invalid Office formatting source ranges.");
        previousEnd = run.to;
      }
      if (binding.formatting.text !== binding.text) throw new Error("Office formatting snapshot disagrees with text binding.");
      const normalization = nativeNewlines(binding.formatting.text);
      const expectedRuns = binding.formatting.runs.map(run => ({ ...run, from: normalization.toNative[run.from], to: normalization.toNative[run.to] }));
      actual.formattingChanged = !same(compactRuns(actual.runs), compactRuns(expectedRuns));
    }
    // XML 1.0 normalizes literal CR/CRLF in both Word and PowerPoint parts.
    // Restore raw source spelling only after actual native equality, with marks
    // mapped back to source offsets; genuinely different Office text remains an edit.
    const normalization = nativeNewlines(baseline);
    if (value === normalization.text) { value = baseline; runs = runs.map(run => ({ ...run, from: normalization.toSource[run.from], to: normalization.toSource[run.to] })); }
    const key = JSON.stringify(binding.path); const entry = textEdits.get(key) ?? { path: binding.path, pieces: [] }; entry.pieces.push({ offset: binding.textOffset, original: baseline, actual: { ...actual, text: value, runs } }); textEdits.set(key, entry);
  };
  const tables = new Map<string, { path: (string | number)[]; table: TableContent; cells: Map<string, unknown> }>();
  const applyTable = (binding: OfficeArtifactBinding, node: XmlNode, rels: Relationship[]) => {
    const original = getPath(sourceContent, binding.path);
    if (!original || typeof original !== "object" || !("kind" in original) || original.kind !== "table") throw new Error("Office table binding has no canonical typed table.");
    const table = original as TableContent, grid = tableGrid(node, format, rels), rowStart = binding.rowStart ?? 0, columnStart = binding.columnStart ?? 0, rowCount = binding.rowCount ?? table.rows.length, columnCount = binding.columnCount ?? table.columns.length;
    const validated = readRecordedDocumentTable({ table });
    if (validated.status !== "recognized") throw new Error(`Ambiguous canonical Office table: ${validated.reason}`);
    if (grid.length !== rowCount + 1 || grid.some(row => row.length !== columnCount) || rowStart + rowCount > table.rows.length || columnStart + columnCount > table.columns.length) throw new Error("Unsupported Office table structural edit.");
    const key = JSON.stringify(binding.path), entry = tables.get(key) ?? { path: binding.path, table: structuredClone(table), cells: new Map<string, unknown>() };
    const writeCell = (key: string, value: unknown, apply: () => void) => { if (entry.cells.has(key) && !same(entry.cells.get(key), value)) throw new Error("Conflicting repeated Office table cells."); entry.cells.set(key, value); apply(); };
    grid[0].forEach((raw, index) => {
      const originalLabel = table.columns[columnStart + index].label;
      const label = raw === nativeNewlines(originalLabel).text ? originalLabel : raw;
      writeCell(`header:${columnStart + index}`, label, () => { entry.table.columns[columnStart + index].label = label; });
    });
    grid.slice(1).forEach((row, rowIndex) => row.forEach((raw, columnIndex) => {
      const index = rowStart + rowIndex, column = table.columns[columnStart + columnIndex], originalValue = table.rows[index][column.key], value = cellValue(raw, originalValue);
      writeCell(`${index}:${column.key}`, value, () => { if (value !== undefined) entry.table.rows[index][column.key] = value as TableContent["rows"][number][string]; });
      if (!same(value, originalValue) && entry.table.numericalEvidence) entry.table.numericalEvidence = entry.table.numericalEvidence.filter(evidence => evidence.target.row !== index || evidence.target.column !== column.key);
    }));
    tables.set(key, entry);
  };
  const consume = (binding: OfficeArtifactBinding, native: XmlNode[], rels: Relationship[]) => {
    if (binding.kind === "image") {
      readNativeImage(binding, native, format, getPath(sourceContent, binding.path), files, rels);
      return;
    }
    if (binding.kind === "table") { const table = native.flatMap(node => descendants(node, "tbl")); if (table.length !== 1) throw new Error("Missing/ambiguous native Office table binding."); applyTable(binding, table[0], rels); return; }
    if (binding.kind === "chart") {
      if (format === "docx") {
        if (binding.editable !== false) throw new Error("Native Word charts require a readonly canonical binding.");
        readReadonlyWordChart(binding, native, originalChart(sourceContent, binding.path), nodes, rels);
        return;
      }
      const original = getPath(sourceContent, binding.path) as ChartContent;
      if (original.kind !== "chart") throw new Error("Invalid canonical chart binding.");
      const value = readChart(native[0], binding, original, files, nodes, relations, budget);
      applyValue(binding.path, value);
      if (!same(value, original)) warn("Native chart edits are user-authored; original evidence is retained as context, not verification of edited values.");
      return;
    }
    const paragraphs = native.flatMap(node => local(node.name) === "p" ? [node] : descendants(node, "p")).map(node => {
      const paragraph = readParagraph(node, format, rels);
      if (format === "docx") {
        const numId = descendants(node, "numId")[0], level = descendants(node, "ilvl")[0];
        if (numId) {
          if (level && attr(level, "val") !== "0") throw new Error("Nested Office lists are unsupported.");
          const numbering = nodes.get("word/numbering.xml");
          const num = numbering && children(numbering, "num").find(item => attr(item, "numId") === attr(numId, "val"));
          const abstractId = num && children(num, "abstractNumId")[0];
          const abstract = numbering && abstractId && children(numbering, "abstractNum").find(item => attr(item, "abstractNumId") === attr(abstractId, "val"));
          const fmt = abstract && descendants(abstract, "numFmt")[0], start = num && descendants(num, "startOverride")[0];
          const value = fmt && attr(fmt, "val");
          if (!["bullet", "decimal"].includes(value ?? "")) throw new Error("Unsupported Office list numbering.");
          paragraph.list = value === "bullet" ? "bullet" : "ordered";
          paragraph.listStart = start ? Number(attr(start, "val")) : 1;
          if (!Number.isSafeInteger(paragraph.listStart) || paragraph.listStart < 1) throw new Error("Invalid Office list start.");
        }
      }
      return paragraph;
    });
    if (binding.segments) {
      let offset = 0;
      for (const segment of binding.segments) { if (segment.paragraphStart !== offset || segment.paragraphStart + segment.paragraphCount > paragraphs.length) throw new Error("Missing/reordered Office text paragraph segments."); applyText(segment, joinParagraphs(paragraphs.slice(offset, offset + segment.paragraphCount))); offset += segment.paragraphCount; }
      if (offset !== paragraphs.length) throw new Error("Unbound Office text paragraphs.");
    } else applyText(binding, joinParagraphs(paragraphs));
  };
  if (format === "docx") {
    const bound = wordBindings(nodes.get(owner)!, metadata.bindings);
    metadata.bindings.forEach(binding => consume(binding, bound.get(binding.id)!, relations.get(owner) ?? []));
  } else {
    const slideIds = descendants(nodes.get(owner)!, "sldId");
    const slides = slideIds.map(item => relations.get(owner)?.find(relation => relation.id === attr(item, "id") && relation.type.endsWith("/slide"))?.target);
    if (slides.some(part => !part) || new Set(slides).size !== slides.length) throw new Error("Invalid/reordered Office slide list.");
    const nativeBindings = new Map<string, XmlNode>(), order: string[] = [];
    for (const part of slides as string[]) {
      const slide = nodes.get(part); if (!slide) throw new Error("Missing Office slide.");
      const tree = one(slide, "spTree");
      for (const shape of tree.children.filter(node => ["sp", "graphicFrame", "pic", "cxnSp", "grpSp"].includes(local(node.name)))) {
        const properties = one(shape, "cNvPr"), id = attr(properties, "name") ?? "";
        if (!ids.has(id) || nativeBindings.has(id)) throw new Error("Unknown/unbound/duplicate Office slide shape.");
        const binding = bindingsById.get(id)!;
        if (binding.part !== part) throw new Error("Reordered Office slide shape binding."); nativeBindings.set(id, shape); order.push(id);
      }
    }
    if (!same(order, metadata.bindings.map(binding => binding.id))) throw new Error("Missing/reordered Office slide bindings.");
    metadata.bindings.forEach(binding => consume(binding, [nativeBindings.get(binding.id)!], relations.get(binding.part!) ?? []));
  }
  for (const entry of textEdits.values()) {
    const original = getPath(sourceContent, entry.path) as string;
    const whole = entry.pieces.filter(piece => piece.offset === undefined);
    let actual: NativeText;
    if (whole.length) { if (whole.length !== entry.pieces.length || whole.some(piece => !same(piece.actual, whole[0].actual))) throw new Error("Conflicting repeated Office text bindings."); actual = whole[0].actual; }
    else {
      let sourceOffset = 0, value = ""; const runs: NativeText["runs"] = [];
      const seen = new Map<number, typeof entry.pieces[number]>();
      for (const piece of entry.pieces) {
        const at = piece.offset!;
        if (seen.has(at)) { if (!same(seen.get(at)!.actual, piece.actual)) throw new Error("Conflicting repeated Office text fragments."); continue; }
        if (at < sourceOffset || !/^\s*$/.test(original.slice(sourceOffset, at))) throw new Error("Missing/reordered Office text fragments.");
        value += original.slice(sourceOffset, at); const offset = value.length; value += piece.actual.text;
        runs.push(...piece.actual.runs.map(run => ({ ...run, from: run.from + offset, to: run.to + offset })));
        sourceOffset = at + piece.original.length; seen.set(at, piece);
      }
      if (!/^\s*$/.test(original.slice(sourceOffset))) throw new Error("Incomplete Office text fragment coverage.");
      if (entry.pieces.some(piece => piece.actual.list !== entry.pieces[0].actual.list)) throw new Error("Mixed Office list structures are unsupported.");
      value += original.slice(sourceOffset); actual = { ...entry.pieces[0].actual, text: value, runs, formattingChanged: entry.pieces.some(piece => piece.actual.formattingChanged) };
    }
    applyValue(entry.path, actual.text);
    if (entry.path[0] === "blocks" && typeof entry.path[1] === "number" && entry.path[2] === "text" && (content.kind === "report" || content.kind === "research")) {
      const block: RichArtifactBlock = content.blocks[entry.path[1]];
      if (actual.text !== original || actual.formattingChanged) {
        delete block.attrs.richText; if (actual.runs.length) block.attrs.richText = { version: 1, text: actual.text, runs: actual.runs } satisfies RichDocumentFormatting;
        block.attrs.officeEdited = true;
        if (actual.text !== original && (block.type === "quote" || block.attrs.sourceRef || block.attrs.evidenceId)) { block.attrs.sourceQuoteEdited = true; block.attrs.officeEditProvenance = "user_asserted"; warn("Edited source-backed text is user_asserted; retained citations do not verify the revised quotation."); }
      }
      if (format === "docx") {
        if (block.type === "heading") {
          if (actual.level) { if (actual.level !== (block.attrs.level ?? 2)) block.attrs.level = actual.level; }
          else { block.type = "paragraph"; delete block.attrs.level; block.attrs.officeEdited = true; }
        } else if (actual.level && ["paragraph", "bullet_list", "ordered_list"].includes(block.type)) { block.type = "heading"; block.attrs.level = actual.level; block.attrs.officeEdited = true; }
        if (["paragraph", "bullet_list", "ordered_list"].includes(block.type)) {
          const type = actual.list === "bullet" ? "bullet_list" : actual.list === "ordered" ? "ordered_list" : "paragraph";
          if (type !== block.type) { block.type = type; block.attrs.officeEdited = true; }
          if (type === "ordered_list" && actual.listStart !== (block.attrs.start ?? 1)) { block.attrs.start = actual.listStart; block.attrs.officeEdited = true; }
        }
      }
    } else if (actual.text !== original && content.kind === "research" && entry.path[0] === "claims" && typeof entry.path[1] === "number" && entry.path[2] === "text") { content.claims[entry.path[1]].provenance = "user_asserted"; warn("Edited research claims are user_asserted; retained citations are context only."); }
    else if (actual.text !== original && content.kind === "thesis" && entry.path[0] === "claims" && typeof entry.path[1] === "number" && entry.path[2] === "text") {
      const claim = content.claims[entry.path[1]];
      claim.status = "open"; claim.confidence = null; claim.updatedAt = null;
      warn("Edited thesis claims are user_asserted and reopened; retained evidence does not verify the revised claim.");
    }
  }
  for (const entry of tables.values()) {
    const original = getPath(sourceContent, entry.path) as TableContent;
    if (entry.cells.size !== original.columns.length * (original.rows.length + 1)) throw new Error("Incomplete Office table binding coverage.");
    artifactContentSchema.parse(entry.table);
    applyValue(entry.path, entry.table);
    if (!same(entry.table, original)) warn("Native table edits are user-authored; numerical evidence for changed cells has been removed.");
  }
  if (!globalThis.crypto?.subtle) throw new Error("Office Artifact return requires local SHA-256 support.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const fileHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { sourceArtifactId: metadata.sourceArtifactId, sourceVersion: metadata.sourceVersion, sourceHash: metadata.sourceHash, sourceContent, content: artifactContentSchema.parse(content), warnings, format, fileHash };
}

function originalChart(content: ArtifactContent, path: (string | number)[]): ChartContent {
  const chart = artifactContentSchema.parse(getPath(content, path));
  if (chart.kind !== "chart") throw new Error("Invalid canonical native chart binding.");
  return chart;
}
function nativeGeometry(binding: OfficeArtifactBinding, native: XmlNode, format: "docx" | "pptx"): void {
  const geometry = binding.geometry;
  if (!geometry) throw new Error("Missing readonly Office media geometry binding.");
  if (descendants(native, "srcRect").length || descendants(native, "tile").length || descendants(native, "duotone").length || descendants(native, "alphaModFix").length) throw new Error("Edited Office picture crop/effects are unsupported.");
  const transform = descendants(native, "xfrm");
  if (transform.length !== 1 || ["rot", "flipH", "flipV"].some(key => attr(transform[0], key) && attr(transform[0], key) !== "0")) throw new Error("Edited Office media transform is unsupported.");
  const extent = one(transform[0], "ext"), offset = one(transform[0], "off");
  const actual = { x: Number(attr(offset, "x")), y: Number(attr(offset, "y")), cx: Number(attr(extent, "cx")), cy: Number(attr(extent, "cy")) };
  if (!same(actual, geometry)) throw new Error("Edited Office media geometry is unsupported.");
  if (format === "docx") {
    const inline = one(native, "inline"), outerExtent = one(inline, "extent");
    if (Number(attr(outerExtent, "cx")) !== geometry.cx || Number(attr(outerExtent, "cy")) !== geometry.cy || descendants(native, "anchor").length) throw new Error("Edited Word media extent/anchor is unsupported.");
  }
}
function readNativeImage(binding: OfficeArtifactBinding, native: XmlNode[], format: "docx" | "pptx", original: unknown, files: Map<string, Uint8Array>, rels: Relationship[]): void {
  if (binding.editable !== false || !binding.mediaPart || !binding.mediaSha256) throw new Error("Native Office images require readonly source and media bindings.");
  const image = readArtifactImage(original), root = native.length === 1 ? native[0] : null;
  if (!root || format === "pptx" && local(root.name) !== "pic") throw new Error("Missing/ambiguous native Office picture.");
  if (format === "docx") {
    const drawing = one(root, "drawing"), properties = one(drawing, "docPr");
    if (attr(properties, "name") !== binding.id || descendants(drawing, "pic").length !== 1 || descendants(drawing, "chart").length || readParagraphWithoutDrawing(root).trim()) throw new Error("Unknown/modified native Word image binding.");
  } else if (attr(one(root, "cNvPr"), "name") !== binding.id) throw new Error("Unknown native PowerPoint image binding.");
  const blip = one(root, "blip"), id = attr(blip, "embed");
  if (!id || attr(blip, "link") || blip.children.some(child => child.name !== "#text")) throw new Error("Remote/modified Office image references are unsupported.");
  const relation = rels.find(item => item.id === id && item.type.endsWith("/image") && !item.external);
  if (!relation || relation.target !== binding.mediaPart) throw new Error("Missing/mismatched native Office image relationship.");
  const actual = files.get(relation.target), expected = artifactImageBytes(image);
  if (!actual || actual.length > ARTIFACT_IMAGE_LIMITS.bytes || actual.length !== expected.length || binding.mediaSha256 !== image.sha256 || actual.some((byte, index) => byte !== expected[index])) throw new Error("Modified Office image bytes do not match immutable canonical capture.");
  const dimensions = artifactImageDimensions(actual, image.mimeType);
  if (dimensions.width !== image.width || dimensions.height !== image.height) throw new Error("Office image dimensions disagree with canonical capture.");
  nativeGeometry(binding, root, format);
  const geometry = binding.geometry!;
  if (Math.abs(geometry.cx * image.height - geometry.cy * image.width) > image.width + image.height) throw new Error("Office image aspect ratio disagrees with canonical capture.");
}
function readParagraphWithoutDrawing(root: XmlNode): string {
  const withoutDrawings = (node: XmlNode): XmlNode => ({ ...node, children: node.children.filter(child => local(child.name) !== "drawing").map(withoutDrawings) });
  const filtered = withoutDrawings(root);
  return readParagraph(filtered, "docx", []).text;
}
function readReadonlyWordChart(binding: OfficeArtifactBinding, native: XmlNode[], original: ChartContent, nodes: Map<string, XmlNode>, rels: Relationship[]): void {
  if (native.length !== 1 || !binding.chartPart || descendants(native[0], "drawing").length !== 1 || attr(one(native[0], "docPr"), "name") !== binding.id || readParagraphWithoutDrawing(native[0]).trim()) throw new Error("Missing/ambiguous readonly Word chart binding.");
  const reference = one(native[0], "chart"), relationship = rels.find(item => item.id === attr(reference, "id") && item.type.endsWith("/chart") && !item.external);
  if (!relationship || relationship.target !== binding.chartPart) throw new Error("Missing/mismatched Word chart relationship.");
  const chart = nodes.get(binding.chartPart); if (!chart || descendants(chart, "externalData").length || descendants(chart, "f").length || descendants(chart, "numRef").length || descendants(chart, "strRef").length) throw new Error("Readonly Word charts require complete local literal caches.");
  const types: Record<string, string> = { line: "lineChart", area: "areaChart", bar: "barChart", scatter: "scatterChart" };
  const plot = one(chart, "plotArea"), plots = plot.children.filter(child => local(child.name).endsWith("Chart"));
  if (plots.length !== 1 || local(plots[0].name) !== types[original.chartType]) throw new Error("Modified readonly Word chart type.");
  const union: (string | number)[] = [], seen = new Set<string | number>();
  for (const series of original.series) for (const point of series.points) { if (!seen.has(point.x)) { union.push(point.x); seen.add(point.x); } }
  if (union.every(value => typeof value === "number")) union.sort((a, b) => (a as number) - (b as number));
  const literal = (container: XmlNode, expected: (string | number | null)[], numeric: boolean) => {
    const data = one(container, numeric ? "numLit" : "strLit");
    const count = one(data, "ptCount");
    if (Number(attr(count, "val")) !== expected.length) throw new Error("Modified readonly Word chart cache size.");
    const points = new Map<number, string>();
    for (const point of children(data, "pt")) {
      const index = Number(attr(point, "idx")); if (!Number.isInteger(index) || index < 0 || index >= expected.length || points.has(index)) throw new Error("Ambiguous readonly Word chart point.");
      points.set(index, text(one(point, "v")));
    }
    expected.forEach((value, index) => {
      const actual = points.get(index);
      const equal = value === null ? actual === undefined || actual === "" : numeric ? actual !== undefined && actual !== "" && Number.isFinite(Number(actual)) && Number(actual) === value : actual === String(value);
      if (!equal) throw new Error("Modified readonly Word chart cache values; edit canonical chart content before export.");
    });
  };
  const series = descendants(plots[0], "ser");
  if (series.length !== original.series.length) throw new Error("Modified readonly Word chart series.");
  series.forEach((nativeSeries, index) => {
    const source = original.series[index];
    const label = one(nativeSeries, "tx");
    if (text(label) !== source.label) throw new Error("Modified readonly Word chart series label.");
    const expectedIndices = union.map(x => source.points.findIndex(point => Object.is(point.x, x) || point.x === x));
    const indices = binding.sourceIndices?.[index] ?? expectedIndices;
    if (!same(indices, expectedIndices) || new Set(indices.filter(value => value !== -1)).size !== source.points.length) throw new Error("Incomplete/modified readonly Word chart source point mapping.");
    const x = union.map(value => original.chartType === "scatter" ? value : recordedDocumentValue(value));
    literal(one(nativeSeries, original.chartType === "scatter" ? "xVal" : "cat"), x, original.chartType === "scatter");
    literal(one(nativeSeries, original.chartType === "scatter" ? "yVal" : "val"), indices.map(point => point === -1 ? null : source.points[point]?.y ?? null), true);
  });
  if (binding.geometry) {
    const extent = one(one(native[0], "inline"), "extent");
    if (Number(attr(extent, "cx")) !== binding.geometry.cx || Number(attr(extent, "cy")) !== binding.geometry.cy) throw new Error("Modified readonly Word chart geometry.");
  }
}
