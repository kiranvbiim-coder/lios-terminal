import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CONTAINER_BASE_TMPFS_BYTES,
  containerArchiveTmpfsBytes,
  createContainerExecutionBackend,
} from "./container";
import { ExecutionBackendUnavailableError } from "./types";
import type { ExecutionBackendRequest } from "./types";

const IMAGE = "ghcr.io/example/lios-sandbox@sha256:" + "a".repeat(64);
const DOCKER_TARGET = "unix:///var/run/docker.sock";
const PODMAN_TARGET = "unix:///run/user/1000/podman/podman.sock";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-container-backend-"));
  return { root };
}

function backend(engine: "docker" | "podman" = "docker") {
  return createContainerExecutionBackend({
    engine,
    engineTarget: engine === "docker" ? DOCKER_TARGET : PODMAN_TARGET,
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 512 * 1024 * 1024,
    maxProcesses: 64,
  }, {
    generationId: () => "test-generation-00000001",
    retryDelayMs: 0,
  });
}

function request(
  overrides: Partial<ExecutionBackendRequest> = {},
): ExecutionBackendRequest {
  return {
    argv: ["/bin/sh", "-lc", "printf ok"],
    isolation: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    resources: {
      maxWallTimeMs: 5_000,
      maxCapturedOutputChars: 32_768,
    },
    ...overrides,
  };
}

test("archive tmpfs grows beyond the 64 MiB floor for admitted tar overhead", () => {
  assert.equal(containerArchiveTmpfsBytes(0), CONTAINER_BASE_TMPFS_BYTES);
  assert.equal(
    containerArchiveTmpfsBytes(CONTAINER_BASE_TMPFS_BYTES),
    CONTAINER_BASE_TMPFS_BYTES + 1024 * 1024,
  );
  assert.throws(() => containerArchiveTmpfsBytes(-1), /non-negative safe integer/);
});
test("container backend advertises isolated process namespace and enforceable hard bounds", () => {
  const value = backend();
  assert.equal(value.id, "lios.execution.docker");
  assert.deepEqual(value.capabilities.filesystem, ["sandbox"]);
  assert.deepEqual(value.capabilities.network, ["deny"]);
  assert.deepEqual(value.capabilities.processes, ["sandbox"]);
  assert.deepEqual(value.capabilities.resourceControls, [
    "wall-time",
    "captured-output",
    "memory",
    "process-count",
  ]);
});

test("hardened Docker plan uses explicit local target, immutable image and exact entrypoint", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const plan = await backend().prepare(request());
  assert.equal(plan.backendId, "lios.execution.docker");
  assert.deepEqual(plan.spawn.argv.slice(0, 3), ["docker", "--host=" + DOCKER_TARGET, "run"]);
  assert.ok(plan.spawn.argv.includes("--name=lios-exec-test-generation-00000001"));
  assert.equal(plan.facts.runtimeGenerationId, "lios-exec-test-generation-00000001");
  assert.equal(plan.lifecycle?.finalize instanceof Function, true);
  assert.equal(plan.spawn.onCancel, plan.lifecycle?.onCancel);
  for (const required of [
    "--rm",
    "--restart=no",
    "--init",
    "--pull=never",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--network=none",
    "--ipc=private",
    "--no-healthcheck",
    "--log-driver=none",
    "--sig-proxy=true",
    "--stop-timeout=2",
    "--user=10001:10001",
    "--entrypoint=/bin/sh",
  ]) {
    assert.ok(plan.spawn.argv.includes(required), required);
  }
  assert.ok(plan.spawn.argv.includes("--memory=" + String(512 * 1024 * 1024) + "b"));
  assert.ok(plan.spawn.argv.includes("--memory-swap=" + String(512 * 1024 * 1024) + "b"));
  assert.ok(plan.spawn.argv.includes("--pids-limit=64"));
  assert.ok(plan.spawn.argv.includes(IMAGE));
  assert.equal(plan.spawn.cwd, undefined);
  assert.equal(plan.spawn.argv.includes("--mount"), false);
  assert.ok(plan.spawn.argv.includes("--workdir=/tmp"));
  assert.equal(plan.spawn.timeoutMs, 5_000);
  assert.equal(plan.spawn.captureOutput, true);
  assert.equal(plan.spawn.argv.includes("--pid=private"), false, "Docker defaults to a private PID namespace");
});

