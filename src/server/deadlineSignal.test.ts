import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { deadlineSignal } from "./deadlineSignal";

test("the deadline aborts with a TimeoutError exactly when its budget elapses", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deadline = deadlineSignal(undefined, 1_000);
  t.after(() => deadline.dispose());
  t.mock.timers.tick(999);
  assert.equal(deadline.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(deadline.signal.aborted, true);
  assert.equal((deadline.signal.reason as DOMException).name, "TimeoutError");
});

test("a parent abort propagates its own reason before the deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const parent = new AbortController();
  const deadline = deadlineSignal(parent.signal, 60_000);
  t.after(() => deadline.dispose());
  const reason = new Error("user stopped the run");
  parent.abort(reason);
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.signal.reason, reason);
});

test("an already-aborted parent yields an already-aborted signal and no pending timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const parent = new AbortController();
  parent.abort(new Error("already stopped"));
  const deadline = deadlineSignal(parent.signal, 1_000);
  assert.equal(deadline.signal.aborted, true);
  deadline.dispose();
});

test("dispose cancels the timer so a finished run is never aborted later, and is idempotent", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const parent = new AbortController();
  const deadline = deadlineSignal(parent.signal, 1_000);
  deadline.dispose();
  deadline.dispose();
  t.mock.timers.tick(10_000);
  assert.equal(deadline.signal.aborted, false);
  parent.abort(new Error("after dispose"));
  assert.equal(deadline.signal.aborted, false, "a disposed deadline is detached from its parent");
  mock.timers.reset();
});
