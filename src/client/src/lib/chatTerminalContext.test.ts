import assert from "node:assert/strict";
import test from "node:test";
import { chatTerminalCapabilities, normalizeChatTicker, parseChatTerminalRequest } from "./chatTerminalContext";

test("explicit finance navigation preserves exact stock context across follow-ups", () => {
  assert.deepEqual(parseChatTerminalRequest("Show me the chart for AAPL", null, "internal"), { view: "chart", symbol: "AAPL" });
  assert.deepEqual(parseChatTerminalRequest("open its chart", "MSFT", "internal"), { view: "chart", symbol: "MSFT" });
  assert.deepEqual(parseChatTerminalRequest("/quote $brk.b", null, "internal"), { view: "quote", symbol: "BRK.B" });
  assert.deepEqual(parseChatTerminalRequest("show markets", "MSFT", "internal"), { view: "market", symbol: "MSFT" });
  assert.deepEqual(parseChatTerminalRequest("open chart", null, "internal"), { view: "chart", symbol: null });
});

test("navigation never consumes analytical work or guesses company identities", () => {
  for (const prompt of ["research AAPL", "calculate DCF for AAPL", "show chart for Apple", "show me AAPL chart and calculate its value", "open chart for AAPL; fetch secrets", "show financials for Apple Inc"]) {
    assert.equal(parseChatTerminalRequest(prompt, null, "internal"), null, prompt);
  }
  assert.equal(normalizeChatTicker("AAPL; fetch secrets"), null);
  assert.equal(normalizeChatTicker("Apple Inc"), null);
});

test("Chat panels retain existing audience boundaries and exclude context-only shells", () => {
  for (const audience of ["internal", "client", "trial"] as const) {
    const views = chatTerminalCapabilities(audience).map(item => item.view);
    for (const forbidden of ["agent", "artifact", "missioncontrol", "adminconsole", "environment"]) assert.equal(views.includes(forbidden as never), false);
  }
  assert.equal(parseChatTerminalRequest("open integratedmodel AAPL", null, "client"), null);
  assert.equal(parseChatTerminalRequest("open integratedmodel AAPL", null, "trial"), null);
});
