import type { JSONContent } from "@tiptap/core";
import { reportArtifactContentSchema, researchArtifactContentSchema, richDocumentBlockSchema, tableArtifactContentSchema, type ArtifactContent, type RichArtifactDocument, type RichArtifactBlock } from "./artifactContracts";
export type { RichArtifactDocument, RichArtifactBlock } from "./artifactContracts";
export type RichDocumentMark = { type: "bold" | "italic" | "strike" | "code" | "underline" | "link"; attrs?: { href: string; target?: "_blank" | "_self" } };
/** attrs.richText is an inline-only projection, never a second document store.
 * Offsets are UTF-16, sorted, non-overlapping half-open ranges over the exact
 * `text` snapshot. A mismatched snapshot is stale and must not supply marks.
 */
export type RichDocumentFormatting = { version: 1; text: string; runs: { from: number; to: number; marks: RichDocumentMark[] }[] };
export type TiptapDocumentProjection = JSONContent & { type: "doc"; content: JSONContent[] };

const opaqueTypes: Readonly<Record<string, true>> = { table: true, callout: true, chart_ref: true, artifact_ref: true, image: true };
const plainMarks: Readonly<Record<string, true>> = { bold: true, italic: true, strike: true, code: true, underline: true };


export const RECORDED_DOCUMENT_TABLE_PREVIEW_ROWS = 100;
type RecordedDocumentTable = Extract<ArtifactContent, { kind: "table" }>;
export type RecordedDocumentTableResult = { status: "recognized"; table: RecordedDocumentTable } | { status: "legacy"; reason: string };

/** Validate the existing P4 table contract without replacing or normalizing its recorded payload. */
export function readRecordedDocumentTable(attrs: Record<string, unknown> | null): RecordedDocumentTableResult {
  const raw = attrs?.table;
  const parsed = tableArtifactContentSchema.safeParse(raw);
  if (!parsed.success) return { status: "legacy", reason: "Legacy or unrecognized table payload; original text and attributes are retained below." };
  const table = raw as RecordedDocumentTable;
  const keys = new Set<string>();
  for (const column of table.columns) {
    if (keys.has(column.key) || column.key !== column.key.trim()) return { status: "legacy", reason: "Ambiguous table column keys; original text and attributes are retained below." };
    keys.add(column.key);
  }
  const finite = (value: unknown): boolean => {
    if (typeof value === "number") return Number.isFinite(value);
    if (value && typeof value === "object") return Object.values(value).every(finite);
    return true;
  };
  if (!table.rows.every(finite)) return { status: "legacy", reason: "Non-finite table values cannot be projected as a typed table; original text and attributes are retained below." };
  if (table.rows.some(row => Object.keys(row).some(key => !keys.has(key)))) return { status: "legacy", reason: "Table rows contain fields without recorded columns; original text and attributes are retained below." };
  return { status: "recognized", table };
}

/** Literal text only: no currency/percent formatting, URL activation, or numeric inference. */
export function recordedDocumentValue(value: unknown): string {
  const literal = (item: unknown, nested = false): string => {
    if (typeof item === "string") return nested ? JSON.stringify(item) : item;
    if (typeof item === "number" && Object.is(item, -0)) return "-0";
    if (item === null || typeof item !== "object") return String(item);
    if (Array.isArray(item)) return `[${item.map(value => literal(value, true)).join(", ")}]`;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}: ${literal((item as Record<string, unknown>)[key], true)}`).join(", ")}}`;
  };
  return literal(value);
}

/** Bounded read-only preview, never a truncated canonical table or export source. */
export function recordedDocumentTablePreview(table: RecordedDocumentTable): { rows: RecordedDocumentTable["rows"]; shown: number; total: number } {
  const shown = Math.min(table.rows.length, RECORDED_DOCUMENT_TABLE_PREVIEW_ROWS);
  return { rows: table.rows.slice(0, shown), shown, total: table.rows.length };
}
/** Only this allowlist may reach rendered links. Recorded opaque attrs stay opaque. */
export function safeRichDocumentHref(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 4_000 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  if (value.startsWith("#") || (value.startsWith("/") && !value.startsWith("//"))) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? value : null;
  } catch { return null; }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}

