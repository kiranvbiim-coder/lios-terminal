import type { ProvenanceRecord } from "./terminalEvidence";

export type SourceReviewFilter = "all" | "review" | "stale" | "no-as-of";

/** Read-only interpretation of metadata already published by existing LiOS panels. */
export function sourceNeedsReview(source: ProvenanceRecord): boolean {
  return source.quality === "warning" || source.quality === "unavailable"
    || source.conflicts.length > 0 || Boolean(source.fallbackSource)
    || source.freshness === "stale" || source.freshness === "unavailable";
}

export function summarizePublishedSources(sources: readonly ProvenanceRecord[]) {
  return {
    recorded: sources.length,
    review: sources.filter(sourceNeedsReview).length,
    stale: sources.filter(source => source.freshness === "stale" || source.freshness === "unavailable").length,
    missingAsOf: sources.filter(source => !source.effectiveAt?.trim()).length,
  };
}

export function filterPublishedSources(
  sources: readonly ProvenanceRecord[],
  query: string,
  filter: SourceReviewFilter,
): ProvenanceRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  return sources.filter(source => {
    if (filter === "review" && !sourceNeedsReview(source)) return false;
    if (filter === "stale" && source.freshness !== "stale" && source.freshness !== "unavailable") return false;
    if (filter === "no-as-of" && source.effectiveAt?.trim()) return false;
    return !needle || [
      source.label, source.provider ?? "", source.source, source.id,
      ...source.conflicts, ...source.assumptions,
    ].some(part => part.toLocaleLowerCase().includes(needle));
  });
}

/** Published URLs are untrusted data. Never render javascript:, credentials or insecure links. */
export function safePublishedSourceUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname
      ? url.href : null;
  } catch {
    return null;
  }
}
