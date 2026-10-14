import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { LepSidecarSupervisor } from "./p11SidecarSupervisor";

function fixture(): string {
  return path.resolve(process.cwd(), "server/fixtures/p11LepFixture.mjs");
}

test("P11 LEP supervisor handshakes and executes NDJSON over owned stdin/stdout", async () => {
  const inheritedSecretKey = "LIOS_P11_FIXTURE_SECRET_DO_NOT_INHERIT";
  const previousSecret = process.env[inheritedSecretKey];
  process.env[inheritedSecretKey] = "fixture-secret-must-stay-in-lios";
  const supervisor = new LepSidecarSupervisor({
    command: process.execPath,
    args: [fixture()],
    requestTimeoutMs: 5_000,
  });
  try {
    const hello = await supervisor.start({
      packId: "lios.fixture",
      packVersion: "1.0.0",
      componentId: "fixture:sidecar",
      componentVersion: "1.0.0",
      capabilities: ["pricing.derivatives.black_scholes"],
    });
    assert.equal(hello.kind, "hello");

    const response = await supervisor.execute({
      capability: "pricing.derivatives.black_scholes",
      payload: { spot: 100 },
    });
    assert.equal(response.kind, "result");
    if (response.kind === "result") assert.deepEqual(response.result, { echoed: { spot: 100 } });

    const diagnostics = await supervisor.requestDiagnostics();
    assert.equal(diagnostics.kind, "diagnostics");
    const environmentCheck = await supervisor.execute({
      capability: "pricing.derivatives.black_scholes",
      payload: { checkEnv: inheritedSecretKey },
    });
    if (environmentCheck.kind === "result") {
      assert.equal((environmentCheck.result as { inheritedEnvironmentValue?: string | null }).inheritedEnvironmentValue, null);
    } else assert.fail("Expected a sidecar result for the environment isolation check.");
  } finally {
    supervisor.stop();
    if (previousSecret === undefined) delete process.env[inheritedSecretKey];
    else process.env[inheritedSecretKey] = previousSecret;
  }
});

test("P11 supervisor rejects raw credential-looking environment variables", () => {
  assert.throws(() => new LepSidecarSupervisor({
    command: process.execPath,
    env: { LIOS_PROVIDER_API_KEY: "must-not-be-forwarded" },
  }), /secret handles/i);
});

test("P11 sidecar crash rejects the request without crashing the LiOS process and records backoff", async () => {
  const supervisor = new LepSidecarSupervisor({
    command: process.execPath,
    args: [fixture()],
    requestTimeoutMs: 5_000,
    redactValues: ["super-secret"],
  });
  await supervisor.start({
    packId: "lios.fixture",
    packVersion: "1.0.0",
    componentId: "fixture:sidecar",
    componentVersion: "1.0.0",
    capabilities: ["pricing.derivatives.black_scholes"],
  });
  await assert.rejects(() => supervisor.execute({
    capability: "pricing.derivatives.black_scholes",
    payload: { crash: true, token: "super-secret" },
  }), /exited/i);
  const snapshot = supervisor.diagnosticsSnapshot();
  assert.equal(snapshot.running, false);
  assert.ok(snapshot.crashCount >= 1);
  assert.equal(snapshot.canRestart, false);
});

