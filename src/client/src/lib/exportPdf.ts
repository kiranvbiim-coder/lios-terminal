import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import { artifactDocumentItems, type ArtifactDocumentItem, type ArtifactDocumentNativeParagraph, type ArtifactDocumentStyle } from "./artifactDocumentExport";
import { recordedDocumentValue, type RichDocumentMark } from "@shared/richArtifactDocument";
import { artifactImageDataUri } from "@shared/artifactImage";
import { ARTIFACT_PDF_CHART_HEIGHT, prepareArtifactPdfChart, renderArtifactChartPdf } from "./artifactPdfChart";
import {
  buildExportMetadataRows,
  prepareExportSheets,
  type ExportCellValue,
  type ExportContext,
  type ExportResult,
  type ExportSheet,
} from "./exportXlsx";
import { registerLocalExportCustody } from "./exportCustody";

export interface GeneratedPdf {
  filename: string;
  bytes: Uint8Array;
  pageCount: number;
}

export interface BuiltPdfReport {
  bytes: Uint8Array;
  pageCount: number;
  sheetNames: string[];
}

const PAGE_MARGIN_X = 40;
const PAGE_TOP = 62;
const PAGE_BOTTOM = 54;
const FIXED_CREATION_DATE = new Date("2000-01-01T00:00:00.000Z");
const DEFAULT_FILE_ID = "4c694f535044465075626c6973687631";
const PDF_MIME = "application/pdf";

function lastTableY(doc: jsPDF, fallback: number): number {
  const candidate: unknown = doc;
  if (candidate && typeof candidate === "object" && "lastAutoTable" in candidate) {
    const table = candidate.lastAutoTable;
    if (table && typeof table === "object" && "finalY" in table && typeof table.finalY === "number") {
      return table.finalY;
    }
  }
  return fallback;
}

function displayCell(cell: ExportCellValue): string {
  return String(typeof cell === "object" ? cell.value : cell ?? "");
}

function stableFileId(value?: string): string {
  const normalized = (value ?? "").replace(/[^a-fA-F0-9]/g, "");
  return normalized.length >= 32 ? normalized.slice(0, 32) : DEFAULT_FILE_ID;
}

function configureStablePdf(doc: jsPDF, title: string, subject: string, fileId?: string): void {
  doc.setCreationDate(FIXED_CREATION_DATE);
  doc.setFileId(stableFileId(fileId));
  doc.setDocumentProperties({
    title,
    subject,
    author: "LiOS Intelligence Terminal",
    creator: "LiOS Intelligence Terminal",
  });
}

function pageHeight(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight();
}

function pageWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth();
}

function ensureVerticalSpace(doc: jsPDF, cursorY: number, minimum: number): number {
  if (cursorY + minimum <= pageHeight(doc) - PAGE_BOTTOM) return cursorY;
  doc.addPage();
  return PAGE_TOP;
}

function applyPageFurniture(doc: jsPDF, title: string): number {
  const totalPages = doc.getNumberOfPages();
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.5);
    doc.line(PAGE_MARGIN_X, 42, width - PAGE_MARGIN_X, 42);
    doc.line(PAGE_MARGIN_X, height - 38, width - PAGE_MARGIN_X, height - 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    const header = doc.splitTextToSize(title, Math.max(80, width - (PAGE_MARGIN_X * 2) - 110)) as string[];
    doc.text(header[0] ?? title, PAGE_MARGIN_X, 31);
    doc.text(`Page ${page} of ${totalPages}`, width - PAGE_MARGIN_X, height - 23, { align: "right" });
    doc.setTextColor(0);
  }
  return totalPages;
}

function renderTable(
  doc: jsPDF,
  startY: number,
  rows: ExportCellValue[][],
): number {
  const [header, ...body] = rows;
  if (!header) return startY;
  autoTable(doc, {
    startY,
    margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, top: PAGE_TOP, bottom: PAGE_BOTTOM },
    head: [header.map(displayCell)],
    body: body.map((row) => row.map(displayCell)),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 4, right: 5, bottom: 4, left: 5 }, textColor: [51, 65, 85], lineColor: [203, 213, 225], lineWidth: 0.25 },
    headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    showHead: "everyPage",
  });
  return lastTableY(doc, startY) + 24;
}

function validateReportInputs(filename: string | null, title: string, sheets: ExportSheet[]): void {
  if (filename !== null && !filename.trim()) throw new Error("A filename is required");
  if (!title.trim()) throw new Error("A title is required");
  if (sheets.length === 0) throw new Error("At least one sheet is required");
  if (!sheets.every((sheet) => sheet.name.trim())) throw new Error("Every sheet must have a name");
}

