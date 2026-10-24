/**
 * SI-04: native Chromium PDF path only for text jsPDF's WinAnsi fonts cannot
 * represent. Shape Tamil, Devanagari and other complex scripts in the user's
 * Electron process using locally installed OS fonts, never cloud rendering.
 *
 * This is an adapter behind the existing P4 export action, not another editor.
 */
import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import { artifactDocumentItems, artifactDocumentParagraphs, isDocumentArtifact } from "./artifactDocumentExport";

type PdfParagraph = ReturnType<typeof artifactDocumentParagraphs>[number];
type DesktopBridge = {
  exportUnicodePdf?: (request: {
    artifactId: string; version: number; contentHash: string; filename: string;
    paragraphs: PdfParagraph[];
  }) => Promise<{ saved: boolean; cancelled?: boolean; filename?: string }>;
};

const STANDARD_PDF_SPECIAL = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
/** Preserve the existing deterministic jsPDF path for its actual glyph set. */
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

export async function exportUnicodeArtifactPdf(plan: ArtifactExportPlan, content: ArtifactContent): Promise<void> {
  if (!isDocumentArtifact(content) || plan.kind !== content.kind || !plan.formats.includes("pdf")) {
    throw new Error("Unicode PDF requires a document Artifact with an authorized PDF export plan.");
  }
  // Unlike the jsPDF path this initial native-shaping adapter is text/table
  // only. Do not silently drop typed charts or captured image content.
  const items = artifactDocumentItems(plan, content);
  if (items.some(item => item.kind === "chart" || item.kind === "image")) {
    throw new Error("Multilingual PDF with embedded charts or images requires a native layout-capable renderer; export DOCX instead of dropping recorded visuals.");
  }
  const bridge = (window as Window & { limuriaDesktop?: DesktopBridge }).limuriaDesktop;
  if (!bridge?.exportUnicodePdf) {
    throw new Error("Multilingual PDF publishing requires the installed LiOS desktop app with local Chromium text shaping. DOCX export remains available.");
  }
  const paragraphs = artifactDocumentParagraphs(plan, content);
  if (!paragraphs.length || paragraphs.length > 4_000
    || paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0) > 900_000) {
    throw new Error("Unicode report exceeds the bounded local PDF text budget.");
  }
  const result = await bridge.exportUnicodePdf({
    artifactId: plan.artifactId, version: plan.version, contentHash: plan.contentHash,
    filename: (plan.filenameStem.trim().replace(/[^\p{L}\p{N}_. ()-]+/gu, "-").slice(0, 170) || "LiOS-Report")
      + "-v" + plan.version + ".pdf",
    paragraphs,
  });
  if (!result || (result.saved !== true && result.cancelled !== true)) {
    throw new Error("Desktop Unicode PDF publishing did not confirm a saved file.");
  }
}
