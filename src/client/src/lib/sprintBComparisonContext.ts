import type { AnalyticalSnapshot } from "./terminalChangeIntelligence";

/** Compare exact recorded capture contexts; the display must not imply unrelated fields share units. */
export function describeSnapshotPair(a: AnalyticalSnapshot | null, b: AnalyticalSnapshot | null) {
  if (!a || !b) return { kind: "incomplete" as const, message: "Capture or select two snapshots to compare." };
  const sameView = a.view === b.view;
  const sameSymbol = a.symbol.trim().toUpperCase() === b.symbol.trim().toUpperCase();
  if (sameView && sameSymbol) return {
    kind: "same-context" as const,
    message: "Both captures share an analytical view and symbol. Values are still recorded fields, not a verified model explanation.",
  };
  return {
    kind: "cross-context" as const,
    message: "These captures use different views or symbols. Identically named fields may have different units or definitions; no numeric comparison is shown by default.",
  };
}
