import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserProjectNetworkAuthority } from "./browserConnectorRuntime";
import {
  createBrowserRuntimePackTransport,
  workerCommandDeadlineMs,
  type BrowserRuntimePackDependencies,
} from "./browserRuntimePack";
import type { ExecutionBackendLaunchPlan } from "./exec/backends/types";
import type { PreparedSpawnSession } from "./exec/run-command";
import type { SandboxRuntimeProfile } from "./exec/sandbox-runtime-profile";

const profile: SandboxRuntimeProfile = {
  mode: "strict",
  backend: {
    id: "test.physical",
    capabilities: {
      filesystem: ["sandbox"], network: ["deny"], processes: ["sandbox"], resourceControls: ["wall-time", "captured-output"],
    },
    async prepare() { throw new Error("not used"); },
  },
  engine: "docker",
  engineTarget: "unix:///var/run/docker.sock",
  image: "example.invalid/browser@sha256:" + "a".repeat(64),
  user: "10001:10001",
  tools: { shell: "/bin/sh", base64: "/bin/base64", tar: "/bin/tar", python: "/usr/bin/python3", node: "/usr/bin/node", xlsxModule: null },
};

function launchPlan(signal: AbortSignal): ExecutionBackendLaunchPlan {
  return {
    backendId: "test.browser",
    spawn: {
      mode: "child",
      argv: [process.execPath, "-e", "process.stdin.resume()"],
      stdinMode: "pipe-open",
      interactiveInputPolicy: "sandbox-broker-rpc",
      timeoutMs: 30_000,
      maxCapturedOutputChars: 65_536,
      captureOutput: true,
    },
    signal,
    facts: {
      isolation: { filesystem: "sandbox", network: "brokered", processes: "sandbox" },
      resources: { maxWallTimeMs: 30_000, maxCapturedOutputChars: 65_536 },
    },
  };
}

test("SI-02 L12 fixed runtime pack uses prepared spawn RPC and joins shutdown", async () => {
  const controller = new AbortController();
  const exited = Promise.withResolvers<{ stdout: string; stderr: string; wallDurationMs: number }>();
  const writes: Array<Record<string, unknown>> = [];
  let emitStdout: ((chunk: string) => void) | undefined;
  let cancelled = 0;
  const startSpawn = (async (_spawn, signal, _supervisor, options) => {
    assert.equal(signal, controller.signal);
    emitStdout = options.onStdout;
    queueMicrotask(() => emitStdout?.('{"protocol":"lios-browser-broker/1","kind":"ready"}\n'));
    const session: PreparedSpawnSession = {
      async writeInput(data) {
        const frame = JSON.parse(data) as Record<string, unknown>;
        writes.push(frame);
        if (frame.kind === "command") {
          queueMicrotask(() => emitStdout?.(JSON.stringify({
            protocol: "lios-browser-broker/1",
            kind: "command.result",
            requestId: frame.requestId,
            result: frame.method === "extract" ? { text: "bounded" }
              : frame.method === "navigate" ? { url: "https://example.com/resolved" }
              : { closed: true },
          }) + "\n"));
          if (frame.method === "shutdown") exited.resolve({ stdout: "", stderr: "", wallDurationMs: 1 });
        }
      },
      cancel() { cancelled += 1; exited.resolve({ stdout: "", stderr: "", wallDurationMs: 1 }); },
      wait: () => exited.promise,
    };
    return session;
  }) satisfies NonNullable<BrowserRuntimePackDependencies["startSpawn"]>;

  const transport = createBrowserRuntimePackTransport(profile, {
    LIOS_EXECUTION_BROWSER_PLAYWRIGHT_MODULE: "/opt/runtime/playwright-core",
    LIOS_EXECUTION_BROWSER_CHROMIUM: "/opt/runtime/chromium",
  }, { startSpawn });
  const adapter = await transport.open(launchPlan(controller.signal), createBrowserProjectNetworkAuthority({
    projectId: 7,
    allowedDomains: ["example.com"],
    allowDownloads: false,
    downloadMaxBytes: 0,
    filesystemWriteRoots: [],
    navigationTimeoutMs: 30_000,
    maxPages: 1,
  }));
  assert.equal(await adapter.navigate("https://example.com/research", 10_000), "https://example.com/resolved");
  assert.deepEqual(await adapter.extract({ kind: "text" }), { text: "bounded" });
  await adapter.close();
  assert.deepEqual(writes.filter((frame) => frame.kind === "command").map((frame) => frame.method), ["navigate", "extract", "shutdown"]);
  assert.equal(cancelled, 0);
});

