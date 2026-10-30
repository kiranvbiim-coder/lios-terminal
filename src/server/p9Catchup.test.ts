import assert from "node:assert/strict";
import test from "node:test";
import { P9_MAX_MISSED_PER_CLAIM, P9_MISSED_GRACE_MS, P9_MISSED_STAGGER_MS, planP9Catchup } from "./p9AutomationEngine";

const now = new Date("2026-10-30T12:00:00.000Z");
const row = (id: string, ageMs: number) => ({ id, nextRunAt: new Date(now.getTime() - ageMs) });

test("on-time schedules are never deferred, however many are due", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`r${i}`, i * 1000));
  const plan = planP9Catchup(rows, now);
  assert.equal(plan.claim.length, 20);
  assert.deepEqual(plan.defer, []);
});

test("a restart backlog runs a bounded few and spreads the rest strictly forward", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`m${i}`, 86_400_000 - i));
  const plan = planP9Catchup(rows, now);
  assert.deepEqual(plan.claim.map(r => r.id), rows.slice(0, P9_MAX_MISSED_PER_CLAIM).map(r => r.id));
  assert.equal(plan.defer.length, 12 - P9_MAX_MISSED_PER_CLAIM);
  plan.defer.forEach((item, index) => assert.equal(item.nextRunAt.getTime(), now.getTime() + (index + 1) * P9_MISSED_STAGGER_MS));
  assert.ok(plan.defer.every(item => item.nextRunAt > now), "deferral never pulls a run earlier or into the past");
});

test("the grace boundary and mixed backlogs keep on-time work ahead of the cap", () => {
  const exact = row("exact", P9_MISSED_GRACE_MS);
  const justMissed = row("just-missed", P9_MISSED_GRACE_MS + 1);
  assert.deepEqual(planP9Catchup([exact], now).claim.map(r => r.id), ["exact"]);
  const missed = Array.from({ length: P9_MAX_MISSED_PER_CLAIM }, (_, i) => row(`m${i}`, 600_000));
  const plan = planP9Catchup([...missed, justMissed, exact], now);
  assert.ok(plan.claim.some(r => r.id === "exact"), "an on-time row is claimed even when the missed cap is full");
  assert.deepEqual(plan.defer.map(d => d.row.id), ["just-missed"]);
});
