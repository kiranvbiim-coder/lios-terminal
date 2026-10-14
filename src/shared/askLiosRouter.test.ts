import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAskLiosDelegation,
  classifyAskLiosIntent,
} from "./askLiosRouter";

test("explicit deterministic calculation terms route to their authoritative engines", () => {
  assert.deepEqual(classifyAskLiosIntent("Run a DCF for this company"), {
    kind: "compute",
    engineId: "valuation.dcf",
    view: "valuation",
  });
  assert.deepEqual(classifyAskLiosIntent("Calculate DV01"), {
    kind: "compute",
    engineId: "fixed-income.duration",
    view: "fixedincome",
  });
  assert.deepEqual(classifyAskLiosIntent("Show me VaR"), {
    kind: "compute",
    engineId: "portfolio.var",
    view: "advancedrisk",
  });
  assert.deepEqual(classifyAskLiosIntent("Run a Monte Carlo simulation"), {
    kind: "compute",
    engineId: "simulations.monte-carlo",
    view: "montecarlo",
  });
});

test("ordinary explanatory finance questions remain chat instead of being over-routed", () => {
  assert.deepEqual(classifyAskLiosIntent("Compare two companies on valuation"), { kind: "chat" });
  assert.deepEqual(classifyAskLiosIntent("Explain the yield curve"), { kind: "chat" });
  assert.deepEqual(classifyAskLiosIntent("Show the option chain"), { kind: "chat" });
  assert.deepEqual(classifyAskLiosIntent("Explain fixed income"), { kind: "chat" });
  assert.deepEqual(classifyAskLiosIntent("Explain WACC"), { kind: "chat" });
});

test("deterministic delegation is governed, capability-invoking, and non-mutating", () => {
  const intent = classifyAskLiosIntent("Calculate WACC");
  assert.equal(intent.kind, "compute");
  if (intent.kind !== "compute") return;
  const delegation = buildAskLiosDelegation(intent);
  assert.equal(delegation.engineId, "valuation.dcf");
  assert.equal(delegation.view, "valuation");
  assert.match(delegation.message, /deterministic engine/i);
  assert.match(delegation.message, /execute the governed engine/i);
  assert.match(delegation.message, /required inputs/i);
  assert.match(delegation.message, /contextual workspace action/i);
  assert.match(delegation.message, /rather than approximating/i);
});
