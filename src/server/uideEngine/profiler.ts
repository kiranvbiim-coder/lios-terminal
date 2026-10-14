/**
 * UIDE -- ingestion + column profiler + workbook structure analysis.
 *
 * Deterministic only: no LLM calls in this file. This is the layer every
 * later UIDE phase (domain classification, quality checks, completion)
 * reads from, so it needs to be cheap and reliable before anything
 * probabilistic gets layered on top. See the file-scenario fixture bank
 * (fixtureBank.ts) for how each parsed+profiled file gets kept as a
 * permanent regression case.
 *
 * A real spreadsheet is a WORKBOOK, not a table: it has multiple sheets,
 * and those sheets are not all the same shape. A "data" sheet (a
 * transaction list, an indicator time series) is tabular -- header row,
 * homogeneous columns, rows >> columns -- and the existing column profiler
 * handles that well. A hand-built financial model sheet (DCF, LBO,
 * three-statement) is laid out completely differently: labels down column
 * A, periods across the columns, formulas everywhere, often merged cells.
 * Running the column profiler on that shape produces nonsense. So every
 * sheet is classified by SHAPE first, and each shape gets its own
 * extractor -- see detectSheetShape() / extractTabularSheet() /
 * extractLayoutSheet().
 */
import * as XLSX from "xlsx";

export type ColumnType =
  | "numeric"
  | "currency"
  | "percentage"
  | "date"
  | "boolean"
  | "categorical"
  | "text"
  | "empty";

export interface ColumnProfile {
  name: string;
  inferredType: ColumnType;
  totalCount: number;
  nullCount: number;
  uniqueCount: number;
  isLikelyKey: boolean;
  sampleValues: string[];
  min: number | string | null;
  max: number | string | null;
}

export interface TabularSheetProfile {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  // SheetJS renames a blank header cell to "__EMPTY"/"__EMPTY_1" and a
  // repeated header name to "Name_1" -- both mean the sheet actually has a
  // multi-row header or two columns sharing a name, which silently
  // corrupts naive profiling. Surfaced as a warning rather than guessed at.
  duplicateOrBlankHeaderWarning: boolean;
}

export interface FormulaRef {
  cell: string;
  formula: string;
  referencedSheets: string[];
}

export interface LayoutSheetProfile {
  rowCount: number;
  columnCount: number;
  labels: string[];
  formulaCount: number;
  // Crude v1 signal, not exhaustive forensic analysis: a plain hardcoded
  // number sitting in a row where sibling cells are formulas -- the single
  // most common real error in client-submitted valuation models.
  hardcodedValueCount: number;
  detectedModelType: string | null;
  formulas: FormulaRef[];
}

export type SheetShape = "tabular" | "layout" | "empty";

export interface SheetProfile {
  sheetName: string;
  shape: SheetShape;
  tabular: TabularSheetProfile | null;
  layout: LayoutSheetProfile | null;
}

export interface CrossSheetReference {
  fromSheet: string;
  toSheet: string;
  count: number;
}

export interface WorkbookProfile {
  fileName: string;
  fileExt: string;
  sheetNames: string[];
  sheets: SheetProfile[];
  crossSheetReferences: CrossSheetReference[];
  parsedAt: string;
}

const SAMPLE_LIMIT = 500; // per-column values sampled for type inference
const PREVIEW_SAMPLE_COUNT = 5; // distinct sample values shown in the profile
const MAX_FORMULAS_PER_SHEET = 300; // bound profile size on huge models

