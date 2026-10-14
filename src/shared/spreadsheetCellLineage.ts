import type { ArtifactContent, SpreadsheetCell } from "./artifactContracts";

export type SpreadsheetContent = Extract<ArtifactContent, { kind: "spreadsheet" }>;
export const SPREADSHEET_LINEAGE_APPENDIX_MARKER = "LiOS cell lineage metadata v1";
export const SPREADSHEET_LINEAGE_APPENDIX_COLUMNS = ["Sheet ID", "Sheet name", "Cell ref", "Derived status", "Field", "Part", "Parts", "Recorded value (JSON)"] as const;
export type SpreadsheetCellLineageStatus = "unbound" | "current" | "edited_unverified" | "historical_unverified" | "authored_unverified";

/** Current means the captured historical binding still matches, never live provider freshness. */
export function deriveSpreadsheetCellLineageStatus(cell: SpreadsheetCell): SpreadsheetCellLineageStatus {
  const lineage = cell.lineage;
  if (!lineage) return "unbound";
  if (cell.raw !== lineage.capturedRaw || cell.format !== lineage.capturedFormat) return "edited_unverified";
  if (lineage.custody === "imported_history") return "historical_unverified";
  if (lineage.custody === "user_authored") return "authored_unverified";
  return "current";
}

/** Identity is sheet ID + cell ref. Edits retain history, not the assertion of an unchanged value. */
export function mergeSpreadsheetCellLineage(base: SpreadsheetContent, next: SpreadsheetContent): SpreadsheetContent {
  const sheetsById = new Map(base.sheets.map(sheet => [sheet.id, sheet]));
  let changed = false;
  const sheets = next.sheets.map(sheet => {
    const previous = sheetsById.get(sheet.id);
    if (!previous) return sheet;
    let cells: typeof sheet.cells | undefined;
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const lineage = previous.cells[ref]?.lineage;
      if (lineage && cell.lineage !== lineage) {
        cells ??= { ...sheet.cells };
        cells[ref] = { ...cell, lineage };
      }
    }
    if (!cells) return sheet;
    changed = true;
    return { ...sheet, cells };
  });
  return changed ? { ...next, sheets } : next;
}

/** Generic authored writes cannot mint or replace server-verified source/run bindings. */
export function guardSpreadsheetCellLineage(base: SpreadsheetContent | null, next: SpreadsheetContent): SpreadsheetContent {
  const sheetsById = new Map(base?.sheets.map(sheet => [sheet.id, sheet]) ?? []);
  for (const sheet of next.sheets) for (const [ref, cell] of Object.entries(sheet.cells)) {
    const prior = sheetsById.get(sheet.id)?.cells[ref]?.lineage;
    if (prior) continue; // merge below restores the exact prior record, even after an edit.
    if (cell.lineage?.custody === "server_projection") throw new Error("New source-linked cell bindings require a verified persisted model projection.");
    if (cell.lineage?.custody === "user_authored" && (cell.lineage.kind !== "user_assumption" || cell.lineage.assumptionOrigin !== "user_authored")) {
      throw new Error("Authored cell lineage cannot claim a reported source or engine output.");
    }
  }
  return base ? mergeSpreadsheetCellLineage(base, next) : next;
}