function readMark(raw: unknown): RichDocumentMark | null {
  const mark = record(raw, "inline mark");
  if (typeof mark.type !== "string") throw new Error("Invalid inline mark type.");
  if (Object.hasOwn(plainMarks, mark.type)) {
    if (mark.attrs !== undefined && Object.keys(record(mark.attrs, "mark attrs")).length) throw new Error("Unexpected inline mark attrs.");
    return { type: mark.type as RichDocumentMark["type"] };
  }
  if (mark.type !== "link") throw new Error(`Unsupported inline mark: ${mark.type}.`);
  const attrs = record(mark.attrs, "link attrs");
  if (typeof attrs.href !== "string") throw new Error("Invalid link href.");
  const href = safeRichDocumentHref(attrs.href);
  if (!href) return null;
  if (attrs.target !== undefined && attrs.target !== null && attrs.target !== "_blank" && attrs.target !== "_self") throw new Error("Invalid link target.");
  // Match the pinned Tiptap Link default so its JSON normalization cannot turn
  // an unchanged document into a canonical formatting edit.
  return { type: "link", attrs: { href, target: attrs.target === "_self" ? "_self" : "_blank" } };
}

function readMarks(raw: unknown): RichDocumentMark[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 6) throw new Error("Invalid inline marks.");
  const seen = new Set<string>();
  const marks: RichDocumentMark[] = [];
  for (const value of raw) {
    const mark = readMark(value);
    if (!mark) continue;
    if (seen.has(mark.type)) throw new Error("Duplicate inline mark.");
    seen.add(mark.type);
    marks.push(mark);
  }
  return marks.sort((a, b) => a.type.localeCompare(b.type));
}

/** Read coherent inline formatting for any native document consumer.
 * Stale snapshots supply no marks; malformed ranges fail before rendering.
 * Recorded attrs are never rewritten, and only safe recorded links are returned.
 */
export function readRichDocumentFormatting(block: RichArtifactBlock): RichDocumentFormatting | null {
  if (block.attrs.richText === undefined) return null;
  const raw = record(block.attrs.richText, "richText formatting");
  if (raw.version !== 1 || typeof raw.text !== "string" || raw.text.length > 200_000 || !Array.isArray(raw.runs) || raw.runs.length > 20_000) throw new Error("Invalid richText formatting.");
  let end = 0;
  const snapshot = raw.text;
  const runs = raw.runs.map(value => {
    const run = record(value, "format run");
    if (!Number.isInteger(run.from) || !Number.isInteger(run.to) || (run.from as number) < end || (run.to as number) <= (run.from as number) || (run.to as number) > snapshot.length) throw new Error("Invalid richText format offsets.");
    end = run.to as number;
    const from = run.from as number;
    const to = run.to as number;
    const bisectsSurrogate = (offset: number) => offset > 0 && offset < snapshot.length && /[\uD800-\uDBFF]/.test(snapshot[offset - 1]) && /[\uDC00-\uDFFF]/.test(snapshot[offset]);
    if (bisectsSurrogate(from) || bisectsSurrogate(to)) throw new Error("Format offsets must not split a Unicode character.");
    if (!Array.isArray(run.marks)) throw new Error("Invalid richText run marks.");
    return { from: run.from as number, to: run.to as number, marks: readMarks(run.marks) };
  });
  return raw.text === block.text ? { version: 1, text: raw.text, runs } : null;
}

function inlineNodes(text: string, runs: RichDocumentFormatting["runs"], from = 0, to = text.length, literalNewlines = false): JSONContent[] {
  const nodes: JSONContent[] = [];
  const append = (start: number, end: number, marks: RichDocumentMark[]) => {
    if (start >= end) return;
    const chunks = literalNewlines ? [text.slice(start, end)] : text.slice(start, end).split("\n");
    chunks.forEach((chunk, index) => {
      if (index) nodes.push({ type: "hardBreak", ...(marks.length ? { marks } : {}) });
      if (chunk) nodes.push({ type: "text", text: chunk, ...(marks.length ? { marks } : {}) });
    });
  };
  let cursor = from;
  // Find the first intersecting run: list items must not rescan all earlier runs.
  let lower = 0;
  let upper = runs.length;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (runs[middle].to <= from) lower = middle + 1;
    else upper = middle;
  }
  for (let index = lower; index < runs.length; index++) {
    const run = runs[index];
    if (run.from >= to) break;
    append(cursor, Math.min(run.from, to), []);
    append(Math.max(cursor, run.from), Math.min(run.to, to), run.marks);
    cursor = Math.min(run.to, to);
  }
  append(cursor, to, []);
  return nodes;
}

