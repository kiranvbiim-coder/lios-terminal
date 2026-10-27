/**
 * Actual LIOS production Node server -> owned process supervisor -> authenticated
 * Python HTTP sidecar -> numerical engine. No mock server or direct Python spawn.
 *
 * Hosted source process acceptance ONLY: not frozen PyInstaller/Electron/P14.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getProcessSupervisor } from "./exec";
import {
  callPythonService, getPythonServiceEnvironment, PythonServiceDataError,
  stopPythonService,
} from "./pythonService";
import {
  REVERSE_BODY, REVERSE_ROUTE, verifyReverseDcfResult,
} from "../script/sp01_strict_python_valuation_contract.mjs";

test("production Node-owned Python sidecar executes known-answer DCF and rejects invalid assumptions", {
  timeout: 60_000,
}, async () => {
  const keys = [
    "LIOS_EXECUTION_ISOLATION", "PYTHON_REMOTE_SERVICE_URL",
    "PYTHON_REMOTE_SERVICE_TOKEN", "PYTHON_LOCAL_SERVICE_DISABLED",
    "PYTHON_EXECUTABLE", "ELECTRON_RESOURCES_PATH",
  ] as const;
  const prior = keys.map(key => [key, process.env[key]] as const);
  // This test explicitly qualifies the legacy-host / owned-local sidecar
  // pathway. It must not suggest strict container isolation was exercised.
  process.env.LIOS_EXECUTION_ISOLATION = "legacy-host";
  delete process.env.PYTHON_REMOTE_SERVICE_URL;
  delete process.env.PYTHON_REMOTE_SERVICE_TOKEN;
  delete process.env.PYTHON_LOCAL_SERVICE_DISABLED;
  delete process.env.ELECTRON_RESOURCES_PATH;

  // Use the same Python interpreter whose pinned packages CI installed.
  // The normal packaged app selects its own frozen executable instead.
  const python = process.env.PYTHON_EXECUTABLE;
  if (!python) throw new Error("Real sidecar test requires the CI-pinned PYTHON_EXECUTABLE.");
  const releaseOwnedChildren = getProcessSupervisor().acquireScopeCleanup("service:python");
  stopPythonService();
  try {
    const [first, second] = await Promise.all([
      callPythonService<Record<string, unknown>>(REVERSE_ROUTE, REVERSE_BODY, {
        isolationMode: "legacy-host", timeoutMs: 20_000,
      }),
      callPythonService<Record<string, unknown>>(REVERSE_ROUTE, REVERSE_BODY, {
        isolationMode: "legacy-host", timeoutMs: 20_000,
      }),
    ]);
    // Both calls exercised the canonical server-owned, token-authenticated
    // process and its actual HTTP route rather than a mocked transport.
    verifyReverseDcfResult(first);
    verifyReverseDcfResult(second);
    assert.deepEqual(first, second, "same synthetic inputs must be reproducible");

    const inventory = await getPythonServiceEnvironment();
    assert.ok(inventory.packages.numpy);
    assert.ok(inventory.packages.scipy);

    await assert.rejects(
      callPythonService(REVERSE_ROUTE, {
        ...REVERSE_BODY, currentRevenue: 0,
      }, { isolationMode: "legacy-host", timeoutMs: 10_000 }),
      error => error instanceof PythonServiceDataError,
      "invalid source numerical inputs must not become a false success",
    );

    // Input validation must not poison a healthy Python process.
    verifyReverseDcfResult(await callPythonService(
      REVERSE_ROUTE, REVERSE_BODY, {
        isolationMode: "legacy-host", timeoutMs: 20_000,
      },
    ));
  } finally {
    stopPythonService();
    await releaseOwnedChildren();
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
