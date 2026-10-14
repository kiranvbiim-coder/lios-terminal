export type VisualizationIntent = "context" | "diagnostic" | "primary";

export interface VisualizationIntentPolicy {
  intent: VisualizationIntent;
  purpose: string;
  maxInlineHeightPx: number | null;
  allowedOnMonitorSurface: boolean;
}

/**
 * Product-level visualization grammar.
 *
 * CONTEXT: a glanceable micro-visual that helps orient the user but must never
 * become the screen's job. Monitoring/overview screens may use these.
 *
 * DIAGNOSTIC: a model-validation or interpretation visual that belongs beside
 * the calculation it explains (residuals, distributions, frontiers, drawdowns,
 * sensitivity surfaces, etc.). It belongs in a workstation, not an overview.
 *
 * PRIMARY: the visualization is itself the analytical task (full charting,
 * historical investigation, curve work, correlation/regression exploration).
 */
export const VISUALIZATION_INTENT_POLICIES: Record<VisualizationIntent, VisualizationIntentPolicy> = {
  context: {
    intent: "context",
    purpose: "Orient the analyst without displacing the monitoring task.",
    maxInlineHeightPx: 96,
    allowedOnMonitorSurface: true,
  },
  diagnostic: {
    intent: "diagnostic",
    purpose: "Explain, validate, or challenge a model output inside its workstation.",
    maxInlineHeightPx: null,
    allowedOnMonitorSurface: false,
  },
  primary: {
    intent: "primary",
    purpose: "Make visual investigation the main analytical task.",
    maxInlineHeightPx: null,
    allowedOnMonitorSurface: false,
  },
};

/**
 * Explicit monitor surfaces guarded by static CI. Add a path here whenever a
 * new overview/monitor is introduced so a large generic chart cannot quietly
 * turn it into a second chart workstation.
 */
export const MONITOR_VISUALIZATION_SURFACES = [
  "client/src/components/panels/MarketOverview.tsx",
  "client/src/components/panels/QuotePanel.tsx",
  "client/src/components/panels/EconomicsOverviewPanel.tsx",
] as const;

export const MONITOR_CONTEXT_MAX_HEIGHT_PX = VISUALIZATION_INTENT_POLICIES.context.maxInlineHeightPx ?? 96;

export function canUseVisualizationIntentOnMonitor(intent: VisualizationIntent): boolean {
  return VISUALIZATION_INTENT_POLICIES[intent].allowedOnMonitorSurface;
}
