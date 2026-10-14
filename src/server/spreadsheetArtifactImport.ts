import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { z } from "zod";
import { spreadsheetArtifactContentSchema, spreadsheetCellLineageSchema, type ArtifactContent } from "@shared/artifactContracts";
import { SPREADSHEET_LINEAGE_APPENDIX_MARKER, SPREADSHEET_LINEAGE_APPENDIX_COLUMNS } from "@shared/spreadsheetCellLineage";
import type { TenantContext } from "./tenantContext";
import { createArtifact } from "./artifactStore";
import {
  runExecutionBackendRequest,
  type ExecutionBackendRunner,
} from "./exec/run-backend";
import type { ExecutionBackend, ExecutionBackendRequest } from "./exec/backends/types";
import { sandboxIsolationMode } from "./exec/sandbox-runtime-profile";
import {
  CLIENT_UPLOAD_LIMIT_BYTES,
  extensionOf,
  safeUploadFileName,
  validateUploadFileSignature,
} from "./uploadPolicy";

type SpreadsheetContent = Extract<ArtifactContent, { kind: "spreadsheet" }>;

export const SPREADSHEET_IMPORT_MAX_FILE_BYTES = CLIENT_UPLOAD_LIMIT_BYTES;
export const SPREADSHEET_IMPORT_MAX_SHEETS = 50;
export const SPREADSHEET_IMPORT_MAX_ROWS_PER_SHEET = 100_000;
export const SPREADSHEET_IMPORT_MAX_COLUMNS_PER_SHEET = 10_000;
export const SPREADSHEET_IMPORT_MAX_DEFINED_NAMES = 10_000;

export type SpreadsheetImportUnsupportedFeature = "charts" | "pivot_tables" | "external_links" | "defined_names";

export class SpreadsheetArtifactImportError extends Error {}

function importError(message: string): never {
  throw new SpreadsheetArtifactImportError(message);
}

export interface SpreadsheetArtifactImportInput {
  bytes: Buffer;
  originalName: string;
}

export interface ParsedSpreadsheetArtifactImport {
  content: SpreadsheetContent;
  fileName: string;
  sha256: string;
  importedAt: string;
  unsupportedFeatures: SpreadsheetImportUnsupportedFeature[];
}

export interface SpreadsheetImportIsolationOptions {
  backend: ExecutionBackend;
  sandboxNodePath?: string;
  /** Absolute in-image path to the approved SheetJS package/module entry. */
  sandboxXlsxModulePath?: string;
  runner?: ExecutionBackendRunner;
}

const spreadsheetCellSnapshotSchema = z.object({
  f: z.string().max(1_000_000).optional(),
  v: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  t: z.string().max(8).optional(),
  w: z.string().max(1_000_000).optional(),
  z: z.string().max(10_000).optional(),
}).strict();

const spreadsheetSheetSnapshotSchema = z.object({
  ref: z.string().max(128).nullable(),
  cells: z.record(spreadsheetCellSnapshotSchema),
}).strict();

const spreadsheetDefinedNameSnapshotSchema = z.object({
  Name: z.string().min(1).max(255),
  Ref: z.string().min(1).max(200),
  Sheet: z.number().int().min(0).optional(),
}).strict();

const spreadsheetWorkbookSnapshotSchema = z.object({
  sheetNames: z.array(z.string().min(1).max(255)),
  sheets: z.record(spreadsheetSheetSnapshotSchema),
  definedNames: z.array(spreadsheetDefinedNameSnapshotSchema).max(SPREADSHEET_IMPORT_MAX_DEFINED_NAMES).default([]),
  activeTab: z.number().int().min(0).optional(),
  calculationMode: z.enum(["automatic", "manual"]).default("automatic"),
  hasMacros: z.boolean(),
  unsupportedFeatures: z.array(z.enum(["charts", "pivot_tables", "external_links", "defined_names"])),
}).strict();

