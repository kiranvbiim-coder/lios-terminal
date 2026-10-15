import assert from "node:assert/strict";
import test from "node:test";
import {
  p9ManualRunDedupeKey,
  p9ManualRunReceiptStatus,
  p9ManualRunRequestSchema,
  p9ManualRunRevisionMatches,
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