function projectBlock(block: RichArtifactBlock): JSONContent {
  const attrs = { canonicalId: block.id };
  if (Object.hasOwn(opaqueTypes, block.type)) return { type: "canonicalBlock", attrs: { ...attrs, canonicalType: block.type, canonicalAttrs: structuredClone(block.attrs), canonicalText: block.text } };
  const runs = readRichDocumentFormatting(block)?.runs ?? [];
  if (block.type === "bullet_list" || block.type === "ordered_list") {
    let offset = 0;
    const content = block.text.split("\n").map(line => {
      const node = { type: "listItem", content: [{ type: "paragraph", content: inlineNodes(block.text, runs, offset, offset + line.length) }] };
      offset += line.length + 1;
      return node;
    });
    return { type: block.type === "bullet_list" ? "bulletList" : "orderedList", attrs: { ...attrs, ...(block.type === "ordered_list" ? { start: positiveInteger(block.attrs.start, 1) } : {}) }, content };
  }
  if (block.type === "quote") return { type: "blockquote", attrs, content: [{ type: "paragraph", content: inlineNodes(block.text, runs) }] };
  if (block.type === "code") return { type: "codeBlock", attrs: { ...attrs, language: typeof block.attrs.language === "string" ? block.attrs.language : null }, content: inlineNodes(block.text, [], 0, block.text.length, true) };
  return { type: block.type, attrs: { ...attrs, ...(block.type === "heading" ? { level: headingLevel(block.attrs.level) } : {}) }, content: inlineNodes(block.text, runs) };
}

function positiveInteger(value: unknown, fallback: number): number { return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback; }
function headingLevel(value: unknown): number { return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6 ? value as number : 2; }
function parseCanonical(raw: unknown): RichArtifactDocument {
  return raw && typeof raw === "object" && "kind" in raw && raw.kind === "report" ? reportArtifactContentSchema.parse(raw) : researchArtifactContentSchema.parse(raw);
}

export function toTiptapDocumentProjection(raw: unknown): TiptapDocumentProjection {
  const canonical = parseCanonical(raw);
  const ids = new Set<string>();
  for (const block of canonical.blocks) {
    if (ids.has(block.id)) throw new Error(`Duplicate canonical block identity: ${block.id}.`);
    ids.add(block.id);
  }
  return { type: "doc", content: canonical.blocks.map(projectBlock) };
}

/**
 * Reconcile user-inserted report blocks with their nearest recorded section.
 * The original section IDs/titles and unresolved source refs remain untouched.
 * New authored blocks gain section membership, never inherited citations.
 */
export function reconcileReportBlockSections(
  sections: Extract<RichArtifactDocument, { kind: "report" }>["sections"],
  previousIds: readonly string[],
  nextIds: readonly string[],
): Extract<RichArtifactDocument, { kind: "report" }>["sections"] {
  const present = new Set(nextIds);
  const previous = new Set(previousIds);
  const result = sections.map(section => ({
    ...section,
    blockIds: section.blockIds.filter(id => !previous.has(id) || present.has(id)),
  }));
  if (!result.length) return result;

  const membership = new Map<string, number>();
  result.forEach((section, sectionIndex) => section.blockIds.forEach(id => {
    if (present.has(id) && !membership.has(id)) membership.set(id, sectionIndex);
  }));
  for (let i = 0; i < nextIds.length; i++) {
    const id = nextIds[i];
    if (previous.has(id) || membership.has(id)) continue;
    // Prefer the preceding live block's section. For an insertion before the
    // first block use the following anchor, else the first existing section.
    const left = nextIds.slice(0, i).reverse().find(other => membership.has(other));
    const right = left ? undefined : nextIds.slice(i + 1).find(other => membership.has(other));
    const owner = membership.get(left ?? "") ?? membership.get(right ?? "") ?? 0;
    const destination = result[owner].blockIds;
    if (destination.length >= 5_000) throw new Error("Report section block limit exceeded. The unsaved document is retained.");
    const index = left && membership.get(left) === owner
      ? destination.indexOf(left) + 1
      : right && membership.get(right) === owner
        ? destination.indexOf(right) : destination.length;
    destination.splice(Math.max(0, index), 0, id);
    membership.set(id, owner);
  }
  return result;
}

