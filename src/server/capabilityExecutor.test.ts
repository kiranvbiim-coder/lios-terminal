import assert from "node:assert/strict";
import test from "node:test";
import { createLiOSContext } from "@shared/context";
import { ADVANCED_QUANT_PATHS, type AdvancedQuantExecution } from "./advancedQuantExecution";
import {
  CapabilityExecutionError,
  CapabilityExecutor,
  advancedQuantPathForCapability,
  createDefaultCapabilityExecutor,
  type CapabilityExecutionContext,
} from "./capabilityExecutor";
import { CapabilityRegistry, createDefaultCapabilityRegistry } from "./capabilityRegistry";

function sampleCapability(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    description: `Capability ${id}`,
    category: "test",
    version: "1.0.0",
    availability: { state: "available" },
    execution: { target: "typescript", deterministic: true, seeded: false },
    surfaces: ["api", "master_ai"],
    source: { kind: "internal", files: ["server/capabilityExecutor.test.ts"] },
    ...overrides,
  };
}

test("executor rejects unknown, unavailable and unsupported capability execution", async () => {
  const registry = new CapabilityRegistry();
  registry.register(sampleCapability("test.available"));
  registry.register(sampleCapability("test.configurable", {
    availability: { state: "configurable", reason: "Needs provider setup." },
  }));
  const executor = new CapabilityExecutor(registry);
  executor.register("test.available", async () => ({ ok: true }));

  await assert.rejects(
    executor.execute("test.unknown", {}, { surface: "api" }),
    (error: unknown) => error instanceof CapabilityExecutionError && error.code === "unknown_capability",
  );
  await assert.rejects(
    executor.execute("test.configurable", {}, { surface: "api" }),
    (error: unknown) => error instanceof CapabilityExecutionError && error.code === "capability_unavailable",
  );
  await assert.rejects(
    executor.execute("test.available", {}, { surface: "workspace" }),
    (error: unknown) => error instanceof CapabilityExecutionError && error.code === "unsupported_surface",
  );
});

test("executor refuses duplicate and missing handlers", async () => {
  const registry = new CapabilityRegistry();
  registry.register(sampleCapability("test.one"));
  registry.register(sampleCapability("test.two"));
  const executor = new CapabilityExecutor(registry);
  executor.register("test.one", async () => "ok");

  assert.throws(
    () => executor.register("test.one", async () => "duplicate"),
    (error: unknown) => error instanceof CapabilityExecutionError && error.code === "duplicate_handler",
  );
  await assert.rejects(
    executor.execute("test.two", {}, { surface: "api" }),
    (error: unknown) => error instanceof CapabilityExecutionError && error.code === "handler_missing",
  );
});

test("executor validates and forwards one normalized LiOS context to handlers", async () => {
  const registry = new CapabilityRegistry();
  registry.register(sampleCapability("test.context"));
  const executor = new CapabilityExecutor(registry);
  let observed: CapabilityExecutionContext | undefined;
  executor.register("test.context", async (_input, context) => {
    observed = context;
    return "ok";
  });
  const context = createLiOSContext({
    entity: { entityId: null, symbol: "nvda", name: null, exchange: null, region: null, assetClass: "equity" },
    scenarioId: "bear-case",
    viewId: "valuation",
  });

  assert.equal(await executor.execute("test.context", {}, { surface: "master_ai", context }), "ok");
  assert.equal(observed?.context?.entity?.symbol, "NVDA");
  assert.equal(observed?.context?.scenarioId, "bear-case");
  assert.notEqual(observed?.context, context, "dispatcher should forward a parsed copy, not the caller-owned object");

  await assert.rejects(
    executor.execute("test.context", {}, {
      surface: "master_ai",
      context: { ...context, time: { mode: "as-known-on", asOfDate: null } } as typeof context,
    }),
    (error: unknown) => error instanceof CapabilityExecutionError && error.code === "invalid_context",
  );
});

test("default dispatcher wires every advanced quant capability exactly once", () => {
  const registry = createDefaultCapabilityRegistry();
  const executor = createDefaultCapabilityExecutor({
    registry,
    runAdvancedQuant: async () => ({}) as AdvancedQuantExecution,
  });

  assert.equal(executor.executableIds().length, ADVANCED_QUANT_PATHS.length);
  assert.equal(new Set(executor.executableIds()).size, ADVANCED_QUANT_PATHS.length);
  assert.equal(
    executor.executableIds().every((id) => registry.get(id)?.execution.target === "python_sidecar"),
    true,
  );
});

test("Master AI and API dispatch resolve to the same advanced quant handler", async () => {
  const registry = createDefaultCapabilityRegistry();
  const calls: Array<{ path: string; input: unknown; signal?: AbortSignal }> = [];
  const fakeResult = { source: "shared-handler" } as unknown as AdvancedQuantExecution;
  const executor = createDefaultCapabilityExecutor({
    registry,
    runAdvancedQuant: async (path, input, options) => {
      calls.push({ path, input, signal: options?.signal });
      return fakeResult;
    },
  });
  const capabilityId = "python.advanced.valuation.reverse-dcf";
  assert.equal(advancedQuantPathForCapability(capabilityId), "valuation/reverse-dcf");

  const api = await executor.execute(capabilityId, { revenue: 100 }, { surface: "api" });
  const ai = await executor.execute(capabilityId, { revenue: 100 }, { surface: "master_ai" });

  assert.equal(api, fakeResult);
  assert.equal(ai, fakeResult);
  assert.deepEqual(calls.map((call) => call.path), ["valuation/reverse-dcf", "valuation/reverse-dcf"]);
  assert.deepEqual(calls.map((call) => call.input), [{ revenue: 100 }, { revenue: 100 }]);
});
