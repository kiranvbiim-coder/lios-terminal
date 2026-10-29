import crypto from "node:crypto";
import { z } from "zod";
import type { BrowserAutomationAdapter, BrowserConnectorRequest, BrowserProjectNetworkAuthority } from "./browserConnectorRuntime";
import type { ExecutionBackendLaunchPlan } from "./exec/backends/types";
import { describeExecutionOperation } from "./exec/operation-identity";
import { startPreparedSpawn, type PreparedSpawnSession } from "./exec/run-command";
import { getProcessSupervisor } from "./exec";
import type { SandboxRuntimeProfile } from "./exec/sandbox-runtime-profile";
import type { IsolatedPlaywrightBackendTransport } from "./playwrightBrowserAdapter";
import { requestPublicPinned } from "./p13PluginNetworkBroker";
import { createBoundedUtf8Tail } from "./browser-runtime-pack/bounded-utf8-tail";
import { BROWSER_RUNTIME_WORKER_SOURCE } from "./browser-runtime-pack/worker-source";

const PROTOCOL = "lios-browser-broker/1" as const;
const MAX_WORKER_FRAME_BYTES = 64 * 1024;
const MAX_RESOURCE_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_NETWORK_REQUESTS = 64;
const MAX_PENDING_COMMANDS = 4;
const WORKER_READY_TIMEOUT_MS = 15_000;
const WORKER_CLOSE_TIMEOUT_MS = 5_000;

const safeCodeSchema = z.string().regex(/^[a-z0-9_]{1,80}$/);
const workerFrameSchema = z.discriminatedUnion("kind", [
  z.object({ protocol: z.literal(PROTOCOL), kind: z.literal("ready") }).strict(),
  z.object({ protocol: z.literal(PROTOCOL), kind: z.literal("fatal"), code: safeCodeSchema }).strict(),
  z.object({
    protocol: z.literal(PROTOCOL),
    kind: z.literal("network.request"),
    requestId: z.string().regex(/^network-[1-9][0-9]{0,5}$/),
    url: z.string().url().max(4_000),
    method: z.enum(["GET", "HEAD"]),
    headers: z.record(z.string().max(8_192)),
  }).strict(),
  z.object({
    protocol: z.literal(PROTOCOL),
    kind: z.literal("command.result"),
    requestId: z.string().uuid(),
    result: z.unknown(),
  }).strict(),
  z.object({
    protocol: z.literal(PROTOCOL),
    kind: z.literal("command.error"),
    requestId: z.string().uuid(),
    code: safeCodeSchema,
  }).strict(),
]);
type WorkerFrame = z.infer<typeof workerFrameSchema>;

interface CommandCompletion {
  promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(reason?: unknown): void;
}
type StartSpawn = typeof startPreparedSpawn;
type PinnedRequester = typeof requestPublicPinned;

export interface BrowserRuntimePackDependencies {
  startSpawn?: StartSpawn;
  requestPinned?: PinnedRequester;
  readyTimeoutMs?: number;
  closeTimeoutMs?: number;
}

export class BrowserRuntimePackUnavailableError extends Error {
  readonly code = "browser_runtime_pack_unavailable" as const;

  constructor(message = "Approved isolated Browser Runtime Pack is unavailable.") {
    super(message);
    this.name = "BrowserRuntimePackUnavailableError";
  }
}

function absolutePackPath(value: string | undefined, fallback: string, name: string): string {
  const resolved = value?.trim() || fallback;
  if (!resolved.startsWith("/") || resolved.includes("\0")) {
    throw new BrowserRuntimePackUnavailableError(`${name} must be an absolute in-image path.`);
  }
  return resolved;
}

function workerArgv(profile: SandboxRuntimeProfile, env: NodeJS.ProcessEnv): string[] {
  if (profile.mode !== "strict" || !profile.backend || !profile.tools.node) {
    throw new BrowserRuntimePackUnavailableError();
  }
  const playwrightModule = absolutePackPath(
    env.LIOS_EXECUTION_BROWSER_PLAYWRIGHT_MODULE,
    "/opt/lios/node_modules/playwright-core",
    "LIOS_EXECUTION_BROWSER_PLAYWRIGHT_MODULE",
  );
  const chromiumExecutable = absolutePackPath(
    env.LIOS_EXECUTION_BROWSER_CHROMIUM,
    "/opt/lios/browser/chromium",
    "LIOS_EXECUTION_BROWSER_CHROMIUM",
  );
  return [profile.tools.node, "-e", BROWSER_RUNTIME_WORKER_SOURCE, playwrightModule, chromiumExecutable];
}

