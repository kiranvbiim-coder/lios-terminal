import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import { artifactDocumentParagraphs, artifactExportFilename, validateArtifactDocumentExport } from "./artifactDocumentExport";

export interface GeneratedMarkdown { filename: string; bytes: Uint8Array }

export function buildArtifactMarkdown(plan: ArtifactExportPlan, content: ArtifactContent): GeneratedMarkdown {
  validateArtifactDocumentExport(plan, content, "md");
  const paragraphs = artifactDocumentParagraphs(plan, content);
  const body = paragraphs.map((paragraph) => {
    if (paragraph.style === "code" || (paragraph.style === "meta" && /[\r\n]/.test(paragraph.text))) {
      const runs = paragraph.text.match(/`+/g) ?? [];
      const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
      return `${fence}\n${paragraph.text}\n${fence}`;
    }
    if (paragraph.style === "meta") {
      const delimiter = "`".repeat(Math.max(1, ...(paragraph.text.match(/`+/g) ?? []).map((run) => run.length + 1)));
      return `${delimiter} ${paragraph.text} ${delimiter}`;
    }
    // Blocks contain plain text, not executable HTML or an alternate Markdown authority.
    const text = paragraph.text.replace(/([\\`*_{}\[\]<>|])/g, "\\$1").replace(/^([ \t]*)([#>+-]|\d+\.)/gm, "$1\\$2");
    if (paragraph.style === "title") return `# ${text}`;
    if (paragraph.style === "heading1") return `## ${text}`;
    if (paragraph.style === "heading2") return `### ${text}`;
    if (paragraph.style === "quote") return text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    if (paragraph.style === "bullet" || paragraph.style === "ordered") return `${paragraph.style === "bullet" ? "-" : `${paragraph.ordinal}.`} ${text.replace(/\r?\n/g, "\n   ")}`;
    return text;
  }).join("\n\n") + "\n";
  return { filename: artifactExportFilename(plan, "md"), bytes: new TextEncoder().encode(body) };
}

export function exportArtifactMarkdown(plan: ArtifactExportPlan, content: ArtifactContent): void {
  const file = buildArtifactMarkdown(plan, content);
  const href = URL.createObjectURL(new Blob([file.bytes], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = file.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}
