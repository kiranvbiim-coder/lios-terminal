import test from "node:test";
import assert from "node:assert/strict";
import type { P9WorkflowRecord, P9RunRecord } from "./useP9Automation";
import { quickMonitorDraft, workflowTriggerEditDefinition, workflowExecutionTruth, workflowScheduleSummary } from "./workflowReviewTruth";

const workflow = (overrides: Partial<P9WorkflowRecord> = {}): P9WorkflowRecord => ({
  id: "workflow:alpha", projectId: 15, ownerUserId: 3, organizationId: null,
  name: "Monitor provider health", description: "Current sources only",
  template: "provider_health", enabled: false,
  trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } },
  action: { kind: "provider_health" }, notificationPolicy: {
    enabled: true, channels: ["in_app"], notifyOn: ["failure"], minimumRelevanceScore: 0.5,
    cooldownMinutes: 60, suppressUnchanged: true,
  },
  sourceRefs: [], engineRefs: ["lios.provider-status"], artifactRefs: [], eventCursor: {},
  nextRunAt: null, lastRunAt: null, lastSuccessAt: null, lastFailureAt: null,
  consecutiveFailures: 0, createdAt: "2026-10-24T08:00:00.000Z", updatedAt: "2026-10-24T09:00:00.000Z",
  ...overrides,
});

test("quick creation needs user opt-in and only the existing P9 definition schema can authorize schedules", () => {
  const dormant = quickMonitorDraft("provider", false, 60);
  assert.equal(dormant.enabled, false);
  assert.equal(dormant.action.kind, "provider_health");
  assert.deepEqual(dormant.trigger, { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } });
  assert.deepEqual(dormant.notificationPolicy.channels, ["in_app"]);
  assert.deepEqual(dormant.sourceRefs, []);
  const active = quickMonitorDraft("changes", true, 15);
  assert.equal(active.enabled, true);
  assert.equal(active.action.kind, "project_what_changed");
  assert.deepEqual(active.engineRefs, ["lios.project-intelligence"]);
  for (const invalid of [0, 4, 10081, Number.NaN, 1.5]) {
    assert.throws(() => quickMonitorDraft("provider", true, invalid));
  }
});

test("editing a schedule preserves exact action, sources, notification policy and enabled state", () => {
  const original = workflow();
  const edited = workflowTriggerEditDefinition(original, { type: "schedule", schedule: { kind: "interval", everyMinutes: 120 } });
  assert.equal(edited.enabled, false);
  assert.deepEqual(edited.action, original.action);
  assert.deepEqual(edited.notificationPolicy, original.notificationPolicy);
  assert.deepEqual(edited.sourceRefs, original.sourceRefs);
  assert.deepEqual(edited.engineRefs, original.engineRefs);
  assert.equal(edited.trigger.type, "schedule");
  assert.deepEqual(workflowTriggerEditDefinition(original, { type: "schedule", schedule: { kind: "daily_utc", hour: 18, minute: 15 } }).trigger,
    { type: "schedule", schedule: { kind: "daily_utc", hour: 18, minute: 15 } });
  assert.throws(() => workflowTriggerEditDefinition(original, { type: "schedule", schedule: { kind: "daily_utc", hour: 24, minute: 0 } }));
  assert.throws(() => workflowTriggerEditDefinition(workflow({ projectId: 0 }), original.trigger), /Missing current Project/);
});

test("paused, manual and enabled schedules never invent future executions or last-run receipts", () => {
  const dormant = workflow();
  const paused = workflowExecutionTruth(dormant, undefined);
  assert.equal(paused.state, "paused");
  assert.equal(paused.latest, "No recorded run");
  assert.equal(paused.receiptCount, 0);
  assert.match(paused.next, /None while paused/);
  assert.match(paused.warning, /does not undo/);

  const enabled = workflowExecutionTruth(workflow({ enabled: true, nextRunAt: "2026-10-24T12:00:00Z" }), undefined);
  assert.equal(enabled.state, "enabled");
  assert.equal(enabled.next, "2026-10-24T12:00:00Z");
  assert.match(enabled.warning, /not a guarantee/);

  const run = { workflowId: dormant.id, projectId: dormant.projectId, triggerType: "schedule",
    status: "skipped", completedAt: null, executionReceiptIds: [] } as P9RunRecord;
  const skipped = workflowExecutionTruth(workflow({ enabled: true, nextRunAt: null }), run);
  assert.match(skipped.latest, /skipped/);
  assert.match(skipped.latest, /not settled/);
  assert.equal(skipped.receiptCount, 0);
  assert.equal(skipped.next, "No next schedule time confirmed");

  const succeeded = workflowExecutionTruth(workflow({ enabled: true }), {
    ...run, status: "succeeded", completedAt: "2026-10-24T12:00:10Z", executionReceiptIds: ["receipt-1", "receipt-2"],
  });
  assert.equal(succeeded.receiptCount, 2);
  assert.match(succeeded.latest, /succeeded/);
  const manual = workflowExecutionTruth(workflow({ enabled: true, trigger: { type: "manual" } }), undefined);
  assert.equal(manual.state, "manual");
  assert.match(workflowScheduleSummary(workflow({ trigger: { type: "manual" } })), /never automatically/);
  assert.match(workflowScheduleSummary(workflow({ trigger: { type: "event", eventType: "provider_health", filters: {} } })), /permissions required/);
  const conditional = workflowExecutionTruth(workflow({ enabled: true, trigger: { type: "event", eventType: "provider_health", filters: {} } }), undefined);
  assert.equal(conditional.next, "Event-driven · no fixed due time");
});

