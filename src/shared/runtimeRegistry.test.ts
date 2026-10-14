import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeRegistry, RuntimeRegistryError } from "./runtimeRegistry";
import type { RuntimeAdapter } from "./runtimeContracts";

function adapter(id: string, kind: "agent" | "tool" = "agent", replaceable = true): RuntimeAdapter {
  return {
    descriptor: {
      contractVersion: "1",
      id,
      kind,
      name: id,
      version: "1.0.0",
      lifecycle: "builtin",
      executionScopes: ["node_worker"],
      capabilities: [],
      permissions: [],
      runtimePackId: null,
      replaceable,
      source: {
        origin: "lios",
        importedPaths: [],
        modified: false,
      },
    },
  };
}

test("runtime registry rejects accidental duplicate ownership", () => {
  const registry = new RuntimeRegistry();
  registry.register(adapter("agent:research"));
  assert.throws(
    () => registry.register(adapter("agent:research")),
    RuntimeRegistryError,
  );
});

test("runtime registry replacement is explicit, same-kind and replaceability-aware", () => {
  const registry = new RuntimeRegistry();
  registry.register(adapter("agent:research"));
  registry.register(adapter("agent:research"), { replace: true });
  assert.equal(registry.require("agent:research").descriptor.kind, "agent");

  assert.throws(
    () => registry.register(adapter("agent:research", "tool"), { replace: true }),
    /cannot change kind/i,
  );

  const locked = new RuntimeRegistry();
  locked.register(adapter("agent:locked", "agent", false));
  assert.throws(
    () => locked.register(adapter("agent:locked"), { replace: true }),
    /not replaceable/i,
  );
});

test("batch registration is transactional with respect to validation/duplicates", () => {
  const registry = new RuntimeRegistry();
  assert.throws(
    () => registry.registerMany([
      adapter("tool:one", "tool"),
      adapter("tool:one", "tool"),
    ]),
    /duplicated in the registration batch/i,
  );
  assert.equal(registry.list().length, 0);
});

test("registry snapshots are sorted and detached from mutable callers", () => {
  const registry = new RuntimeRegistry();
  registry.registerMany([
    adapter("agent:z"),
    adapter("agent:a"),
  ]);

  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot.map((entry) => entry.id), ["agent:a", "agent:z"]);
  assert.notEqual(snapshot[0], registry.require("agent:a").descriptor);
});

test("missing health probes return an honest non-verified availability state", async () => {
  const registry = new RuntimeRegistry();
  const optional = adapter("agent:optional");
  optional.descriptor.lifecycle = "optional";
  registry.register(optional);

  const health = await registry.healthSnapshot();
  assert.equal(health.length, 1);
  assert.equal(health[0].state, "configurable");
  assert.match(health[0].detail, /no active health probe/i);
});


test("P11 capability routes resolve primary, validator and fallback through the existing registry", () => {
  const registry = new RuntimeRegistry();
  registry.registerMany([
    adapter("tool:portfolio-primary", "tool"),
    adapter("tool:portfolio-validator", "tool"),
    adapter("tool:portfolio-fallback", "tool"),
  ]);
  registry.registerCapabilityRoute({
    capability: "portfolio.optimize.hrp",
    deterministic: true,
    primary: { componentId: "tool:portfolio-primary", packId: "lios.portfolio" },
    validator: { componentId: "tool:portfolio-validator", packId: "lios.portfolio" },
    fallback: { componentId: "tool:portfolio-fallback", packId: "lios.portfolio" },
    entitlement: null,
  });

  const resolved = registry.resolveCapability("portfolio.optimize.hrp");
  assert.equal(resolved.primary.descriptor.id, "tool:portfolio-primary");
  assert.equal(resolved.validator?.descriptor.id, "tool:portfolio-validator");
  assert.equal(resolved.fallback?.descriptor.id, "tool:portfolio-fallback");
  assert.equal(registry.resolveCapabilityRole("portfolio.optimize.hrp", "validator")?.descriptor.id, "tool:portfolio-validator");
});

test("P11 capability routes fail closed on missing components and are removed when a target is unregistered", () => {
  const registry = new RuntimeRegistry();
  registry.register(adapter("tool:primary", "tool"));
  assert.throws(() => registry.registerCapabilityRoute({
    capability: "finance.valuation.reverse_dcf",
    deterministic: true,
    primary: { componentId: "tool:missing", packId: "lios.finance" },
    validator: null,
    fallback: null,
    entitlement: null,
  }), /not registered/i);

  registry.registerCapabilityRoute({
    capability: "finance.valuation.reverse_dcf",
    deterministic: true,
    primary: { componentId: "tool:primary", packId: "lios.finance" },
    validator: null,
    fallback: null,
    entitlement: null,
  });
  assert.equal(registry.listCapabilityRoutes().length, 1);
  registry.unregister("tool:primary");
  assert.equal(registry.listCapabilityRoutes().length, 0);
});