type SpreadsheetWorkbookSnapshot = z.infer<typeof spreadsheetWorkbookSnapshotSchema>;

const ISOLATED_SPREADSHEET_TIMEOUT_MS = 60_000;
const ISOLATED_SPREADSHEET_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const ISOLATED_SPREADSHEET_MEMORY_BYTES = 1024 * 1024 * 1024;
const ISOLATED_SPREADSHEET_MAX_PROCESSES = 16;
const ISOLATED_SPREADSHEET_RESULT = ".lios-spreadsheet-snapshot.json";

type WorkbookWithFiles = XLSX.WorkBook & {
  files?: Record<string, unknown>;
  vbaraw?: unknown;
};
type WorkbookMetadata = NonNullable<XLSX.WorkBook["Workbook"]> & {
  WBView?: Array<{ activeTab?: number }>;
  CalcPr?: { calcMode?: string };
};


function isReservedDefinedName(name: string): boolean {
  return /^_xlnm\.(?:Print_Area|Print_Titles|_FilterDatabase)$/i.test(name);
}

function workbookArchivePaths(workbook: XLSX.WorkBook): string[] {
  const files = (workbook as WorkbookWithFiles).files;
  return files ? Object.keys(files).map((path) => path.replaceAll("\\", "/").toLowerCase()) : [];
}

export function detectSpreadsheetImportUnsupportedFeatures(workbook: XLSX.WorkBook): SpreadsheetImportUnsupportedFeature[] {
  const paths = workbookArchivePaths(workbook);
  const features = new Set<SpreadsheetImportUnsupportedFeature>();
  if (paths.some((path) => path.includes("/charts/") || path.startsWith("xl/charts/"))) features.add("charts");
  if (paths.some((path) => path.includes("/pivottables/") || path.includes("/pivotcache"))) features.add("pivot_tables");
  if (paths.some((path) => path.includes("/externallinks/") || path.startsWith("xl/externallinks/"))) features.add("external_links");
  if (workbook.Workbook?.Names?.some((name) => isReservedDefinedName(name.Name))) features.add("defined_names");
  return [...features];
}

function hasMacros(workbook: XLSX.WorkBook): boolean {
  if ((workbook as WorkbookWithFiles).vbaraw) return true;
  return workbookArchivePaths(workbook).some((path) => path.endsWith("/vbaproject.bin") || path === "xl/vbaproject.bin");
}

function sheetDimensionsFromRef(ref: string | null): { rowCount: number; columnCount: number } {
  if (!ref) return { rowCount: 1, columnCount: 1 };
  let range: ReturnType<typeof XLSX.utils.decode_range>;
  try {
    range = XLSX.utils.decode_range(ref);
  } catch {
    importError("Spreadsheet worksheet dimensions are invalid.");
  }
  return {
    rowCount: Math.max(1, range.e.r + 1),
    columnCount: Math.max(1, range.e.c + 1),
  };
}

function snapshotWorkbook(workbook: XLSX.WorkBook): SpreadsheetWorkbookSnapshot {
  const sheets: SpreadsheetWorkbookSnapshot["sheets"] = {};
  const metadata = workbook.Workbook as WorkbookMetadata | undefined;
  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) importError(`Worksheet "${name}" could not be read.`);
    const cells: Record<string, z.infer<typeof spreadsheetCellSnapshotSchema>> = {};
    for (const [ref, candidate] of Object.entries(worksheet)) {
      if (ref.startsWith("!")) continue;
      const cell = candidate as XLSX.CellObject;
      cells[ref] = {
        ...(typeof cell.f === "string" ? { f: cell.f } : {}),
        ...(cell.v === null || ["string", "number", "boolean"].includes(typeof cell.v)
          ? { v: cell.v as string | number | boolean | null }
          : {}),
        ...(typeof cell.t === "string" ? { t: cell.t } : {}),
        ...(typeof cell.w === "string" ? { w: cell.w } : {}),
        ...(typeof cell.z === "string" ? { z: cell.z } : {}),
      };
    }
    sheets[name] = {
      ref: typeof worksheet["!ref"] === "string" ? worksheet["!ref"] : null,
      cells,
    };
  }
  return spreadsheetWorkbookSnapshotSchema.parse({
    sheetNames: [...workbook.SheetNames],
    sheets,
    definedNames: (workbook.Workbook?.Names ?? []).map(({ Name, Ref, Sheet }) => ({
      Name, Ref, ...(Sheet === undefined ? {} : { Sheet }),
    })),
    activeTab: metadata?.WBView?.[0]?.activeTab,
    calculationMode: metadata?.CalcPr?.calcMode === "manual" ? "manual" : "automatic",
    hasMacros: hasMacros(workbook),
    unsupportedFeatures: detectSpreadsheetImportUnsupportedFeatures(workbook),
  });
}