test("SI-02 L12 runtime pack refuses absent strict runtime and relative pack paths", () => {
  assert.throws(() => createBrowserRuntimePackTransport({ ...profile, mode: "legacy-host", backend: null }), /unavailable/i);
  assert.throws(() => createBrowserRuntimePackTransport(profile, {
    LIOS_EXECUTION_BROWSER_PLAYWRIGHT_MODULE: "relative/playwright",
  }), /absolute in-image path/i);
});

test("host command deadlines add one transport slack, clamp navigation and never exceed the worker budget plus slack", () => {
  assert.equal(workerCommandDeadlineMs("navigate", { timeoutMs: 10_000 }), 15_000);
  assert.equal(workerCommandDeadlineMs("navigate", { timeoutMs: 1 }), 6_000, "floor of one second");
  assert.equal(workerCommandDeadlineMs("navigate", { timeoutMs: 10_000_000 }), 125_000, "ceiling of two minutes");
  assert.equal(workerCommandDeadlineMs("navigate", { timeoutMs: Number.NaN }), 25_000, "malformed input uses the default");
  assert.equal(workerCommandDeadlineMs("click", {}), 13_250);
  assert.equal(workerCommandDeadlineMs("extract", {}), 10_000);
});

test("a wedged worker fails its command at the deadline, stops the isolated session once and still closes", async (t) => {
  // The production watchdog timer is unref'd (the server keeps the loop alive); a bare test process needs a ref'd handle.
  const keepAlive = setInterval(() => undefined, 1_000);
  t.after(() => clearInterval(keepAlive));
  const controller = new AbortController();
  const exited = Promise.withResolvers<{ stdout: string; stderr: string; wallDurationMs: number }>();
  const methods: string[] = [];
  let cancelled = 0;
  const startSpawn = (async (_spawn, _signal, _supervisor, options) => {
    queueMicrotask(() => options.onStdout('{"protocol":"lios-browser-broker/1","kind":"ready"}\n'));
    const session: PreparedSpawnSession = {
      async writeInput(data) {
        const frame = JSON.parse(data) as Record<string, unknown>;
        if (frame.kind !== "command") return;
        methods.push(String(frame.method));
        // navigate answers; extract/click never do (a wedged renderer); shutdown is irrelevant after cancellation.
        if (frame.method === "navigate") queueMicrotask(() => options.onStdout(JSON.stringify({
          protocol: "lios-browser-broker/1", kind: "command.result", requestId: frame.requestId, result: { url: "https://example.com/ok" },
        }) + "\n"));
      },
      cancel() { cancelled += 1; exited.resolve({ stdout: "", stderr: "", wallDurationMs: 1 }); },
      wait: () => exited.promise,
    };
    return session;
  }) satisfies NonNullable<BrowserRuntimePackDependencies["startSpawn"]>;
  const transport = createBrowserRuntimePackTransport(profile, {
    LIOS_EXECUTION_BROWSER_PLAYWRIGHT_MODULE: "/opt/runtime/playwright-core",
    LIOS_EXECUTION_BROWSER_CHROMIUM: "/opt/runtime/chromium",
  }, { startSpawn, commandTimeoutMs: 60 });
  const adapter = await transport.open(launchPlan(controller.signal), createBrowserProjectNetworkAuthority({
    projectId: 7, allowedDomains: ["example.com"], allowDownloads: false, downloadMaxBytes: 0,
    filesystemWriteRoots: [], navigationTimeoutMs: 30_000, maxPages: 1,
  }));
  assert.equal(await adapter.navigate("https://example.com/a", 10_000), "https://example.com/ok", "a responsive worker is not affected by the deadline");
  const started = Date.now();
  await assert.rejects(adapter.extract({ kind: "text" }), /did not respond within its deadline/);
  assert.ok(Date.now() - started < 2_000, "the host does not wait for the whole run budget");
  assert.equal(cancelled, 1, "the wedged worker is stopped exactly once");
  await assert.rejects(adapter.interact({ selector: "button" } as never), /isolated worker was stopped|unavailable|terminated|exited/i, "a stopped worker accepts no further command and nothing is replayed");
  await adapter.close();
  assert.deepEqual(methods.filter(method => method !== "shutdown"), ["navigate", "extract"], "the failed extract is not retried and the later click never reaches the dead worker");
});
