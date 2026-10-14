export interface VintageStampedRecord<T> {
  id: string;
  value: T;
  effectiveAt?: string;
  publishedAt?: string;
  retrievedAt?: string;
  revisedAt?: string;
  vintageId?: string;
}

export interface VintageDecision {
  knowable: boolean;
  reason: "published-before-asof" | "no-publication-time" | "published-after-asof" | "invalid-time";
}

function time(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function wasKnowableAt<T>(record: VintageStampedRecord<T>, asOf: string): VintageDecision {
  const cutoff = time(asOf);
  if (cutoff === null) return { knowable: false, reason: "invalid-time" };
  const published = time(record.publishedAt);
  if (published === null) return { knowable: false, reason: "no-publication-time" };
  return published <= cutoff
    ? { knowable: true, reason: "published-before-asof" }
    : { knowable: false, reason: "published-after-asof" };
}

export function filterKnowableAt<T>(records: readonly VintageStampedRecord<T>[], asOf: string): VintageStampedRecord<T>[] {
  return records.filter((record) => wasKnowableAt(record, asOf).knowable).map((record) => ({ ...record }));
}

export function latestKnowableVintage<T>(records: readonly VintageStampedRecord<T>[], asOf: string): VintageStampedRecord<T> | null {
  return filterKnowableAt(records, asOf)
    .sort((a, b) => (time(b.publishedAt) ?? 0) - (time(a.publishedAt) ?? 0))[0] ?? null;
}

export function vintageWarning<T>(record: VintageStampedRecord<T>, asOf: string): string | null {
  const decision = wasKnowableAt(record, asOf);
  if (decision.knowable) return null;
  if (decision.reason === "no-publication-time") return "Publication timestamp unavailable; LiOS cannot prove this record was knowable at the selected time.";
  if (decision.reason === "published-after-asof") return "This record was published after the selected point-in-time and is excluded to prevent hindsight leakage.";
  return "Selected time or record timestamp is invalid.";
}