function downloadPdfBytes(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes], { type: PDF_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Pure counterpart to exportPdfReport. Equal explicit inputs yield equal bytes;
 * callers own any generated-at timestamp they choose to include in context.
 */
export function buildPdfReportBytes(
  title: string,
  sheets: ExportSheet[],
  context?: ExportContext,
): BuiltPdfReport {
  validateReportInputs(null, title, sheets);
  const prepared = prepareExportSheets(sheets, context ?? {});
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: false });
  configureStablePdf(doc, title, context?.model ?? "LiOS professional report", context?.modelHash);
  let cursorY = PAGE_TOP + 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(15, 23, 42);
  doc.text(title, PAGE_MARGIN_X, cursorY);
  cursorY += 30;

  if (context) {
    cursorY = ensureVerticalSpace(doc, cursorY, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text("Export Metadata", PAGE_MARGIN_X, cursorY);
    cursorY = renderTable(doc, cursorY + 6, buildExportMetadataRows(context));
    if (prepared.notes.some((note) => note.rowsTruncated > 0 || note.columnsTruncated > 0)) {
      cursorY = ensureVerticalSpace(doc, cursorY, 28);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("Layout bounds were applied; see source workbook metadata for truncation details.", PAGE_MARGIN_X, cursorY);
      cursorY += 16;
    }
  }

  for (const sheet of prepared.sheets) {
    const [header] = sheet.rows;
    if (!header) continue;
    cursorY = ensureVerticalSpace(doc, cursorY, 48);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(sheet.name, PAGE_MARGIN_X, cursorY);
    cursorY = renderTable(doc, cursorY + 6, sheet.rows);
  }

  const pageCount = applyPageFurniture(doc, title);
  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    pageCount,
    sheetNames: prepared.sheets.map((sheet) => sheet.name),
  };
}


function paragraphMetrics(style: ArtifactDocumentStyle, headingLevel = 1): { fontSize: number; leading: number; gap: number; fontStyle: "normal" | "bold" | "italic" } {
  if (style === "title") return { fontSize: 22, leading: 27, gap: 14, fontStyle: "bold" };
  if (style === "heading1") return { fontSize: Math.max(11, 18 - headingLevel), leading: Math.max(15, 22 - headingLevel), gap: 9, fontStyle: "bold" };
  if (style === "heading2") return { fontSize: 13, leading: 18, gap: 8, fontStyle: "bold" };
  if (style === "quote") return { fontSize: 10.5, leading: 15, gap: 8, fontStyle: "italic" };
  if (style === "code") return { fontSize: 9.5, leading: 14, gap: 8, fontStyle: "normal" };
  if (style === "meta") return { fontSize: 9, leading: 13, gap: 4, fontStyle: "normal" };
  return { fontSize: 10.5, leading: 15, gap: 8, fontStyle: "normal" };
}

/** Standard PDF fonts are WinAnsi, not Unicode fonts. Reject rather than replace glyphs. */
function assertPdfText(text: string): void {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (character === "\n" || character === "\r" || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".includes(character)) continue;
    throw new Error(`PDF font does not support U+${code.toString(16).toUpperCase().padStart(4, "0")}; publish with a supported font or export the original JSON.`);
  }
}

