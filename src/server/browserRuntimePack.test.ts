import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserProjectNetworkAuthority } from "./browserConnectorRuntime";
import {
  createBrowserRuntimePackTransport,
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
