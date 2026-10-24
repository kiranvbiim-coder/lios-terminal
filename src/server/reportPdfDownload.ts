/**
 * P4: owner-authenticated native PDF delivery for the exact saved Report
 * Artifact revision. Reuses LiOS's existing browser-independent jsPDF
 * builder; PDF is a read-only publishing view of the canonical editable P4
 * Report, NOT a new Artifact store or an editable Word-return format.
 */
import { artifactContentSchema } from "@shared/artifactContracts";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { getArtifactExportPlan } from "./artifactExport";
import { assertLocalByodRuntime } from "./runtimeSecurity";
import type { TenantContext } from "./tenantContext";
import { buildArtifactPdf } from "../client/src/lib/exportPdf";
import { requiresChromiumUnicodePdf } from "../client/src/lib/artifactUnicodePdf";

const REPORT_PDF_MIME = "application/pdf" as const;
const MAX_REPORT_PDF_BYTES = 32 * 1024 * 1024;
const MAX_REPORT_PDF_PAGES = 2_000;

export interface ReportPdfDownload {
  filename: string;
  bytes: Uint8Array;
  artifactId: string;
  version: number;
  contentHash: string;
  pageCount: number;
  mimeType: typeof REPORT_PDF_MIME;
}

function validPdfEnvelope(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 100 || bytes.byteLength > MAX_REPORT_PDF_BYTES) return false;
  const header = new TextDecoder().decode(bytes.subarray(0, 8));
  const trailer = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 32)));
  return header.startsWith("%PDF-") && /%%EOF\s*$/.test(trailer);
}

/** Never produce a public URL or export an arbitrary client-authored payload. */
export async function prepareReportPdfDownload(
  ctx: TenantContext,
  artifactId: string,
  version?: number,
): Promise<ReportPdfDownload> {
  assertLocalByodRuntime("Professional report PDF download");
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.kind !== "report" || artifact.status !== "active") {
    throw new Error("PDF download requires an active saved Report Artifact.");
  }
  const currentVersion = version ?? artifact.headVersion;
  if (currentVersion !== artifact.headVersion) {
    throw new Error("Report revision changed; reopen the current revision before downloading PDF.");
  }
  const [plan, saved] = await Promise.all([
    getArtifactExportPlan(ctx, artifactId, currentVersion),
    getArtifactVersion(ctx, artifactId, currentVersion),
  ]);
  if (plan.artifactId !== artifactId || plan.version !== saved.version
    || plan.contentHash !== saved.contentHash || plan.kind !== "report"
    || !plan.formats.includes("pdf")) {
    throw new Error("Current Report PDF export plan is inconsistent with the saved revision.");
  }
  const content = artifactContentSchema.parse(saved.content);
  if (content.kind !== "report") {
    throw new Error("The saved Report content no longer matches its Artifact kind.");
  }
  if (requiresChromiumUnicodePdf(plan, content)) {
    throw new Error("Cannot render Unicode professional PDF through the standard HTTP renderer; use the installed LiOS Desktop Artifact Export for native Tamil/Indic shaping.");
  }
  // This is the SAME bound-aware renderer already used in the existing P4
  // desktop UI: pagination, exact source refs and unsupported-glyph failure
  // are inherited, not silently replaced with an unlicensed conversion.
  const generated = buildArtifactPdf(plan, content);
  if (!validPdfEnvelope(generated.bytes)
    || generated.pageCount < 1 || generated.pageCount > MAX_REPORT_PDF_PAGES) {
    throw new Error("Generated Report PDF failed native output integrity limits.");
  }
  // Permission remains with the saved local P4 owner. An edit during render
  // invalidates this delivery, even if the old PDF bytes were otherwise valid.
  const refreshed = await getArtifact(ctx, artifactId);
  if (refreshed.status !== "active" || refreshed.headVersion !== currentVersion) {
    throw new Error("Report changed while generating PDF; reopen and export the current revision.");
  }
  return {
    filename: generated.filename,
    bytes: generated.bytes,
    artifactId,
    version: currentVersion,
    contentHash: saved.contentHash,
    pageCount: generated.pageCount,
    mimeType: REPORT_PDF_MIME,
  };
}
