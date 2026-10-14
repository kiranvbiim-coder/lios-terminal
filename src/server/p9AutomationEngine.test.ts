import test from "node:test";
import assert from "node:assert/strict";
import {
  decideP9Notification,
  nextP9ScheduledRun,
  p9AutomationEventMatches,
  p9UnseenObservedFilings,
} from "./p9AutomationEngine";
import { p9WorkflowDefinitionInputSchema } from "@shared/p9AutomationContracts";

test("P9 interval and daily UTC schedules compute deterministic next run", () => {
  const from = new Date("2026-09-22T12:34:56.000Z");
  assert.equal(
    nextP9ScheduledRun({ type: "schedule", schedule: { kind: "interval", everyMinutes: 30 } }, from)?.toISOString(),
    "2026-09-22T13:04:56.000Z",
  );
  assert.equal(
    nextP9ScheduledRun({ type: "schedule", schedule: { kind: "daily_utc", hour: 13, minute: 0 } }, from)?.toISOString(),
    "2026-09-22T13:00:00.000Z",
  );
  assert.equal(
    nextP9ScheduledRun({ type: "schedule", schedule: { kind: "daily_utc", hour: 10, minute: 0 } }, from)?.toISOString(),
    "2026-09-23T10:00:00.000Z",
  );
});

test("P9 event matching respects event type tenant fields and explicit filters", () => {
  const trigger = { type: "event" as const, eventType: "price_threshold" as const, filters: { symbol: "AAPL", ownerUserId: 7 } };
  assert.equal(p9AutomationEventMatches(trigger, {
    eventType: "price_threshold",
    occurredAt: "2026-09-22T12:00:00.000Z",
    projectId: null,
    ownerUserId: 7,
    organizationId: null,
    sourceRef: "price-alert:1",
    payload: { symbol: "aapl", triggerPrice: 210 },
  }), true);
  assert.equal(p9AutomationEventMatches(trigger, {
    eventType: "price_threshold",
    occurredAt: "2026-09-22T12:00:00.000Z",
    projectId: null,
    ownerUserId: 8,
    organizationId: null,
    sourceRef: "price-alert:2",
    payload: { symbol: "AAPL", triggerPrice: 210 },
  }), false);
});

test("P9 notification policy suppresses irrelevant/noisy runs and delivers material changes", () => {
  const policy = {
    enabled: true,
    channels: ["in_app" as const],
    notifyOn: ["failure" as const, "condition_met" as const, "change_detected" as const],
    minimumRelevanceScore: 0.5,
    cooldownMinutes: 60,
    suppressUnchanged: true,
  };
  const base = {
    summary: "No change",
    changed: false,
    conditionMet: false,
    relevanceScore: 0.1,
    sourceRefs: [],
    engineRefs: [],
    artifactRefs: [],
    executionReceiptIds: [],
    output: {},
  };
  assert.equal(decideP9Notification({
    policy,
    status: "succeeded",
    result: base,
    lastDeliveredAt: null,
    now: new Date("2026-09-22T12:00:00.000Z"),
  }).status, "suppressed");

  const changed = { ...base, summary: "Material change", changed: true, relevanceScore: 0.8 };
  assert.equal(decideP9Notification({
    policy,
    status: "succeeded",
    result: changed,
    lastDeliveredAt: null,
    now: new Date("2026-09-22T12:00:00.000Z"),
  }).status, "delivered");

  assert.equal(decideP9Notification({
    policy,
    status: "succeeded",
    result: changed,
    lastDeliveredAt: new Date("2026-09-22T11:30:00.000Z"),
    now: new Date("2026-09-22T12:00:00.000Z"),
  }).status, "suppressed");
});

test("P9 canonical templates cannot be rebound to unrelated executors", () => {
  const invalid = p9WorkflowDefinitionInputSchema.safeParse({
    schemaVersion: "1",
    name: "Bad thesis workflow",
    description: "",
    template: "thesis_refresh",
    trigger: { type: "manual" },
    action: { kind: "provider_health" },
    notificationPolicy: {},
    sourceRefs: [],
    engineRefs: [],
    artifactRefs: [],
    enabled: true,
  });
  assert.equal(invalid.success, false);

  const valid = p9WorkflowDefinitionInputSchema.safeParse({
    schemaVersion: "1",
    name: "Thesis refresh",
    description: "",
    template: "thesis_refresh",
    trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } },
    action: { kind: "thesis_refresh", artifactId: "artifact:thesis-1" },
    notificationPolicy: {},
    sourceRefs: [],
    engineRefs: ["lios.thesis.native"],
    artifactRefs: ["artifact:thesis-1"],
    enabled: true,
  });
  assert.equal(valid.success, true);
});


test("P9 suppressUnchanged also suppresses explicit success notifications", () => {
  const policy = {
    enabled: true,
    channels: ["in_app" as const],
    notifyOn: ["success" as const],
    minimumRelevanceScore: 0,
    cooldownMinutes: 0,
    suppressUnchanged: true,
  };
  const result = {
    summary: "Completed with no material change",
    changed: false,
    conditionMet: false,
    relevanceScore: 1,
    sourceRefs: [],
    engineRefs: [],
    artifactRefs: [],
    executionReceiptIds: [],
    output: {},
  };
  assert.equal(decideP9Notification({
    policy,
    status: "succeeded",
    result,
    lastDeliveredAt: null,
    now: new Date("2026-09-22T12:00:00.000Z"),
  }).status, "suppressed");
});

test("P9 filing cursor returns every unseen filing without replaying the cursor", () => {
  const filings = [
    { accessionNumber: "new-2", filedDate: "2026-09-22" },
    { accessionNumber: "new-1", filedDate: "2026-09-22" },
    { accessionNumber: "cursor", filedDate: "2026-09-21" },
    { accessionNumber: "old", filedDate: "2026-09-20" },
  ];
  assert.deepEqual(
    p9UnseenObservedFilings(filings, "cursor", "2026-09-21").map((item) => item.accessionNumber),
    ["new-2", "new-1"],
  );
  assert.deepEqual(
    p9UnseenObservedFilings(filings, "missing-cursor", "2026-09-21").map((item) => item.accessionNumber),
    ["new-2", "new-1"],
  );
});
