import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalMacro, getBuiltInTerminalMacros, resolveTerminalMacro, validateTerminalMacro } from "./terminalMacros";

test("built-in equity tearsheet is inspectable and resolves active symbol", () => {
  const macro = getBuiltInTerminalMacros().find((item) => item.name === "Equity Tearsheet");
  assert.ok(macro);
  const steps = resolveTerminalMacro(macro, "nvda");
  assert.equal(steps.some((item) => item.view === "valuation" && item.symbol === "NVDA"), true);
  assert.equal(steps.length, macro.steps.length);
});

test("global macro steps do not inherit an active ticker", () => {
  const macro = getBuiltInTerminalMacros().find((item) => item.name === "Morning Review");
  assert.ok(macro);
  const steps = resolveTerminalMacro(macro, "AAPL");
  assert.equal(steps.find((item) => item.view === "market")?.symbol, undefined);
  assert.equal(steps.find((item) => item.view === "macrodashboard")?.symbol, undefined);
});

test("custom macros validate visible step requirements", () => {
  const empty = createTerminalMacro({ name: "My Macro" });
  assert.deepEqual(validateTerminalMacro(empty), ["Add at least one visible step."]);
});
