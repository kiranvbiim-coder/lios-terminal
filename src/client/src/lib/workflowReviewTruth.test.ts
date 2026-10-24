import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { P9WorkflowRecord, P9RunRecord } from "./useP9Automation";
import { quickMonitorDraft, scheduleEditDefinition, workflowExecutionTruth, workflowScheduleSummary } from "./workflowReviewTruth";

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
  const edited = scheduleEditDefinition(original, { type: "schedule", schedule: { kind: "interval", everyMinutes: 120 } });
  assert.equal(edited.enabled, false);
  assert.deepEqual(edited.action, original.action);
  assert.deepEqual(edited.notificationPolicy, original.notificationPolicy);
  assert.deepEqual(edited.sourceRefs, original.sourceRefs);
  assert.deepEqual(edited.engineRefs, original.engineRefs);
  assert.equal(edited.trigger.type, "schedule");
  assert.deepEqual(scheduleEditDefinition(original, { type: "schedule", schedule: { kind: "daily_utc", hour: 18, minute: 15 } }).trigger,
    { type: "schedule", schedule: { kind: "daily_utc", hour: 18, minute: 15 } });
  assert.throws(() => scheduleEditDefinition(original, { type: "schedule", schedule: { kind: "daily_utc", hour: 24, minute: 0 } }));
  assert.throws(() => scheduleEditDefinition(workflow({ projectId: 0 }), original.trigger), /Missing current Project/);
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
});

test("actual P9 management route and store atomically check reviewed updatedAt only for these confirmed actions", () => {
  const store = readFileSync(new URL("../../../server/p9AutomationStore.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../../../server/p9AutomationRoutes.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("./useP9Automation.ts", import.meta.url), "utf8");
  assert.match(store, /expectedUpdatedAt\?: string/g);
  assert.equal(store.split("eq(projectAutomationWorkflows.updatedAt, new Date(expectedUpdatedAt))").length - 1, 3);
  assert.match(store, /Workflow changed since review/);
  const deleteStart = store.indexOf("export async function deleteP9Workflow");
  const deletePart = store.slice(deleteStart, store.indexOf("export interface ClaimedP9Workflow", deleteStart));
  assert.ok(deletePart.indexOf(".returning({ id: projectAutomationWorkflows.id })") < deletePart.indexOf('action: "deleted"'));
  assert.match(routes, /expectedUpdatedAt: z.string\(\).datetime\(\{ offset: true \}\).optional\(\)/);
  assert.match(routes, /replaceP9Workflow\(ctx\(req\), current.id, definition, expectedUpdatedAt\)/);
  assert.match(routes, /setP9WorkflowEnabled\(ctx\(req\), current.id, body.enabled, body.expectedUpdatedAt\)/);
  assert.match(routes, /deleteP9Workflow\(ctx\(req\), current.id, expected.expectedUpdatedAt\)/);
  assert.match(client, /replaceP9Workflow\(projectId: number, workflowId: string, input: P9WorkflowDefinitionInput, expectedUpdatedAt\?: string\)/);
  assert.match(client, /expectedUpdatedAt \? \{ expectedUpdatedAt \} : undefined/);
});

test("P9 UI never immediately creates an enabled schedule or silently deletes/pauses a listed workflow", () => {
  const panel = readFileSync(new URL("../components/terminal/ProjectAutomationPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /data-testid="p9-create-review"/);
  assert.match(panel, /data-testid="p9-create-enable-consent"/);
  assert.match(panel, /const \[createEnabled, setCreateEnabled\] = useState\(false\)/);
  assert.match(panel, /data-testid="p9-workflow-review"/);
  assert.match(panel, /workflowExecutionTruth\(workflow, last\)/);
  assert.match(panel, /requestWorkflowReview\(workflow, workflow.enabled \? "pause" : "resume"\)/);
  assert.match(panel, /requestWorkflowReview\(workflow, "delete"\)/);
  assert.match(panel, /requestWorkflowReview\(workflow, "edit"\)/);
  assert.match(panel, /candidate.expectedUpdatedAt/);
  assert.match(panel, /selectedProject.current === originalProject/);
  assert.match(panel, /managementInFlight.current = false;\s*\/\/ Workbench may have switched Projects/);
  assert.equal((panel.match(/setBusyId\(null\);/g) ?? []).length >= 2, true, "Project-switch management locks must always be released");
  assert.match(panel, /setP9WorkflowEnabled\(originalProject, candidate.workflowId, enabled, candidate.expectedUpdatedAt\)/);
  assert.match(panel, /replaceP9Workflow\(originalProject, candidate.workflowId, definition, candidate.expectedUpdatedAt\)/);
  assert.match(panel, /deleteP9Workflow\(originalProject, candidate.workflowId, candidate.expectedUpdatedAt\)/);
  assert.doesNotMatch(panel, /onClick=\{\(\) => void deleteP9Workflow/);
  assert.doesNotMatch(panel, /onClick=\{\(\) => void setP9WorkflowEnabled/);
});
