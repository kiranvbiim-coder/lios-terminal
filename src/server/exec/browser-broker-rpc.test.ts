import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertExecutionOperationBinding,
  describeExecutionOperation,
  ExecutionOperationMismatchError,
} from "./operation-identity";
import { createContainerExecutionBackend } from "./backends/container";
import { ExecutionBackendUnavailableError } from "./backends/types";

const IMAGE = "ghcr.io/example/lios-browser@sha256:" + "b".repeat(64);
const DOCKER_TARGET = "unix:///var/run/docker.sock";

function containerBackend() {
  return createContainerExecutionBackend({
    engine: "docker",
    engineTarget: DOCKER_TARGET,
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 512 * 1024 * 1024,
    maxProcesses: 64,
  }, {
    generationId: () => "browser-rpc-test-00000001",
    retryDelayMs: 0,
  });
}

test("SI-02 L12 exact-operation identity binds the closed broker-RPC stdin policy", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-browser-rpc-operation-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const argv = [process.execPath, "-e", "process.stdin.resume()"];

  const approved = await describeExecutionOperation({
    argv,
    cwd,
    stdinMode: "pipe-open",
    interactiveInputPolicy: "sandbox-broker-rpc",
  });

  assert.equal(approved.launch.stdin.mode, "interactive-approved");
  assert.equal(approved.launch.stdin.interactiveInputPolicy, "sandbox-broker-rpc");

  await assert.rejects(
    () => assertExecutionOperationBinding({
      argv,
      cwd,
      stdinMode: "pipe-open",
      interactiveInputPolicy: "sandbox-readonly-console",
    }, approved.digest),
    ExecutionOperationMismatchError,
  );
});

test("SI-02 L12 container admits only the labelled broker-RPC pipe and stays physically network-none", async () => {
  const backend = containerBackend();
  const plan = await backend.prepare({
    argv: ["/opt/lios/bin/node", "/opt/lios/browser/playwright-worker.cjs"],
    stdinMode: "pipe-open",
    interactiveInputPolicy: "sandbox-broker-rpc",
    isolation: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    resources: {
      maxWallTimeMs: 5_000,
      maxCapturedOutputChars: 32_768,
    },
  });

  assert.equal(plan.spawn.stdinMode, "pipe-open");
  assert.equal(plan.spawn.interactiveInputPolicy, "sandbox-broker-rpc");
  assert.ok(plan.spawn.argv.includes("--interactive"));
  assert.ok(plan.spawn.argv.includes("--network=none"));
  assert.deepEqual(plan.facts.isolation, {
    filesystem: "sandbox",
    network: "deny",
    processes: "sandbox",
  });

  await assert.rejects(
    () => backend.prepare({
      argv: ["/opt/lios/bin/node", "/opt/lios/browser/playwright-worker.cjs"],
      stdinMode: "pipe-open",
      isolation: {
        filesystem: "sandbox",
        network: "deny",
        processes: "sandbox",
      },
      resources: {
        maxWallTimeMs: 5_000,
        maxCapturedOutputChars: 32_768,
      },
    }),
    ExecutionBackendUnavailableError,
  );
});
