import type { SpreadsheetArtifactContent } from "@shared/artifactBridgeTypes";

/** Cell/name/worksheet edits change a P4 draft; navigation and renderer choice do not. */
export function spreadsheetDraftHasChanges(baseline: SpreadsheetArtifactContent, next: SpreadsheetArtifactContent): boolean {
  if (next.calculationMode !== baseline.calculationMode || next.sheets.length !== baseline.sheets.length) return true;
  for (let index = 0; index < next.sheets.length; index++) {
    const sheet = next.sheets[index]!;
    const prior = baseline.sheets[index]!;
    if (sheet.id !== prior.id || sheet.name !== prior.name || sheet.rowCount !== prior.rowCount || sheet.columnCount !== prior.columnCount) return true;
    if (Object.keys(sheet.names).length !== Object.keys(prior.names).length) return true;
    for (const [name, target] of Object.entries(sheet.names)) if (prior.names[name] !== target) return true;
    let priorCellCount = 0;
    for (const [ref, cell] of Object.entries(prior.cells)) {
      if (!cell.raw && !cell.format && !cell.lineage) continue;
      priorCellCount++;
      const edited = sheet.cells[ref];
      if (!edited || edited.raw !== cell.raw || edited.format !== cell.format) return true;
    }
    let nextCellCount = 0;
    for (const cell of Object.values(sheet.cells)) if (cell.raw || cell.format || cell.lineage) nextCellCount++;
    if (nextCellCount !== priorCellCount) return true;
  }
  return false;
}

/** Refetch equality includes historical lineage, but excludes renderer/navigation-only fields. Not a custody hash. */
export function spreadsheetContentComparisonKey(content: SpreadsheetArtifactContent): string {
  return JSON.stringify({ kind: content.kind, calculationMode: content.calculationMode, sheets: content.sheets }, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
}
