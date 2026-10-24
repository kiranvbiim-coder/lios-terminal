import type { ArtifactContent } from "@shared/artifactContracts";

/**
 * Compact preview of one *already authorized*, exact saved P4 revision.
 * Never build this from chat metadata, list headings, a newer head or an AI
 * summary. No provider sourceRefs, raw cells, model inputs or credentials.
 */
export function recordedArtifactPreview(content: ArtifactContent): string | null {
  switch (content.kind) {
    case "chart": {
      const points = content.series.reduce((total, series) => total + series.points.length, 0);
      return `${content.chartType} chart · ${content.series.length} recorded series · ${points} recorded points`;
    }
    case "table":
      return `Table · ${content.rows.length} recorded rows · ${content.columns.length} columns`;
    case "spreadsheet":
      return `Spreadsheet · ${content.sheets.length} saved sheets`;
    case "data":
      return `Data · ${content.rowCount} declared rows · ${content.columns.length} columns`;
    case "portfolio":
      return `Portfolio · ${content.holdings.length} saved holdings`;
    case "valuation":
      return `Valuation · model ${content.modelId.slice(0, 80)}${content.symbol ? ` · ${content.symbol.slice(0, 32)}` : ""}`;
    case "research":
      return content.question.trim()
        ? `Research question · ${truncateLine(content.question)}`
        : `Research · ${content.blocks.length} saved blocks · ${content.evidence.length} recorded evidence entries`;
    case "report":
      return `Report · ${content.sections.length} sections · ${content.blocks.length} saved blocks`;
    case "backtest":
      return `Backtest · recorded status: ${content.status.replaceAll("_", " ")} · ${content.trades.length} saved trades`;
    case "strategy":
      return `Strategy · recorded validation: ${content.validation.status}`;
    case "decision":
      return `Decision objective · ${truncateLine(content.objective)}`;
    case "screen":
      return `Saved screen · ${truncateLine(content.view)}`;
    case "thesis":
      return `Thesis · recorded state: ${content.status}`;
    // Never invent a result for a type without a bounded, known shape.
    default:
      return null;
  }
}

function truncateLine(value: string): string {
  const oneLine = value.trim().replace(/\s+/g, " ");
  return oneLine.length > 108 ? `${oneLine.slice(0, 107)}…` : oneLine;
}
