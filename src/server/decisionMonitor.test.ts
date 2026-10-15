import test from "node:test";
import assert from "node:assert/strict";
import { classifyDecisionMonitorTransition, parseDecisionIndicator } from "./decisionMonitor";

test("decision indicators require explicit supported source prefixes", () => {
  assert.deepEqual(parseDecisionIndicator("quote:AAPL"), { kind: "quote", key: "AAPL" });
  assert.deepEqual(parseDecisionIndicator("fred:unrate"), { kind: "fred", key: "UNRATE" });
  assert.equal(parseDecisionIndicator("AAPL price"), null);
  assert.equal(parseDecisionIndicator("web:https://example.test"), null);
});

test("acknowledged decision breach stays quiet until genuine recovery and re-breach", () => {
  const classify = classifyDecisionMonitorTransition;
  assert.deepEqual(classify("active", false), {
    nextStatus: "active", emitBreach: false, emitRecovery: false,
  });
  assert.deepEqual(classify("active", true), {
    nextStatus: "breached", emitBreach: true, emitRecovery: false,
  });
  assert.deepEqual(classify("breached", true), {
    nextStatus: "breached", emitBreach: false, emitRecovery: false,
  });
  assert.deepEqual(classify("acknowledged", true), {
    nextStatus: "acknowledged", emitBreach: false, emitRecovery: false,
  });
  assert.deepEqual(classify("acknowledged", false), {
    nextStatus: "active", emitBreach: false, emitRecovery: true,
  });
  assert.deepEqual(classify("breached", false), {
    nextStatus: "active", emitBreach: false, emitRecovery: true,
  });
  // Only a later transition from re-armed active back to breached alerts.
  const afterRecovery = classify(classify("acknowledged", false).nextStatus, true);
  assert.equal(afterRecovery.emitBreach, true);
});

test("repeated monitoring polls do not generate duplicate threshold events", () => {
  let status = "active";
  let breachNotifications = 0;
  let recoveryNotifications = 0;
  for (const breached of [true, true, true]) {
    const transition = classifyDecisionMonitorTransition(status, breached);
    if (transition.emitBreach) breachNotifications += 1;
    if (transition.emitRecovery) recoveryNotifications += 1;
    status = transition.nextStatus;
  }
  assert.equal(breachNotifications, 1);
  status = "acknowledged"; // Reviewer's existing acknowledge endpoint.
  for (const breached of [true, true, false, false, true]) {
    const transition = classifyDecisionMonitorTransition(status, breached);
    if (transition.emitBreach) breachNotifications += 1;
    if (transition.emitRecovery) recoveryNotifications += 1;
    status = transition.nextStatus;
  }
  assert.equal(breachNotifications, 2, "only the genuine re-breach can notify again");
  assert.equal(recoveryNotifications, 1);
  assert.equal(status, "breached");
});