function snapshotCellRaw(cell: z.infer<typeof spreadsheetCellSnapshotSchema>): string {
  if (cell.f) return `=${cell.f}`;
  if (cell.v === undefined || cell.v === null) return "";
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "e") return cell.w ?? String(cell.v);
  return String(cell.v);
}

function importedDefinedNames(snapshot: SpreadsheetWorkbookSnapshot): Array<Record<string, string>> {
  const maps = snapshot.sheetNames.map(() => Object.create(null) as Record<string, string>);
  const seenNames = snapshot.sheetNames.map(() => new Set<string>());
  for (const defined of snapshot.definedNames) {
    if (isReservedDefinedName(defined.Name)) continue; // Explicitly reported as unsupported print/filter metadata.
    const qualified = /^(?:'((?:[^']|'')+)'|([^'!\[\]]+))!(.+)$/.exec(defined.Ref);
    const targetName = qualified ? (qualified[1]?.replaceAll("''", "'") ?? qualified[2]!) : null;
    const targetIndex = targetName === null ? defined.Sheet : snapshot.sheetNames.indexOf(targetName);
    const ownerIndex = defined.Sheet ?? targetIndex;
    const range = qualified ? qualified[3]! : defined.Ref;
    if (ownerIndex === undefined || targetIndex === undefined || !maps[ownerIndex] || !maps[targetIndex]) {
      importError(`Defined name "${defined.Name}" has unsupported or ambiguous worksheet scope.`);
    }
    if (!/^\$?[A-Z]{1,4}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,4}\$?[1-9]\d{0,6})?$/.test(range)) {
      importError(`Defined name "${defined.Name}" has an unsupported formula, external link, or non-cell-range target.`);
    }
    const canonicalRange = range.replaceAll("$", "");
    const decoded = XLSX.utils.decode_range(canonicalRange);
    if (decoded.s.r > decoded.e.r || decoded.s.c > decoded.e.c ||
        decoded.e.r >= SPREADSHEET_IMPORT_MAX_ROWS_PER_SHEET ||
        decoded.e.c >= SPREADSHEET_IMPORT_MAX_COLUMNS_PER_SHEET) {
      importError(`Defined name "${defined.Name}" exceeds the spreadsheet import bounds.`);
    }
    const names = maps[ownerIndex]!;
    const seen = seenNames[ownerIndex]!;
    if (seen.has(defined.Name.toLowerCase())) {
      importError(`Defined name "${defined.Name}" has conflicting scopes that cannot be preserved canonically.`);
    }
    seen.add(defined.Name.toLowerCase());
    names[defined.Name] = ownerIndex === targetIndex ? canonicalRange : defined.Ref;
  }
  return maps;
}

/**
 * The visible appendix travels through the existing bounded SheetJS snapshot.
 * File declarations can restore historical context, never server-owned custody.
 * Invalid or ambiguous records remain visible worksheet text without a binding.
 */