test("Podman plan uses explicit local target and private PID namespace", async () => {
  const plan = await backend("podman").prepare(request());
  assert.deepEqual(plan.spawn.argv.slice(0, 3), ["podman", "--url=" + PODMAN_TARGET, "run"]);
  assert.ok(plan.spawn.argv.includes("--pid=private"));
});

test("host workspace/no-filesystem postures are refused until their own authority exists", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  for (const isolation of [
    { filesystem: "workspace-readonly", network: "deny", processes: "sandbox" },
    { filesystem: "workspace-readwrite", network: "deny", processes: "sandbox" },
    { filesystem: "host", network: "deny", processes: "sandbox" },
    { filesystem: "none", network: "deny", processes: "sandbox" },
  ] as const) {
    await assert.rejects(
      () => backend().prepare(request({ cwd: f.root, isolation })),
      (error: unknown) => {
        assert.ok(error instanceof ExecutionBackendUnavailableError);
        assert.equal(error.reason, "filesystem-isolation-unsupported");
        return true;
      },
    );
  }
});

test("request hard limits can tighten but never widen backend ceilings", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const plan = await backend().prepare(request({
    resources: {
      maxWallTimeMs: 3_000,
      maxCapturedOutputChars: 4_096,
      maxMemoryBytes: 128 * 1024 * 1024,
      maxProcesses: 8,
    },
  }));
  assert.equal(plan.facts.resources.maxMemoryBytes, 128 * 1024 * 1024);
  assert.equal(plan.facts.resources.maxProcesses, 8);
  assert.ok(plan.spawn.argv.includes("--memory=" + String(128 * 1024 * 1024) + "b"));
  assert.ok(plan.spawn.argv.includes("--pids-limit=8"));

  const capped = await backend().prepare(request({
    resources: {
      maxWallTimeMs: 3_000,
      maxCapturedOutputChars: 4_096,
      maxMemoryBytes: 2 * 1024 * 1024 * 1024,
      maxProcesses: 999,
    },
  }));
  assert.equal(capped.facts.resources.maxMemoryBytes, 512 * 1024 * 1024);
  assert.equal(capped.facts.resources.maxProcesses, 64);
});

test("container backend refuses host/network/process escape and unsupported quota semantics", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const cases: ExecutionBackendRequest[] = [
    request({
      isolation: { filesystem: "sandbox", network: "inherit", processes: "sandbox" },
    }),
    request({
      isolation: { filesystem: "sandbox", network: "deny", processes: "host" },
    }),
    request({
      resources: {
        maxWallTimeMs: 5_000,
        maxCapturedOutputChars: 32_768,
        maxCpuTimeMs: 1_000,
      },
    }),
    request({
      resources: {
        maxWallTimeMs: 5_000,
        maxCapturedOutputChars: 32_768,
        maxStorageBytes: 1024 * 1024,
      },
    }),
  ];
  for (const value of cases) {
    await assert.rejects(() => backend().prepare(value), ExecutionBackendUnavailableError);
  }
});

test("container backend does not serialize request environment or ambiguous launch semantics", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  for (const value of [
    request({ env: { SECRET: "do-not-put-in-argv" } }),
    request({ envProfile: "python-runtime" }),
    request({ argv0: "other-name" }),
    request({ windowsVerbatimArguments: true }),
    request({ stdinMode: "pipe-open" }),
  ]) {
    await assert.rejects(() => backend().prepare(value), ExecutionBackendUnavailableError);
  }
});

test("fixed stdin uses interactive attach but remains outside argv", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const secret = "stdin-secret-value";
  const plan = await backend().prepare(request({ input: secret }));
  assert.ok(plan.spawn.argv.includes("--interactive"));
  assert.equal(JSON.stringify(plan.spawn.argv).includes(secret), false);
  assert.equal(plan.spawn.input, secret);
});

