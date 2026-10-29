import type {
  P9AutomationEvent,
  P9NotificationPolicy,
  P9NotificationReason,
  P9WorkflowRunResult,
  P9WorkflowTrigger,
} from "@shared/p9AutomationContracts";

export function nextP9ScheduledRun(trigger: P9WorkflowTrigger, from: Date): Date | null {
  if (trigger.type !== "schedule") return null;
  if (trigger.schedule.kind === "interval") {
    return new Date(from.getTime() + trigger.schedule.everyMinutes * 60_000);
  }
  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCHours(trigger.schedule.hour, trigger.schedule.minute, 0, 0);
  if (candidate.getTime() <= from.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

const FAILURE_BACKOFF_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
/**
 * Adapted from OpenClaw src/cron/service/jobs-scheduling.ts errorBackoffMs,
 * c074824a27c96d3983043f9eeb33823cd1772d8c (MIT, Copyright (c) 2026 OpenClaw Foundation).
 * LiOS: retain the approved default progression; successful runs have no delay.
 */
export function p9FailureBackoff(consecutiveFailures: number): number {
  if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 0) throw new Error("Invalid automation failure count.");
  if (consecutiveFailures === 0) return 0;
  return FAILURE_BACKOFF_MS[Math.min(consecutiveFailures - 1, FAILURE_BACKOFF_MS.length - 1)];
}

function comparable(value: string | number | boolean | null | undefined): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  return String(value);
}

export function p9AutomationEventMatches(trigger: P9WorkflowTrigger, event: P9AutomationEvent): boolean {
  if (trigger.type !== "event" || trigger.eventType !== event.eventType) return false;
  // Filter inputs may include source payload fields, but the authoritative
  // tenant scope and source identity must always come from the event envelope.
  // Otherwise a producer could shadow ownerUserId/projectId/sourceRef with
  // same-named payload values and make a scoped trigger match incorrectly.
  const bag: Record<string, string | number | boolean | null> = {
    ...event.payload,
    projectId: event.projectId,
    ownerUserId: event.ownerUserId,
    organizationId: event.organizationId,
    sourceRef: event.sourceRef,
  };
  return Object.entries(trigger.filters).every(([key, expected]) =>
    Object.prototype.hasOwnProperty.call(bag, key) && comparable(bag[key]) === comparable(expected)
  );
}

/**
 * Run one saved event workflow at a time without allowing an unexpected
 * failure (for example, a deleted owner before beginP9Run) to prevent other
 * matched workflows from running. A failed workflow is never reported as
 * executed or successful; callers must separately surface unexpected failures.
 * Tenant, entitlement and permission checks remain with executeP9Workflow.
 */
export async function executeMatchedP9EventWorkflows<T>(
  workflows: readonly T[],
  execute: (workflow: T) => Promise<{ run: unknown | null; error: string | null }>,
): Promise<{ matched: number; executed: number; failed: number; unexpectedFailures: number }> {
  let executed = 0;
  let failed = 0;
  let unexpectedFailures = 0;
  for (const workflow of workflows) {
    try {
      const outcome = await execute(workflow);
      if (outcome.run) executed += 1;
      if (outcome.error) failed += 1;
    } catch {
      failed += 1;
      unexpectedFailures += 1;
    }
  }
  return { matched: workflows.length, executed, failed, unexpectedFailures };
}

export function p9UnseenObservedFilings<T extends { accessionNumber: string; filedDate: string }>(
  filingsNewestFirst: readonly T[],
  priorAccession: string,
  priorFiledDate: string | null,
): T[] {
  const priorIndex = filingsNewestFirst.findIndex((filing) => filing.accessionNumber === priorAccession);
  if (priorIndex >= 0) return filingsNewestFirst.slice(0, priorIndex);
  return filingsNewestFirst.filter((filing) =>
    !priorFiledDate || filing.filedDate > priorFiledDate
  );
}

export interface P9NotificationDecision {
  status: "delivered" | "suppressed";
  reason: P9NotificationReason;
  explanation: string;
}

function runReason(status: "succeeded" | "failed", result: P9WorkflowRunResult | null): P9NotificationReason {
  if (status === "failed") return "failure";
  if (result?.conditionMet) return "condition_met";
  if (result?.changed) return "change_detected";
  return "success";
}

export function decideP9Notification(input: {
  policy: P9NotificationPolicy;
  status: "succeeded" | "failed";
  result: P9WorkflowRunResult | null;
  lastDeliveredAt: Date | null;
  now: Date;
}): P9NotificationDecision {
  const reason = runReason(input.status, input.result);
  if (!input.policy.enabled) {
    return { status: "suppressed", reason, explanation: "Notifications are disabled for this workflow." };
  }
  if (!input.policy.notifyOn.includes(reason)) {
    return { status: "suppressed", reason, explanation: `Policy does not notify on ${reason}.` };
  }
  if (input.status === "succeeded" && input.policy.suppressUnchanged && !input.result?.changed && !input.result?.conditionMet) {
    return { status: "suppressed", reason, explanation: "Run produced no configured material change." };
  }
  const relevance = input.result?.relevanceScore ?? (input.status === "failed" ? 1 : 0);
  if (relevance < input.policy.minimumRelevanceScore) {
    return {
      status: "suppressed",
      reason,
      explanation: `Relevance ${relevance.toFixed(2)} is below policy threshold ${input.policy.minimumRelevanceScore.toFixed(2)}.`,
    };
  }
  if (input.lastDeliveredAt && input.policy.cooldownMinutes > 0) {
    const cooldownUntil = input.lastDeliveredAt.getTime() + input.policy.cooldownMinutes * 60_000;
    if (input.now.getTime() < cooldownUntil) {
      return { status: "suppressed", reason, explanation: "Notification cooldown is still active." };
    }
  }
  return { status: "delivered", reason, explanation: "Notification meets the workflow relevance and cooldown policy." };
}

export function p9NotificationTitle(name: string, reason: P9NotificationReason): string {
  if (reason === "failure") return `${name} · workflow failed`;
  if (reason === "condition_met") return `${name} · condition met`;
  if (reason === "change_detected") return `${name} · material change detected`;
  return `${name} · workflow completed`;
}
