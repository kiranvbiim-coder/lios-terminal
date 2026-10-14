import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import * as XLSX from "xlsx";
import { artifactSpreadsheetToXlsxBytes } from "../client/src/lib/spreadsheetXlsx";
import { fromUniverWorkbookSnapshot, toUniverWorkbookProjection } from "@shared/univerArtifact";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { deriveSpreadsheetCellLineageStatus } from "@shared/spreadsheetCellLineage";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-spreadsheet-import-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const {
  SPREADSHEET_IMPORT_MAX_FILE_BYTES,
  detectSpreadsheetImportUnsupportedFeatures,
  importSpreadsheetArtifact,
  parseSpreadsheetArtifactImport,
} = await import("./spreadsheetArtifactImport");
const { createArtifactVersion, getArtifactVersion, listArtifactInteractionReceipts, listProjectArtifacts } = await import("./artifactStore");
const { registerArtifactRoutes } = await import("./artifactRoutes");

function twoSheetWorkbookBytes(): Buffer {
  const workbook = XLSX.utils.book_new();
  const model = XLSX.utils.aoa_to_sheet([
    ["Revenue", "Growth", "Projected"],
    [100, 0.15, null],
  ]);
  (model.B2 as XLSX.CellObject).z = "0.00%";
  model.C2 = { t: "n", f: "A2*(1+B2)", v: 115 };
  model["!ref"] = "A1:C2";

  const assumptions = XLSX.utils.aoa_to_sheet([
    ["WACC"],
    [0.1],
  ]);
  (assumptions.A2 as XLSX.CellObject).z = "0.0%";

  XLSX.utils.book_append_sheet(workbook, model, "Model");
  XLSX.utils.book_append_sheet(workbook, assumptions, "Assumptions");
  workbook.Workbook = { Names: [
    { Name: "Revenue", Ref: "'Model'!$A$2", Sheet: 0 },
    { Name: "Growth", Ref: "'Model'!$B$2", Sheet: 0 },
    { Name: "WACC", Ref: "'Assumptions'!$A$2" },
  ] };
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

test("S3 spreadsheet import preserves workbook structure and persists through P4", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const bytes = twoSheetWorkbookBytes();
  const parsed = parseSpreadsheetArtifactImport({
    bytes,
    originalName: "valuation-model.xlsx",
  });
  assert.deepEqual(parsed.content.sheets.map((sheet) => sheet.name), ["Model", "Assumptions"]);
  assert.equal(parsed.content.sheets[0]?.cells.C2?.raw, "=A2*(1+B2)");
  assert.equal(parsed.content.sheets[0]?.cells.B2?.raw, "0.15");
  assert.equal(parsed.content.sheets[0]?.cells.B2?.format, "0.00%");
  assert.equal(parsed.content.rendererPreference, "univer");
  assert.deepEqual(parsed.content.sheets[0]?.names, { Revenue: "A2", Growth: "B2" });
  assert.deepEqual(parsed.content.sheets[1]?.names, { WACC: "A2" });
  const uncached = XLSX.read(bytes, { type: "buffer", cellFormula: true, cellNF: true });
  uncached.Sheets.Model.C2 = { t: "s", f: "A2*(1+B2)" };
  const uncachedBytes = Buffer.from(XLSX.write(uncached, { type: "buffer", bookType: "xlsx" }));
  const uncachedImport = parseSpreadsheetArtifactImport({ bytes: uncachedBytes, originalName: "uncached.xlsx" });
  assert.equal(uncachedImport.content.sheets[0].cells.C2.raw, "=A2*(1+B2)", "uncached formulas survive canonical reimport");

  const csvParsed = parseSpreadsheetArtifactImport({
    bytes: Buffer.from("Name,Revenue\nAlpha,125\nBeta,150\n", "utf8"),
    originalName: "revenue.csv",
  });
  assert.equal(csvParsed.content.sheets.length, 1);
  assert.equal(csvParsed.content.sheets[0]?.cells.A2?.raw, "Alpha");
  assert.equal(csvParsed.content.sheets[0]?.cells.B3?.raw, "150");

  const featureWorkbook = XLSX.utils.book_new() as XLSX.WorkBook & { files?: Record<string, unknown> };
  featureWorkbook.files = {
    "xl/charts/chart1.xml": {},
    "xl/pivotTables/pivotTable1.xml": {},
    "xl/externalLinks/externalLink1.xml": {},
  };
  assert.deepEqual(
    detectSpreadsheetImportUnsupportedFeatures(featureWorkbook).sort(),
    ["charts", "external_links", "pivot_tables"],
  );

  assert.throws(
    () => parseSpreadsheetArtifactImport({ bytes, originalName: "macro-model.xlsm" }),
    /Macro-enabled .* not imported/i,
  );
  assert.throws(
    () => parseSpreadsheetArtifactImport({
      bytes: Buffer.alloc(SPREADSHEET_IMPORT_MAX_FILE_BYTES + 1, 0x61),
      originalName: "too-large.csv",
    }),
    /exceeds .* import limit/i,
  );

  const [user] = await getDb().insert(users).values({
    email: `${crypto.randomUUID()}@example.com`,
    passwordHash: "spreadsheet-import-test-hash",
    role: "internal_analyst",
    organizationId: null,
    name: "Spreadsheet Import User",
  }).returning();
  const tenant = { userId: user.id, organizationId: null, role: user.role };
  const project = await createProject(tenant, { name: "Spreadsheet Import Project" });

  const imported = await importSpreadsheetArtifact(tenant, project.id, {
    bytes,
    originalName: "valuation-model.xlsx",
  });
  assert.equal(imported.artifact.origin, "import");
  assert.equal(imported.artifact.kind, "spreadsheet");
  assert.equal(imported.version.adapterId, "lios.spreadsheet.univer");
  assert.ok(imported.version.sourceRefs.includes("import:file:valuation-model.xlsx"));
  assert.ok(imported.version.sourceRefs.some((ref) => ref.startsWith("import:sha256:")));
  assert.ok(imported.version.sourceRefs.some((ref) => ref.startsWith("imported-at:")));

  const recovered = await getArtifactVersion(tenant, imported.artifact.id);
  assert.deepEqual(
    (recovered.content as typeof parsed.content).sheets.map((sheet) => sheet.name),
    ["Model", "Assumptions"],
  );
  assert.equal((recovered.content as typeof parsed.content).sheets[0]?.cells.C2?.raw, "=A2*(1+B2)");
  assert.deepEqual((recovered.content as typeof parsed.content).sheets[0]?.names, { Revenue: "A2", Growth: "B2" });
  assert.deepEqual((recovered.content as typeof parsed.content).sheets[1]?.names, { WACC: "A2" });

  const editedContent = structuredClone(recovered.content as typeof parsed.content);
  editedContent.sheets[0]!.cells.A2 = { raw: "120", format: editedContent.sheets[0]!.cells.A2?.format ?? null };
  const revision = await createArtifactVersion(tenant, {
    artifactId: imported.artifact.id,
    baseVersion: recovered.version,
    content: editedContent,
    actorType: "user",
    note: "Acceptance edit after spreadsheet import.",
  });
  assert.equal(revision.version, 2);
  const reloadedAfterEdit = await getArtifactVersion(tenant, imported.artifact.id);
  assert.equal(reloadedAfterEdit.version, 2);
  assert.equal((reloadedAfterEdit.content as typeof parsed.content).sheets[0]?.cells.A2?.raw, "120");
  assert.equal((reloadedAfterEdit.content as typeof parsed.content).sheets[0]?.cells.B2?.format, "0.00%");
  assert.equal((reloadedAfterEdit.content as typeof parsed.content).sheets[0]?.cells.C2?.raw, "=A2*(1+B2)");
  assert.deepEqual((reloadedAfterEdit.content as typeof parsed.content).sheets[0]?.names, { Revenue: "A2", Growth: "B2" });

  const receipts = await listArtifactInteractionReceipts(tenant, imported.artifact.id);
  assert.ok(receipts.some((receipt) => receipt.action === "import"));

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => {
    const authenticatedRequest = req as typeof req & { isAuthenticated: () => boolean; user?: Express.User };
    authenticatedRequest.isAuthenticated = () => true;
    authenticatedRequest.user = user as Express.User;
    next();
  });
  registerArtifactRoutes(app);

  let server: Server | null = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    server = null;
  });

  const endpoint = `http://127.0.0.1:${address.port}/api/projects/${project.id}/artifacts/import-spreadsheet`;
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "http-import.xlsx",
  );
  const response = await fetch(endpoint, { method: "POST", body: form });
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const routeImported = JSON.parse(responseText) as {
    artifact: { id: string; origin: string };
    version: { adapterId: string };
    import: { sheets: number };
  };
  assert.equal(routeImported.artifact.origin, "import");
  assert.equal(routeImported.version.adapterId, "lios.spreadsheet.univer");
  assert.equal(routeImported.import.sheets, 2);

  const beforeMacro = (await listProjectArtifacts(tenant, project.id)).length;
  const macroForm = new FormData();
  macroForm.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "application/vnd.ms-excel.sheet.macroEnabled.12" }),
    "macro-model.xlsm",
  );
  const macroResponse = await fetch(endpoint, { method: "POST", body: macroForm });
  assert.equal(macroResponse.status, 400);
  assert.match((await macroResponse.json() as { error: string }).error, /Macro-enabled .* not imported/i);
  assert.equal((await listProjectArtifacts(tenant, project.id)).length, beforeMacro, "refused import must not create an Artifact");
});