test("absolute in-container executable identity is required", async () => {
  await assert.rejects(
    () => backend().prepare(request({ argv: ["sh", "-lc", "printf nope"] })),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "request-invalid");
      return true;
    },
  );
});

test("immutable image, explicit local target and non-root user are required", () => {
  assert.throws(() => createContainerExecutionBackend({
    engine: "docker",
    engineTarget: DOCKER_TARGET,
    image: "ubuntu:latest",
    user: "10001:10001",
    maxMemoryBytes: 1024,
    maxProcesses: 4,
  }), /immutable sha256 digest/);
  assert.throws(() => createContainerExecutionBackend({
    engine: "docker",
    engineTarget: "tcp://127.0.0.1:2375",
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 1024,
    maxProcesses: 4,
  }), /local unix:\/\/ endpoint/);
  assert.throws(() => createContainerExecutionBackend({
    engine: "other" as "docker",
    engineTarget: DOCKER_TARGET,
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 1024,
    maxProcesses: 4,
  }), /docker or podman/);
  assert.throws(() => createContainerExecutionBackend({
    engine: "docker",
    engineTarget: DOCKER_TARGET,
    image: IMAGE,
    user: "0:0",
    maxMemoryBytes: 1024,
    maxProcesses: 4,
  }), /non-root numeric uid:gid/);
});

test("option-shaped image references are rejected", () => {
  assert.throws(() => createContainerExecutionBackend({
    engine: "docker",
    engineTarget: DOCKER_TARGET,
    image: "--privileged@sha256:" + "b".repeat(64),
    user: "10001:10001",
    maxMemoryBytes: 1024,
    maxProcesses: 4,
  }), /immutable sha256 digest/);
});

test("workspace bridge streams explicit inputs into private tmpfs and returns only declared outputs", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.root, "input.txt"), "alpha");

  const calls: string[][] = [];
  const config = {
    engine: "docker" as const,
    engineTarget: DOCKER_TARGET,
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 512 * 1024 * 1024,
    maxProcesses: 64,
    workspaceBridge: {
      shellPath: "/bin/sh",
      base64Path: "/usr/bin/base64",
      tarPath: "/bin/tar",
      tmpfsBytes: 16 * 1024 * 1024,
    },
  };
  const value = createContainerExecutionBackend(config, {
    generationId: () => "workspace-generation-0001",
    retryDelayMs: 0,
    controlRunner: async (argv) => {
      calls.push([...argv]);
      const operation = argv[2];
      if (operation === "cp") throw new Error("tmpfs is unavailable after the child exits");
      if (operation === "rm") return { code: 0, stdout: "", stderr: "" };
      if (operation === "inspect") return { code: 1, stdout: "", stderr: "No such container" };
      throw new Error("unexpected control command");
    },
  });

  const plan = await value.prepare(request({
    workspaceTransfer: {
      root: f.root,
      inputs: ["input.txt"],
      outputs: ["result.txt"],
      mode: "write-return",
    },
  }));

  assert.equal(plan.spawn.argv.includes("--rm"), false, "lifecycle owns authoritative removal");
  assert.ok(plan.spawn.argv.some((arg) => arg.startsWith("--tmpfs=/workspace:")));
  assert.ok(plan.spawn.argv.includes("--entrypoint=/bin/sh"));
  assert.ok(plan.spawn.argv.includes("/usr/bin/base64"));
  assert.ok(plan.spawn.argv.includes("/bin/tar"));
  assert.ok(plan.spawn.argv.includes("/bin/sh"));
  assert.equal(JSON.stringify(plan.spawn.argv).includes(f.root), false, "host root never enters container argv");
  assert.equal(JSON.stringify(plan.facts).includes(f.root), false, "receipt facts omit host root");
  assert.equal(plan.facts.workspaceTransfer?.inputs[0]?.path, "input.txt");
  assert.match(plan.facts.workspaceTransfer?.inputs[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(typeof plan.spawn.input, "string");
  assert.equal(JSON.stringify(plan.spawn.argv).includes(plan.spawn.input ?? ""), false);
  assert.equal(plan.spawn.captureOutput, false, "raw transport cannot enter the normal exit payload");
  const token = plan.spawn.input!.split("\n", 1)[0]!;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(plan.spawn.argv).includes(token), false);
  assert.equal(JSON.stringify(plan.facts).includes(token), false);
  const bridgeScript = plan.spawn.argv[plan.spawn.argv.indexOf("-c") + 1]!;
  assert.match(bridgeScript, /IFS= read -r token/);
  assert.match(bridgeScript, /LIOS-OUTPUT-%s-FILE-0/);
  const encoded = Buffer.from("computed").toString("base64");
  plan.spawn.onStdoutRaw?.(Buffer.from(`user stdout\n\nLIOS-OUTPUT-${token}-BEGIN\nLIOS-OUTPUT-${token}-FILE-0\n${encoded}\n\nLIOS-OUTPUT-${token}-DONE\n`));
  const sanitized = plan.lifecycle!.acceptExit!({
    reason: "exit", exitCode: 0, exitSignal: null, durationMs: 1,
    stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false,
    timedOut: false, noOutputTimedOut: false,
  });
  assert.equal(sanitized.stdout, "user stdout\n");
  assert.equal(sanitized.stdout.includes(encoded), false);

  const finalized = await plan.lifecycle!.finalize();
  assert.equal(finalized.workspaceOutputs?.[0]?.path, "result.txt");
  assert.equal(finalized.workspaceOutputs?.[0]?.data.toString("utf8"), "computed");
  assert.deepEqual(calls.map((argv) => argv[2]), ["rm", "inspect"]);
  assert.ok(calls.every((argv) => argv[1] === "--host=" + DOCKER_TARGET));

  config.workspaceBridge.shellPath = "/mutated";
  const second = await value.prepare(request({
    workspaceTransfer: {
      root: f.root,
      inputs: ["input.txt"],
      mode: "ingress-only",
    },
  }));
  assert.ok(second.spawn.argv.includes("--entrypoint=/bin/sh"), "backend snapshots bridge config");
  assert.equal(second.spawn.argv.includes("--entrypoint=/mutated"), false);
});