function jsonLine(frame: Record<string, unknown>): string {
  const line = JSON.stringify(frame);
  if (Buffer.byteLength(line) > 3 * 1024 * 1024) {
    throw new BrowserRuntimePackUnavailableError("Browser broker response exceeded the bounded stdin frame.");
  }
  return `${line}\n`;
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 && value! <= 30_000 ? value! : fallback;
}

async function waitBounded<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  const timeout = Promise.withResolvers<T>();
  const timer = setTimeout(() => {
    onTimeout();
    timeout.reject(new BrowserRuntimePackUnavailableError("Browser runtime worker did not respond within its lifecycle bound."));
  }, timeoutMs);
  timer.unref?.();
  try {
    return await Promise.race([promise, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

async function exactSpawnPlan(plan: ExecutionBackendLaunchPlan): Promise<ExecutionBackendLaunchPlan["spawn"]> {
  const operation = await describeExecutionOperation({
    argv: [...plan.spawn.argv],
    cwd: plan.spawn.cwd,
    env: plan.spawn.env,
    envProfile: plan.spawn.envProfile,
    argv0: plan.spawn.argv0,
    windowsVerbatimArguments: plan.spawn.windowsVerbatimArguments,
    input: plan.spawn.input,
    stdinMode: plan.spawn.stdinMode,
    interactiveInputPolicy: plan.spawn.interactiveInputPolicy,
    filePaths: plan.spawn.operationFilePaths,
  });
  return { ...plan.spawn, expectedOperationDigest: operation.digest };
}

class BrowserRuntimePackAdapter implements BrowserAutomationAdapter {
  readonly id = "lios.browser-runtime-pack.playwright";
  readonly networkProjectId: number;
  private readonly commands = new Map<string, CommandCompletion>();
  private readonly brokerTasks = new Set<Promise<void>>();
  private readonly ready = Promise.withResolvers<void>();
  private readonly stderr = createBoundedUtf8Tail(8 * 1024);
  private readonly transportController = new AbortController();
  private session: PreparedSpawnSession | null = null;
  private stdoutBuffer = "";
  private terminalError: Error | null = null;
  private requestCount = 0;
  private responseBytes = 0;
  private completion: Promise<void> | null = null;
  private closing: Promise<void> | null = null;

  constructor(
    private readonly plan: ExecutionBackendLaunchPlan,
    private readonly networkAuthority: BrowserProjectNetworkAuthority,
    private readonly dependencies: BrowserRuntimePackDependencies,
  ) {
    this.networkProjectId = networkAuthority.projectId;
  }

  async open(): Promise<void> {
    const spawn = await exactSpawnPlan(this.plan);
    const start = this.dependencies.startSpawn ?? startPreparedSpawn;
    this.session = await start(spawn, this.plan.signal, getProcessSupervisor(), {
      lifecycle: this.plan.lifecycle,
      onStdout: (chunk) => this.onStdout(chunk),
      onStderr: (chunk) => this.stderr.append(chunk),
    });
    this.completion = this.session.wait().then(
      () => this.finish(new BrowserRuntimePackUnavailableError("Browser runtime worker exited.")),
      () => this.finish(new BrowserRuntimePackUnavailableError("Browser runtime worker terminated.")),
    );
    await waitBounded(
      this.ready.promise,
      boundedTimeout(this.dependencies.readyTimeoutMs, WORKER_READY_TIMEOUT_MS),
      () => this.session?.cancel("overall-timeout"),
    );
  }

  private finish(error: Error): void {
    if (!this.terminalError) this.terminalError = error;
    this.ready.reject(this.terminalError);
    for (const command of this.commands.values()) command.reject(this.terminalError);
    this.commands.clear();
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer) > MAX_WORKER_FRAME_BYTES * 2) {
      this.session?.cancel("spawn-error");
      this.finish(new BrowserRuntimePackUnavailableError("Browser worker emitted an oversized frame."));
      return;
    }
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_WORKER_FRAME_BYTES) {
        this.session?.cancel("spawn-error");
        this.finish(new BrowserRuntimePackUnavailableError("Browser worker emitted an oversized frame."));
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        this.session?.cancel("spawn-error");
        this.finish(new BrowserRuntimePackUnavailableError("Browser worker emitted invalid RPC output."));
        return;
      }
      const parsed = workerFrameSchema.safeParse(raw);
      if (!parsed.success) {
        this.session?.cancel("spawn-error");
        this.finish(new BrowserRuntimePackUnavailableError("Browser worker emitted an invalid RPC frame."));
        return;
      }
      this.dispatch(parsed.data);
    }
  }

  private dispatch(frame: WorkerFrame): void {
    if (frame.kind === "ready") {
      this.ready.resolve();
      return;
    }
    if (frame.kind === "fatal") {
      this.session?.cancel("spawn-error");
      this.finish(new BrowserRuntimePackUnavailableError(`Browser runtime pack failed closed (${frame.code}).`));
      return;
    }
    if (frame.kind === "network.request") {
      const task = this.handleNetwork(frame).finally(() => this.brokerTasks.delete(task));
      this.brokerTasks.add(task);
      return;
    }
    const command = this.commands.get(frame.requestId);
    if (!command) return;
    this.commands.delete(frame.requestId);
    if (frame.kind === "command.result") command.resolve(frame.result);
    else command.reject(new BrowserRuntimePackUnavailableError(`Browser worker command failed (${frame.code}).`));
  }

  private async handleNetwork(frame: Extract<WorkerFrame, { kind: "network.request" }>): Promise<void> {
    try {
      this.requestCount += 1;
      if (this.requestCount > MAX_NETWORK_REQUESTS) throw new Error("network_request_limit");
      const url = this.networkAuthority.authorize(frame.url);
      const requester = this.dependencies.requestPinned ?? requestPublicPinned;
      const signal = this.plan.signal
        ? AbortSignal.any([this.plan.signal, this.transportController.signal])
        : this.transportController.signal;
      const response = await requester({
        url,
        method: frame.method,
        headers: frame.headers,
        body: null,
        timeoutMs: 15_000,
        maxResponseBytes: MAX_RESOURCE_RESPONSE_BYTES,
        signal,
      });
      this.responseBytes += response.body.byteLength;
      if (this.responseBytes > MAX_TOTAL_RESPONSE_BYTES) throw new Error("network_total_response_too_large");
      await this.session?.writeInput(jsonLine({
        protocol: PROTOCOL,
        kind: "network.response",
        requestId: frame.requestId,
        status: response.status,
        headers: response.headers,
        bodyBase64: response.body.toString("base64"),
      }));
    } catch {
      await this.session?.writeInput(jsonLine({
        protocol: PROTOCOL,
        kind: "network.error",
        requestId: frame.requestId,
        code: "network_request_failed",
      })).catch(() => undefined);
    }
  }

  private async command(method: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.session || this.terminalError) throw this.terminalError ?? new BrowserRuntimePackUnavailableError();
    if (this.commands.size >= MAX_PENDING_COMMANDS) {
      throw new BrowserRuntimePackUnavailableError("Browser runtime command concurrency limit reached.");
    }
    const requestId = crypto.randomUUID();
    const completion = Promise.withResolvers<unknown>();
    this.commands.set(requestId, completion);
    try {
      await this.session.writeInput(jsonLine({ protocol: PROTOCOL, kind: "command", requestId, method, ...payload }));
      return await completion.promise;
    } finally {
      this.commands.delete(requestId);
    }
  }

  async navigate(url: string, timeoutMs: number): Promise<string> {
    const result = z.object({ url: z.string().url().max(4_000) }).strict().parse(
      await this.command("navigate", { url, timeoutMs }),
    );
    return result.url;
  }

  async extract(input: BrowserConnectorRequest["extraction"]): Promise<unknown> {
    return this.command("extract", { input });
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      this.transportController.abort();
      const session = this.session;
      if (!session) return;
      try {
        await waitBounded(
          this.command("shutdown", {}),
          boundedTimeout(this.dependencies.closeTimeoutMs, WORKER_CLOSE_TIMEOUT_MS),
          () => session.cancel("manual-cancel"),
        );
      } catch {
        session.cancel("manual-cancel");
      }
      await Promise.allSettled([...this.brokerTasks]);
      await this.completion?.catch(() => undefined);
    })();
    return this.closing;
  }
}

export function createBrowserRuntimePackTransport(
  profile: SandboxRuntimeProfile,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: BrowserRuntimePackDependencies = {},
): IsolatedPlaywrightBackendTransport {
  const argv = workerArgv(profile, env);
  return {
    worker: { argv },
    async open(plan, networkAuthority) {
      const adapter = new BrowserRuntimePackAdapter(plan, networkAuthority, dependencies);
      await adapter.open();
      return adapter;
    },
  };
}
