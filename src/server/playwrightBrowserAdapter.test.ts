import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserProjectNetworkAuthority,
  type BrowserAutomationAdapter,
  type BrowserProjectNetworkAuthority,
} from "./browserConnectorRuntime";
import { BROWSER_RUNTIME_ISOLATION } from "./exec/browser-isolation";
import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionBackendRequest,
} from "./exec/backends/types";
import {
  createPlaywrightBrowserAdapter,
  PLAYWRIGHT_BROWSER_ADAPTER_ID,
  type IsolatedPlaywrightBackendTransport,
} from "./playwrightBrowserAdapter";

const browserPolicy = {
  projectId: 1,
  allowedDomains: ["sec.gov"],
  allowDownloads: false,
  downloadMaxBytes: 0,
  filesystemWriteRoots: [],
  navigationTimeoutMs: 30_000,
  maxPages: 2,
};

function networkAuthority(): BrowserProjectNetworkAuthority {
  return createBrowserProjectNetworkAuthority(browserPolicy);
}

function adapter(id = "test.browser.adapter"): BrowserAutomationAdapter {
  return {
    id,
    async navigate() {},
    async extract() { return "ok"; },
    async close() {},
  };
}

function preparedPlan(backendId: string, request: ExecutionBackendRequest): ExecutionBackendLaunchPlan {
  return {
    backendId,
    spawn: {
      mode: "child",
      argv: [...request.argv],
      cwd: request.cwd,
      env: request.env,
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
}

function browserBackend(
  prepare: (request: ExecutionBackendRequest) => Promise<ExecutionBackendLaunchPlan>,
): ExecutionBackend {
  return {
    id: "test.browser.brokered",
    capabilities: {
      filesystem: ["sandbox"],
      network: ["brokered"],
      processes: ["sandbox"],
      resourceControls: ["wall-time", "memory", "process-count"],
    },
    prepare,
  };
}

function isolatedTransport(
  opened: (
    plan: ExecutionBackendLaunchPlan,
    network: BrowserProjectNetworkAuthority,
  ) => void = () => undefined,
): IsolatedPlaywrightBackendTransport {
  return {
    worker: {
      argv: ["/opt/lios/bin/node", "/opt/lios/browser/playwright-worker.js"],
      env: { LIOS_BROWSER_BROKER: "project-policy" },
    },
    async open(plan, network) {
      opened(plan, network);
      return adapter();
    },
  };
}


test("P5 strict isolation refuses host Playwright when canonical backend is absent", async () => {
  await assert.rejects(
    () => createPlaywrightBrowserAdapter({ isolationMode: "canonical-isolated" }),
    /No canonical browser runtime currently proves/,
  );
});

test("SI-02 L12 strict path prepares the browser worker through the canonical backend before opening transport", async () => {
  const controller = new AbortController();
  const prepared: ExecutionBackendRequest[] = [];
  const opened: ExecutionBackendLaunchPlan[] = [];
  const projects: number[] = [];
  const backend = browserBackend(async (request) => {
    prepared.push(request);
    return preparedPlan("test.browser.brokered", request);
  });

  const result = await createPlaywrightBrowserAdapter({
    isolationMode: "canonical-isolated",
    backend,
    signal: controller.signal,
    networkAuthority: networkAuthority(),
    isolatedTransport: isolatedTransport((plan, network) => {
      opened.push(plan);
      projects.push(network.projectId);
      assert.equal(network.authorize("https://www.sec.gov/edgar").hostname, "www.sec.gov");
      assert.throws(() => network.authorize("https://example.com/"), /outside Project policy/i);
    }),
  });

  assert.equal(result.id, "test.browser.adapter");
  assert.equal(result.networkProjectId, 1);
  assert.equal(prepared.length, 1);
  assert.deepEqual(prepared[0]!.isolation, BROWSER_RUNTIME_ISOLATION);
  assert.deepEqual(prepared[0]!.argv, ["/opt/lios/bin/node", "/opt/lios/browser/playwright-worker.js"]);
  assert.deepEqual(prepared[0]!.env, { LIOS_BROWSER_BROKER: "project-policy" });
  assert.equal(prepared[0]!.stdinMode, "pipe-open");
  assert.equal(prepared[0]!.interactiveInputPolicy, "sandbox-broker-rpc");
  assert.equal(prepared[0]!.signal, controller.signal);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]!.backendId, backend.id);
  assert.equal(opened[0]!.signal, controller.signal);
  assert.deepEqual(projects, [1]);
});

