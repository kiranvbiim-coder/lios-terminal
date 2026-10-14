/**
 * UIDE (Universal Intelligent Data Engine) -- Phase 1 routes.
 *
 * Phase 1 scope only: ingest a file, profile its columns deterministically,
 * save it to the scenario fixture bank. No AI completion here -- that's a
 * later phase.
 *
 * Role split follows the house convention (see contentRoutes.ts/
 * adminRoutes.ts): read endpoints admit internal_compliance alongside
 * admin/analyst, since compliance can view org/content data everywhere
 * else in this app; only the "author" actions (upload, classify -- this
 * processes arbitrary uploaded client files and makes an LLM call) stay
 * restricted to admin/analyst.
 */
import type { Express } from "express";
import crypto from "crypto";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { ingestAndProfile, supportedExtensions, extOf } from "./uideEngine/profiler";
import { saveFixture, listFixtures, getFixture, saveClassification } from "./uideEngine/fixtureBank";
import { classifyDomain } from "./uideEngine/domainClassifier";
import { extractStatementsFromPdf, type ExtractedPeriodReport } from "./uideEngine/pdfStatementExtractor";
import { normalizeExtractedStatementReports } from "./uideEngine/documentIngestionAdapter";
import { saveImportedFinancials, listImportsForWorkspace, type ImportedReportRow } from "./uideEngine/importedFinancialsStore";
import { getWorkspace } from "./uideEngine/workspaceStore";
import { sourceIdentity, createProvenanceRecord } from "./provenance";
import { createMemoryUpload, INTERNAL_UPLOAD_LIMIT_BYTES } from "./uploadPolicy";
import { tenantContext } from "./tenantContext";
import { upsertFinancialMetricOverride } from "./financialMetricStore";

const upload = createMemoryUpload([...supportedExtensions(), "pdf"], INTERNAL_UPLOAD_LIMIT_BYTES);

const UIDE_AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const UIDE_READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

function workspaceOwned(req: any, res: any): boolean {
  if (getWorkspace(String(req.params.workspaceId), req.user!.id)) return true;
  res.status(404).json({ error: "Workspace not found." });
  return false;
}

// Extension filtering (createMemoryUpload) only checks the claimed file
// name -- trivially spoofed by renaming a file. Check the actual bytes too.
function hasPrefix(buffer: Buffer, bytes: number[]): boolean {
  return buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);
}

function validateFileSignature(buffer: Buffer, ext: string): string | null {
  if (ext === "pdf") return hasPrefix(buffer, [0x25, 0x50, 0x44, 0x46]) ? null : "File content is not a valid PDF.";
  if (ext === "csv") return buffer.includes(0) ? "CSV contains binary/NUL bytes and was rejected." : null;
  if (ext === "xlsx") {
    return hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06]) || hasPrefix(buffer, [0x50, 0x4b, 0x07, 0x08])
      ? null
      : "File content is not a valid XLSX/ZIP container.";
  }
  return "Unsupported file type.";
}

// Strips path separators and C0/DEL control characters from an untrusted
// uploaded file name via character-code comparison (not a regex escape
// range, which is easy to mistranscribe into literal control bytes).
function safeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "upload";
  const stripped = Array.from(base)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code <= 31 || code === 127 ? "_" : ch;
    })
    .join("");
  return stripped.slice(0, 180) || "upload";
}

function validateUpload(req: any, res: any): boolean {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded. Attach a file under the 'file' field." });
    return false;
  }
  const ext = extOf(req.file.originalname);
  if (!supportedExtensions().includes(ext)) {
    res.status(400).json({ error: `Unsupported file type ".${ext}". Supported: ${supportedExtensions().join(", ")}` });
    return false;
  }
  const signatureError = validateFileSignature(req.file.buffer, ext);
  if (signatureError) {
    res.status(400).json({ error: signatureError });
    return false;
  }
  req.file.originalname = safeFileName(req.file.originalname);
  return true;
}