test("real XLSX defined names retain quoted sheets and local scopes without guessing formula ownership", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[100], [15]]), "Owner's Model");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[20], [25]]), "Inputs");
  workbook.Workbook = { Names: [
    { Name: "Revenue", Ref: "'Owner''s Model'!$A$1:$A$2", Sheet: 0 },
    { Name: "Revenue", Ref: "'Inputs'!$A$1", Sheet: 1 },
    { Name: "InputValues", Ref: "'Inputs'!$A$1:$A$2" },
    { Name: "OtherInput", Ref: "'Inputs'!$A$2", Sheet: 0 },
    { Name: "Print_Area", Ref: "'Inputs'!$A$1", Sheet: 1 },
    { Name: "_xlnm.Print_Area", Ref: "'Inputs'!$A$1:$A$2", Sheet: 1 },
  ] };
  const serialize = () => Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  const parsed = parseSpreadsheetArtifactImport({ bytes: serialize(), originalName: "named.xlsx" });
  assert.deepEqual(parsed.content.sheets[0].names, { Revenue: "A1:A2", OtherInput: "'Inputs'!$A$2" });
  assert.deepEqual(parsed.content.sheets[1].names, { Revenue: "A1", InputValues: "A1:A2", Print_Area: "A1" });
  assert.deepEqual(parsed.unsupportedFeatures, ["defined_names"]);
  for (const defined of [
    { Name: "Ambiguous", Ref: "$A$1" },
    { Name: "External", Ref: "'[1]Inputs'!$A$1", Sheet: 0 },
    { Name: "Formula", Ref: "SUM('Inputs'!$A$1:$A$2)", Sheet: 0 },
    { Name: "OutOfBounds", Ref: "'Inputs'!$A$100001", Sheet: 1 },
    { Name: "BadScope", Ref: "'Inputs'!$A$1", Sheet: 20 },
  ]) {
    workbook.Workbook.Names = [defined];
    assert.throws(() => parseSpreadsheetArtifactImport({ bytes: serialize(), originalName: "unsupported.xlsx" }),
      /Defined name .* (?:unsupported|ambiguous|bounds)/);
  }
});

