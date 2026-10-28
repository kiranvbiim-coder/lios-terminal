/**
 * P4: Download the current saved Report Artifact as a real editable DOCX.
 *
 * The implementation reuses LiOS's existing native Word renderer and
 * authenticated P4 store. It never introduces a second document engine,
 * persists export bytes, calls an AI provider or sends private report content
 * to the hosted license control plane.
 */
import { artifactContentSchema } from "@shared/artifactContracts";
import { readOfficeArtifactRoundtrip, OFFICE_ARTIFACT_LIMITS } from "@shared/officeArtifactRoundtrip";
import { hashLedgerValue } from "./ledgerStore";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { getArtifactExportPlan } from "./artifactExport";
import { assertLocalByodRuntime } from "./runtimeSecurity";
import type { TenantContext } from "./tenantContext";
// The client Word builder exports a pure, deterministic byte generator.
// Import the existing generator only; do not invoke its DOM download helper.
import { buildArtifactDocx } from "../client/src/lib/exportDocx";

export interface ReportDocxDownload {
  filename: string;
  bytes: Uint8Array;
  artifactId: string;
  version: number;
  contentHash: string;
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

const REPORT_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;

/**
 * Offline-friendly document download. Exact saved version must still be head;
 * the original exported file can later be returned through the existing
 * Office proposal workflow for a reviewed edit, never a silent overwrite.
 */
export async function prepareReportDocxDownload(
  ctx: TenantContext,
  artifactId: string,
  version?: number,
): Promise<ReportDocxDownload> {
  assertLocalByodRuntime("Professional report Word download");
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.status !== "active" || artifact.kind !== "report") {
    throw new Error("Word download requires an active saved Report Artifact.");
  }
  const expected = version ?? artifact.headVersion;
  if (expected !== artifact.headVersion) {
    throw new Error("Report revision changed; reopen its current revision before downloading Word.");
  }
  const plan = await getArtifactExportPlan(ctx, artifactId, expected);
  const saved = await getArtifactVersion(ctx, artifactId, expected);
  if (plan.artifactId !== artifact.id || plan.version !== saved.version
    || plan.contentHash !== saved.contentHash || plan.kind !== "report"
    || !plan.formats.includes("docx")) {
    throw new Error("Current Report Artifact DOCX export custody is inconsistent.");
  }
  const content = artifactContentSchema.parse(saved.content);
  if (content.kind !== "report") {
    throw new Error("Saved report content no longer matches the Report Artifact.");
  }
  const generated = buildArtifactDocx(plan, content);
  if (!generated.bytes.length || generated.bytes.byteLength > OFFICE_ARTIFACT_LIMITS.compressedBytes) {
    throw new Error("Word report exceeds the bounded Office download limit.");
  }
  // Validate the actual Word package before returning it. This runs the same
  // hostile-file / metadata checks used by LiOS's existing Office-return flow,
  // and verifies that untouched Word reopens as the EXACT saved P4 revision.
  const reopened = await readOfficeArtifactRoundtrip(generated.bytes, "docx");
  if (reopened.sourceArtifactId !== artifact.id
    || reopened.sourceVersion !== expected
    || reopened.sourceHash !== saved.contentHash
    || hashLedgerValue(reopened.sourceContent) !== saved.contentHash
    || hashLedgerValue(reopened.content) !== saved.contentHash) {
    throw new Error("Word report did not reopen as the exact saved Artifact revision.");
  }
  // Do not return bytes for a stale head if the owner edited the Artifact
  // while ZIP generation/validation was in progress.
  if ((await getArtifact(ctx, artifactId)).headVersion !== expected) {
    throw new Error("Report changed while generating Word; reopen and export again.");
  }
  await getArtifactExportPlan(ctx, artifactId, expected);
  return {
    filename: generated.filename,
    bytes: generated.bytes,
    artifactId,
    version: expected,
    contentHash: saved.contentHash,
    mimeType: REPORT_DOCX_MIME,
  };
}
