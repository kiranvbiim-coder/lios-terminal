import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import { ADVANCED_QUANT_REGISTRY } from "./advancedQuantRegistry";
import { ADVANCED_QUANT_DEPTH2_REGISTRY } from "./advancedQuantRegistryDepth2";
import {
  CapabilityRegistry,
  advancedQuantCapabilities,
  connectorCapabilities,
  connectorDefinitionToCapabilities,
  createDefaultCapabilityRegistry,
  quantModelToCapability,
} from "./capabilityRegistry";

const ALL_ADVANCED_QUANT = [
  ...ADVANCED_QUANT_REGISTRY,
  ...ADVANCED_QUANT_DEPTH2_REGISTRY,
];

function sampleCapability(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Capability ${id}`,
    description: `Test capability ${id}`,
    category: "test",
    version: "1.0.0",
    availability: { state: "available" },
    execution: { target: "typescript", deterministic: true, seeded: false },
    surfaces: ["api", "command_palette"],
    source: { kind: "internal", files: ["server/capabilityRegistry.test.ts"] },
    ...overrides,
  };
}

test("capability registry rejects duplicate ids without partially mutating a batch", () => {
  const registry = new CapabilityRegistry();
  registry.register(sampleCapability("test.one"));
  assert.throws(() => registry.register(sampleCapability("test.one")), /Duplicate LiOS capability id/);
  assert.throws(() => registry.registerMany([
    sampleCapability("test.two"),
    sampleCapability("test.one"),
  ]), /Duplicate LiOS capability id/);
  assert.equal(registry.has("test.two"), false);
  assert.equal(registry.list().length, 1);
});

test("capability registry is deterministic and does not leak mutable stored objects", () => {
  const registry = new CapabilityRegistry();
  registry.registerMany([
    sampleCapability("test.zeta"),
    sampleCapability("test.alpha"),
  ]);
  assert.deepEqual(registry.list().map((item) => item.id), ["test.alpha", "test.zeta"]);

  const retrieved = registry.get("test.alpha");
  assert.ok(retrieved);
  retrieved.tags.push("mutated-copy");
  assert.equal(registry.get("test.alpha")?.tags.includes("mutated-copy"), false);
});

test("capability registry filters and searches across the common contract", () => {
  const registry = new CapabilityRegistry();
  registry.registerMany([
    sampleCapability("test.quant", {
      name: "Discounted Cash Flow",
      description: "Valuation engine",
      category: "valuation",
      execution: { target: "python_sidecar", deterministic: true, seeded: false },
      surfaces: ["api", "master_ai"],
      tags: ["finance", "dcf"],
    }),
    sampleCapability("test.data", {
      name: "Market Snapshot",
      description: "Market data capability",
      category: "market_data",
      execution: { target: "data_service", deterministic: false, seeded: false },
      surfaces: ["api", "workspace"],
    }),
  ]);

  assert.deepEqual(registry.find({ category: "valuation" }).map((item) => item.id), ["test.quant"]);
  assert.deepEqual(registry.find({ surface: "workspace" }).map((item) => item.id), ["test.data"]);
  assert.deepEqual(registry.find({ executionTarget: "python_sidecar" }).map((item) => item.id), ["test.quant"]);
  assert.deepEqual(registry.find({ text: "dcf" }).map((item) => item.id), ["test.quant"]);
  assert.deepEqual(registry.find({ text: "snapshot" }).map((item) => item.id), ["test.data"]);
});

test("every advanced quant wave adapts losslessly into the universal capability index", () => {
  const capabilities = advancedQuantCapabilities();
  assert.equal(capabilities.length, ALL_ADVANCED_QUANT.length);
  assert.equal(new Set(capabilities.map((item) => item.id)).size, capabilities.length);

  for (const model of ALL_ADVANCED_QUANT) {
    const capability = quantModelToCapability(model);
    assert.equal(capability.id, model.id);
    assert.equal(capability.name, model.label);
    assert.equal(capability.category, model.category);
    assert.equal(capability.version, model.version);
    assert.equal(capability.execution.endpoint, model.apiEndpoint);
    assert.equal(capability.source.sourceId, "quant-model-registry");
    assert.deepEqual(capability.uiHints.existingSurfaces, model.surfaces);
    assert.equal(capability.surfaces.includes("master_ai"), true);
    assert.equal(capability.aiHints.invocable, true);
    assert.equal(capability.execution.handlerId, `capability:${model.id}`);
  }
});

test("built-in connector contract families converge into unique discoverable capabilities", () => {
  const capabilities = connectorCapabilities();
  assert.ok(capabilities.length >= BUILT_IN_CONNECTORS.length);
  assert.equal(new Set(capabilities.map((item) => item.id)).size, capabilities.length);

  for (const definition of BUILT_IN_CONNECTORS) {
    const mapped = connectorDefinitionToCapabilities(definition);
    assert.ok(mapped.length > 0, `${definition.id} should expose at least one semantic data contract`);
    const expectedTarget = definition.category === "ai" || definition.sourceType === "local_model"
      ? "ai_provider"
      : "data_service";
    for (const capability of mapped) {
      assert.equal(capability.source.kind, "connector");
      assert.equal(capability.source.sourceId, definition.id);
      assert.equal(capability.execution.target, expectedTarget);
      assert.equal(capability.aiHints.invocable, false);
      assert.equal(capability.availability.state, definition.adapterImplemented ? "configurable" : "disabled");
    }
  }
});

test("connector capabilities preserve runtime truth instead of claiming static catalog entries are live", () => {
  const implemented = BUILT_IN_CONNECTORS.find((definition) => definition.adapterImplemented);
  const catalogOnly = BUILT_IN_CONNECTORS.find((definition) => !definition.adapterImplemented);
  assert.ok(implemented, "fixture requires an implemented built-in connector");
  assert.ok(catalogOnly, "fixture requires a catalog-only built-in connector");

  assert.equal(connectorDefinitionToCapabilities(implemented)[0].availability.state, "configurable");
  assert.match(connectorDefinitionToCapabilities(implemented)[0].availability.reason ?? "", /user-scoped connector runtime/i);
  assert.equal(connectorDefinitionToCapabilities(catalogOnly)[0].availability.state, "disabled");
});

