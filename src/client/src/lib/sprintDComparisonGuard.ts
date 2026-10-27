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
 * Compare by immutable published receipt identity, never array position.
 * New calculations are prepended to the evidence store; index selections can
 * silently drift to another model after a receipt is published or revoked.
 * Missing, duplicate, or replaced identities must require a new selection.
 */
export function resolveRecordedReceiptPair(
  receipts: readonly CalculationReceipt[],
  idA: string | null,
  idB: string | null,
): readonly [CalculationReceipt, CalculationReceipt] | null {
  if (!idA || !idB || idA === idB) return null;
  const matchingA = receipts.filter(receipt => receipt.id === idA);
  const matchingB = receipts.filter(receipt => receipt.id === idB);
  return matchingA.length === 1 && matchingB.length === 1
    ? [matchingA[0], matchingB[0]]
    : null;
}