function renderArtifactParagraph(doc: jsPDF, paragraph: ArtifactDocumentNativeParagraph, startY: number, followingHeight = 18): number {
  assertPdfText(paragraph.text);
  const metrics = paragraphMetrics(paragraph.style, paragraph.headingLevel);
  const prefix = paragraph.style === "bullet" ? "- " : paragraph.style === "ordered" ? `${paragraph.ordinal}. ` : "";
  const left = PAGE_MARGIN_X + (prefix ? 18 : paragraph.style === "quote" ? 12 : 0);
  const right = pageWidth(doc) - PAGE_MARGIN_X;
  const heading = paragraph.style === "title" || paragraph.style === "heading1" || paragraph.style === "heading2";
  let minimum = metrics.leading;
  if (heading) {
    doc.setFont("helvetica", metrics.fontStyle);
    doc.setFontSize(metrics.fontSize);
    // Reserve the heading with the next content start, rather than leaving an orphan.
    // A small width reserve covers standard-font advance rounding and mixed inline marks.
    const headingLines = doc.splitTextToSize(paragraph.text, right - left - metrics.fontSize * 2) as string[];
    minimum = Math.min(pageHeight(doc) - PAGE_TOP - PAGE_BOTTOM, Math.max(1, headingLines.length) * metrics.leading + metrics.gap + followingHeight);
  }
  let y = ensureVerticalSpace(doc, startY, minimum);
  let x = left;
  let hasText = false;
  if (paragraph.style === "meta") doc.setTextColor(100, 116, 139);
  else if (paragraph.style === "quote") doc.setTextColor(71, 85, 105);
  else if (heading) doc.setTextColor(15, 23, 42);
  else doc.setTextColor(51, 65, 85);
  doc.setDrawColor(100, 116, 139);
  const setFont = (marks: readonly RichDocumentMark[]) => {
    const bold = metrics.fontStyle === "bold" || marks.some(mark => mark.type === "bold");
    const italic = metrics.fontStyle === "italic" || marks.some(mark => mark.type === "italic");
    doc.setFont(paragraph.style === "code" || marks.some(mark => mark.type === "code") ? "courier" : "helvetica", bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal");
    doc.setFontSize(metrics.fontSize);
  };
  // jsPDF rounds standard-font AFM widths to hundredths of an em; native PDF
  // readers use the full advances. Tj text also does not apply pair kerning.
  // Budget one hundredth per glyph so measured lines and mixed-font spans fit.
  const textWidth = (text: string) => (doc.getStringUnitWidth(text, { doKerning: false }) + text.length * 0.01) * metrics.fontSize;
  setFont([]);
  if (prefix) {
    // Keep the complete recorded ordinal even when it needs more than the usual list indent.
    const prefixWidth = textWidth(prefix);
    if (prefixWidth > right - PAGE_MARGIN_X - 20) throw new Error("PDF list ordinal exceeds the page width.");
    doc.text(prefix, PAGE_MARGIN_X, y);
  }
  const textLeft = Math.max(left, PAGE_MARGIN_X + (prefix ? textWidth(prefix) : 0));
  x = textLeft;
  const newLine = () => { y = ensureVerticalSpace(doc, y + metrics.leading, metrics.leading); x = textLeft; hasText = false; };
  const draw = (text: string, marks: readonly RichDocumentMark[]) => {
    setFont(marks);
    const width = textWidth(text);
    if (!Number.isFinite(width) || x + width > right + 0.01) throw new Error("PDF text exceeds the supported page width.");
    const link = marks.find(mark => mark.type === "link");
    if (link?.attrs?.href) doc.textWithLink(text, x, y, { url: link.attrs.href });
    else doc.text(text, x, y);
    doc.setLineWidth(0.5);
    if (marks.some(mark => mark.type === "underline" || mark.type === "link")) doc.line(x, y + 1.5, x + width, y + 1.5);
    if (marks.some(mark => mark.type === "strike")) doc.line(x, y - metrics.fontSize * 0.3, x + width, y - metrics.fontSize * 0.3);
    x += width;
    hasText = true;
  };
  const runs = paragraph.formatting?.runs ?? [];
  let offset = 0;
  const spans: { text: string; marks: RichDocumentMark[] }[] = [];
  for (const run of runs) {
    if (run.from > offset) spans.push({ text: paragraph.text.slice(offset, run.from), marks: [] });
    spans.push({ text: paragraph.text.slice(run.from, run.to), marks: run.marks });
    offset = run.to;
  }
  if (offset < paragraph.text.length) spans.push({ text: paragraph.text.slice(offset), marks: [] });
  for (const span of spans) {
    setFont(span.marks);
    let pending = "";
    const flush = () => { if (pending) { draw(pending, span.marks); pending = ""; } };
    for (const token of span.text.split(/(\r\n|\r|\n| +)/).filter(Boolean)) {
      if (/^[\r\n]+$/.test(token)) { flush(); newLine(); continue; }
      const width = textWidth(token);
      if (x + textWidth(pending + token) <= right) { pending += token; continue; }
      flush();
      if (hasText) newLine();
      if (width <= right - textLeft) pending = token;
      else {
        // Split long literal tokens at glyph boundaries; never clip, elide or scale to unreadability.
        for (const glyph of token) {
          if (pending && textWidth(pending + glyph) > right - x) { flush(); newLine(); }
          if (textWidth(glyph) > right - textLeft) throw new Error("PDF glyph exceeds the page width.");
          pending += glyph;
        }
      }
    }
    flush();
  }
  return y + metrics.leading + metrics.gap;
}

function renderArtifactTable(doc: jsPDF, item: Extract<ArtifactDocumentItem, { kind: "table" }>, startY: number): number {
  const { columns, rows } = item.table;
  if (!columns.length) {
    if (rows.length) throw new Error("PDF cannot represent table rows without columns.");
    return startY;
  }
  const head = columns.map(column => column.label);
  const body = rows.map(row => columns.map(column => Object.hasOwn(row, column.key) ? recordedDocumentValue(row[column.key]) : "Not recorded"));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const available = pageWidth(doc) - PAGE_MARGIN_X * 2;
  const widths = head.map(label => {
    assertPdfText(label);
    return Math.min(180, Math.max(70, doc.getTextWidth(label) + 12));
  });
  for (const row of body) row.forEach((value, index) => {
    assertPdfText(value);
    widths[index] = Math.min(180, Math.max(widths[index], doc.getTextWidth(value) + 12));
  });
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  autoTable(doc, {
    startY: ensureVerticalSpace(doc, startY, 36),
    margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X, top: PAGE_TOP, bottom: PAGE_BOTTOM },
    head: [head], body,
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 4, right: 5, bottom: 4, left: 5 }, overflow: "linebreak", textColor: [51, 65, 85], lineColor: [203, 213, 225], lineWidth: 0.25 },
    columnStyles: Object.fromEntries(widths.map((width, index) => [index, {
      cellWidth: totalWidth > available ? width : width * available / totalWidth,
      halign: columns[index].type === "number" || columns[index].type === "currency" || columns[index].type === "percent" ? "right" : "left",
    }])),
    headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    showHead: "everyPage",
    horizontalPageBreak: true,
    horizontalPageBreakBehaviour: "afterAllRows",
    didDrawCell: ({ cell }) => {
      if (cell.x < PAGE_MARGIN_X - 0.1 || cell.x + cell.width > pageWidth(doc) - PAGE_MARGIN_X + 0.1 || cell.y < PAGE_TOP - 0.1 || cell.y + cell.height > pageHeight(doc) - PAGE_BOTTOM + 0.1) {
        throw new Error("PDF table layout exceeds the printable page bounds.");
      }
    },
  });
  return lastTableY(doc, startY) + 18;
}