function importHistoricalCellLineage(
  snapshot: SpreadsheetWorkbookSnapshot,
  sheets: Array<Pick<SpreadsheetContent["sheets"][number], "name" | "rowCount" | "columnCount" | "cells">>,
): void {
  type FieldParts = { total: number; chunks: Map<number, string> };
  type RecordParts = { sheetName: string; ref: string; fields: Map<string, FieldParts>; invalid: boolean };
  const records = new Map<string, RecordParts>();
  for (const appendix of Object.values(snapshot.sheets)) {
    const marker = Object.entries(appendix.cells).find(([ref, cell]) =>
      /^A[1-9]\d*$/.test(ref) && cell.v === SPREADSHEET_LINEAGE_APPENDIX_MARKER && !cell.f);
    if (!marker) continue;
    const headerRow = Number(marker[0].slice(1)) + 1;
    if (!SPREADSHEET_LINEAGE_APPENDIX_COLUMNS.every((heading, index) =>
      appendix.cells[`${XLSX.utils.encode_col(index)}${headerRow}`]?.v === heading)) continue;
    for (const ref of Object.keys(appendix.cells)) {
      if (!/^A[1-9]\d*$/.test(ref)) continue;
      const row = Number(ref.slice(1));
      if (row <= headerRow) continue;
      const values = SPREADSHEET_LINEAGE_APPENDIX_COLUMNS.map((_, index) =>
        appendix.cells[`${XLSX.utils.encode_col(index)}${row}`]);
      if (values.some((cell) => !cell || cell.f || typeof cell.v !== "string")) continue;
      const [sheetId, sheetName, cellRef, , field, partRaw, totalRaw, chunk] = values.map((cell) => String(cell!.v));
      if (field === "currentRaw" || field === "currentFormat") continue;
      const key = JSON.stringify([sheetId, sheetName, cellRef]);
      let record = records.get(key);
      if (!record) {
        record = { sheetName, ref: cellRef, fields: new Map(), invalid: false };
        records.set(key, record);
      }
      const part = Number(partRaw), total = Number(totalRaw);
      if (!Number.isInteger(part) || !Number.isInteger(total) || part < 1 || total < part ||
          total > 8 || chunk.length > 32_000 || record.fields.size > 64) {
        record.invalid = true;
        continue;
      }
      let parts = record.fields.get(field);
      if (!parts) {
        parts = { total, chunks: new Map() };
        record.fields.set(field, parts);
      }
      if (parts.total !== total || parts.chunks.has(part)) record.invalid = true;
      parts.chunks.set(part, chunk);
    }
  }
  const targets = new Map<string, SpreadsheetContent["sheets"][number]["cells"][string]["lineage"] | null>();
  for (const record of records.values()) {
    const target = JSON.stringify([record.sheetName, record.ref]);
    if (targets.has(target)) {
      targets.set(target, null); // Conflicting declarations cannot pick a winner.
      continue;
    }
    targets.set(target, null);
    if (record.invalid) continue;
    const fields: Record<string, unknown> = Object.create(null);
    try {
      for (const [field, parts] of record.fields) {
        if (parts.chunks.size !== parts.total) throw new Error("Incomplete lineage field");
        fields[field] = JSON.parse(Array.from({ length: parts.total }, (_, index) => parts.chunks.get(index + 1)!).join(""));
      }
    } catch {
      continue;
    }
    const historical = spreadsheetCellLineageSchema.safeParse({ ...fields, custody: "imported_history" });
    if (historical.success) targets.set(target, historical.data);
  }
  for (const [target, lineage] of targets) {
    if (!lineage) continue;
    const [sheetName, ref] = JSON.parse(target) as [string, string];
    const sheet = sheets.find((candidate) => candidate.name === sheetName);
    if (!sheet || !/^[A-Z]{1,4}[1-9]\d{0,6}$/.test(ref)) continue;
    const address = XLSX.utils.decode_cell(ref);
    if (address.r >= sheet.rowCount || address.c >= sheet.columnCount) continue;
    sheet.cells[ref] = { ...(sheet.cells[ref] ?? { raw: "", format: null }), lineage };
  }
}

