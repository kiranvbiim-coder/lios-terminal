import type { DataFreshness, DataStatus } from "@shared/dataStatus";

interface Props {
  status?: DataStatus | null;
  showAsOf?: boolean;
  showProvider?: boolean;
  compact?: boolean;
  className?: string;
  [key: string]: unknown;
}

const FRESHNESS_LABEL: Record<DataFreshness, string> = {
  current: "CURRENT",
  delayed: "DELAYED",
  daily: "DAILY",
  reference: "REFERENCE",
  feed: "FEED",
  schedule: "SCHEDULE",
  snapshot: "SNAPSHOT",
  manual: "MANUAL",
  ai_generated: "AI",
};

const FRESHNESS_CLASS: Record<DataFreshness, string> = {
  current: "border-emerald-500/50 text-emerald-300 bg-emerald-500/10",
  delayed: "border-amber-500/50 text-amber-300 bg-amber-500/10",
  daily: "border-sky-500/50 text-sky-300 bg-sky-500/10",
  reference: "border-slate-500/50 text-slate-300 bg-slate-500/10",
  feed: "border-cyan-500/50 text-cyan-300 bg-cyan-500/10",
  schedule: "border-violet-500/50 text-violet-300 bg-violet-500/10",
  snapshot: "border-indigo-500/50 text-indigo-300 bg-indigo-500/10",
  manual: "border-orange-500/50 text-orange-300 bg-orange-500/10",
  ai_generated: "border-fuchsia-500/50 text-fuchsia-300 bg-fuchsia-500/10",
};

function formatAsOf(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Universal client-side renderer for the canonical @shared/dataStatus taxonomy.
 * It deliberately consumes server-issued status metadata rather than inferring
 * freshness from the browser clock, so trust/provenance presentation stays
 * deterministic across internal and client builds.
 *
 * Compact mode is exception-first: an ordinary current/source-backed state is
 * represented by one accessible status dot, while delayed, daily, reference,
 * feed, schedule, snapshot, manual, AI-generated, and fallback states retain an
 * explicit text label because those distinctions can change interpretation.
 */
export default function DataStatusBadge({
  status,
  showAsOf = false,
  showProvider = false,
  compact = false,
  className = "",
}: Props) {
  if (!status) return null;

  const asOf = formatAsOf(status.asOf);
  const fallbackClass = status.isFallback
    ? "border-red-500/60 text-red-300 bg-red-500/10"
    : FRESHNESS_CLASS[status.freshness];
  const title = [
    status.provider,
    status.delayLabel,
    asOf ? `As of ${asOf}` : null,
    status.isFallback ? "Fallback / degraded source" : null,
  ].filter(Boolean).join(" · ");
  const quietCurrent = compact && status.freshness === "current" && !status.isFallback;

  if (quietCurrent) {
    return (
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${className}`}
        title={title}
        aria-label={`Current source-backed data · ${title}`}
        data-testid="data-status-badge"
        data-status-priority="normal"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 border px-1.5 py-0.5 font-terminal text-[8px] leading-none tracking-wide ${fallbackClass} ${className}`}
      title={title}
      aria-label={title}
      data-testid="data-status-badge"
      data-status-priority={status.isFallback || status.freshness === "delayed" || status.freshness === "manual" || status.freshness === "ai_generated" ? "exception" : "context"}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.isFallback ? "bg-red-400" : "bg-current"}`}
        aria-hidden="true"
      />
      <span className="whitespace-nowrap">
        {status.isFallback ? "DEGRADED" : FRESHNESS_LABEL[status.freshness]}
      </span>
      {!compact && <span className="hidden whitespace-nowrap opacity-75 sm:inline">{status.delayLabel}</span>}
      {showProvider && <span className="hidden whitespace-nowrap opacity-75 md:inline">{status.provider}</span>}
      {showAsOf && asOf && <span className="hidden whitespace-nowrap opacity-75 lg:inline">AS OF {asOf}</span>}
    </span>
  );
}
