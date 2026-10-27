import type { AnalyticalSnapshot } from "./terminalChangeIntelligence";
import type { CalculationReceipt } from "./terminalEvidence";

/**
 * A cross-context warning acknowledgment only applies to the exact ordered
 * pair of recorded captures. Switching A/B or changing a snapshot revokes it.
 */
export function comparisonReviewKey(
  a: AnalyticalSnapshot | null | undefined,
  b: AnalyticalSnapshot | null | undefined,
): string | null {
  if (!a || !b) return null;
  const identity = (item: AnalyticalSnapshot) =>
    [item.id, item.capturedAt, item.view, item.symbol, item.values, item.metadata];
  return JSON.stringify([identity(a), identity(b)]);
}

/**
 * Never silently clamp an expired receipt selection to a different receipt.
 * A and B must refer to separate, currently published record identities.
 */
export function resolveRecordedReceiptPair(
  receipts: readonly CalculationReceipt[],
  indexA: number,
  indexB: number,
): readonly [CalculationReceipt, CalculationReceipt] | null {
  if (!Number.isSafeInteger(indexA) || !Number.isSafeInteger(indexB)) return null;
  if (indexA < 0 || indexB < 0 || indexA === indexB) return null;
  const a = receipts[indexA];
  const b = receipts[indexB];
  return a && b && a.id !== b.id ? [a, b] : null;
}
