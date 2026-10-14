import { memo, type ButtonHTMLAttributes, type ReactNode } from "react";
import { buildSparklinePoints, type FusionTone } from "@/lib/fusionExperience";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<FusionTone, string> = {
  neutral: "text-foreground",
  positive: "text-up",
  negative: "text-down",
  warning: "text-amber-300",
  accent: "text-cyan-200",
};

export const FusionSparkline = memo(function FusionSparkline({
  values,
  className,
  height = 28,
  label,
}: {
  values: Array<number | null | undefined>;
  className?: string;
  height?: number;
  label?: string;
}) {
  const points = buildSparklinePoints(values, 100, height, 2);
  if (!points) return <div className={cn("fusion-sparkline-empty", className)} aria-label={label ?? "No trend data"} />;
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className={cn("fusion-sparkline", className)}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

export function FusionMetric({
  label,
  value,
  secondary,
  change,
  series,
  tone = "neutral",
  onClick,
  title,
}: {
  label: string;
  value: ReactNode;
  secondary?: ReactNode;
  change?: ReactNode;
  series?: Array<number | null | undefined>;
  tone?: FusionTone;
  onClick?: () => void;
  title?: string;
}) {
  const content = (
    <>
      <div className="fusion-metric-label" data-visual-object="metric-label">{label}</div>
      <div className="fusion-metric-main">
        <div className={cn("fusion-metric-value", TONE_CLASS[tone])}>{value}</div>
        {change !== undefined && <div className={cn("fusion-metric-change", TONE_CLASS[tone])}>{change}</div>}
      </div>
      {secondary !== undefined && <div className="fusion-metric-secondary">{secondary}</div>}
      {series && series.some((item) => typeof item === "number") && (
        <FusionSparkline values={series} height={18} className={cn("mt-1 h-[18px] w-full", TONE_CLASS[tone])} />
      )}
    </>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} title={title} className="fusion-metric fusion-interactive group text-left" data-visual-object="metric">{content}</button>;
  }
  return <div title={title} className="fusion-metric group text-left" data-visual-object="metric">{content}</div>;
}

export function FusionMetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("fusion-metric-grid", className)}>{children}</div>;
}

export function FusionSection({
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("fusion-section lios-phase1-panel", className)} data-visual-object="section">
      <header className="fusion-section-header">
        <div className="min-w-0">
          {eyebrow && <div className="fusion-section-eyebrow">{eyebrow}</div>}
          <div className="fusion-section-title">{title}</div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="fusion-section-body">{children}</div>
    </section>
  );
}

export function FusionDataBar({
  value,
  max,
  label,
  valueLabel,
  tone = "accent",
}: {
  value: number | null | undefined;
  max: number;
  label: string;
  valueLabel?: ReactNode;
  tone?: FusionTone;
}) {
  const width = typeof value === "number" && Number.isFinite(value) && max > 0
    ? Math.max(0, Math.min(100, (Math.abs(value) / max) * 100))
    : 0;
  const fillClass = tone === "positive"
    ? "bg-[hsl(var(--up))]"
    : tone === "negative"
      ? "bg-[hsl(var(--down))]"
      : tone === "warning"
        ? "bg-amber-300"
        : "bg-cyan-300";
  return (
    <div className="fusion-data-bar">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        <span className="tabular-nums text-foreground">{valueLabel ?? (value ?? "—")}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden bg-white/[0.045]">
        <div className={cn("h-full transition-[width]", fillClass)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function FusionEmptyState({ children }: { children: ReactNode }) {
  return <FusionStateBlock state="empty">{children}</FusionStateBlock>;
}

/**
 * Phase 1 shared visual primitives. These components deliberately carry
 * semantic data attributes so every terminal surface can share one visual
 * contract without coupling the analytical components to Tailwind details.
 */
export function FusionPanel({
  children,
  className,
  as: Element = "section",
  ...props
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return <Element {...props} className={cn("lios-phase1-panel", className)} data-visual-object="panel">{children}</Element>;
}

export function FusionActionButton({
  variant = "quiet",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "accent" | "danger";
}) {
  return <button {...props} type={props.type ?? "button"} className={cn("lios-phase1-action", className)} data-variant={variant}>{children}</button>;
}

export function FusionStatusBadge({
  children,
  tone = "neutral",
  kind = "status",
  className,
}: {
  children: ReactNode;
  tone?: FusionTone;
  kind?: "status" | "source" | "freshness";
  className?: string;
}) {
  return <span className={cn("lios-phase1-badge", className)} data-kind={kind} data-tone={tone}>{children}</span>;
}

export function FusionSourceBadge({ source = "LIVE EVIDENCE", className }: { source?: ReactNode; className?: string }) {
  return <FusionStatusBadge kind="source" tone="accent" className={className}>{source}</FusionStatusBadge>;
}

export function FusionFreshnessBadge({
  state,
  className,
}: {
  state: "live" | "ready" | "loading" | "stale" | "offline";
  className?: string;
}) {
  const label = state === "live" ? "LIVE" : state === "ready" ? "READY" : state === "loading" ? "UPDATING" : state === "stale" ? "STALE" : "OFFLINE";
  const tone: FusionTone = state === "live" || state === "ready" ? "positive" : state === "loading" || state === "stale" ? "warning" : "negative";
  return <FusionStatusBadge kind="freshness" tone={tone} className={className}><i aria-hidden="true" />{label}</FusionStatusBadge>;
}

export function FusionEvidenceRow({
  label,
  value,
  source,
  freshness,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  source?: ReactNode;
  freshness?: "live" | "ready" | "loading" | "stale" | "offline";
  className?: string;
}) {
  return (
    <div className={cn("lios-phase1-evidence", className)} data-visual-object="evidence-row">
      <span className="lios-phase1-evidence-label">{label}</span>
      <strong className="lios-phase1-evidence-value">{value}</strong>
      <span className="lios-phase1-evidence-meta">
        {source && <FusionSourceBadge source={source} />}
        {freshness && <FusionFreshnessBadge state={freshness} />}
      </span>
    </div>
  );
}

export function FusionStateBlock({
  state,
  children,
  detail,
  action,
  className,
}: {
  state: "loading" | "empty" | "error" | "ready";
  children: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("fusion-empty lios-phase1-state", className)} data-state={state} data-visual-object="state">
      <div className="lios-phase1-state-title">{children}</div>
      {detail && <div className="lios-phase1-state-detail">{detail}</div>}
      {action && <div className="lios-phase1-state-action">{action}</div>}
    </div>
  );
}