test("SI-02 L12 strict path fails closed before backend preparation when Project network authority is missing", async () => {
  let prepared = 0;
  let opened = false;
  const backend = browserBackend(async (request) => {
    prepared += 1;
    return preparedPlan("test.browser.brokered", request);
  });
  await assert.rejects(
    () => createPlaywrightBrowserAdapter({
      isolationMode: "canonical-isolated",
      backend,
      isolatedTransport: isolatedTransport(() => { opened = true; }),
    }),
    /Project-scoped browser network authority is not configured/,
  );
  assert.equal(prepared, 0);
  assert.equal(opened, false);
});

test("SI-02 L12 strict path still fails closed when the approved backend transport is missing", async () => {
  let prepared = 0;
  const backend = browserBackend(async (request) => {
    prepared += 1;
    return preparedPlan("test.browser.brokered", request);
  });
  await assert.rejects(
    () => createPlaywrightBrowserAdapter({
      isolationMode: "canonical-isolated",
      backend,
      networkAuthority: networkAuthority(),
    }),
    /isolated Playwright backend transport is not configured/,
  );
  assert.equal(prepared, 0, "do not prepare a browser process that cannot be opened through the approved transport");
});

test("SI-02 L12 rejects a backend plan that weakens brokered browser isolation", async () => {
  let opened = false;
  const backend = browserBackend(async (request) => ({
    ...preparedPlan("test.browser.brokered", request),
    facts: {
      isolation: { filesystem: "sandbox", network: "inherit", processes: "sandbox" },
      resources: { ...request.resources },
    },
  }));
  await assert.rejects(
    () => createPlaywrightBrowserAdapter({
      isolationMode: "canonical-isolated",
      backend,
      networkAuthority: networkAuthority(),
      isolatedTransport: isolatedTransport(() => { opened = true; }),
    }),
    /weakened the canonical browser isolation boundary/,
  );
  assert.equal(opened, false);
});

test("SI-02 L12 cancellation before admission cannot start the backend or leak the abort reason", async () => {
  const controller = new AbortController();
  controller.abort(new Error("private-cancel-sentinel"));
  let prepared = 0;
  let opened = false;
  const backend = browserBackend(async (request) => {
    prepared += 1;
    return preparedPlan("test.browser.brokered", request);
  });

  await assert.rejects(
    () => createPlaywrightBrowserAdapter({
      isolationMode: "canonical-isolated",
      backend,
      signal: controller.signal,
      networkAuthority: networkAuthority(),
      isolatedTransport: isolatedTransport(() => { opened = true; }),
    }),
    (error: unknown) => error instanceof Error
      && /cancelled before backend admission/.test(error.message)
      && !error.message.includes("private-cancel-sentinel"),
  );
  assert.equal(prepared, 0);
  assert.equal(opened, false);
});

test("SI-02 L12 cancellation during backend admission cannot open transport or leak backend details", async () => {
  const controller = new AbortController();
  let opened = false;
  const backend = browserBackend(async (request) => {
    assert.equal(request.signal, controller.signal);
    controller.abort(new Error("private-midflight-cancel-sentinel"));
    throw new Error("private-backend-admission-error");
  });

  await assert.rejects(
    () => createPlaywrightBrowserAdapter({
      isolationMode: "canonical-isolated",
      backend,
      signal: controller.signal,
      networkAuthority: networkAuthority(),
      isolatedTransport: isolatedTransport(() => { opened = true; }),
    }),
    (error: unknown) => error instanceof Error
      && /cancelled during backend admission/.test(error.message)
      && !error.message.includes("private-midflight-cancel-sentinel")
      && !error.message.includes("private-backend-admission-error"),
  );
  assert.equal(opened, false);
});

test("SI-02 L12 closes a transport adapter that returns a conflicting Project network binding", async () => {
  let closed = 0;
  const backend = browserBackend(async (request) => preparedPlan("test.browser.brokered", request));
  const transport: IsolatedPlaywrightBackendTransport = {
    worker: { argv: ["/opt/lios/bin/node", "/opt/lios/browser/playwright-worker.js"] },
    async open() {
      return {
        id: "test.browser.conflicting-project",
        networkProjectId: 2,
        async navigate() {},
        async extract() { return "never"; },
        async close() { closed += 1; },
      };
    },
  };

  await assert.rejects(
    () => createPlaywrightBrowserAdapter({
      isolationMode: "canonical-isolated",
      backend,
      networkAuthority: networkAuthority(),
      isolatedTransport: transport,
    }),
    /different Project network authority/i,
  );
  assert.equal(closed, 1);
});