test("workspace bridge fails closed before host reads when unsupported and cannot share user stdin", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const missingRoot = path.join(f.root, "does-not-exist");

  await assert.rejects(
    () => backend().prepare(request({
      workspaceTransfer: {
        root: missingRoot,
        inputs: ["secret.txt"],
        mode: "ingress-only",
      },
    })),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "filesystem-isolation-unsupported");
      return true;
    },
  );

  const bridged = createContainerExecutionBackend({
    engine: "docker",
    engineTarget: DOCKER_TARGET,
    image: IMAGE,
    user: "10001:10001",
    maxMemoryBytes: 512 * 1024 * 1024,
    maxProcesses: 64,
    workspaceBridge: {
      shellPath: "/bin/sh",
      base64Path: "/usr/bin/base64",
      tarPath: "/bin/tar",
      tmpfsBytes: 16 * 1024 * 1024,
    },
  }, {
    generationId: () => "workspace-generation-0002",
  });
  fs.writeFileSync(path.join(f.root, "input.txt"), "alpha");
  await assert.rejects(
    () => bridged.prepare(request({
      input: "user-stdin",
      workspaceTransfer: {
        root: f.root,
        inputs: ["input.txt"],
        mode: "ingress-only",
      },
    })),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "request-invalid");
      return true;
    },
  );
});

test("live authorization survives admission and pre-cancelled authority fails secret-safe", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  const plan = await backend().prepare(request({ signal: controller.signal }));
  assert.equal(plan.signal, controller.signal);
  controller.abort(new Error("revoked"));
  assert.equal(plan.signal?.aborted, true);

  const sentinel = "PRIVATE_CONTAINER_ABORT_SENTINEL_245";
  await assert.rejects(
    () => backend("podman").prepare(request({ signal: AbortSignal.abort(new Error(sentinel)) })),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionBackendUnavailableError);
      assert.equal(error.reason, "authorization-cancelled");
      assert.equal(error.message.includes(sentinel), false);
      return true;
    },
  );
});