const CURRENCY_RE = /^[+-]?[$€£¥]\s?-?[\d,]+(\.\d+)?$|^-?[\d,]+(\.\d+)?\s?[$€£¥]$/;
const PERCENTAGE_RE = /^-?[\d,]+(\.\d+)?\s?%$/;
const NUMERIC_RE = /^-?[\d,]+(\.\d+)?$/;
// Accounting notation: (1,250.00) means -1250. Optionally with a currency
// symbol inside or outside the parens -- ($1,250.00) / (1,250.00 USD-style).
const PAREN_NEGATIVE_RE = /^\(\s*[$€£¥]?\s?[\d,]+(\.\d+)?\s?\)$/;
// Abbreviated magnitude: "1.2M", "$45.6K", "3.4B" -- extremely common in
// exported finance/ops data (market cap, revenue) and previously fell
// through to `text` entirely since neither NUMERIC_RE nor CURRENCY_RE
// matches a trailing letter.
const ABBREVIATED_NUMBER_RE = /^[+-]?[$€£¥]?\s?[\d,]+(\.\d+)?\s?([KMBT])$/i;
const ISO_DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/;
const SLASH_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const MONTH_NAME = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const MONTH_DATE_RE = new RegExp(
  `^(?:(?:${MONTH_NAME})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{2,4}|\\d{1,2}\\s+(?:${MONTH_NAME})[a-z]*\\.?,?\\s+\\d{2,4})$`,
  "i",
);
const BOOLEAN_VALUES = new Set(["true", "false", "yes", "no", "y", "n"]);
const ABBREVIATION_MULTIPLIER: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

const CATEGORICAL_HINT_TYPES = new Set(["currency", "percentage", "date"]);

const MODEL_TYPE_KEYWORDS: Record<string, string[]> = {
  dcf: ["terminal value", "discount rate", "wacc", "free cash flow", "present value", "perpetuity growth"],
  lbo: ["sources and uses", "debt schedule", "leverage", "irr", "moic", "exit multiple"],
  three_statement: ["revenue", "cogs", "gross profit", "operating expense", "net income", "total assets", "total liabilities"],
  comps: ["ev/ebitda", "p/e", "trading comparables", "peer group", "multiple"],
};

export function supportedExtensions(): string[] {
  return ["csv", "tsv", "xlsx", "xls", "ods", "json", "txt"];
}

export function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

// ─── Text decoding ──────────────────────────────────────────────────────────

/** Strips a UTF-8 BOM and falls back to latin1 if the utf8 decode looks corrupted. */
function decodeText(buffer: Buffer): string {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const replacementCount = (text.match(/�/g) || []).length;
  if (replacementCount > 0 && replacementCount / Math.max(text.length, 1) > 0.001) {
    // A meaningful density of U+FFFD replacement characters means this
    // almost certainly wasn't valid UTF-8 to begin with (common for older
    // enterprise exports in Latin-1/Windows-1252). Retry with latin1 rather
    // than silently shipping mojibake.
    let retry = buffer.toString("latin1");
    if (retry.charCodeAt(0) === 0xfeff) retry = retry.slice(1);
    return retry;
  }
  return text;
}

// ─── Value classification (per-cell) ───────────────────────────────────────

function classifyValue(raw: unknown): ColumnType {
  if (raw === null || raw === undefined || raw === "") return "empty";
  if (raw instanceof Date) return "date";
  if (typeof raw === "number") return "numeric";
  if (typeof raw === "boolean") return "boolean";

  const str = String(raw).trim();
  if (str === "") return "empty";
  if (BOOLEAN_VALUES.has(str.toLowerCase())) return "boolean";
  if (PERCENTAGE_RE.test(str)) return "percentage";
  if (PAREN_NEGATIVE_RE.test(str)) return str.includes("$") || /[€£¥]/.test(str) ? "currency" : "numeric";
  if (CURRENCY_RE.test(str)) return "currency";
  if (ABBREVIATED_NUMBER_RE.test(str)) return /[$€£¥]/.test(str) ? "currency" : "numeric";
  if (NUMERIC_RE.test(str)) return "numeric";
  // Explicit patterns only -- deliberately not falling back to Date.parse,
  // which is permissive enough to misread short alphanumeric IDs (e.g. a
  // "machine_id" column full of "M-07") as dates. A missed exotic date
  // format is a smaller failure than mislabeling an identifier column.
  if (ISO_DATE_RE.test(str) || SLASH_DATE_RE.test(str) || MONTH_DATE_RE.test(str)) return "date";
  return "text";
}

