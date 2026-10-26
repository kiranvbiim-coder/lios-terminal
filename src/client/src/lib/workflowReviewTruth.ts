import {
  p9WorkflowDefinitionInputSchema, p9WorkflowTriggerSchema,
  type P9WorkflowDefinitionInput, type P9WorkflowTrigger,
} from "@shared/p9AutomationContracts";
import type { P9WorkflowRecord, P9RunRecord } from "./useP9Automation";

export type QuickMonitorKind = "provider" | "changes";

export function quickMonitorDraft(kind: QuickMonitorKind, enabled: boolean, minutes: number): P9WorkflowDefinitionInput {
  const input = kind === "provider" ? {
    schemaVersion: "1", name: "Provider health monitor",
    description: "Check configured providers and user-connected source health without exposing credentials.",
    template: "provider_health",
    trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: minutes } },
    action: { kind: "provider_health" },
    notificationPolicy: { enabled: true, channels: ["in_app"], notifyOn: ["failure", "condition_met", "change_detected"], minimumRelevanceScore: 0.5, cooldownMinutes: 60, suppressUnchanged: true },
    sourceRefs: [], engineRefs: ["lios.provider-status", "lios.source-connections"], artifactRefs: [],
    enabled,
  } : {
    schemaVersion: "1", name: "Project what changed",
    description: "Compare Project Intelligence against its previous snapshot and surface material source changes.",
    template: "custom",
    trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: minutes } },
    action: { kind: "project_what_changed" },
    notificationPolicy: { enabled: true, channels: ["in_app"], notifyOn: ["failure", "condition_met", "change_detected"], minimumRelevanceScore: 0.5, cooldownMinutes: 60, suppressUnchanged: true },
    sourceRefs: [], engineRefs: ["lios.project-intelligence"], artifactRefs: [],
    enabled,
  };
  return p9WorkflowDefinitionInputSchema.parse(input);
}

/** Build a full replacement from exactly one server-returned Project workflow;
 * the action, source IDs, notification rights and schedule are not fabricated.
 * A strict server-side revision compare is required on saving. */
export function workflowTriggerEditDefinition(
  workflow: P9WorkflowRecord,
  trigger: P9WorkflowTrigger,
): P9WorkflowDefinitionInput {
  if (!Number.isSafeInteger(workflow.projectId) || workflow.projectId <= 0 || !workflow.id || !workflow.updatedAt) {
    throw new Error("Missing current Project workflow authority.");
  }
  return p9WorkflowDefinitionInputSchema.parse({
    schemaVersion: "1", name: workflow.name, description: workflow.description,
    template: workflow.template, trigger: p9WorkflowTriggerSchema.parse(trigger),
    action: workflow.action, notificationPolicy: workflow.notificationPolicy,
    sourceRefs: workflow.sourceRefs, engineRefs: workflow.engineRefs,
    artifactRefs: workflow.artifactRefs, enabled: workflow.enabled,
  });
}

export function workflowScheduleSummary(workflow: P9WorkflowRecord): string {
  const t = workflow.trigger;
  if (t.type === "manual") return "Manual only · never automatically scheduled";
  if (t.type === "event") return "Event-triggered · matching events and current permissions required";
  if (t.schedule.kind === "daily_utc") return `Daily ${String(t.schedule.hour).padStart(2, "0")}:${String(t.schedule.minute).padStart(2, "0")} UTC · Home must be running`;
  return `Every ${t.schedule.everyMinutes} minutes · Home must be running`;
}

export function workflowExecutionTruth(workflow: P9WorkflowRecord, last: P9RunRecord | undefined): {
  state: "paused" | "enabled" | "manual";
  next: string;
  latest: string;
  receiptCount: number;
  warning: string;
} {
  const state = workflow.enabled ? workflow.trigger.type === "manual" ? "manual" : "enabled" : "paused";
  const next = state !== "enabled" ? "None while paused or manual-only"
    : workflow.trigger.type === "event" ? "Event-driven · no fixed due time"
    : workflow.nextRunAt ?? "No next schedule time confirmed";
  const latest = !last ? "No recorded run" : `${last.triggerType}: ${last.status}${last.completedAt ? ` at ${last.completedAt}` : " · not settled"}`;
  return {
    state, next, latest,
    receiptCount: last?.executionReceiptIds?.length ?? 0,
    warning: state === "enabled"
      ? "Enabled is an intent, not a guarantee of future execution. The running Home and the existing P9 scheduler, rights and receipts determine actual outcomes."
      : state === "paused"
        ? "Paused blocks new scheduled claims; it does not undo a run already claimed or an external side effect."
        : "Manual-only workflow has no automatic schedule.",
  };
}