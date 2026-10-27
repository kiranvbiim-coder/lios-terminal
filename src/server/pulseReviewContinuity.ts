import { createHash } from "node:crypto";
import type { IntelligenceCard } from "@shared/waveDContracts";

export interface PulseReviewedSnapshot {
  reviewedAt: string | null;
  fingerprints: string[];
}
export const EMPTY_PULSE_REVIEWED_SNAPSHOT: PulseReviewedSnapshot = {
  reviewedAt: null, fingerprints: [],
};
const MAX_REVIEW_CARDS = 120;

/**
 * A revision fingerprint identifies a recorded card with its actual source
 * references. It is NOT evidence of a business event, nor a source-level diff.
 * Excludes URLs, article bodies and credentials from the durable preference.
 */
export function fingerprintPulseRevision(card: IntelligenceCard): string | null {
  if (!card.evidence?.length || !card.id || !card.createdAt) return null;
  const sources = card.evidence.filter(ref => typeof ref.id === "string" && ref.id.length > 0)
    .map(ref => [ref.id, ref.availableAt ?? "", ref.snapshotId ?? ""])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (!sources.length) return null;
  const identity = JSON.stringify([card.id, card.createdAt, card.title, sources]);
  return createHash("sha256").update(identity).digest("hex");
}

export function normalizePulseReviewedSnapshot(value: unknown): PulseReviewedSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_PULSE_REVIEWED_SNAPSHOT };
  const raw = value as Record<string, unknown>;
  const reviewedAt = typeof raw.reviewedAt === "string" && Number.isFinite(Date.parse(raw.reviewedAt))
    ? new Date(raw.reviewedAt).toISOString() : null;
  const fingerprints = reviewedAt && Array.isArray(raw.fingerprints)
    ? [...new Set(raw.fingerprints.slice(0, MAX_REVIEW_CARDS).filter(
      (item): item is string => typeof item === "string" && /^[a-f0-9]{64}$/.test(item),
    ))]
    : [];
  return { reviewedAt, fingerprints };
}

/** Bounded reviewed evidence from current authorized, visible card projection. */
export function capturePulseReviewedSnapshot(
  cards: readonly IntelligenceCard[], at = new Date(),
): PulseReviewedSnapshot {
  if (!Number.isFinite(at.getTime())) throw new Error("Review time is unavailable.");
  const identities = cards.slice(0, MAX_REVIEW_CARDS)
    .map(fingerprintPulseRevision).filter((value): value is string => value !== null);
  return { reviewedAt: at.toISOString(), fingerprints: [...new Set(identities)] };
}

export interface PulseReviewDifference {
  status: "not_reviewed" | "compared";
  reviewedAt: string | null;
  newCardIds: string[];
  newCount: number;
  sourceBackedCount: number;
}

/**
 * Only source-backed cards newly absent from an explicitly acknowledged
 * snapshot are reported as new/revised. Does not invent added/updated/removed
 * source categories, historical comparison, or a model conclusion.
 */
export function comparePulseWithReviewedSnapshot(
  cards: readonly IntelligenceCard[],
  rawSnapshot: unknown,
): PulseReviewDifference {
  const snapshot = normalizePulseReviewedSnapshot(rawSnapshot);
  const recorded = cards.slice(0, MAX_REVIEW_CARDS).flatMap(card => {
    const hash = fingerprintPulseRevision(card);
    return hash ? [{ id: card.id, fingerprint: hash }] : [];
  });
  const previouslyReviewed = new Set(snapshot.fingerprints);
  const changed = snapshot.reviewedAt
    ? recorded.filter(({ fingerprint }) => !previouslyReviewed.has(fingerprint))
    : [];
  return {
    status: snapshot.reviewedAt ? "compared" : "not_reviewed",
    reviewedAt: snapshot.reviewedAt,
    newCardIds: changed.map(({ id }) => id),
    newCount: changed.length,
    sourceBackedCount: recorded.length,
  };
}