function snapshotToArtifactContent(snapshotInput: unknown): SpreadsheetContent {
  const snapshot = spreadsheetWorkbookSnapshotSchema.parse(snapshotInput);
  if (!snapshot.sheetNames.length) importError("The spreadsheet does not contain any worksheets.");
  if (snapshot.sheetNames.length > SPREADSHEET_IMPORT_MAX_SHEETS) {
    importError(`Spreadsheet has ${snapshot.sheetNames.length} sheets; the import limit is ${SPREADSHEET_IMPORT_MAX_SHEETS}.`);
  }
  if (new Set(snapshot.sheetNames).size !== snapshot.sheetNames.length) {
    importError("Spreadsheet contains duplicate worksheet names.");
  }

  const namesBySheet = importedDefinedNames(snapshot);
  const sheets = snapshot.sheetNames.map((name, index) => {
    const worksheet = snapshot.sheets[name];
    if (!worksheet) importError(`Worksheet "${name}" could not be read.`);
    const { rowCount, columnCount } = sheetDimensionsFromRef(worksheet.ref);
    if (rowCount > SPREADSHEET_IMPORT_MAX_ROWS_PER_SHEET) {
      importError(`Worksheet "${name}" has ${rowCount} rows; the import limit is ${SPREADSHEET_IMPORT_MAX_ROWS_PER_SHEET} rows per sheet.`);
    }
    if (columnCount > SPREADSHEET_IMPORT_MAX_COLUMNS_PER_SHEET) {
      importError(`Worksheet "${name}" has ${columnCount} columns; the import limit is ${SPREADSHEET_IMPORT_MAX_COLUMNS_PER_SHEET} columns per sheet.`);
    }

    const cells: SpreadsheetContent["sheets"][number]["cells"] = {};
    for (const [ref, cell] of Object.entries(worksheet.cells)) {
      let address: ReturnType<typeof XLSX.utils.decode_cell>;
      try {
        address = XLSX.utils.decode_cell(ref);
      } catch {
        importError(`Worksheet "${name}" contains an invalid cell address.`);
      }
      if (
        address.r + 1 > SPREADSHEET_IMPORT_MAX_ROWS_PER_SHEET ||
        address.c + 1 > SPREADSHEET_IMPORT_MAX_COLUMNS_PER_SHEET
      ) {
        importError(`Worksheet "${name}" contains a cell outside the import bounds.`);
      }
      const raw = snapshotCellRaw(cell);
      const format = typeof cell.z === "string" && cell.z.length ? cell.z : null;
      if (raw || format) cells[ref] = { raw, format };
    }

    return {
      id: `sheet-${index + 1}`,
      name,
      cells,
      names: namesBySheet[index],
      rowCount,
      columnCount,
    };
  });
  importHistoricalCellLineage(snapshot, sheets);

  return spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet",
    sheets,
    activeSheetId: sheets[snapshot.activeTab ?? 0]?.id ?? sheets[0]!.id,
    rendererPreference: "univer",
    calculationMode: snapshot.calculationMode,
  });
}

function workbookToArtifactContent(workbook: XLSX.WorkBook): SpreadsheetContent {
  return snapshotToArtifactContent(snapshotWorkbook(workbook));
}

function validateSpreadsheetImportInput(
  input: SpreadsheetArtifactImportInput,
): { fileName: string; extension: "xlsx" | "csv" } {
  const fileName = safeUploadFileName(input.originalName);
  const extension = extensionOf(fileName);
  if (extension === "xlsm") {
    importError("Macro-enabled .xlsm workbooks are not imported. Remove macros and save a clean .xlsx file before importing.");
  }
  if (extension !== "xlsx" && extension !== "csv") {
    importError("Only .xlsx and .csv spreadsheets can be imported here.");
  }
  if (!input.bytes.length) importError("The selected spreadsheet is empty.");
  if (input.bytes.byteLength > SPREADSHEET_IMPORT_MAX_FILE_BYTES) {
    importError(`Spreadsheet exceeds the ${Math.floor(SPREADSHEET_IMPORT_MAX_FILE_BYTES / (1024 * 1024))} MB import limit.`);
  }
  const signatureError = validateUploadFileSignature(input.bytes, extension);
  if (signatureError) importError(signatureError);
  return { fileName, extension };
}

