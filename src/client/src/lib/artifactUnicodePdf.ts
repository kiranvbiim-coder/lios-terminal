/**
 * P4 multilingual publishing: project the existing native Artifact document
 * items (including real tables, verified captured images and governed charts)
 * into a bounded, inert Electron print payload. No alternate report store.
 */
import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import { artifactDocumentItems, artifactDocumentParagraphs, isDocumentArtifact } from "./artifactDocumentExport";
import { ARTIFACT_IMAGE_LIMITS } from "@shared/artifactImage";
import { recordedDocumentValue } from "@shared/richArtifactDocument";
import { prepareArtifactPdfChart } from "./artifactPdfChart";

type PdfParagraph = ReturnType<typeof artifactDocumentParagraphs>[number];
export type UnicodePdfPrintItem =
  | ({ kind: "paragraph" } & PdfParagraph)
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "image"; caption: string; sourceRef: string; mimeType: "image/png" | "image/jpeg";
      dataBase64: string; byteLength: number; width: number; height: number; sha256: string }
  | { kind: "chart"; caption: string; sourceRef: string | null;
      chartType: "line" | "area" | "bar" | "scatter"; xKind: "number" | "category";
      yDomain: [number,number] | null;
      windows: Array<{ xValues: (string|number)[]; series: Array<{
        label: string; points: Array<{ xIndex: number; y: number }>;
      }> }> };
type DesktopBridge = {
  exportUnicodePdf?: (request: {
    artifactId: string; version: number; contentHash: string; filename: string;
    paragraphs: PdfParagraph[]; items: UnicodePdfPrintItem[];
  }) => Promise<{ saved: boolean; cancelled?: boolean; filename?: string }>;
};

const STANDARD_PDF_SPECIAL = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function hasUnsupportedStandardPdfGlyph(text: string): boolean {
  for (const char of text) {
    const point = char.codePointAt(0)!;
    if (char === "\n" || char === "\r" || (point >= 32 && point <= 126)
      || (point >= 160 && point <= 255) || STANDARD_PDF_SPECIAL.includes(char)) continue;
    return true;
  }
  return false;
}
export function requiresChromiumUnicodePdf(plan: ArtifactExportPlan, content: ArtifactContent): boolean {
  if (!isDocumentArtifact(content) || !plan.formats.includes("pdf") || plan.kind !== content.kind) return false;
  const paragraphs = artifactDocumentParagraphs(plan, content);
  return hasUnsupportedStandardPdfGlyph(plan.filenameStem)
    || paragraphs.some(paragraph => hasUnsupportedStandardPdfGlyph(paragraph.text));
}

const MAX_CHARTS = 8;
const MAX_CHART_WINDOWS = 30;
const MAX_CHART_POINTS = 3_000;
const MAX_TABLE_CELLS = 10_000;

export function projectUnicodePdfItems(plan: ArtifactExportPlan, content: ArtifactContent): UnicodePdfPrintItem[] {
  if (!isDocumentArtifact(content) || plan.kind !== content.kind || !plan.formats.includes("pdf")) {
    throw new Error("Unicode PDF requires a document Artifact with an authorized PDF export plan.");
  }
  const input = artifactDocumentItems(plan, content);
  const items: UnicodePdfPrintItem[] = [];
  let imageBytes = 0;
  let chartCount = 0;
  let cells = 0;
  for (const item of input) {
    if (item.kind === "paragraph") {
      items.push({ kind: "paragraph", text: item.text, style: item.style,
        ...(item.ordinal ? { ordinal: item.ordinal } : {}) });
    } else if (item.kind === "table") {
      cells += item.table.columns.length * (item.table.rows.length + 1);
      if (cells > MAX_TABLE_CELLS) throw new Error("Unicode PDF table cells exceed the bound; export DOCX.");
      items.push({
        kind: "table",
        columns: item.table.columns.map(column => column.label),
        rows: item.table.rows.map(row => item.table.columns.map(column =>
          Object.hasOwn(row, column.key) ? recordedDocumentValue(row[column.key]) : "Not recorded")),
      });
    } else if (item.kind === "image") {
      imageBytes += item.image.byteLength;
      if (imageBytes > ARTIFACT_IMAGE_LIMITS.totalBytes) {
        throw new Error("Unicode PDF images exceed the existing P4 image budget.");
      }
      // artifactDocumentItems already invokes readArtifactImage, verifying
      // dimensions, exact byte count, SHA-256 and canonical PNG/JPEG source.
      items.push({
        kind: "image", caption: item.block.text, sourceRef: item.image.sourceRef,
        mimeType: item.image.mimeType, dataBase64: item.image.dataBase64,
        byteLength: item.image.byteLength, width: item.image.width, height: item.image.height,
        sha256: item.image.sha256,
      });
    } else if (item.kind === "chart") {
      if (++chartCount > MAX_CHARTS) throw new Error("Unicode PDF exceeds its eight-chart budget.");
      const prepared = prepareArtifactPdfChart(item.chart);
      if (prepared.windowCount > MAX_CHART_WINDOWS
        || prepared.projection.totalSourcePoints > MAX_CHART_POINTS) {
        throw new Error("Unicode PDF chart exceeds the bounded layout budget; export DOCX or narrow the chart.");
      }
      items.push({
        kind: "chart", caption: item.block.text,
        sourceRef: typeof item.block.attrs.sourceRef === "string" ? item.block.attrs.sourceRef : null,
        chartType: prepared.projection.chartType, xKind: prepared.projection.xKind,
        yDomain: prepared.projection.yDomain,
        windows: prepared.windows.map(window => ({
          xValues: window.rows.map(row => row.x),
          series: window.series.map(series => ({
            label: series.label,
            // Preserve sparse points and exact source y; never impute nulls.
            points: series.points.map(point => ({
              xIndex: point.xIndex - window.offset, y: point.y,
            })),
          })),
        })),
      });
    }
  }
  if (!items.length || items.length > 4_000) throw new Error("Unicode PDF document exceeds the print item budget.");
  return items;
}

export async function exportUnicodeArtifactPdf(plan: ArtifactExportPlan, content: ArtifactContent): Promise<void> {
  const items = projectUnicodePdfItems(plan, content);
  const bridge = (window as Window & { limuriaDesktop?: DesktopBridge }).limuriaDesktop;
  if (!bridge?.exportUnicodePdf) {
    throw new Error("Multilingual PDF publishing requires the installed LiOS desktop app with local Chromium text shaping. DOCX export remains available.");
  }
  const paragraphs = artifactDocumentParagraphs(plan, content);
  if (!paragraphs.length || paragraphs.length > 4_000 ||
    paragraphs.reduce((sum, item) => sum + item.text.length, 0) > 900_000) {
    throw new Error("Unicode PDF exceeds its local text budget.");
  }
  const result = await bridge.exportUnicodePdf({
    artifactId: plan.artifactId, version: plan.version, contentHash: plan.contentHash,
    filename: (plan.filenameStem.trim().replace(/[^\p{L}\p{N}_. ()-]+/gu, "-").slice(0, 170) || "LiOS-Report")
      + "-v" + plan.version + ".pdf",
    paragraphs, items,
  });
  if (!result || (result.saved !== true && result.cancelled !== true)) {
    throw new Error("Desktop Unicode PDF publishing did not confirm a saved file.");
  }
}
