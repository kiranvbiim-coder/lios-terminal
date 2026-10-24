import type { ICellData, IWorkbookData, LocaleType } from "@univerjs/presets";
import { spreadsheetArtifactContentSchema } from "./artifactContracts";
import type { ArtifactContent, SpreadsheetCell } from "./artifactContracts";
import type { IDefinedNameMapItem } from "@univerjs/engine-formula";

type SpreadsheetContent = Extract<ArtifactContent, { kind: "spreadsheet" }>;
const CELL_REF = /^([A-Z]{1,4})([1-9][0-9]{0,6})$/;
// DefinedNameDataController's native workbook resource, not a separate name store.
const SHEET_DEFINED_NAME_PLUGIN = "SHEET_DEFINED_NAME_PLUGIN";

function coordinates(ref: string): { row: number; column: number } {
  const match = CELL_REF.exec(ref);
  if (!match) throw new Error(`Invalid spreadsheet cell reference: ${ref}`);
  let column = 0;
  for (const character of match[1]!) column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

function reference(row: number, column: number): string {
  let letters = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  }
  return `${letters}${row + 1}`;
}

function normalizedDecimal(raw: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw)!;
  let digits = `${match[2]}${match[3] ?? ""}`.replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  const zeros = /0+$/.exec(digits)?.[0].length ?? 0;
  digits = digits.slice(0, digits.length - zeros);
  exponent += zeros;
  return `${match[1]}${digits}e${exponent}`;
}

function namedReference(sheetName: string, target: string): string {
  if (!/^\$?[A-Z]{1,4}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,4}\$?[1-9]\d{0,6})?$/.test(target)) return target;
  const absolute = target.replace(/\$?([A-Z]+)\$?(\d+)/g, (_match, column: string, row: string) => `$${column}$${row}`);
  return `'${sheetName.replaceAll("'", "''")}'!${absolute}`;
}

function dataCell(raw: string, format: string | null): ICellData {
  const cell: ICellData = raw.startsWith("=") ? { f: raw } : { v: raw, t: 1 };
  if (!raw.startsWith("=") && format !== "@") {
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
      const value = Number(raw);
      // Number is only a projection when its decimal serialization reproduces the exact source value.
      if (Number.isFinite(value) && normalizedDecimal(raw) === normalizedDecimal(String(value))) {
        cell.v = value;
        cell.t = 2;
      }
    } else if (/^(?:true|false)$/i.test(raw)) {
      cell.v = raw.toLowerCase() === "true";
      cell.t = 3;
    }
  }
  if (format) cell.s = { n: { pattern: format } };
  return cell;
}

/** The selected-cell inspector and immutable saves share the same exact-raw conversion. */
export function fromUniverCellData(cell: ICellData | null, priorCell: SpreadsheetCell | undefined, format: string | null): SpreadsheetCell {
  const source = priorCell ? dataCell(priorCell.raw, priorCell.format) : null;
  const raw = cell?.f ?? (cell?.v === undefined || cell.v === null ? "" : String(cell.v));
  const unchanged = source && (source.f ?? null) === (cell?.f ?? null)
    && (cell?.f || source.v === cell?.v);
  return { ...priorCell, raw: unchanged ? priorCell!.raw : raw, format };
}

/** P4 keeps state authoritative; Univer receives its real row/column matrix, not the old A1-keyed placeholder projection. */
export function toUniverWorkbookProjection(raw: unknown): IWorkbookData {
  const content = spreadsheetArtifactContentSchema.parse(raw);
  const sheets: IWorkbookData["sheets"] = {};
  const definedNames: IDefinedNameMapItem = Object.create(null);
  for (const sheet of content.sheets) {
    const cellData: Record<number, Record<number, ICellData>> = {};
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const { row, column } = coordinates(ref);
      if (row >= sheet.rowCount || column >= sheet.columnCount) throw new Error(`Cell ${ref} exceeds worksheet dimensions.`);
      (cellData[row] ??= {})[column] = dataCell(cell.raw, cell.format);
    }
    sheets[sheet.id] = { id: sheet.id, name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, cellData };
    for (const [name, target] of Object.entries(sheet.names)) {
      const id = JSON.stringify([sheet.id, name]);
      definedNames[id] = { id, name, localSheetId: sheet.id, formulaOrRefString: namedReference(sheet.name, target) };
    }
  }
  return {
    id: "lios-workbook", name: "LiOS Artifact", appVersion: "1.0.0-rc.0", locale: "enUS" as LocaleType,
    styles: {}, sheetOrder: content.sheets.map((sheet) => sheet.id), sheets,
    resources: [{ name: SHEET_DEFINED_NAME_PLUGIN, data: JSON.stringify(definedNames) }],
  };
}

