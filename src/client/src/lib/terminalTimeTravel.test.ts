import test from "node:test";
import assert from "node:assert/strict";
import { describeTimeContext, normalizeTimeContext, setAsKnownOn, supportsPointInTime } from "./terminalTimeTravel";

test("point-in-time support is explicit rather than universal", () => {
  assert.equal(supportsPointInTime("financialstatements"), true);
  assert.equal(supportsPointInTime("market"), false);
});

test("as-known-on dates normalize safely", () => {
  const context = setAsKnownOn("2025-12-31");
  assert.equal(context.enabled, true);
  assert.equal(describeTimeContext(context), "As known on 2025-12-31");
  assert.equal(normalizeTimeContext({ enabled: true, asOfDate: "bad-date" }).enabled, false);
});
