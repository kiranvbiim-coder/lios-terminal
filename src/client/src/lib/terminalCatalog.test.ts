import test from "node:test";
import assert from "node:assert/strict";
import { getTerminalCapability, searchTerminalCapabilities, TERMINAL_CAPABILITIES } from "./terminalCatalog";
import { getVisibleWorkspaces, isRegisteredView, isViewVisibleToAudience } from "./featureRegistry";

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

test("context-only Artifact panes stay registered but cannot be discovered as empty capability launches", () => {
  assert.equal(isRegisteredView("artifact"), true);
  assert.equal(TERMINAL_CAPABILITIES.some(capability => capability.view === "artifact"), false);
  for (const audience of ["internal", "client", "trial"] as const) {
    assert.equal(isViewVisibleToAudience("artifact", audience), true);
    assert.equal(getVisibleWorkspaces(audience).some(workspace => workspace.views.includes("artifact")), false);
  }
  for (const internal of [true, false]) {
    assert.equal(searchTerminalCapabilities("artifact", internal, 1000).some(capability => capability.view === "artifact"), false);
  }
  assert.equal(getTerminalCapability("artifact").workspace, "outputs");
});
