import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_RUNTIME_ISOLATION,
  BrowserRuntimeIsolationUnavailableError,
  assertBrowserRuntimeIsolationBackend,
  prepareBrowserRuntimeIsolationBackend,
} from "./browser-isolation";
import type { ExecutionBackend, ExecutionBackendRequest } from "./backends/types";

function backend(network: "inherit" | "deny" | "brokered"): ExecutionBackend {
  return {
    id: "test.browser." + network,
    capabilities: {
      filesystem: ["sandbox"],
      network: [network],
      processes: ["sandbox"],
      resourceControls: ["wall-time", "memory", "process-count"],
    },
    async prepare() {
      throw new Error("not used");
    },
  };
}

test("browser isolation requires sandboxed filesystem/process and brokered egress", () => {
  assert.deepEqual(BROWSER_RUNTIME_ISOLATION, {
    filesystem: "sandbox",
    network: "brokered",
    processes: "sandbox",
  });
  assert.equal(assertBrowserRuntimeIsolationBackend(backend("brokered")).id, "test.browser.brokered");
});

test("deny and inherit network backends cannot be mislabeled as browser-policy isolation", () => {
  for (const network of ["deny", "inherit"] as const) {
    assert.throws(
      () => assertBrowserRuntimeIsolationBackend(backend(network)),
      BrowserRuntimeIsolationUnavailableError,
    );
  }
  assert.throws(
    () => assertBrowserRuntimeIsolationBackend(undefined),
    BrowserRuntimeIsolationUnavailableError,
  );
});

test("brokered network alone is insufficient without sandboxed process/filesystem posture", () => {
  const weak: ExecutionBackend = {
    id: "test.browser.weak",
    capabilities: {
      filesystem: ["host"],
      network: ["brokered"],
      processes: ["host"],
      resourceControls: ["wall-time"],
    },
    async prepare() {
      throw new Error("not used");
    },
  };
  assert.throws(
    () => assertBrowserRuntimeIsolationBackend(weak),
    /cannot satisfy the canonical browser isolation boundary/,
  );
});

test("browser backends without hard memory and task ceilings are refused", () => {
  for (const control of ["memory", "process-count"] as const) {
    const missing = backend("brokered");
    missing.capabilities = {
      ...missing.capabilities,
      resourceControls: missing.capabilities.resourceControls.filter((candidate) => candidate !== control),
    };
    assert.throws(() => assertBrowserRuntimeIsolationBackend(missing), BrowserRuntimeIsolationUnavailableError);
  }
});

test("SI-02 L12 browser worker admission requires the closed broker-RPC stdin policy", async () => {
  let admitted: ExecutionBackendRequest | null = null;
  const brokered: ExecutionBackend = {
    id: "test.browser.rpc",
    capabilities: {
      filesystem: ["sandbox"],
      network: ["brokered"],
      processes: ["sandbox"],
      resourceControls: ["wall-time", "memory", "process-count"],
    },
    async prepare(request) {
      admitted = request;
      return {
        backendId: "test.browser.rpc",
        spawn: {
          mode: "child",
          argv: [...request.argv],
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
        },
      };
    },
  };

  await prepareBrowserRuntimeIsolationBackend(brokered, {
    argv: ["/opt/lios/bin/node", "/opt/lios/browser/playwright-worker.cjs"],
  });

  assert.equal(admitted?.stdinMode, "pipe-open");
  assert.equal(admitted?.interactiveInputPolicy, "sandbox-broker-rpc");
});
