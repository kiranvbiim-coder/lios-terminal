import test from "node:test";
import assert from "node:assert/strict";
import { parseDecisionIndicator } from "./decisionMonitor";

test("decision indicators require explicit supported source prefixes", () => {
  assert.deepEqual(parseDecisionIndicator("quote:AAPL"), { kind: "quote", key: "AAPL" });
  assert.deepEqual(parseDecisionIndicator("fred:unrate"), { kind: "fred", key: "UNRATE" });
  assert.equal(parseDecisionIndicator("AAPL price"), null);
  assert.equal(parseDecisionIndicator("web:https://example.test"), null);
});