function formatDateOnly(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toNumeric(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (raw instanceof Date) return raw.getTime();
  const str = String(raw ?? "").trim();
  if (str === "") return null;

  const parenMatch = str.match(PAREN_NEGATIVE_RE);
  if (parenMatch) {
    const inner = str.replace(/[()$€£¥\s]/g, "");
    const n = Number(inner.replace(/,/g, ""));
    return Number.isNaN(n) ? null : -n;
  }

  const abbrevMatch = str.match(ABBREVIATED_NUMBER_RE);
  if (abbrevMatch) {
    const cleaned = str.replace(/[$€£¥\s]/g, "");
    const unit = cleaned.slice(-1).toUpperCase();
    const numPart = cleaned.slice(0, -1).replace(/,/g, "");
    const n = Number(numPart);
    return Number.isNaN(n) ? null : n * (ABBREVIATION_MULTIPLIER[unit] ?? 1);
  }

  const cleaned = str.replace(/[$€£¥,%\s]/g, "");
  if (cleaned === "" || Number.isNaN(Number(cleaned))) return null;
  return Number(cleaned);
}

function profileColumn(name: string, values: unknown[]): ColumnProfile {
  const totalCount = values.length;
  const sample = values.slice(0, SAMPLE_LIMIT);

  const typeCounts = new Map<ColumnType, number>();
  for (const v of sample) {
    const t = classifyValue(v);
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }

  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nonNull = values.filter((v) => !(v === null || v === undefined || v === ""));
  const uniqueCount = new Set(nonNull.map((v) => (v instanceof Date ? v.getTime() : String(v)))).size;

  typeCounts.delete("empty");
  let inferredType: ColumnType = "empty";
  let bestCount = -1;
  const typeEntries = Array.from(typeCounts.entries());
  for (let i = 0; i < typeEntries.length; i++) {
    const [type, count] = typeEntries[i];
    if (count > bestCount) {
      inferredType = type;
      bestCount = count;
    }
  }

  if (inferredType === "text" && nonNull.length > 0) {
    const cardinalityRatio = uniqueCount / nonNull.length;
    if (uniqueCount <= 50 && cardinalityRatio < 0.2) inferredType = "categorical";
  }

  const isLikelyKey = nonNull.length > 1 && uniqueCount === nonNull.length;

  let min: number | string | null = null;
  let max: number | string | null = null;
  if (inferredType === "numeric" || inferredType === "currency" || inferredType === "percentage") {
    const nums = nonNull.map(toNumeric).filter((n): n is number => n !== null);
    if (nums.length) {
      min = Math.min(...nums);
      max = Math.max(...nums);
    }
  } else if (inferredType === "date") {
    const times = nonNull
      .map((v) => (v instanceof Date ? v.getTime() : Date.parse(String(v))))
      .filter((t) => !Number.isNaN(t));
    if (times.length) {
      min = formatDateOnly(Math.min(...times));
      max = formatDateOnly(Math.max(...times));
    }
  }

  const sampleValues = Array.from(new Set(nonNull.map((v) => (v instanceof Date ? formatDateOnly(v.getTime()) : String(v)))))
    .slice(0, PREVIEW_SAMPLE_COUNT);

  return { name, inferredType, totalCount, nullCount, uniqueCount, isLikelyKey, sampleValues, min, max };
}

function hasBlankOrDuplicateHeaders(columnNames: string[]): boolean {
  return columnNames.some((name) => /^__EMPTY(_\d+)?$/.test(name) || /_\d+$/.test(name));
}

function extractTabularSheet(rows: Record<string, unknown>[]): TabularSheetProfile {
  const columnNames = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columnNames.add(key);
  }
  const names = Array.from(columnNames);
  const columns = names.map((name) => profileColumn(name, rows.map((r) => r[name])));

  return {
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    duplicateOrBlankHeaderWarning: hasBlankOrDuplicateHeaders(names),
  };
}