type DecodedBlock = { type: RichArtifactBlock["type"]; text: string; runs: RichDocumentFormatting["runs"] };
function decodeNode(raw: unknown): DecodedBlock {
  const node = record(raw, "document node");
  if (node.text !== undefined || node.marks !== undefined) throw new Error("Block nodes cannot contain inline text or marks directly.");
  const runs: RichDocumentFormatting["runs"] = [];
  let text = "";
  const append = (value: string, marks: RichDocumentMark[] = []) => {
    const from = text.length;
    text += value;
    if (text.length > 200_000) throw new Error("Document block exceeds text limit.");
    if (!value || !marks.length) return;
    const last = runs[runs.length - 1];
    if (last && last.to === from && JSON.stringify(last.marks) === JSON.stringify(marks)) last.to = text.length;
    else runs.push({ from, to: text.length, marks });
    if (runs.length > 20_000) throw new Error("Document block exceeds formatting limit.");
  };
  const children = (parent: Record<string, unknown>): unknown[] => {
    if (parent.content === undefined) return [];
    if (!Array.isArray(parent.content) || parent.content.length > 200_001) throw new Error("Invalid document children.");
    return parent.content;
  };
  const inline = (parent: Record<string, unknown>, code = false) => {
    for (const rawChild of children(parent)) {
      const child = record(rawChild, "inline node");
      if (child.content !== undefined) throw new Error("Inline nodes cannot have children.");
      if (code && readMarks(child.marks).length) throw new Error("Code blocks cannot contain rich text marks.");
      if (child.type === "text" && typeof child.text === "string" && child.text.length) append(child.text, code ? [] : readMarks(child.marks));
      else if (child.type === "hardBreak" && !code && child.text === undefined) append("\n", readMarks(child.marks));
      else throw new Error(`Unsupported inline node: ${String(child.type)}.`);
    }
  };
  const paragraphs = (parent: Record<string, unknown>) => {
    children(parent).forEach((rawChild, index) => {
      const child = record(rawChild, "paragraph node");
      if (child.type !== "paragraph") throw new Error("Only paragraphs are supported inside lists and quotes.");
      if (index) append("\n");
      inline(child);
    });
  };
  let type: RichArtifactBlock["type"];
  switch (node.type) {
    case "paragraph": case "heading": type = node.type; inline(node); break;
    case "codeBlock": type = "code"; inline(node, true); break;
    case "blockquote": type = "quote"; paragraphs(node); break;
    case "bulletList": case "orderedList":
      type = node.type === "bulletList" ? "bullet_list" : "ordered_list";
      if (!children(node).length) throw new Error("Lists require at least one item.");
      children(node).forEach((rawItem, index) => {
        const item = record(rawItem, "list item");
        if (item.type !== "listItem" || !children(item).length) throw new Error("Invalid list item.");
        if (index) append("\n");
        paragraphs(item);
      });
      break;
    default: throw new Error(`Unsupported document node: ${String(node.type)}.`);
  }
  return { type, text, runs };
}

/** Decode edits against the P4 canonical source, not against mutable donor attrs.
 * Duplicate IDs are blocked rather than risking pasted provenance inheritance.
 * Newly assigned IDs are written into the supplied JSON projection so repeated
 * saves of that projection retain identity; the caller may supply its ID factory.
 */
