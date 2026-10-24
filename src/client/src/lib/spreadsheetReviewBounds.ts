import {
  spreadsheetCellDiffSchema,
  type ArtifactContent,
  type SpreadsheetCellDiff,
} from "@shared/artifactContracts";

type SpreadsheetContent = Extract<ArtifactContent, { kind: "spreadsheet" }>;

/** 
 * Review-diff controls are not a second spreadsheet engine. They may propose
 * ONLY cells that exist in the exact recorded worksheet dimensions.
 * The canonical base value and historical lineage are never synthesized.
 */
export function checkedSpreadsheetCellRef(
  sheet: SpreadsheetContent["sheets"][number] | undefined,
  ref: string,
): string | null {
  if (!sheet) return null;
  const normalized = ref.trim().toUpperCase();
  const parts = /^([A-Z]{1,4})([1-9][0-9]{0,6})$/.exec(normalized);
  if (!parts) return null;
  let column = 0;
  for (const letter of parts[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(parts[2]);
  if (row > sheet.rowCount || column > sheet.columnCount) return null;
  return normalized;
}

/** Throws a visible actionable error instead of sending a malformed P4 diff. */
export function prepareSpreadsheetCellReview(
  content: SpreadsheetContent,
  sheetId: string,
  rawRef: string,
  proposedRaw: string,
): SpreadsheetCellDiff {
  const sheet = content.sheets.find(item => item.id === sheetId);
  if (!sheet) throw new Error("The selected worksheet is no longer in this saved Artifact. Reload the revision.");
  const ref = checkedSpreadsheetCellRef(sheet, rawRef);
  if (!ref) throw new Error(`Cell ${rawRef.trim() || "(empty)"} is outside worksheet ${sheet.name} (${sheet.rowCount} rows × ${sheet.columnCount} columns). No review diff was created.`);
  if (proposedRaw.length > 100_000) throw new Error("The proposed cell exceeds the canonical 100,000-character limit. No review diff was created.");
  const before = sheet.cells[ref] ?? null;
  return spreadsheetCellDiffSchema.parse({
    sheetId: sheet.id,
    ref,
    before,
    after: { ...before, raw: proposedRaw, format: before?.format ?? null },
  });
}