// ─── Sheet shape detection ──────────────────────────────────────────────────

interface SheetGeometry {
  aoa: unknown[][];
  rowCount: number;
  columnCount: number;
  mergeCount: number;
  formulaCells: { addr: string; row: number; col: number; formula: string }[];
}

function sheetGeometry(sheet: XLSX.WorkSheet): SheetGeometry {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const rowCount = aoa.length;
  const columnCount = aoa.reduce((max, row) => Math.max(max, row.length), 0);
  const mergeCount = (sheet["!merges"] || []).length;

  const formulaCells: SheetGeometry["formulaCells"] = [];
  const ref = sheet["!ref"];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr] as XLSX.CellObject | undefined;
        if (cell?.f) formulaCells.push({ addr, row: r, col: c, formula: cell.f });
      }
    }
  }

  return { aoa, rowCount, columnCount, mergeCount, formulaCells };
}

/**
 * Tabular: header-like first row, rows far outnumber columns, formulas
 * sparse, no merges. Layout/model: label-heavy column A, formula-dense,
 * merges present, row:column ratio close to 1. Scored rather than a single
 * hard rule, tie-broken toward tabular (the safer default, since it reuses
 * the already-proven column profiler rather than the newer layout path).
 */
function detectShape(geo: SheetGeometry): SheetShape {
  const nonEmptyRows = geo.aoa.filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== ""));
  if (nonEmptyRows.length < 2 || geo.columnCount === 0) return "empty";

  const header = geo.aoa[0] || [];
  const headerCells = header.filter((c) => c !== null && c !== undefined && c !== "");
  const headerNonNumericRatio = headerCells.length
    ? headerCells.filter((c) => typeof c !== "number").length / headerCells.length
    : 0;
  const headerUniqueRatio = headerCells.length
    ? new Set(headerCells.map(String)).size / headerCells.length
    : 0;

  const bodyRows = geo.aoa.slice(1);
  const columnALabelRatio = bodyRows.length
    ? bodyRows.filter((row) => typeof row[0] === "string" && row[0] !== "").length / bodyRows.length
    : 0;

  const rowToColRatio = geo.rowCount / Math.max(geo.columnCount, 1);
  const formulaDensity = geo.formulaCells.length / Math.max(geo.rowCount, 1);

  let layoutScore = 0;
  let tabularScore = 0;

  if (geo.mergeCount > 0) layoutScore += 2;
  if (formulaDensity > 0.3) layoutScore += 2;
  if (columnALabelRatio > 0.6 && rowToColRatio < 3) layoutScore += 2;
  if (headerNonNumericRatio < 0.5) layoutScore += 1;

  if (headerNonNumericRatio >= 0.7 && headerUniqueRatio >= 0.7) tabularScore += 2;
  if (rowToColRatio >= 3) tabularScore += 2;
  if (formulaDensity < 0.05) tabularScore += 1;
  if (geo.mergeCount === 0) tabularScore += 1;

  return layoutScore > tabularScore ? "layout" : "tabular";
}

// ─── Layout/model sheet extraction ─────────────────────────────────────────

function detectModelType(labels: string[]): string | null {
  const joined = labels.join(" ").toLowerCase();
  let best: string | null = null;
  let bestHits = 0;
  for (const [modelType, keywords] of Object.entries(MODEL_TYPE_KEYWORDS)) {
    const hits = keywords.filter((k) => joined.includes(k)).length;
    if (hits > bestHits) {
      best = modelType;
      bestHits = hits;
    }
  }
  return bestHits > 0 ? best : null;
}

