import assert from "node:assert/strict";
import test from "node:test";
import { classifyAskLiosIntent } from "./askLiosRouter";

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
  assert.deepEqual(classifyAskLiosIntent("In 2 sentences, what is bond duration?"), { kind: "chat" }, "Formatting digits do not authorize numerical execution.");
  assert.equal(classifyAskLiosIntent("What is the duration of a 10 year 5% bond").kind, "compute", "Explicit figures still reach the deterministic engine.");
  assert.equal(classifyAskLiosIntent("Calculate what the DV01 is").kind, "compute", "A command verb keeps engine routing.");
});

test("a particular quantity remains governed even when phrased as a question with no supplied figures", () => {
  assert.deepEqual(classifyAskLiosIntent("What is the WACC for IBM?"), { kind: "compute", engineId: "valuation.dcf", view: "valuation" });
  assert.equal(classifyAskLiosIntent("What is IBM's WACC?").kind, "compute");
});

