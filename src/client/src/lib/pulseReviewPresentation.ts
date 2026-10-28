import type { IntelligenceCard } from "@shared/waveDContracts";

/** View-level boundary for the existing authenticated Wave D review contract.
 * No review state is stored on the client; only the server's persisted history
 * can establish a "since the last review" comparison.
 */
export interface PulseReviewPresentation {
  status: "not_reviewed" | "compared";
  reviewedAt: string | null;
  newCardIds: readonly string[];
  newCount: number;
  sourceBackedCount: number;
}

export function normalizePulseReviewPresentation(
  raw: unknown, visibleCards: readonly IntelligenceCard[],
): PulseReviewPresentation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (input.status !== "not_reviewed" && input.status !== "compared") return null;
  if (typeof input.newCount !== "number" || !Number.isSafeInteger(input.newCount) || input.newCount < 0 ||
      typeof input.sourceBackedCount !== "number" || !Number.isSafeInteger(input.sourceBackedCount) || input.sourceBackedCount < 0 ||
      (input.newCount as number) > (input.sourceBackedCount as number) ||
      (input.sourceBackedCount as number) > 120 ||
      !Array.isArray(input.newCardIds) || input.newCardIds.length > 120 ||
      !input.newCardIds.every(id => typeof id === "string" && id.length > 0)) return null;
  if (input.status === "not_reviewed") {
    if (input.reviewedAt !== null || input.newCount !== 0 || input.newCardIds.length) return null;
  } else if (typeof input.reviewedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(input.reviewedAt) ||
      !Number.isFinite(Date.parse(input.reviewedAt))) return null;
  // Reject repeated receipt IDs instead of silently deduplicating a malformed source history.
  if (new Set(input.newCardIds as string[]).size !== input.newCardIds.length) return null;
  const visibleIds = new Set(visibleCards.map(card => card.id));
  const ids: string[] = [...new Set(input.newCardIds as string[])];
  if (ids.length !== input.newCount) return null;
  return {
    status: input.status,
    reviewedAt: input.status === "compared" ? input.reviewedAt as string : null,
    // Only mark cards actually returned in the currently authorized response.
    newCardIds: ids.filter(id => visibleIds.has(id)),
    newCount: input.newCount as number,
    sourceBackedCount: input.sourceBackedCount as number,
  };
}