export function parseSpreadsheetArtifactImport(input: SpreadsheetArtifactImportInput): ParsedSpreadsheetArtifactImport {
  if (sandboxIsolationMode() === "strict") {
    importError(
      "Strict SI-01.12 isolation requires parseSpreadsheetArtifactImportIsolated(); in-process SheetJS fallback is refused.",
    );
  }
  const { fileName } = validateSpreadsheetImportInput(input);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input.bytes, {
      type: "buffer",
      cellFormula: true,
      sheetStubs: true,
      cellNF: true,
      cellDates: false,
      raw: true,
      bookFiles: true,
      bookVBA: true,
    });
  } catch {
    importError("The spreadsheet could not be parsed. Check that the file is a valid XLSX or CSV file.");
  }

  if (hasMacros(workbook)) {
    importError("Macro-enabled workbooks are not imported. Remove macros and save a clean .xlsx file before importing.");
  }

  return {
    content: workbookToArtifactContent(workbook),
    fileName,
    sha256: crypto.createHash("sha256").update(input.bytes).digest("hex"),
    importedAt: new Date().toISOString(),
    unsupportedFeatures: detectSpreadsheetImportUnsupportedFeatures(workbook),
  };
}

function isolatedSpreadsheetWorkerScript(): string {
  return [
    "const fs = require('node:fs')",
    "const inputPath = process.argv[1]",
    "const outputPath = process.argv[2]",
    "const maxBytes = Number(process.argv[3])",
    "const XLSX = require(process.argv[4])",
    "const bytes = fs.readFileSync(inputPath)",
    "const workbook = XLSX.read(bytes,{type:'buffer',cellFormula:true,sheetStubs:true,cellNF:true,cellDates:false,raw:true,bookFiles:true,bookVBA:true})",
    "const paths = workbook.files ? Object.keys(workbook.files).map((p)=>p.replaceAll('\\\\','/').toLowerCase()) : []",
    "const unsupportedFeatures = []",
    "if (paths.some((p)=>p.includes('/charts/')||p.startsWith('xl/charts/'))) unsupportedFeatures.push('charts')",
    "if (paths.some((p)=>p.includes('/pivottables/')||p.includes('/pivotcache'))) unsupportedFeatures.push('pivot_tables')",
    "if (paths.some((p)=>p.includes('/externallinks/')||p.startsWith('xl/externallinks/'))) unsupportedFeatures.push('external_links')",
    "const definedNames = (workbook.Workbook?.Names || []).map(({Name,Ref,Sheet})=>({Name,Ref,...(Sheet===undefined?{}:{Sheet})}))",
    "if (definedNames.length > 10000) throw new Error('spreadsheet defined names exceed import limit')",
    "if (definedNames.some((n)=>/^_xlnm\\.(?:Print_Area|Print_Titles|_FilterDatabase)$/i.test(n.Name))) unsupportedFeatures.push('defined_names')",
    "const activeTab = workbook.Workbook?.WBView?.[0]?.activeTab",
    "const calculationMode = workbook.Workbook?.CalcPr?.calcMode === 'manual' ? 'manual' : 'automatic'",
    "const hasMacros = Boolean(workbook.vbaraw) || paths.some((p)=>p.endsWith('/vbaproject.bin')||p==='xl/vbaproject.bin')",
    "const sheets = {}",
    "for (const name of workbook.SheetNames) {",
    " const ws = workbook.Sheets[name]; if (!ws) throw new Error('missing worksheet')",
    " const cells = {}",
    " for (const [ref,c] of Object.entries(ws)) {",
    "  if (ref.startsWith('!')) continue",
    "  const out = {}",
    "  if (typeof c.f === 'string') out.f = c.f",
    "  if (c.v === null || ['string','number','boolean'].includes(typeof c.v)) out.v = c.v",
    "  if (typeof c.t === 'string') out.t = c.t",
    "  if (typeof c.w === 'string') out.w = c.w",
    "  if (typeof c.z === 'string') out.z = c.z",
    "  cells[ref] = out",
    " }",
    " sheets[name] = { ref: typeof ws['!ref'] === 'string' ? ws['!ref'] : null, cells }",
    "}",
    "const snapshot = {sheetNames:[...workbook.SheetNames],sheets,definedNames,activeTab,calculationMode,hasMacros,unsupportedFeatures}",
    "const serialized = JSON.stringify(snapshot)",
    "if (Buffer.byteLength(serialized,'utf8') > maxBytes) throw new Error('normalized spreadsheet snapshot exceeds output limit')",
    "fs.writeFileSync(outputPath, serialized, {encoding:'utf8',mode:0o600})",
  ].join("; ");
}

