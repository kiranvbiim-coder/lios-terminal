import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry, createDefaultCapabilityRegistry } from "./capabilityRegistry";
import { discoverCapabilities } from "./capabilityDiscovery";

function capability(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: `${name} description`,
    category: "test",
    version: "1.0.0",
    availability: { state: "available" },
    execution: { target: "typescript", deterministic: true, seeded: false },
    surfaces: ["command_palette", "master_ai"],
    permissions: [],
    entitlements: [],
    contextRequirements: [],
    tags: [],
    schemaRefs: {},
    uiHints: { existingSurfaces: [], preferredView: "quantworkbench" },
    aiHints: { invocable: false, requiresConfirmation: false },
    source: { kind: "internal", files: ["server/capabilityDiscovery.test.ts"] },
    ...overrides,
  };
}

test("discovery ranks exact and prefix matches ahead of generic description matches", () => {
  const registry = new CapabilityRegistry();
  registry.registerMany([
    capability("test.reverse", "Reverse DCF"),
    capability("test.generic", "Valuation Workbench", { description: "Includes reverse DCF scenarios" }),
    capability("test.other", "Reverse Engineering"),
  ]);

  const results = discoverCapabilities("reverse dcf", { surface: "command_palette" }, registry);
  assert.deepEqual(results.map((result) => result.capabilityId), ["test.reverse", "test.generic"]);
  assert.ok(results[0].score > results[1].score);
  assert.ok(results[0].matchedOn.includes("name"));
});

test("discovery requires every query token to match somewhere in capability metadata", () => {
  const registry = new CapabilityRegistry();
  registry.registerMany([
    capability("test.credit", "Credit Stress", { tags: ["risk", "merton"] }),
    capability("test.portfolio", "Portfolio Stress", { tags: ["risk"] }),
  ]);

  assert.deepEqual(
    discoverCapabilities("credit merton", {}, registry).map((result) => result.capabilityId),
    ["test.credit"],
  );
});

test("surface and invocable filters prevent discovery surfaces from over-claiming execution", () => {
  const registry = new CapabilityRegistry();
  registry.registerMany([
    capability("test.invocable", "Invocable Tool", { aiHints: { invocable: true, requiresConfirmation: false } }),
    capability("test.discovery", "Discovery Tool"),
    capability("test.workspace", "Workspace Only", { surfaces: ["workspace"] }),
  ]);

  assert.deepEqual(
    discoverCapabilities("", { surface: "master_ai", invocableOnly: true }, registry).map((result) => result.capabilityId),
    ["test.invocable"],
  );
  assert.equal(discoverCapabilities("workspace", { surface: "command_palette" }, registry).length, 0);
});


test("SI-07 discovery retains unavailable tools but never claims they are invocable now", () => {
  const registry = new CapabilityRegistry();
  const states = ["available", "configurable", "experimental", "degraded", "disabled"] as const;
  registry.registerMany(states.map((state) =>
    capability(`tool.${state}`, `Tool ${state}`, {
      aiHints: { invocable: true, requiresConfirmation: false },
      availability: state === "available"
        ? { state }
        : { state, reason: `Requires ${state} setup or recovery.` },
    }),
  ));
  const visible = discoverCapabilities("tool", { surface: "command_palette" }, registry);
  assert.equal(visible.length, states.length);
  for (const result of visible) {
    assert.equal(result.invocable, result.availability.state === "available",
      `Capability ${result.capabilityId} must not overstate execution readiness`);
  }
  assert.deepEqual(
    discoverCapabilities("tool", { surface: "master_ai", invocableOnly: true }, registry)
      .map((result) => result.capabilityId),
    ["tool.available"],
  );
  const disabled = discoverCapabilities("tool.disabled", { surface: "command_palette" }, registry)[0];
  assert.equal(disabled?.availability.state, "disabled");
  assert.equal(disabled?.invocable, false);
});

test("default discovery exposes advanced compute with safe launch targets and connectors via Connection Center", () => {
  const registry = createDefaultCapabilityRegistry();
  const reverseDcf = discoverCapabilities("reverse dcf", { surface: "command_palette", limit: 10 }, registry);
  assert.ok(reverseDcf.length > 0);
  assert.equal(reverseDcf[0].preferredView, "valuation");
  assert.equal(reverseDcf[0].invocable, true);

  const fred = discoverCapabilities("fred macro", { surface: "command_palette", limit: 10 }, registry);
  assert.ok(fred.some((result) => result.capabilityId.startsWith("connector.fred.")));
  assert.ok(fred.filter((result) => result.capabilityId.startsWith("connector.fred.")).every((result) => result.preferredView === "connectors"));
});

test("discovery clamps result limits", () => {
  const registry = createDefaultCapabilityRegistry();
  assert.ok(discoverCapabilities("", { limit: 500 }, registry).length <= 50);
  assert.ok(discoverCapabilities("", { limit: 0 }, registry).length >= 1);
});
