import test from "node:test";
import assert from "node:assert/strict";
import { chatTerminalCapabilities } from "./chatTerminalContext";
import { countDiscoveredChatTools, discoverChatTools } from "./chatToolDiscovery";
import { PRIMARY_WORKSPACES, type WorkspaceAudience } from "./featureRegistry";

test("Chat tool discovery mirrors the existing audience-specific registry without duplication", () => {
  for (const audience of ["internal", "client", "trial"] as const satisfies readonly WorkspaceAudience[]) {
    const groups = discoverChatTools(audience);
    const visible = groups.flatMap(group => group.tools);
    const canonical = chatTerminalCapabilities(audience);
    assert.deepEqual(visible.map(tool => tool.view).sort(), canonical.map(tool => tool.view).sort());
    assert.equal(countDiscoveredChatTools(groups), canonical.length);
    assert.equal(new Set(visible.map(tool => tool.view)).size, canonical.length);
    assert.ok(groups.every(group => group.tools.length > 0));
    assert.ok(groups.every(group => PRIMARY_WORKSPACES.some(workspace => workspace.key === group.key && workspace.label === group.label)));
    assert.ok(groups.every(group => group.tools.every(tool => tool.workspace === group.key)));
    assert.ok(!visible.some(tool => ["missioncontrol", "agent", "artifact", "developer", "adminconsole", "environment"].includes(tool.view)));
  }
});

test("search works across known finance and non-finance view metadata, irrespective of case", () => {
  const valuation = discoverChatTools("client", "  vaLuaTion  ").flatMap(group => group.tools);
  assert.ok(valuation.some(item => item.view === "valuation"));
  const environment = discoverChatTools("client", "climate").flatMap(group => group.tools);
  assert.ok(environment.length > 0 && environment.some(item => /climate/i.test([item.label, item.description, item.domain, ...item.keywords].join(" "))));
  assert.equal(countDiscoveredChatTools(discoverChatTools("client", "xyz_never_a_registered_lios_tool")), 0);
});

test("unauthorized internal capabilities cannot leak through text search or groups", () => {
  for (const audience of ["client", "trial"] as const) {
    const all = discoverChatTools(audience);
    const internalOnly = discoverChatTools(audience, "integratedmodel").flatMap(group => group.tools);
    assert.ok(!all.flatMap(group => group.tools).some(item => item.view === "integratedmodel"));
    assert.ok(!internalOnly.some(item => item.view === "integratedmodel"));
  }
});

test("the query is bounded while preserving partial match and no-match states", () => {
  const query = "valuation".padEnd(140, " ");
  assert.ok(discoverChatTools("internal", query).some(group => group.tools.some(item => item.view === "valuation")));
  assert.deepEqual(discoverChatTools("internal", "  doesnotexistinsidecapabilities  "), []);
});
