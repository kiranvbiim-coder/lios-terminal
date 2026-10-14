import assert from "node:assert/strict";
import test from "node:test";
import { P10_RUNTIME_PACK_IDS, P10_RUNTIME_PACKS, expandP10RuntimePacks, validateP10RuntimePackCatalog } from "./p10RuntimePacks";

test("P10 exposes exactly the six canonical runtime packs", () => {
  assert.deepEqual(P10_RUNTIME_PACK_IDS, ["core", "research", "quant", "modeling", "data-lab", "local-ai"]);
  assert.deepEqual(P10_RUNTIME_PACKS.map((pack) => pack.id), [...P10_RUNTIME_PACK_IDS]);
  assert.deepEqual(validateP10RuntimePackCatalog(), []);
});

test("Core is the only default-enabled P10 pack", () => {
  assert.deepEqual(P10_RUNTIME_PACKS.filter((pack) => pack.defaultEnabled).map((pack) => pack.id), ["core"]);
});

test("P10 pack expansion preserves the low-level signed allow-list and always includes core", () => {
  assert.deepEqual(expandP10RuntimePacks([]), ["core"]);
  const research = expandP10RuntimePacks(["research"]);
  assert.ok(research.includes("core"));
  assert.ok(research.includes("research-sec"));
  assert.ok(research.includes("research-docs"));
  assert.ok(!research.includes("ml"));

  const quant = expandP10RuntimePacks(["quant"]);
  for (const id of ["core", "fixed-income", "econometrics", "forecasting", "optimization", "ml"]) assert.ok(quant.includes(id));
});

test("Local AI is a capability pack and does not silently install a model/runtime package", () => {
  const local = P10_RUNTIME_PACKS.find((pack) => pack.id === "local-ai");
  assert.ok(local);
  assert.deepEqual(local.includedManagedPackIds, []);
  assert.equal(local.defaultEnabled, false);
  assert.ok(local.releaseNotes.some((note) => /does not silently|user supplies/i.test(note)));
});
