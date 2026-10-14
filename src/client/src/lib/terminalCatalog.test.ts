import test from "node:test";
import assert from "node:assert/strict";
import { getTerminalCapability, searchTerminalCapabilities } from "./terminalCatalog";

test("catalog makes DCF discoverable from natural task language", () => {
  const results = searchTerminalCapabilities("intrinsic value", false);
  assert.equal(results[0]?.view, "valuation");
  assert.equal(getTerminalCapability("valuation").shortLabel, "DCF");
});

test("catalog respects internal and client audience boundaries", () => {
  assert.equal(searchTerminalCapabilities("decision engine", false).some((item) => item.view === "decisionengine"), false);
  assert.equal(searchTerminalCapabilities("decision engine", true).some((item) => item.view === "decisionengine"), true);
  assert.equal(searchTerminalCapabilities("my data", true).some((item) => item.view === "clientdata"), false);
  assert.equal(searchTerminalCapabilities("my data", false).some((item) => item.view === "clientdata"), true);
});

test("empty search returns hero capabilities instead of the full catalog", () => {
  const results = searchTerminalCapabilities("", false);
  assert.ok(results.length > 0);
  assert.ok(results.every((item) => item.hero));
});
