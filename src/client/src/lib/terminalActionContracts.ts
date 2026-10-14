import type { ViewMode } from "./terminalTypes";
import { getTerminalCapability } from "./terminalCatalog";
import { getRelatedToolActions, type ToolRelationship } from "./terminalToolGraph";

export type AnalyticalObjectKind =
  | "security"
  | "portfolio"
  | "economic-series"
  | "dataset"
  | "model-output"
  | "evidence"
  | "workspace"
  | "scenario"
  | "global";

export interface AnalyticalContext {
  kind: AnalyticalObjectKind;
  symbol?: string;
  objectId?: string;
  label?: string;
  asOf?: string;
  sourceView?: ViewMode;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export type AnalyticalOpenMode = "current" | "tab" | "split-right" | "split-below";

export interface AnalyticalTransferIntent {
  id: string;
  sourceView: ViewMode;
  targetView: ViewMode;
  relationship: ToolRelationship;
  context: AnalyticalContext;
  mode: AnalyticalOpenMode;
  reason: string;
  preserves: readonly string[];
  transformations: readonly string[];
  createdAt: number;
}

export interface CompatibleAnalyticalAction {
  view: ViewMode;
  label: string;
  shortLabel: string;
  relationship: ToolRelationship;
  reason: string;
  symbolAware: boolean;
  suggestedMode: AnalyticalOpenMode;
}

const PREFERRED_SPLITS = new Set<string>([
  "financialstatements:valuation",
  "valuation:peercomp",
  "chart:news",
  "portfolio:portfoliostress",
  "macrodashboard:indicatorexplorer",
  "supplychaindashboard:supplychainquant",
  "environmentdashboard:environmentquant",
]);

function normalizeSymbol(symbol: string | undefined): string | undefined {
  const normalized = symbol?.trim().toUpperCase();
  return normalized || undefined;
}

export function createAnalyticalContext(
  view: ViewMode,
  symbol?: string,
  overrides: Partial<AnalyticalContext> = {},
): AnalyticalContext {
  const capability = getTerminalCapability(view);
  const normalizedSymbol = normalizeSymbol(symbol);
  return {
    kind: normalizedSymbol && capability.symbolAware ? "security" : "global",
    symbol: normalizedSymbol && capability.symbolAware ? normalizedSymbol : undefined,
    sourceView: view,
    label: normalizedSymbol && capability.symbolAware
      ? `${normalizedSymbol} · ${capability.label}`
      : capability.label,
    ...overrides,
  };
}

export function getCompatibleAnalyticalActions(
  view: ViewMode,
  isInternal: boolean,
): CompatibleAnalyticalAction[] {
  return getRelatedToolActions(view, isInternal).map((action) => {
    const target = getTerminalCapability(action.view);
    const splitKey = `${view}:${action.view}`;
    return {
      view: action.view,
      label: target.label,
      shortLabel: target.shortLabel,
      relationship: action.relationship,
      reason: action.reason,
      symbolAware: target.symbolAware,
      suggestedMode: PREFERRED_SPLITS.has(splitKey) ? "split-right" : "current",
    };
  });
}

export function getOpenWithActions(view: ViewMode, isInternal: boolean): CompatibleAnalyticalAction[] {
  return getCompatibleAnalyticalActions(view, isInternal)
    .filter((action) => action.relationship === "next" || action.relationship === "related" || action.relationship === "evidence")
    .slice(0, 10);
}

export function getSendToActions(view: ViewMode, isInternal: boolean): CompatibleAnalyticalAction[] {
  return getCompatibleAnalyticalActions(view, isInternal)
    .filter((action) => action.relationship === "feeds" || action.relationship === "deliver" || action.relationship === "monitor")
    .slice(0, 10);
}

export function buildAnalyticalTransferIntent(input: {
  sourceView: ViewMode;
  targetView: ViewMode;
  relationship: ToolRelationship;
  context: AnalyticalContext;
  mode?: AnalyticalOpenMode;
  reason: string;
}): AnalyticalTransferIntent {
  const source = getTerminalCapability(input.sourceView);
  const target = getTerminalCapability(input.targetView);
  const normalizedSymbol = normalizeSymbol(input.context.symbol);
  const preserves = ["active analytical object"];
  if (normalizedSymbol && target.symbolAware) preserves.push("symbol");
  if (input.context.asOf) preserves.push("as-of date");
  if (input.context.objectId) preserves.push("object identity");

  return {
    id: `${Date.now()}-${input.sourceView}-${input.targetView}`,
    sourceView: input.sourceView,
    targetView: input.targetView,
    relationship: input.relationship,
    context: {
      ...input.context,
      symbol: normalizedSymbol && target.symbolAware ? normalizedSymbol : undefined,
    },
    mode: input.mode ?? (PREFERRED_SPLITS.has(`${input.sourceView}:${input.targetView}`) ? "split-right" : "current"),
    reason: input.reason,
    preserves,
    // V3 transfer contracts never silently mutate data. A future concrete
    // model adapter must explicitly list any transformation it performs.
    transformations: [],
    createdAt: Date.now(),
  };
}

export function describeAnalyticalTransfer(intent: AnalyticalTransferIntent): string {
  const source = getTerminalCapability(intent.sourceView);
  const target = getTerminalCapability(intent.targetView);
  const context = intent.context.symbol ? ` for ${intent.context.symbol}` : "";
  return `${source.label} → ${target.label}${context}. Preserves ${intent.preserves.join(", ")}. No hidden transformations.`;
}