test("canonical named workbook export reopens through trusted SheetJS import with active sheet and calculation behavior", () => {
  const source = parseSpreadsheetArtifactImport({ bytes: twoSheetWorkbookBytes(), originalName: "model.xlsx" }).content;
  source.activeSheetId = source.sheets[1].id;
  source.calculationMode = "manual";
  source.sheets[0].cells.C2 = { raw: "=Revenue*(1+Growth)", format: "0.00" };
  source.sheets[1].cells.A3 = { raw: "12345678901234567890.123456789", format: "@" };
  source.sheets[1].rowCount = 3;
  const reopened = parseSpreadsheetArtifactImport({
    bytes: Buffer.from(artifactSpreadsheetToXlsxBytes(source)), originalName: "reopened.xlsx",
  }).content;
  assert.deepEqual(reopened, source);
  assert.deepEqual(fromUniverWorkbookSnapshot(toUniverWorkbookProjection(reopened), reopened, reopened.activeSheetId), source);
});

test("XLSX import preserves visible lineage as historical declarations without verifying dataset ownership", () => {
  const lineage = {
    kind: "reported_actual", custody: "server_projection", capturedRaw: "100", capturedFormat: "#,##0",
    datasetSnapshotId: "12345678-1234-4123-8123-123456789012", contentHash: "a".repeat(64),
    statement: "income_statement", canonicalKey: "revenue", sourcePath: "/annual/revenue",
    period: "FY2025", periodEnd: "2025-12-31", sourceRefs: ["citation:reported", "receipt:snapshot"],
  };
  const source = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", activeSheetId: "owned-sheet",
    sheets: [{ id: "owned-sheet", name: "Model", cells: { A1: { raw: "100", format: "#,##0", lineage } } }],
  });
  const workbook = XLSX.read(artifactSpreadsheetToXlsxBytes(source), { type: "array", raw: true, cellNF: true });
  const serialize = () => Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  const imported = parseSpreadsheetArtifactImport({ bytes: serialize(), originalName: "historical.xlsx" }).content;
  const cell = imported.sheets[0].cells.A1;
  assert.deepEqual(cell.lineage, { ...source.sheets[0].cells.A1.lineage, custody: "imported_history" });
  assert.equal(deriveSpreadsheetCellLineageStatus(cell), "historical_unverified");
  assert.notEqual(imported.sheets[0].id, "owned-sheet", "file metadata cannot restore canonical P4 sheet identity");
  assert.deepEqual(imported.sheets[1].cells, parseSpreadsheetArtifactImport({
    bytes: Buffer.from(artifactSpreadsheetToXlsxBytes(source)), originalName: "visible.xlsx",
  }).content.sheets[1].cells, "appendix survives as a user-visible worksheet");
  workbook.Sheets.Model.A1.v = 120;
  const edited = parseSpreadsheetArtifactImport({ bytes: serialize(), originalName: "edited.xlsx" }).content;
  assert.equal(edited.sheets[0].cells.A1.raw, "120");
  assert.equal(edited.sheets[0].cells.A1.lineage?.capturedRaw, "100");
  assert.equal(deriveSpreadsheetCellLineageStatus(edited.sheets[0].cells.A1), "edited_unverified");
  const appendix = workbook.Sheets["__LiOS Provenance"];
  const fieldRow = Object.entries(appendix).find(([ref, candidate]) => /^E\d+$/.test(ref) && (candidate as XLSX.CellObject).v === "datasetSnapshotId");
  assert.ok(fieldRow);
  const valueRef = fieldRow[0].replace("E", "H");
  appendix[valueRef].v = JSON.stringify("not-an-owned-dataset");
  const malformed = parseSpreadsheetArtifactImport({ bytes: serialize(), originalName: "malformed.xlsx" }).content;
  assert.equal(malformed.sheets[0].cells.A1.lineage, undefined);
  assert.equal(malformed.sheets[1].cells[valueRef].raw, JSON.stringify("not-an-owned-dataset"),
    "unusable metadata remains visible rather than being discarded or promoted to authority");
});
