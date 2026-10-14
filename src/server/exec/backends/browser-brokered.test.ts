import assert from "node:assert/strict";
import test from "node:test";
import { BROWSER_RUNTIME_ISOLATION } from "../browser-isolation";
import {
  createBrowserBrokeredExecutionBackend,
  BrowserBrokeredExecutionBackendUnavailableError,
} from "./browser-brokered";
import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionBackendRequest,
} from "./types";

function physicalDelegate(
  prepare: (request: ExecutionBackendRequest) => Promise<ExecutionBackendLaunchPlan> = async (request) => ({
    backendId: "test.physical",
    spawn: {
      mode: "child",
      argv: ["docker", "run", "--network=none", ...request.argv],
      stdinMode: request.stdinMode,
      interactiveInputPolicy: request.interactiveInputPolicy,
      timeoutMs: request.resources.maxWallTimeMs,
      maxCapturedOutputChars: request.resources.maxCapturedOutputChars,
      captureOutput: true,
    },
    signal: request.signal,
    facts: {
      isolation: { ...request.isolation },
      resources: { ...request.resources },
      runtimeGenerationId: "test-generation",
    },
  }),
): ExecutionBackend {
  return {
    id: "test.physical",
    capabilities: {
      filesystem: ["sandbox"],
      network: ["deny"],
      processes: ["sandbox"],
      resourceControls: ["wall-time", "captured-output"],
    },
    prepare,
  };
}

function browserRequest(signal?: AbortSignal): ExecutionBackendRequest {
  return {
    argv: ["/opt/lios/bin/node", "/opt/lios/browser/playwright-worker.cjs"],
    stdinMode: "pipe-open",
    interactiveInputPolicy: "sandbox-broker-rpc",
    isolation: { ...BROWSER_RUNTIME_ISOLATION },
    resources: {
      maxWallTimeMs: 30_000,
      maxCapturedOutputChars: 32_768,
    },
    signal,
  };
}

test("SI-02 L12 browser broker wrapper translates brokered egress to a physically deny-network launch", async () => {
  const seen: ExecutionBackendRequest[] = [];
  const delegate = physicalDelegate(async (request) => {
    seen.push(request);
    return physicalDelegate().prepare(request);
  });
  const backend = createBrowserBrokeredExecutionBackend(delegate);
  const controller = new AbortController();
  const plan = await backend.prepare(browserRequest(controller.signal));

  assert.equal(backend.id, "lios.browser-brokered@test.physical");
  assert.deepEqual(backend.capabilities.network, ["brokered"]);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]!.isolation, {
    filesystem: "sandbox",
    network: "deny",
    processes: "sandbox",
  });
  assert.equal(seen[0]!.stdinMode, "pipe-open");
  assert.equal(seen[0]!.interactiveInputPolicy, "sandbox-broker-rpc");
  assert.equal(seen[0]!.signal, controller.signal);

  assert.equal(plan.backendId, backend.id);
  assert.deepEqual(plan.facts.isolation, BROWSER_RUNTIME_ISOLATION);
  assert.equal(plan.spawn.stdinMode, "pipe-open");
  assert.equal(plan.spawn.interactiveInputPolicy, "sandbox-broker-rpc");
  assert.ok(plan.spawn.argv.includes("--network=none"));
  assert.equal(plan.signal, controller.signal);
  assert.equal(plan.facts.runtimeGenerationId, "test-generation");
});

test("SI-02 L12 browser broker wrapper fails closed for weak delegates and weakened prepared plans", async () => {
  const weakDelegate: ExecutionBackend = {
    id: "test.weak",
    capabilities: {
      filesystem: ["host"],
      network: ["inherit"],
      processes: ["host"],
      resourceControls: ["wall-time"],
    },
    async prepare() { throw new Error("must not run"); },
  };
  assert.throws(
    () => createBrowserBrokeredExecutionBackend(weakDelegate),
    BrowserBrokeredExecutionBackendUnavailableError,
  );

  const weakened = createBrowserBrokeredExecutionBackend(physicalDelegate(async (request) => ({
    backendId: "test.physical",
    spawn: {
      mode: "child",
      argv: ["docker", "run", "--network=host", ...request.argv],
      stdinMode: "pipe-closed",
      timeoutMs: request.resources.maxWallTimeMs,
      maxCapturedOutputChars: request.resources.maxCapturedOutputChars,
      captureOutput: true,
    },
    signal: request.signal,
    facts: {
      isolation: { filesystem: "sandbox", network: "inherit", processes: "sandbox" },
      resources: { ...request.resources },
    },
  })));

  await assert.rejects(
    () => weakened.prepare(browserRequest()),
    BrowserBrokeredExecutionBackendUnavailableError,
  );
});
