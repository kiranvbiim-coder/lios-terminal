import test from "node:test";
import assert from "node:assert/strict";
import { ADVANCED_QUANT_EXAMPLES } from "./advancedQuantExamples";
import { ADVANCED_QUANT_DEPTH2_EXAMPLES } from "./advancedQuantExamplesDepth2";
import { ADVANCED_QUANT_REGISTRY } from "../../../server/advancedQuantRegistry";
import { ADVANCED_QUANT_DEPTH2_REGISTRY } from "../../../server/advancedQuantRegistryDepth2";

const ALL_EXAMPLES = { ...ADVANCED_QUANT_EXAMPLES, ...ADVANCED_QUANT_DEPTH2_EXAMPLES };
const ALL_REGISTRY = [...ADVANCED_QUANT_REGISTRY, ...ADVANCED_QUANT_DEPTH2_REGISTRY];

test("every advanced quant registry model has a non-empty starter payload", () => {
  const registryIds = ALL_REGISTRY.map((entry) => entry.id).sort();
  const exampleIds = Object.keys(ALL_EXAMPLES).sort();
  assert.deepEqual(exampleIds, registryIds);
  assert.equal(registryIds.length, 85);
  for (const [id, payload] of Object.entries(ALL_EXAMPLES)) {
    assert.ok(Object.keys(payload).length > 0, `${id} has an empty example payload`);
  }
});

test("seeded stochastic advanced examples contain explicit seeds", () => {
  for (const entry of ALL_REGISTRY.filter((item) => item.determinism === "seeded_stochastic")) {
    const payload = ALL_EXAMPLES[entry.id];
    assert.ok(payload, `missing example for ${entry.id}`);
    assert.equal(typeof payload.seed, "number", `${entry.id} must expose an explicit example seed`);
  }
});

test("second-wave starter payloads cover every depth-2 model", () => {
  assert.equal(Object.keys(ADVANCED_QUANT_DEPTH2_EXAMPLES).length, ADVANCED_QUANT_DEPTH2_REGISTRY.length);
  for (const entry of ADVANCED_QUANT_DEPTH2_REGISTRY) {
    assert.ok(ADVANCED_QUANT_DEPTH2_EXAMPLES[entry.id], `missing depth-2 starter payload for ${entry.id}`);
  }
});
