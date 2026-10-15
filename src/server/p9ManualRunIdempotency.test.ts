import assert from "node:assert/strict";
import test from "node:test";
import {
  p9ManualRunDedupeKey,
  p9ManualRunReceiptStatus,
  p9ManualRunRequestSchema,
  p9ManualRunRevisionMatches,
  p9ManualRunAdmissionMatches,
  admitP9ApprovedManualRun,
  type P9ManualWorkflowSnapshot,
} from "./p9ManualRunIdempotency";

const KEY = "550e8400-e29b-41d4-a716-446655440000";
const REVISION = "2026-10-15T12:00:00.000Z";

test("SI-06.22 legacy empty P9 manual-run payload is still accepted without automatic receipt", () => {
  assert.deepEqual(p9ManualRunRequestSchema.parse({}), {});
  assert.deepEqual(p9ManualRunRequestSchema.parse(undefined ?? {}), {});
});

test("SI-06.22 manual idempotency request requires a strict UUID and approved workflow revision", () => {
  const input = { idempotencyKey: KEY, expectedUpdatedAt: REVISION };
  assert.deepEqual(p9ManualRunRequestSchema.parse(input), input);
  for (const bad of [
    { idempotencyKey: KEY },
    { expectedUpdatedAt: REVISION },
    { idempotencyKey: "old-offline-request", expectedUpdatedAt: REVISION },
    { idempotencyKey: KEY, expectedUpdatedAt: "yesterday" },
    { idempotencyKey: KEY, expectedUpdatedAt: REVISION, action: { kind: "trade" } },
    { idempotencyKey: KEY, expectedUpdatedAt: REVISION, ownerUserId: 15 },
    { idempotencyKey: KEY, expectedUpdatedAt: REVISION, dedupeKey: "shared-access" },
    { idempotencyKey: KEY, expectedUpdatedAt: REVISION, expectedProjectId: 99 },
    { payload: "arbitrary" },
  ]) assert.equal(p9ManualRunRequestSchema.safeParse(bad).success, false);
});

test("SI-06.22 a request key is stable and namespaced away from event and schedule deduplication", () => {
  const canonical = p9ManualRunDedupeKey(KEY);
  assert.equal(canonical, "manual:" + KEY);
  assert.equal(canonical, p9ManualRunDedupeKey(KEY));
  assert.notEqual(canonical, "event:" + KEY);
  assert.throws(() => p9ManualRunDedupeKey("unsafe/path"));
});

test("SI-06.22 a keyed manual run is rejected when workflow version changes", () => {
  assert.equal(p9ManualRunRevisionMatches(new Date(REVISION), REVISION), true);
  assert.equal(p9ManualRunRevisionMatches(new Date("2026-10-15T12:00:01.000Z"), REVISION), false);
  assert.equal(p9ManualRunRevisionMatches(new Date(REVISION), "not-a-date"), false);
  assert.equal(p9ManualRunRevisionMatches(new Date(NaN), REVISION), false);
});

test("SI-06.22 server receipt distinguishes running from completed without claiming a duplicate run", () => {
  assert.equal(p9ManualRunReceiptStatus("running"), "in_progress");
  assert.equal(p9ManualRunReceiptStatus("succeeded"), "completed");
  assert.equal(p9ManualRunReceiptStatus("failed"), "completed");
  assert.equal(p9ManualRunReceiptStatus("skipped"), "completed");
});

function approvedWorkflow(): P9ManualWorkflowSnapshot {
  return {
    updatedAt: new Date(REVISION),
    name: "Market intelligence",
    description: "Review source changes",
    template: "custom",
    enabled: true,
    trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } },
    action: { kind: "provider_health" },
    notificationPolicy: { enabled: true, channels: ["in_app"], notifyOn: ["failure"] },
    sourceRefs: ["project:7"],
    engineRefs: ["lios.provider-status"],
    artifactRefs: [],
  };
}

test("SI-06.22 atomic admission rejects a version changed after route preflight", async () => {
  const approved = approvedWorkflow();
  const updated = { ...approved, updatedAt: new Date("2026-10-15T12:00:01.000Z") };
  let inserts = 0;
  const admitted = await admitP9ApprovedManualRun(
    async () => updated,
    async () => { inserts += 1; return { id: "workflow-run:unsafe" }; },
    approved,
    new Date(REVISION),
  );
  assert.equal(admitted, null);
  assert.equal(inserts, 0, "a stale approval never creates a P9 run receipt");
});

test("SI-06.22 same-millisecond action, policy, or source changes cannot bypass approval", async () => {
  const approved = approvedWorkflow();
  const variants: P9ManualWorkflowSnapshot[] = [
    { ...approved, action: { kind: "project_what_changed" } },
    { ...approved, enabled: false },
    { ...approved, sourceRefs: ["other-project:99"] },
    { ...approved, notificationPolicy: { enabled: false } },
    { ...approved, engineRefs: ["different-provider"] },
    { ...approved, name: "Retitled by another owner" },
  ];
  for (const changed of variants) {
    assert.equal(p9ManualRunAdmissionMatches(changed, approved, new Date(REVISION)), false);
    let inserted = false;
    assert.equal(await admitP9ApprovedManualRun(
      async () => changed,
      async () => { inserted = true; return { receipt: true }; },
      approved,
      new Date(REVISION),
    ), null);
    assert.equal(inserted, false);
  }
});

test("SI-06.22 atomic admission waits for a locked row before any insert", async () => {
  const approved = approvedWorkflow();
  let resolveLock!: (value: P9ManualWorkflowSnapshot | null) => void;
  const locked = new Promise<P9ManualWorkflowSnapshot | null>((resolve) => { resolveLock = resolve; });
  const events: string[] = [];
  const admitted = admitP9ApprovedManualRun(
    async () => { events.push("locked-select"); return locked; },
    async () => { events.push("insert"); return { id: "one-durable-run" }; },
    approved,
    new Date(REVISION),
  );
  await Promise.resolve();
  assert.deepEqual(events, ["locked-select"]);
  resolveLock(approved);
  assert.deepEqual(await admitted, { id: "one-durable-run" });
  assert.deepEqual(events, ["locked-select", "insert"]);
});

test("SI-06.22 missing locked workflow or invalid expected revision never inserts", async () => {
  const approved = approvedWorkflow();
  let inserts = 0;
  const insert = async () => { inserts += 1; return { id: "run" }; };
  assert.equal(await admitP9ApprovedManualRun(async () => null, insert, approved, new Date(REVISION)), null);
  assert.equal(await admitP9ApprovedManualRun(
    async () => approved, insert, approved, new Date("2026-10-15T12:00:02.000Z"),
  ), null);
  assert.equal(inserts, 0);
});

test("SI-06.22 equivalent workflow JSON fields match without depending on object key ordering", () => {
  const approved = approvedWorkflow();
  const equivalent: P9ManualWorkflowSnapshot = {
    ...approved,
    action: { kind: "provider_health" },
    trigger: { schedule: { everyMinutes: 60, kind: "interval" }, type: "schedule" },
  };
  assert.equal(p9ManualRunAdmissionMatches(equivalent, approved, new Date(REVISION)), true);
});