/** Save edits through the existing immutable P4 revision API. Preserve original raw text and name maps when values are unchanged. */
export function fromUniverWorkbookSnapshot(snapshot: IWorkbookData, original: SpreadsheetContent, activeSheetId: string): SpreadsheetContent {
  const resource = snapshot.resources?.find((item) => item.name === SHEET_DEFINED_NAME_PLUGIN);
  const namesBySheet = new Map<string, Record<string, string>>();
  if (resource) {
    const definedNames: unknown = JSON.parse(resource.data || "{}");
    if (!definedNames || typeof definedNames !== "object" || Array.isArray(definedNames)) throw new Error("Invalid defined-name resource.");
    for (const id of snapshot.sheetOrder) namesBySheet.set(id, Object.create(null));
    for (const candidate of Object.values(definedNames)) {
      const name = candidate as Partial<IDefinedNameMapItem[string]> | null;
      if (!name || typeof name.name !== "string" || typeof name.formulaOrRefString !== "string" ||
          typeof name.localSheetId !== "string" || !namesBySheet.has(name.localSheetId)) {
        throw new Error("Defined name has unsupported worksheet scope.");
      }
      const owner = snapshot.sheets[name.localSheetId]!;
      const qualified = /^(?:'((?:[^']|'')+)'|([^'!\[\]]+))!(.+)$/.exec(name.formulaOrRefString);
      const targetSheet = qualified ? qualified[1]?.replaceAll("''", "'") ?? qualified[2] : null;
      const localRange = qualified?.[3];
      const target = targetSheet === owner.name && localRange &&
        /^\$?[A-Z]{1,4}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,4}\$?[1-9]\d{0,6})?$/.test(localRange)
        ? localRange.replaceAll("$", "") : name.formulaOrRefString;
      const names = namesBySheet.get(name.localSheetId)!;
      if (Object.keys(names).some((key) => key.toLowerCase() === name.name!.toLowerCase())) throw new Error("Duplicate defined name in worksheet scope.");
      names[name.name] = target;
    }
  }
  const sheets = snapshot.sheetOrder.map((id) => {
    const sheet = snapshot.sheets[id];
    if (!sheet) throw new Error(`Workbook is missing worksheet ${id}.`);
    const prior = original.sheets.find((candidate) => candidate.id === id);
    const cells: SpreadsheetContent["sheets"][number]["cells"] = {};
    const matrix = sheet.cellData as Record<string, Record<string, ICellData | null>> | undefined;
    for (const [rowText, rowData] of Object.entries(matrix ?? {})) {
      const row = Number(rowText);
      if (!Number.isInteger(row) || row < 0) throw new Error("Invalid worksheet row index.");
      for (const [columnText, cell] of Object.entries(rowData)) {
        if (!cell) continue;
        const column = Number(columnText);
        if (!Number.isInteger(column) || column < 0) throw new Error("Invalid worksheet column index.");
        if (row >= (sheet.rowCount ?? prior?.rowCount ?? 100) || column >= (sheet.columnCount ?? prior?.columnCount ?? 26)) {
          throw new Error(`Univer cell at row ${row + 1}, column ${column + 1} exceeds worksheet dimensions; no P4 revision was saved.`);
        }
        const ref = reference(row, column);
        const priorCell = prior?.cells[ref];
        const style = typeof cell.s === "string" ? snapshot.styles[cell.s] : cell.s;
        const converted = fromUniverCellData(cell, priorCell, style?.n?.pattern ?? null);
        // Provenance comes only from the canonical baseline at this sheet/ref, never donor cell metadata.
        // A cleared source-linked value retains historical lineage without reviving its captured raw.
        if (converted.raw || converted.format || converted.lineage) cells[ref] = converted;
      }
    }
    for (const [ref, cell] of Object.entries(prior?.cells ?? {})) {
      if (!cell.lineage || cells[ref]) continue;
      const { row, column } = coordinates(ref);
      if (row < (sheet.rowCount ?? prior!.rowCount) && column < (sheet.columnCount ?? prior!.columnCount)) {
        cells[ref] = { ...cell, raw: "", format: null };
      }
    }
    return { id, name: sheet.name ?? prior?.name ?? "Sheet", cells, names: namesBySheet.get(id) ?? prior?.names ?? {}, rowCount: sheet.rowCount ?? prior?.rowCount ?? 100, columnCount: sheet.columnCount ?? prior?.columnCount ?? 26 };
  });
  return spreadsheetArtifactContentSchema.parse({ ...original, sheets, activeSheetId, rendererPreference: "univer" });
}
