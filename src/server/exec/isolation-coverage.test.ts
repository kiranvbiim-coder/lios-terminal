import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SI01_ISOLATION_COVERAGE,
  assertIsolationCoverageTruth,
  backendSupportsIsolationClaim,
  type Si01IsolationCoverageEntry,
} from "./isolation-coverage";
import { createContainerExecutionBackend } from "./backends/container";
import { localExecutionBackend } from "./backends/local";
import { nodePermissionExecutionBackend } from "./backends/node-permission";
import type { ExecutionBackend } from "./backends/types";

const IMAGE = "ghcr.io/example/lios-sandbox@sha256:" + "a".repeat(64);
const DOCKER_TARGET = "unix:///var/run/docker.sock";
const PODMAN_TARGET = "unix:///run/user/1000/podman/podman.sock";

function container(engine: "docker" | "podman"): ExecutionBackend {
  return createContainerExecutionBackend({
    engine,
    engineTarget: engine === "docker" ? DOCKER_TARGET : PODMAN_TARGET,
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 512 * 1024 * 1024,
    maxProcesses: 64,
  });
}

test("SI-01 isolation matrix is unique and only backend-ready rows publish claims", () => {
  const ids = SI01_ISOLATION_COVERAGE.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of SI01_ISOLATION_COVERAGE) {
    if (entry.state === "backend-ready") {
      assert.ok(entry.claim, `${entry.id} must publish its exact backend-ready claim`);
      assert.ok(entry.backendIds.length > 0);
    } else {
      assert.equal(entry.claim, undefined, `${entry.id} must not overclaim isolation while ${entry.state}`);
    }
  }
});

test("matrix source owners remain real repository paths", () => {
  const serverRoot = path.resolve(process.cwd(), "server");
  assert.ok(fs.existsSync(serverRoot), "run this contract from the src package root");
  for (const entry of SI01_ISOLATION_COVERAGE) {
    if (entry.state === "dependency-pending") continue;
    for (const sourcePath of entry.sourcePaths) {
      assert.equal(
        fs.existsSync(path.resolve(process.cwd(), sourcePath)),
        true,
        `${entry.id} references missing owner path ${sourcePath}`,
      );
    }
  }
});

test("current backend-ready SI-01 claims are bounded by real backend capabilities", () => {
  assert.doesNotThrow(() =>
    assertIsolationCoverageTruth(
      SI01_ISOLATION_COVERAGE,
      [container("docker"), container("podman"), localExecutionBackend, nodePermissionExecutionBackend],
    ),
  );
});

test("validator rejects an isolation posture stronger than the backend advertises", () => {
  const overclaim: Si01IsolationCoverageEntry = {
    id: "privileged-shell-command",
    owner: "test",
    sourcePaths: ["test"],
    state: "backend-ready",
    backendIds: ["lios.execution.local"],
    claim: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    requiredResourceControls: ["memory", "process-count"],
    limitation: "test",
  };
  assert.throws(
    () => assertIsolationCoverageTruth([overclaim], [localExecutionBackend]),
    /stronger isolation\/resources/,
  );
});

test("validator rejects pending/in-process paths that publish an active claim", () => {
  const falseClaim: Si01IsolationCoverageEntry = {
    id: "pdf-attachment-parser",
    owner: "test",
    sourcePaths: ["server/projectAttachmentContent.ts"],
    state: "integration-required",
    backendIds: [],
    claim: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    requiredResourceControls: [],
    limitation: "test",
  };
  assert.throws(
    () => assertIsolationCoverageTruth([falseClaim], []),
    /must not publish an active isolation claim/,
  );
});

test("container shell claim requires every advertised resource control, not only isolation dimensions", () => {
  const backend = container("docker");
  assert.equal(
    backendSupportsIsolationClaim(
      backend.capabilities,
      { filesystem: "sandbox", network: "deny", processes: "sandbox" },
      ["wall-time", "captured-output", "memory", "process-count"],
    ),
    true,
  );
  assert.equal(
    backendSupportsIsolationClaim(
      backend.capabilities,
      { filesystem: "sandbox", network: "deny", processes: "sandbox" },
      ["cpu-time"],
    ),
    false,
  );
});

test("matrix truthfully records host/in-process gaps that Task 3 must integrate", () => {
  const byId = new Map(SI01_ISOLATION_COVERAGE.map((entry) => [entry.id, entry]));
  for (const id of [
    "p11-lep-python-sidecar",
    "python-http-sidecar",
  ] as const) {
    assert.equal(byId.get(id)?.state, "integration-required");
    assert.equal(byId.get(id)?.claim, undefined);
  }
  assert.equal(byId.get("p7-docling-document-parser")?.state, "backend-ready");
  assert.equal(byId.get("pdf-attachment-parser")?.state, "backend-ready");
  assert.equal(byId.get("spreadsheet-import-parser")?.state, "backend-ready");
  assert.deepEqual(byId.get("p7-docling-document-parser")?.claim, {
    filesystem: "sandbox",
    network: "deny",
    processes: "sandbox",
  });
  assert.equal(byId.get("managed-python-runtime-provisioning")?.state, "contract-gap");
  assert.equal(byId.get("playwright-browser-runtime")?.state, "integration-required");
  assert.equal(byId.get("playwright-browser-runtime")?.claim, undefined);
});
