import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import { exportArtifactSpreadsheetToXlsx } from "./spreadsheetXlsx";
import { exportArtifactPdf, exportPdfReport } from "./exportPdf";
import { exportWorkbook, type ExportSheet } from "./exportXlsx";
import { exportArtifactPptx, exportPptxReport } from "./exportPptx";
import { exportArtifactDocx } from "./exportDocx";
import { exportArtifactMarkdown } from "./exportMarkdown";
import { isDocumentArtifact } from "./artifactDocumentExport";

function downloadText(filename: string, body: string, type: string) {
  const blob = new Blob([body], { type }); const href = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = href; anchor.download = filename; anchor.click(); URL.revokeObjectURL(href);
}
function rowsFor(content: ArtifactContent): ExportSheet {
  if (content.kind === "table") return { name: "Artifact", rows: [content.columns.map((c) => c.label), ...content.rows.map((row) => content.columns.map((c) => String(row[c.key] ?? "")))] };
  if (content.kind === "data") return { name: "Data", rows: [content.columns.map((c) => c.name), ...content.previewRows.map((row) => content.columns.map((c) => String(row[c.name] ?? "")))] };
  if (content.kind === "timeline") return { name: "Timeline", rows: [["At","Type","Title","Summary"], ...content.events.map((e) => [e.at,e.type,e.title,e.summary])] };
  return { name: "Artifact", rows: [["Artifact JSON"], [JSON.stringify(content)]] };
}
function requireDownload(result: { ok: boolean; error?: string }): void {
  if (!result.ok) throw new Error(result.error ?? "Unable to deliver Artifact export.");
}
export async function exportArtifactLocal(plan: ArtifactExportPlan, content: ArtifactContent, format: ArtifactExportPlan["formats"][number], beforeDownload?: () => void): Promise<void> {
  if (!plan.formats.includes(format)) throw new Error(`${format} is not valid for this Artifact.`);
  if (plan.kind !== content.kind) throw new Error(`Artifact export plan kind "${plan.kind}" does not match content kind "${content.kind}".`);
  beforeDownload?.();
  const stem = `${plan.filenameStem}-v${plan.version}`;
  if (format === "json") return downloadText(`${stem}.json`, JSON.stringify(content, null, 2), "application/json");
  if (format === "md" && isDocumentArtifact(content)) return exportArtifactMarkdown(plan, content);
  if (format === "md") return downloadText(`${stem}.md`, content.kind === "strategy" ? content.source : `# LiOS Artifact\n\n${JSON.stringify(content, null, 2)}`, "text/markdown");
  if (format === "csv") { const sheet = rowsFor(content); const csv = sheet.rows.map((row) => row.map((cell) => `"${String(typeof cell === "object" ? cell.value : cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"); return downloadText(`${stem}.csv`, csv, "text/csv"); }
  if (format === "xlsx" && content.kind === "spreadsheet") return exportArtifactSpreadsheetToXlsx(content, `${stem}.xlsx`, plan);
  if (format === "xlsx") return requireDownload(exportWorkbook(`${stem}.xlsx`, [rowsFor(content)], { model: `${content.kind} Artifact`, modelHash: plan.contentHash, provenance: plan.sourceRefs, generatedAt: new Date().toISOString() }));
  if (format === "pdf" && (isDocumentArtifact(content) || content.kind === "chart")) return requireDownload(exportArtifactPdf(plan, content));
  if (format === "pdf") return requireDownload(exportPdfReport(`${stem}.pdf`, plan.filenameStem, [rowsFor(content)], { model: `${content.kind} Artifact`, modelHash: plan.contentHash, provenance: plan.sourceRefs, generatedAt: new Date().toISOString() }));
  if (format === "pptx" && (isDocumentArtifact(content) || content.kind === "chart")) return exportArtifactPptx(plan, content, beforeDownload);
  if (format === "pptx") return exportPptxReport(`${stem}.pptx`, plan.filenameStem, [rowsFor(content)], { model: `${content.kind} Artifact`, modelHash: plan.contentHash, provenance: plan.sourceRefs });
  if (format === "docx") return exportArtifactDocx(plan, content);
  throw new Error(`${format} export requires a specialized adapter not available in the base desktop build.`);
}
