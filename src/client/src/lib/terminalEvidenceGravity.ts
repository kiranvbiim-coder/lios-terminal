import type { ProvenanceRecord, CalculationReceipt } from "./terminalEvidence";
import type { ViewMode } from "./terminalTypes";
import { getTerminalCapability } from "./terminalCatalog";

export interface RankedEvidence<T> {
  item: T;
  score: number;
  reasons: string[];
}

function terms(view: ViewMode, symbol?: string): string[] {
  const capability = getTerminalCapability(view);
  return [capability.label, capability.shortLabel, capability.description, ...capability.keywords, symbol ?? ""]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
}

function scoreText(text: string, needles: readonly string[]): { score: number; reasons: string[] } {
  const normalized = text.toLowerCase();
  const matched = Array.from(new Set(needles.filter((needle) => normalized.includes(needle))));
  return { score: matched.length * 4, reasons: matched.slice(0, 4).map((item) => `Matches ${item}`) };
}

export function rankProvenanceForContext(items: readonly ProvenanceRecord[], view: ViewMode, symbol?: string): RankedEvidence<ProvenanceRecord>[] {
  const needles = terms(view, symbol);
  return items.map((item) => {
    const text = `${item.label} ${item.provider ?? ""} ${item.source} ${item.transformations.map((step) => `${step.label} ${step.description ?? ""}`).join(" ")} ${item.assumptions.join(" ")}`;
    const match = scoreText(text, needles);
    let score = match.score;
    const reasons = [...match.reasons];
    if (item.quality === "verified") { score += 5; reasons.push("Verified source"); }
    if (item.freshness === "live") { score += 4; reasons.push("Live data"); }
    if (item.freshness === "point-in-time") { score += 3; reasons.push("Point-in-time evidence"); }
    if (item.quality === "warning") score -= 2;
    if (item.freshness === "stale" || item.freshness === "unavailable") score -= 4;
    return { item, score, reasons };
  }).sort((a, b) => b.score - a.score);
}

export function rankReceiptsForContext(items: readonly CalculationReceipt[], view: ViewMode, symbol?: string): RankedEvidence<CalculationReceipt>[] {
  const needles = terms(view, symbol);
  return items.map((item) => {
    const text = `${item.label} ${item.engine} ${Object.keys(item.inputs).join(" ")} ${Object.keys(item.parameters).join(" ")} ${Object.keys(item.outputs).join(" ")}`;
    const match = scoreText(text, needles);
    let score = match.score + (item.warnings.length ? -1 : 3);
    const reasons = [...match.reasons];
    if (!item.warnings.length) reasons.push("No calculation warnings");
    return { item, score, reasons };
  }).sort((a, b) => b.score - a.score);
}