test("P11 sidecar timeout sends cooperative cancellation and keeps a responsive worker usable", async () => {
  const supervisor = new LepSidecarSupervisor({
    command: process.execPath,
    args: [fixture()],
    requestTimeoutMs: 5_000,
    cancelGraceMs: 100,
  });
  await supervisor.start({
    packId: "lios.fixture",
    packVersion: "1.0.0",
    componentId: "fixture:sidecar",
    componentVersion: "1.0.0",
    capabilities: ["pricing.derivatives.black_scholes"],
  });
  try {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort(new Error("cancelled before dispatch"));
    await assert.rejects(() => supervisor.execute({
      capability: "pricing.derivatives.black_scholes",
      payload: { shouldNotRun: true },
      signal: alreadyAborted.signal,
    }), /cancelled before dispatch/i);
    assert.equal(supervisor.diagnosticsSnapshot().running, true);

    await assert.rejects(() => supervisor.execute({
      capability: "pricing.derivatives.black_scholes",
      payload: { delayMs: 1_000 },
      deadlineMs: 50,
    }), /timed out/i);
    assert.equal(supervisor.diagnosticsSnapshot().running, true);
    const response = await supervisor.execute({
      capability: "pricing.derivatives.black_scholes",
      payload: { afterCancel: true },
    });
    assert.equal(response.kind, "result");

    const abort = new AbortController();
    let requestId = "";
    const cancelled = supervisor.execute({
      capability: "pricing.derivatives.black_scholes",
      payload: { delayMs: 1_000 },
      signal: abort.signal,
      onRequestId: (id) => { requestId = id; },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(supervisor.cancel(requestId), true);
    await assert.rejects(() => cancelled, /cancelled/i);
    assert.equal(supervisor.diagnosticsSnapshot().running, true);
  } finally {
    supervisor.stop();
  }
});

test("P11 sidecar timeout terminates an uncooperative worker after the cancellation grace period", async () => {
  const supervisor = new LepSidecarSupervisor({
    command: process.execPath,
    args: [fixture()],
    requestTimeoutMs: 5_000,
    cancelGraceMs: 40,
  });
  await supervisor.start({
    packId: "lios.fixture",
    packVersion: "1.0.0",
    componentId: "fixture:sidecar",
    componentVersion: "1.0.0",
    capabilities: ["pricing.derivatives.black_scholes"],
  });
  try {
    await assert.rejects(() => supervisor.execute({
      capability: "pricing.derivatives.black_scholes",
      payload: { neverRespond: true },
      deadlineMs: 50,
    }), /timed out/i);
    // Windows stops the worker via asynchronous taskkill; poll for the real outcome instead of a fixed sleep.
    const deadline = Date.now() + 10_000;
    while (supervisor.diagnosticsSnapshot().running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const snapshot = supervisor.diagnosticsSnapshot();
    assert.equal(snapshot.running, false);
    assert.ok(snapshot.crashCount >= 1);
  } finally {
    supervisor.stop();
  }
});

test("P11 sidecar force-kills a worker that ignores SIGTERM and waits for exit before restart", async () => {
  const supervisor = new LepSidecarSupervisor({
    command: process.execPath,
    args: [fixture()],
    requestTimeoutMs: 5_000,
    cancelGraceMs: 10,
    terminateGraceMs: 30,
  });
  const handshake = {
    packId: "lios.fixture",
    packVersion: "1.0.0",
    componentId: "fixture:sidecar",
    componentVersion: "1.0.0",
    capabilities: ["pricing.derivatives.black_scholes"],
  };
  await supervisor.start(handshake);
  const firstPid = supervisor.diagnosticsSnapshot().pid;
  try {
    await assert.rejects(() => supervisor.execute({
      capability: "pricing.derivatives.black_scholes",
      payload: { neverRespond: true, ignoreSigterm: true },
      deadlineMs: 20,
    }), /timed out/i);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(supervisor.diagnosticsSnapshot().running, false);
    assert.ok(supervisor.diagnosticsSnapshot().crashCount >= 1);

    const restartDeadline = Date.now() + 2_000;
    while (!supervisor.diagnosticsSnapshot().canRestart && Date.now() < restartDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(supervisor.diagnosticsSnapshot().canRestart, true);
    await supervisor.start(handshake);
    assert.notEqual(supervisor.diagnosticsSnapshot().pid, firstPid);
  } finally {
    supervisor.stop();
  }
});

test("P11 sidecar rejects a mismatched handshake before accepting work", async () => {
  const supervisor = new LepSidecarSupervisor({ command: process.execPath, args: [fixture()], requestTimeoutMs: 5_000 });
  await assert.rejects(() => supervisor.start({
    packId: "lios.not-the-fixture",
    packVersion: "1.0.0",
    componentId: "fixture:sidecar",
    componentVersion: "1.0.0",
    capabilities: ["pricing.derivatives.black_scholes"],
  }), /handshake does not match/i);
  supervisor.stop();
});