function extractLayoutSheet(sheet: XLSX.WorkSheet, geo: SheetGeometry): LayoutSheetProfile {
  const labels = geo.aoa
    .slice(1)
    .map((row) => row[0])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");

  const formulasByRow = new Map<number, { addr: string; formula: string }[]>();
  for (const fc of geo.formulaCells) {
    const list = formulasByRow.get(fc.row) ?? [];
    list.push({ addr: fc.addr, formula: fc.formula });
    formulasByRow.set(fc.row, list);
  }

  // Crude v1 hardcode signal: in any row that has at least 2 formula
  // cells, count sibling cells (same row, not column A) holding a plain
  // number with no formula -- the classic "someone typed over a formula"
  // pattern.
  let hardcodedValueCount = 0;
  for (const [row, formulas] of Array.from(formulasByRow.entries())) {
    if (formulas.length < 2) continue;
    const formulaCols = new Set(formulas.map((f: { addr: string; formula: string }) => XLSX.utils.decode_cell(f.addr).c));
    const dataRow = geo.aoa[row] || [];
    for (let c = 1; c < dataRow.length; c++) {
      if (formulaCols.has(c)) continue;
      if (typeof dataRow[c] === "number") hardcodedValueCount++;
    }
  }

  const formulas: FormulaRef[] = geo.formulaCells.slice(0, MAX_FORMULAS_PER_SHEET).map((fc) => ({
    cell: fc.addr,
    formula: fc.formula,
    referencedSheets: extractReferencedSheets(fc.formula),
  }));

  return {
    rowCount: geo.rowCount,
    columnCount: geo.columnCount,
    labels,
    formulaCount: geo.formulaCells.length,
    hardcodedValueCount,
    detectedModelType: detectModelType(labels),
    formulas,
  };
}

const SHEET_REF_RE = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))!/g;

function extractReferencedSheets(formula: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  SHEET_REF_RE.lastIndex = 0;
  while ((match = SHEET_REF_RE.exec(formula))) {
    const name = match[1] || match[2];
    if (name) found.add(name);
  }
  return Array.from(found);
}

// ─── Fixed-width text ───────────────────────────────────────────────────────

/**
 * No delimiter to split on, so column boundaries are inferred from visual
 * alignment: a character column that's blank (or past line-end) across
 * nearly every line is a field gap. Contiguous gap-runs become split
 * points. This is a standard heuristic for this format, not perfect --
 * genuinely ambiguous layouts fall back to fewer, wider columns rather
 * than guessing narrow ones.
 */
function parseFixedWidth(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const maxLen = Math.max(...lines.map((l) => l.length));
  const isGapColumn: boolean[] = [];
  for (let i = 0; i < maxLen; i++) {
    const blankCount = lines.filter((l) => i >= l.length || l[i] === " ").length;
    isGapColumn.push(blankCount / lines.length > 0.95);
  }

  const boundaries: number[] = [0];
  for (let i = 1; i < maxLen; i++) {
    if (isGapColumn[i] && !isGapColumn[i - 1]) boundaries.push(i);
  }
  boundaries.push(maxLen);

  const splitLine = (line: string): string[] => {
    const fields: string[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      fields.push(line.slice(boundaries[i], boundaries[i + 1]).trim());
    }
    return fields;
  };

  const headerFields = splitLine(lines[0]);
  const looksLikeHeader = headerFields.every((f) => f === "" || !/^-?[\d.,]+$/.test(f));
  const header = looksLikeHeader
    ? headerFields.map((f, i) => f || `col_${i + 1}`)
    : headerFields.map((_, i) => `col_${i + 1}`);
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const fields = splitLine(line);
    const row: Record<string, unknown> = {};
    header.forEach((name, i) => { row[name] = fields[i] === "" ? null : fields[i]; });
    return row;
  });
}

// ─── Top-level parsing ──────────────────────────────────────────────────────

interface RawSheet {
  name: string;
  rows: Record<string, unknown>[] | null; // header-object rows, for tabular candidates
  geometry: SheetGeometry | null; // structural view, for shape detection + layout extraction
  worksheet: XLSX.WorkSheet | null;
}

