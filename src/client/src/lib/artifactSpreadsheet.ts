import type { SpreadsheetArtifactContent } from "@shared/artifactBridgeTypes";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { SpreadsheetGrid } from "./spreadsheetEngine";

export function artifactSheetToGrid(content: SpreadsheetArtifactContent, sheetId = content.activeSheetId): SpreadsheetGrid {
  const parsed = spreadsheetArtifactContentSchema.parse(content);
  const sheet = parsed.sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) throw new Error("Artifact sheet not found.");
  const grid = new SpreadsheetGrid();
  for (const [name, target] of Object.entries(sheet.names)) grid.defineName(name, target);
  for (const [ref, cell] of Object.entries(sheet.cells)) { grid.setCell(ref, cell.raw); if (cell.format) grid.setFormat(ref, cell.format); }
  return grid;
}
export function gridToArtifactSheet(content: SpreadsheetArtifactContent, grid: SpreadsheetGrid, sheetId = content.activeSheetId): SpreadsheetArtifactContent {
  const next = structuredClone(spreadsheetArtifactContentSchema.parse(content));
  const sheet = next.sheets.find((candidate) => candidate.id === sheetId);
  if (!sheet) throw new Error("Artifact sheet not found.");
  const priorCells = sheet.cells;
  sheet.cells = {};
  grid.getAllCells().forEach((cell, ref) => {
    sheet.cells[ref] = { ...priorCells[ref], raw: cell.raw, format: grid.getFormat(ref) };
  });
  // Blank formatted cells and cleared source-linked cells still carry canonical P4 history.
  grid.getAllFormats().forEach((format, ref) => {
    if (!sheet.cells[ref]) sheet.cells[ref] = { ...priorCells[ref], raw: "", format };
  });
  for (const [ref, cell] of Object.entries(priorCells)) {
    if (cell.lineage && !sheet.cells[ref]) sheet.cells[ref] = { ...cell, raw: "", format: null };
  }
  const priorNames = new Map(Object.entries(sheet.names).map(([name, target]) => [name.trim().toUpperCase(), { name, target }]));
  sheet.names = {};
  grid.getNames().forEach((target, name) => {
    const prior = priorNames.get(name);
    sheet.names[prior?.target === target ? prior.name : name] = target;
  });
  return spreadsheetArtifactContentSchema.parse(next);
}
