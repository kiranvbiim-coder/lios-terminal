import { useMemo } from "react";
import type { P9CronSchedule } from "@shared/p9CronSchedule";
import { p9WorkflowTriggerSchema } from "@shared/p9AutomationContracts";
import { workflowCronPreview } from "@/lib/workflowReviewTruth";

export function CronScheduleFields({ schedule, onChange, disabled = false }: {
  schedule: P9CronSchedule;
  onChange: (schedule: P9CronSchedule) => void;
  disabled?: boolean;
}) {
  const review = useMemo(() => {
    const trigger = { type: "schedule" as const, schedule };
    const parsed = p9WorkflowTriggerSchema.safeParse(trigger);
    return { parsed, preview: parsed.success ? workflowCronPreview(trigger, new Date()) : null };
  }, [schedule.expression, schedule.timeZone]);
  return <fieldset className="space-y-2 rounded border border-border/50 bg-black/15 p-3" disabled={disabled}>
    <legend className="text-sm font-medium">Cron schedule · explicit time zone</legend>
    <label className="block text-sm">Five-field cron expression
      <input aria-label="Five-field cron expression" maxLength={200} value={schedule.expression}
        placeholder="0 9 * * MON-FRI" onChange={event => onChange({ ...schedule, expression: event.target.value })}
        className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2 font-mono" />
    </label>
    <label className="block text-sm">IANA time zone
      <input aria-label="IANA time zone" maxLength={100} value={schedule.timeZone} placeholder="UTC"
        onChange={event => onChange({ ...schedule, timeZone: event.target.value })}
        className="mt-1 min-h-10 w-full rounded border border-border bg-background px-2" />
    </label>
    <p className="text-xs text-muted-foreground">Minute, hour, day of month, month, weekday. Example: 0 9 * * MON-FRI. At least 5 minutes between minute-field slots. Day-of-month and weekday use OR when both are restricted.</p>
    {!review.parsed.success && <p role="alert" className="text-xs text-amber-200">{review.parsed.error.issues[0]?.message ?? "Enter a valid five-field expression and IANA time zone."}</p>}
    {review.preview && <p role="status" className="text-xs text-muted-foreground">Local next-due preview: {review.preview.utc} (UTC) · {review.preview.zoned} ({schedule.timeZone}). This is not a run receipt; Home computes the saved next due time.</p>}
    <p className="text-xs text-muted-foreground">Home must be running and current permissions must permit execution. DST: nonexistent wall times are skipped; repeated wall times run only at their first occurrence. After downtime, at most one overdue claim runs; missed slots are not replayed.</p>
  </fieldset>;
}