function buildSpreadsheetIsolationRequest(
  input: SpreadsheetArtifactImportInput,
  options: Pick<SpreadsheetImportIsolationOptions, "sandboxNodePath" | "sandboxXlsxModulePath"> = {},
): {
  request: ExecutionBackendRequest;
  fileName: string;
  extension: "xlsx" | "csv";
  root: string;
} {
  const { fileName, extension } = validateSpreadsheetImportInput(input);
  const nodePath = options.sandboxNodePath ?? "/usr/bin/node";
  if (!nodePath.startsWith("/") || nodePath.includes("\0")) {
    importError("Isolated spreadsheet Node path must be an absolute NUL-free path inside the sandbox image.");
  }
  const xlsxModulePath = options.sandboxXlsxModulePath ?? "/opt/lios/node_modules/xlsx";
  if (!xlsxModulePath.startsWith("/") || xlsxModulePath.includes("\0")) {
    importError("Isolated spreadsheet SheetJS module path must be an absolute NUL-free path inside the sandbox image.");
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-spreadsheet-isolated-"));
  const inputName = `input.${extension}`;
  try {
    fs.writeFileSync(path.join(root, inputName), input.bytes, { mode: 0o600 });
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }

  return {
    fileName,
    extension,
    root,
    request: {
      argv: [
        nodePath,
        "-e",
        isolatedSpreadsheetWorkerScript(),
        "/workspace/" + inputName,
        "/workspace/" + ISOLATED_SPREADSHEET_RESULT,
        String(ISOLATED_SPREADSHEET_MAX_OUTPUT_BYTES),
        xlsxModulePath,
      ],
      isolation: {
        filesystem: "sandbox",
        network: "deny",
        processes: "sandbox",
      },
      resources: {
        maxWallTimeMs: ISOLATED_SPREADSHEET_TIMEOUT_MS,
        maxCapturedOutputChars: 64 * 1024,
        maxMemoryBytes: ISOLATED_SPREADSHEET_MEMORY_BYTES,
        maxProcesses: ISOLATED_SPREADSHEET_MAX_PROCESSES,
      },
      workspaceTransfer: {
        root,
        inputs: [inputName],
        outputs: [ISOLATED_SPREADSHEET_RESULT],
        mode: "write-return",
        maxFileBytes: ISOLATED_SPREADSHEET_MAX_OUTPUT_BYTES,
        maxTotalBytes: ISOLATED_SPREADSHEET_MAX_OUTPUT_BYTES,
      },
    },
  };
}

export async function parseSpreadsheetArtifactImportIsolated(
  input: SpreadsheetArtifactImportInput,
  options: SpreadsheetImportIsolationOptions,
): Promise<ParsedSpreadsheetArtifactImport> {
  const built = buildSpreadsheetIsolationRequest(input, options);
  try {
    const runner = options.runner ?? runExecutionBackendRequest;
    const executed = await runner(options.backend, built.request);
    if (executed.exit.reason !== "exit" || executed.exit.exitCode !== 0) {
      const detail = executed.exit.stderr.trim().slice(0, 4_000);
      importError(
        detail
          ? `Isolated spreadsheet parser failed: ${detail}`
          : `Isolated spreadsheet parser failed (reason=${executed.exit.reason}, code=${executed.exit.exitCode ?? "null"}).`,
      );
    }
    const returned = executed.finalization.workspaceOutputs?.find(
      (file) => file.path === ISOLATED_SPREADSHEET_RESULT,
    );
    if (!returned) importError("Isolated spreadsheet parser did not return its declared normalized snapshot.");
    if (returned.size > ISOLATED_SPREADSHEET_MAX_OUTPUT_BYTES) {
      importError("Isolated spreadsheet normalized snapshot exceeded the output limit.");
    }

    let snapshot: SpreadsheetWorkbookSnapshot;
    try {
      snapshot = spreadsheetWorkbookSnapshotSchema.parse(JSON.parse(returned.data.toString("utf8")));
    } catch {
      importError("Isolated spreadsheet parser returned an invalid normalized snapshot.");
    }
    if (snapshot.hasMacros) {
      importError("Macro-enabled workbooks are not imported. Remove macros and save a clean .xlsx file before importing.");
    }

    return {
      content: snapshotToArtifactContent(snapshot),
      fileName: built.fileName,
      sha256: crypto.createHash("sha256").update(input.bytes).digest("hex"),
      importedAt: new Date().toISOString(),
      unsupportedFeatures: [...new Set(snapshot.unsupportedFeatures)],
    };
  } finally {
    fs.rmSync(built.root, { recursive: true, force: true });
  }
}

async function persistParsedSpreadsheetArtifact(
  ctx: TenantContext,
  projectId: number,
  parsed: ParsedSpreadsheetArtifactImport,
) {
  const title = parsed.fileName.replace(/\.(xlsx|csv)$/i, "").trim() || "Imported spreadsheet";
  const unsupportedSummary = parsed.unsupportedFeatures.length
    ? ` Unsupported workbook features not imported: ${parsed.unsupportedFeatures.join(", ")}.`
    : "";
  const created = await createArtifact(ctx, {
    projectId,
    title,
    content: parsed.content,
    origin: "import",
    adapterId: "lios.spreadsheet.univer",
    actorType: "user",
    sourceRefs: [
      `import:file:${parsed.fileName}`,
      `import:sha256:${parsed.sha256}`,
      `imported-at:${parsed.importedAt}`,
      ...parsed.unsupportedFeatures.map((feature) => `import:not-imported:${feature}`),
    ],
    note: `Imported ${parsed.fileName} at ${parsed.importedAt}; SHA-256 ${parsed.sha256}.${unsupportedSummary}`,
  });
  return {
    ...created,
    import: {
      fileName: parsed.fileName,
      sha256: parsed.sha256,
      importedAt: parsed.importedAt,
      unsupportedFeatures: parsed.unsupportedFeatures,
      sheets: parsed.content.sheets.length,
    },
  };
}

export async function importSpreadsheetArtifact(
  ctx: TenantContext,
  projectId: number,
  input: SpreadsheetArtifactImportInput,
) {
  return persistParsedSpreadsheetArtifact(
    ctx,
    projectId,
    parseSpreadsheetArtifactImport(input),
  );
}

export async function importSpreadsheetArtifactIsolated(
  ctx: TenantContext,
  projectId: number,
  input: SpreadsheetArtifactImportInput,
  options: SpreadsheetImportIsolationOptions,
) {
  return persistParsedSpreadsheetArtifact(
    ctx,
    projectId,
    await parseSpreadsheetArtifactImportIsolated(input, options),
  );
}
