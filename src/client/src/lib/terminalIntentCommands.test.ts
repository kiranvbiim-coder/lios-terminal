import test from "node:test";
import assert from "node:assert/strict";
import { parseFlexibleTerminalCommand } from "./terminalIntentCommands";

test("supports action-first commands", () => {
  assert.deepEqual(parseFlexibleTerminalCommand("DCF NVDA"), { raw: "DCF NVDA", symbol: "NVDA", view: "valuation" });
  assert.deepEqual(parseFlexibleTerminalCommand("value msft"), { raw: "VALUE MSFT", symbol: "MSFT", view: "valuation" });
  assert.deepEqual(parseFlexibleTerminalCommand("financials reli"), { raw: "FINANCIALS RELI", symbol: "RELI", view: "financialstatements" });
  assert.deepEqual(parseFlexibleTerminalCommand("peers aapl"), { raw: "PEERS AAPL", symbol: "AAPL", view: "peercomp" });
});

test("preserves classic terminal grammar", () => {
  assert.deepEqual(parseFlexibleTerminalCommand("AAPL GP"), { raw: "AAPL GP", symbol: "AAPL", view: "chart" });
  assert.deepEqual(parseFlexibleTerminalCommand("MRKT"), { raw: "MRKT", view: "market" });
});


test("multi-word natural language is not coerced into a quote ticker", () => {
  assert.equal(parseFlexibleTerminalCommand("Why is Apple down today?"), null);
  assert.equal(parseFlexibleTerminalCommand("Explain this valuation"), null);
  assert.equal(parseFlexibleTerminalCommand("Compare Apple and Microsoft"), null);
});

test("explicit symbol and intent syntax still resolves deterministically", () => {
  assert.deepEqual(parseFlexibleTerminalCommand("AAPL GP"), { raw: "AAPL GP", symbol: "AAPL", view: "chart" });
  assert.deepEqual(parseFlexibleTerminalCommand("VALUE MSFT"), { raw: "VALUE MSFT", symbol: "MSFT", view: "valuation" });
});
