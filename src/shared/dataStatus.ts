/**
 * Canonical data-provenance taxonomy: what freshness/trust bucket a piece of
 * data falls into, shown to the user via a badge (server/dataStatus.ts's
 * buildDataStatus() constructs these server-side; client/'s DataStatusBadge
 * renders them).
 *
 * Was previously duplicated independently in server/dataStatus.ts and
 * client/src/lib/finance.ts -- moved here so both terminal apps and the
 * server share one taxonomy rather than two copies that can drift apart.
 * (See Trial-to-Contract BUILD_PLAN: "Universal trust/provenance layer".)
 */
export type DataFreshness =
  | "current"
  | "delayed"
  | "daily"
  | "reference"
  | "feed"
  | "schedule"
  | "snapshot"
  | "manual"
  // AI-generated content (chat responses, summaries) is its own bucket,
  // distinct from "reference" (which covers non-AI static/estimated data) --
  // a wrong AI answer and a stale reference table are different kinds of
  // risk and should read differently to the user.
  | "ai_generated";

export interface DataStatus {
  provider: string;
  freshness: DataFreshness;
  asOf: string | null;
  delayLabel: string;
  isFallback: boolean;
}

const DEFAULT_DELAY_LABELS: Record<DataFreshness, string> = {
  current: "Current session",
  delayed: "Delayed feed",
  daily: "Daily close data",
  reference: "Reference only",
  feed: "Feed-based publication metadata",
  schedule: "Scheduled release calendar",
  snapshot: "Snapshot / mixed-source view",
  manual: "Manually imported by user",
  ai_generated: "AI-generated response",
};

export function buildDataStatus(input: {
  provider: string;
  freshness: DataFreshness;
  asOf?: string | null;
  delayLabel?: string;
  isFallback?: boolean;
}): DataStatus {
  return {
    // Deliberately always "Limuria Intelligence" regardless of input.provider
    // -- the actual upstream vendor (Yahoo/Stooq/SEC/Gemini/...) is never
    // surfaced to the end user, preserved exactly from the original
    // server/dataStatus.ts this was moved from.
    provider: "Limuria Intelligence",
    freshness: input.freshness,
    asOf: input.asOf ?? null,
    delayLabel: input.delayLabel ?? DEFAULT_DELAY_LABELS[input.freshness],
    isFallback: input.isFallback ?? false,
  };
}