export function registerUideRoutes(app: Express): void {
  app.post("/api/uide/upload", requireRole(...UIDE_AUTHOR_ROLES), upload.single("file"), async (req, res) => {
    if (!validateUpload(req, res)) return;
    const file = req.file!;

    try {
      const { profile } = ingestAndProfile(file.buffer, file.originalname);
      const source = sourceIdentity(file.buffer, file.originalname, file.mimetype);
      const provenance = createProvenanceRecord({
        source,
        organizationId: req.user!.organizationId ?? null,
        uploadedByUserId: req.user!.id,
        datasetId: `uide-fixture:${crypto.randomUUID()}`,
      });
      const meta = saveFixture(profile, req.user!.id, {
        provenanceId: provenance.id,
        sourceSha256: source.sha256,
        sourceSizeBytes: source.sizeBytes,
        organizationId: provenance.organizationId,
      });
      await recordAuditEvent(req.user!.id, "uide_file_uploaded", {
        fixtureId: meta.id,
        fileName: profile.fileName,
        sourceSha256: source.sha256,
        sourceSizeBytes: source.sizeBytes,
        provenanceId: provenance.id,
        sheetCount: profile.sheetNames.length,
        ...auditActor(req.user!),
      });
      res.json({ fixtureId: meta.id, provenanceId: provenance.id, sourceSha256: source.sha256, profile });
    } catch (err: any) {
      res.status(400).json({ error: "File could not be parsed." });
    }
  });

  app.get("/api/uide/fixtures", requireRole(...UIDE_READ_ROLES), (req, res) => {
    res.json(listFixtures(req.user!.id));
  });

  app.get("/api/uide/fixtures/:id", requireRole(...UIDE_READ_ROLES), (req, res) => {
    const record = getFixture(String(req.params.id), req.user!.id);
    if (!record) {
      res.status(404).json({ error: "Fixture not found." });
      return;
    }
    res.json(record);
  });

  // Table Extraction & Financial Statement Viewer: PDF -> draft statements.
  // Two-step by design (extract, then a separate commit) so nothing is
  // written to the imported-financials store until a human has reviewed it
  // -- see pdfStatementExtractor.ts's module comment for why extraction
  // alone is never trusted as final.
  app.post("/api/uide/statement-extract", requireRole(...UIDE_AUTHOR_ROLES), upload.single("file"), async (req, res) => {
    if (!validateUpload(req, res)) return;
    const file = req.file!;
    if (extOf(file.originalname) !== "pdf") {
      res.status(400).json({ error: `Unsupported file type ".${extOf(file.originalname)}". Statement extraction only accepts .pdf.` });
      return;
    }

    try {
      const result = await extractStatementsFromPdf(file.buffer, file.originalname);
      await recordAuditEvent(req.user!.id, "uide_statement_extracted", {
        fileName: result.fileName,
        pageCount: result.pageCount,
        reportsFound: result.reports.length,
        warningCount: result.warnings.length,
        ...auditActor(req.user!),
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: "Failed to extract statements from PDF." });
    }
  });

  app.post("/api/uide/statement-commit", requireRole(...UIDE_AUTHOR_ROLES), async (req, res) => {
    const { symbol, fileName, reports, workspaceId } = req.body as {
      symbol?: string; fileName?: string; reports?: ExtractedPeriodReport[]; workspaceId?: string;
    };
    if (!symbol || typeof symbol !== "string") {
      res.status(400).json({ error: "symbol is required." });
      return;
    }
    if (!Array.isArray(reports) || reports.length === 0) {
      res.status(400).json({ error: "reports must be a non-empty array." });
      return;
    }
    if (workspaceId && !workspaceOwned(req, res)) return;

    const rows: ImportedReportRow[] = reports.map((r) => ({
      symbol: symbol.toUpperCase(),
      report_type: r.reportType,
      date: `${r.fiscalYear}-12-31`,
      fiscal_year: r.fiscalYear,
      period: "FY",
      reported_currency: r.reportedCurrency ?? "UNKNOWN",
      data: JSON.stringify(Object.fromEntries(r.fields.filter((f) => f.value !== null).map((f) => [f.key, f.value]))),
      filing_date: null,
    }));

    const importFileName = safeFileName(fileName || "unknown.pdf");
    const importedAt = new Date().toISOString();
    const normalized = normalizeExtractedStatementReports({
      symbol: symbol.toUpperCase(),
      fileName: importFileName,
      reports,
      importedAt,
    });

    try {
      const stored = saveImportedFinancials(symbol, rows, {
        fileName: importFileName,
        importedAt,
        importedByUserId: req.user!.id,
        ...(workspaceId ? { workspaceId } : {}),
      });

      // The raw extracted rows above are the audit-of-record for what was
      // uploaded. The normalized observations are the values every other
      // panel (FinancialStatementsPanel, valuation) actually reads --
      // through the same financial_metric_overrides table the CSV/XLSX
      // BYOD import path (POST /api/finance/normalize, persist:true)
      // writes to. Without this, a committed PDF import silently never
      // appeared anywhere: the store above has no reader outside the
      // workspace-imports summary list.
      const ctx = tenantContext(req.user!);
      let persistedObservations = 0;
      await Promise.all(normalized.observations.map(async (observation) => {
        if (typeof observation.value !== "number" || !observation.asOf || !observation.period || !observation.source) return;
        await upsertFinancialMetricOverride(ctx, {
          symbol: symbol.toUpperCase(),
          metricId: observation.metricId,
          value: observation.value,
          period: observation.period,
          asOf: observation.asOf,
          source: observation.source,
          sourceUrl: observation.sourceUrl,
          currency: observation.currency,
          note: observation.note,
          status: "imported",
        });
        persistedObservations += 1;
      }));

      await recordAuditEvent(req.user!.id, "uide_statement_imported", {
        symbol: stored.symbol,
        fileName: importFileName,
        reportCount: rows.length,
        normalizedObservationCount: normalized.observations.length,
        normalizedRejectionCount: normalized.rejected.length,
        persistedObservationCount: persistedObservations,
        workspaceId,
        ...auditActor(req.user!),
      });

      res.json({ ...stored, persistedObservationCount: persistedObservations });
    } catch {
      res.status(409).json({ error: "Import could not be committed." });
    }
  });

  app.get("/api/uide/workspace-imports/:workspaceId", requireRole(...UIDE_READ_ROLES), (req, res) => {
    if (!workspaceOwned(req, res)) return;
    res.json(listImportsForWorkspace(String(req.params.workspaceId), req.user!.id));
  });

  app.post("/api/uide/fixtures/:id/classify", requireRole(...UIDE_AUTHOR_ROLES), async (req, res) => {
    const record = getFixture(String(req.params.id), req.user!.id);
    if (!record) {
      res.status(404).json({ error: "Fixture not found." });
      return;
    }

    const classification = await classifyDomain(record.profile);
    const updated = saveClassification(record.id, req.user!.id, classification);
    if (!updated) {
      res.status(404).json({ error: "Fixture not found." });
      return;
    }
    await recordAuditEvent(req.user!.id, "uide_file_classified", {
      fixtureId: record.id,
      fileName: record.fileName,
      topDomain: classification.candidates[0]?.slug,
      topDomainConfidence: classification.candidates[0]?.confidence,
      reasoningSource: classification.reasoningSource,
      ...auditActor(req.user!),
    });
    res.json(updated);
  });
}
