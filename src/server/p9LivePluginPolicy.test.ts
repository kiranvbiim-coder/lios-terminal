import assert from "node:assert/strict";
import test from "node:test";
import { assertP9LivePluginDependencies } from "./p9LivePluginPolicy";

const trusted = { state: "trusted" as const, packageDigest: "a".repeat(64), runtimeKind: "node_process" };

test("D4 saved P13 dependencies require a currently installed signed package", () => {
  const seen: string[] = [];
  assert.doesNotThrow(() => assertP9LivePluginDependencies(["lios.conversation-runtime", "provider:openai"], () => {
    throw new Error("Unrelated P9 workflow attempted plugin lookup.");
  }));
  assert.doesNotThrow(() => assertP9LivePluginDependencies(
    ["plugin:research.vendor", "plugin:research.vendor", "other:stable"],
    id => { seen.push(id); return trusted; },
  ));
  assert.deepEqual(seen, ["research.vendor"], "repeat refs cannot multiply trust checks");
  for (const state of [
    null,
    { ...trusted, state: "revoked" as const },
    { ...trusted, state: "unknown_signer" as const },
    { ...trusted, state: "invalid" as const },
    { ...trusted, state: "unsigned" as const },
    { ...trusted, packageDigest: null },
  ]) {
    assert.throws(() => assertP9LivePluginDependencies(
      ["plugin:research.vendor"], () => state,
    ), /not currently installed|lacks current signed package trust/);
  }
});
test("D4 saved plugin references reject ambiguous and injected package identifiers", () => {
  for (const ref of ["plugin:", "plugin:aa", "plugin:../../other", "plugin:vendor/app", "plugin:Vendor", "plugin:alpha@1.0.0", "plugin:alpha:tool"]) {
    assert.throws(() => assertP9LivePluginDependencies([ref], () => trusted), /invalid plugin package reference/);
  }
});