function chartMetadata(chart: Extract<ArtifactContent, { kind: "chart" }>): string {
  return recordedDocumentValue({ ...chart, series: chart.series.map(({ id, label }) => ({ id, label })) });
}

function renderArtifactItems(doc: jsPDF, items: readonly ArtifactDocumentItem[]): void {
  let cursorY = PAGE_TOP;
  // All media comes from validated captured canonical bytes, never a URL.
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.kind === "table") { cursorY = renderArtifactTable(doc, item, cursorY); continue; }
    if (item.kind === "image") {
      const availableWidth = pageWidth(doc) - PAGE_MARGIN_X * 2;
      const availableHeight = pageHeight(doc) - PAGE_TOP - PAGE_BOTTOM;
      const scale = Math.min(availableWidth / item.image.width, availableHeight / item.image.height, 0.75);
      const width = item.image.width * scale;
      const height = item.image.height * scale;
      cursorY = ensureVerticalSpace(doc, cursorY, height);
      doc.addImage(artifactImageDataUri(item.image), item.image.mimeType === "image/png" ? "PNG" : "JPEG", PAGE_MARGIN_X + (availableWidth - width) / 2, cursorY, width, height, item.image.sha256);
      cursorY += height + 18;
      continue;
    }
    if (item.kind === "chart") {
      const prepared = prepareArtifactPdfChart(item.chart);
      cursorY = ensureVerticalSpace(doc, cursorY, prepared.height);
      doc.setFont("helvetica", "normal");
      cursorY = renderArtifactChartPdf(doc, prepared, {
        x: PAGE_MARGIN_X, y: cursorY, width: pageWidth(doc) - PAGE_MARGIN_X * 2,
        height: prepared.height,
        newPage: () => { doc.addPage(); return PAGE_TOP; },
        validateText: assertPdfText,
      }).bottomY + 18;
      continue;
    }
    const next = items[index + 1];
    let followingHeight = next?.kind === "table" ? 36 : next?.kind === "chart" ? ARTIFACT_PDF_CHART_HEIGHT : 18;
    if (next?.kind === "image") {
      const scale = Math.min((pageWidth(doc) - PAGE_MARGIN_X * 2) / next.image.width, (pageHeight(doc) - PAGE_TOP - PAGE_BOTTOM) / next.image.height, 0.75);
      followingHeight = next.image.height * scale;
    } else if (next?.kind === "paragraph") followingHeight = paragraphMetrics(next.style, next.headingLevel).leading;
    cursorY = renderArtifactParagraph(doc, item, cursorY, followingHeight);
    if (item.block?.type === "chart_ref" && item.block.attrs.chart === undefined) {
      cursorY = renderArtifactParagraph(doc, { kind: "paragraph", text: "Recorded chart reference unavailable; no canonical chart payload recorded.", style: "meta" }, cursorY);
    }
  }
}