function parseAsWorkbook(buffer: Buffer, ext: string): RawSheet[] {
  const workbook = ext === "csv" || ext === "tsv"
    ? XLSX.read(decodeText(buffer), { type: "string", raw: true, FS: ext === "tsv" ? "\t" : "," })
    : XLSX.read(buffer, { type: "buffer", cellDates: true });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const geometry = sheetGeometry(sheet);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    return { name, rows, geometry, worksheet: sheet };
  });
}

function parseJsonWorkbook(buffer: Buffer): RawSheet[] {
  const text = decodeText(buffer);
  const parsed = JSON.parse(text);
  let rows: Record<string, unknown>[];
  if (Array.isArray(parsed)) {
    rows = parsed as Record<string, unknown>[];
  } else if (parsed && typeof parsed === "object") {
    const arrayField = Object.values(parsed).find((v) => Array.isArray(v));
    rows = arrayField ? (arrayField as Record<string, unknown>[]) : [parsed as Record<string, unknown>];
  } else {
    throw new Error("Unrecognized JSON shape -- expected an array of records.");
  }
  return [{ name: "Sheet1", rows, geometry: null, worksheet: null }];
}

function parseFixedWidthWorkbook(buffer: Buffer): RawSheet[] {
  const rows = parseFixedWidth(decodeText(buffer));
  return [{ name: "Sheet1", rows, geometry: null, worksheet: null }];
}

function buildSheetProfile(raw: RawSheet): SheetProfile {
  // JSON/fixed-width sheets carry no geometry (no spreadsheet structure to
  // inspect) -- always treated as tabular, which matches how those two
  // formats are constructed (they can't express a layout/model shape).
  if (!raw.geometry || !raw.worksheet) {
    const rows = raw.rows ?? [];
    if (rows.length === 0) {
      return { sheetName: raw.name, shape: "empty", tabular: null, layout: null };
    }
    return { sheetName: raw.name, shape: "tabular", tabular: extractTabularSheet(rows), layout: null };
  }

  const shape = detectShape(raw.geometry);
  if (shape === "empty") {
    return { sheetName: raw.name, shape, tabular: null, layout: null };
  }
  if (shape === "layout") {
    return { sheetName: raw.name, shape, tabular: null, layout: extractLayoutSheet(raw.worksheet, raw.geometry) };
  }
  return { sheetName: raw.name, shape, tabular: extractTabularSheet(raw.rows ?? []), layout: null };
}

function buildCrossSheetReferences(rawSheets: RawSheet[], sheetNames: string[]): CrossSheetReference[] {
  const nameSet = new Set(sheetNames);
  const counts = new Map<string, number>();

  for (const raw of rawSheets) {
    if (!raw.geometry) continue;
    for (const fc of raw.geometry.formulaCells) {
      for (const referenced of extractReferencedSheets(fc.formula)) {
        if (!nameSet.has(referenced) || referenced === raw.name) continue;
        const key = `${raw.name} ${referenced}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries()).map(([key, count]) => {
    const [fromSheet, toSheet] = key.split(" ");
    return { fromSheet, toSheet, count };
  });
}

export function ingestAndProfile(buffer: Buffer, fileName: string): { profile: WorkbookProfile } {
  const ext = extOf(fileName);
  if (!supportedExtensions().includes(ext)) {
    throw new Error(`Unsupported file type ".${ext}". Supported: ${supportedExtensions().join(", ")}`);
  }

  let rawSheets: RawSheet[];
  if (ext === "json") {
    rawSheets = parseJsonWorkbook(buffer);
  } else if (ext === "txt") {
    rawSheets = parseFixedWidthWorkbook(buffer);
  } else {
    rawSheets = parseAsWorkbook(buffer, ext);
  }

  const sheetNames = rawSheets.map((s) => s.name);
  const sheets = rawSheets.map(buildSheetProfile);
  const crossSheetReferences = buildCrossSheetReferences(rawSheets, sheetNames);

  const profile: WorkbookProfile = {
    fileName,
    fileExt: ext,
    sheetNames,
    sheets,
    crossSheetReferences,
    parsedAt: new Date().toISOString(),
  };

  return { profile };
}