export function fromTiptapDocumentProjection(document: unknown, rawCanonical: unknown, options: { createBlockId?: () => string } = {}): RichArtifactDocument {
  const canonical = parseCanonical(rawCanonical);
  const originalProjection = toTiptapDocumentProjection(canonical);
  const originals = new Map(canonical.blocks.map((block, index) => [block.id, { block, node: originalProjection.content[index] }]));
  const doc = record(document, "document");
  if (doc.type !== "doc" || !Array.isArray(doc.content) || doc.content.length > 5_000) throw new Error("Invalid rich document root.");
  const seen = new Set<string>();
  const assigned: { node: Record<string, unknown>; attrs: Record<string, unknown>; id: string }[] = [];
  const createId = options.createBlockId ?? (() => globalThis.crypto.randomUUID());
  const blocks = doc.content.map(rawNode => {
    const node = record(rawNode, "block node");
    const attrs = node.attrs === undefined ? {} : record(node.attrs, "block attrs");
    const suppliedId = attrs.canonicalId;
    if (suppliedId !== undefined && suppliedId !== null && (typeof suppliedId !== "string" || suppliedId.trim() !== suppliedId || !suppliedId || suppliedId.length > 200)) throw new Error("Invalid canonical block identity.");
    const id = typeof suppliedId === "string" ? suppliedId : createId();
    if (typeof id !== "string" || !id || id.length > 200 || id.trim() !== id || seen.has(id) || (typeof suppliedId !== "string" && originals.has(id))) throw new Error("Duplicate or invalid canonical block identity.");
    seen.add(id);
    if (typeof suppliedId !== "string") assigned.push({ node, attrs, id });
    const original = originals.get(id);
    if (node.type === "canonicalBlock") {
      if (!original || !Object.hasOwn(opaqueTypes, original.block.type) || attrs.canonicalType !== original.block.type || node.content !== undefined || node.text !== undefined || typeof attrs.canonicalText !== "string") throw new Error("Opaque blocks must retain their canonical identity and type.");
      return richDocumentBlockSchema.parse({ ...original.block, text: attrs.canonicalText });
    }
    const decoded = decodeNode(node);
    if (original && Object.hasOwn(opaqueTypes, original.block.type)) throw new Error("Opaque canonical blocks cannot be flattened.");
    const blockAttrs = original ? { ...original.block.attrs } : {};
    const baseline = original ? decodeNode(original.node) : null;
    const sameFormatting = baseline && decoded.text === baseline.text && JSON.stringify(decoded.runs) === JSON.stringify(baseline.runs);
    const hadStaleFormatting = original?.block.attrs.richText !== undefined && readRichDocumentFormatting(original.block) === null;
    if (!sameFormatting || hadStaleFormatting) {
      delete blockAttrs.richText;
      if (decoded.runs.length) blockAttrs.richText = { version: 1, text: decoded.text, runs: decoded.runs } satisfies RichDocumentFormatting;
    }
    if (decoded.type === "heading") {
      const level = headingLevel(attrs.level);
      if (!original || original.block.type !== "heading" || level !== headingLevel(original.block.attrs.level)) blockAttrs.level = level;
    }
    if (decoded.type === "ordered_list") {
      const start = positiveInteger(attrs.start, 1);
      if (!original || original.block.type !== "ordered_list" || start !== positiveInteger(original.block.attrs.start, 1)) blockAttrs.start = start;
    }
    if (decoded.type === "code") {
      if (attrs.language !== undefined && attrs.language !== null && typeof attrs.language !== "string") throw new Error("Invalid code language.");
      if (!original || original.block.type !== "code" || attrs.language !== original.node.attrs?.language) blockAttrs.language = attrs.language ?? null;
    }
    return richDocumentBlockSchema.parse({ id, type: decoded.type, text: decoded.text, attrs: blockAttrs });
  });
  const result = parseCanonical({ ...canonical, blocks, ...(canonical.kind === "report" ? { sections: reconcileReportBlockSections(canonical.sections, canonical.blocks.map(block => block.id), blocks.map(block => block.id)) } : {}) });
  for (const { node, attrs, id } of assigned) node.attrs = { ...attrs, canonicalId: id };
  return result;
}