function filenameSafe(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "LiOS-Artifact";
}

export function buildArtifactPdf(plan: ArtifactExportPlan, content: ArtifactContent): GeneratedPdf {
  if (plan.kind !== content.kind) {
    throw new Error(`Artifact export plan kind "${plan.kind}" does not match content kind "${content.kind}".`);
  }
  if (!plan.formats.includes("pdf")) throw new Error("PDF is not enabled for this Artifact export plan.");
  if (content.kind !== "chart" && content.kind !== "research" && content.kind !== "report" && content.kind !== "decision" && content.kind !== "thesis") {
    throw new Error(`Professional Artifact PDF publishing is not supported for kind "${content.kind}".`);
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: false });
  configureStablePdf(doc, plan.filenameStem, `${plan.kind} Artifact ${plan.artifactId} v${plan.version}`, plan.contentHash);
  assertPdfText(plan.filenameStem);
  if (content.kind === "chart") {
    const prepared = prepareArtifactPdfChart(content);
    let cursorY = renderArtifactParagraph(doc, { kind: "paragraph", text: plan.filenameStem, style: "title" }, PAGE_TOP, prepared.height);
    cursorY = ensureVerticalSpace(doc, cursorY, prepared.height);
    doc.setFont("helvetica", "normal");
    cursorY = renderArtifactChartPdf(doc, prepared, {
      x: PAGE_MARGIN_X, y: cursorY, width: pageWidth(doc) - PAGE_MARGIN_X * 2, height: prepared.height,
      newPage: () => { doc.addPage(); return PAGE_TOP; }, validateText: assertPdfText,
    }).bottomY + 18;
    for (const text of [
      `Chart metadata: ${chartMetadata(content)}`, `Artifact: ${plan.artifactId}`, `Version: ${plan.version}`,
      `Kind: ${plan.kind}`, `Content hash: ${plan.contentHash}`,
      ...(plan.sourceRefs.length ? plan.sourceRefs.map(source => `Source: ${source}`) : ["Sources: none recorded"]),
    ]) cursorY = renderArtifactParagraph(doc, { kind: "paragraph", text, style: "meta" }, cursorY);
  } else renderArtifactItems(doc, artifactDocumentItems(plan, content));
  if (doc.getNumberOfPages() > 2_000) throw new Error("Professional Artifact PDF exceeds the 2,000-page publishing bound; export the original JSON.");
  const pageCount = applyPageFurniture(doc, plan.filenameStem);
  return {
    filename: `${filenameSafe(plan.filenameStem)}-v${plan.version}.pdf`,
    bytes: new Uint8Array(doc.output("arraybuffer")),
    pageCount,
  };
}

export function exportArtifactPdf(plan: ArtifactExportPlan, content: ArtifactContent): ExportResult {
  const filename = `${filenameSafe(plan.filenameStem)}-v${plan.version}.pdf`;
  try {
    const generated = buildArtifactPdf(plan, content);
    downloadPdfBytes(generated.filename, generated.bytes);
    void registerLocalExportCustody({ filename: generated.filename, format: "pdf", bytes: generated.bytes });
    return { ok: true, filename: generated.filename, sheetNames: [plan.filenameStem] };
  } catch (error) {
    return { ok: false, filename, error: error instanceof Error ? error.message : "Unable to deliver Artifact PDF" };
  }
}

// PDF counterpart to exportXlsx.ts's exportWorkbook. Legacy callers can keep
// passing (filename, title, sheets); context-aware calls add a metadata table.
export function exportPdfReport(
  filename: string,
  title: string,
  sheets: ExportSheet[],
  context?: ExportContext,
): ExportResult {
  try {
    validateReportInputs(filename, title, sheets);
    const built = buildPdfReportBytes(title, sheets, context);
    downloadPdfBytes(filename, built.bytes);
    void registerLocalExportCustody({ filename, format: "pdf", bytes: built.bytes });
    return { ok: true, filename, sheetNames: built.sheetNames };
  } catch (error) {
    return {
      ok: false,
      filename,
      error: error instanceof Error ? error.message : "Unable to deliver PDF",
    };
  }
}
