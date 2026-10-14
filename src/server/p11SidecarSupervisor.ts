import crypto from "node:crypto";
import { getProcessSupervisor } from "./exec";
import type { ManagedRun, ManagedRunStdin } from "./exec/types";
import { effectiveSandboxIsolationMode } from "./exec/sandbox-runtime-profile";
import {
  LIOS_ENGINE_PROTOCOL_VERSION,
  lepMessageSchema,
  type LepMessage,
} from "@shared/engineFabricContracts";

const SAFE_INHERITED_ENV_KEYS = [
  "PATH",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
] as const;

type Pending = {
  requestKind: LepMessage["kind"];
  expected: Set<LepMessage["kind"]>;
  resolve: (message: LepMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cleanup: () => void;
};

interface SidecarProcess {
  run: ManagedRun;
  stdin: ManagedRunStdin;
  exited: boolean;
  stopping: boolean;
}

export interface LepSidecarSupervisorOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  cancelGraceMs?: number;
  terminateGraceMs?: number;
  maxRestarts?: number;
  redactValues?: string[];
  maxMessageBytes?: number;
  auxiliaryRequestHandler?: (message: unknown) => unknown | null | Promise<unknown | null>;
  isolationMode?: "legacy-host" | "strict";
}

export class LepSidecarSupervisor {
  private child: SidecarProcess | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private stdoutBuffer = "";
  private stopping = false;
  private crashCount = 0;
  private nextRestartAt = 0;
  private logs: string[] = [];
  private hello: LepMessage | null = null;
  private cancellationTimers = new Map<string, NodeJS.Timeout>();
  private cancellingRequests = new Set<string>();

  constructor(private readonly options: LepSidecarSupervisorOptions) {
    if (effectiveSandboxIsolationMode(options.isolationMode) === "strict") {
      throw new Error(
        "Strict SI-01.12 isolation is unavailable for long-lived P11 LEP sidecars; host-sidecar fallback is refused.",
      );
    }
    for (const name of Object.keys(options.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid P11 sidecar environment variable name: ${name}`);
      if (/(?:api[_-]?key|token|secret|password|credential|authorization)/i.test(name)) {
        throw new Error(`P11 sidecar secrets must be provided through governed secret handles, not environment variable ${name}.`);
      }
    }
  }

  private childEnvironment(): NodeJS.ProcessEnv {
    const inherited: NodeJS.ProcessEnv = {};
    for (const name of SAFE_INHERITED_ENV_KEYS) {
      const value = process.env[name];
      if (value !== undefined) inherited[name] = value;
    }
    return { ...inherited, ...(this.options.env ?? {}) };
  }

  private processIsAlive(child = this.child): child is SidecarProcess {
    return Boolean(child && !child.exited);
  }

  private redact(input: string): string {
    let value = input
      .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
      .replace(/(api[_-]?key|token|secret)(\s*[:=]\s*)[^\s,}]+/gi, "$1$2[REDACTED]");
    for (const secret of this.options.redactValues ?? []) {
      if (secret) value = value.split(secret).join("[REDACTED]");
    }
    return value.slice(0, 4_000);
  }

  private addLog(line: string): void {
    const redacted = this.redact(line.trim());
    if (!redacted) return;
    this.logs.push(redacted);
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
  }

  diagnosticsSnapshot() {
    return {
      running: this.processIsAlive(),
      pid: this.child?.run.pid ?? null,
      crashCount: this.crashCount,
      nextRestartAt: this.nextRestartAt || null,
      canRestart: this.canRestart(),
      handshake: this.hello,
      logs: [...this.logs],
    };
  }

  canRestart(now = Date.now()): boolean {
    return this.crashCount < (this.options.maxRestarts ?? 5) && now >= this.nextRestartAt;
  }

  private async spawnProcess(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.child) {
      if (this.processIsAlive(this.child) && !this.child.stopping) return;
      throw new Error("P11 sidecar is still stopping or finalizing its exit and cannot be restarted yet.");
    }
    if (!this.canRestart()) throw new Error("P11 sidecar restart is in backoff or crash-loop limit.");
    this.stopping = false;
    const starting = (async () => {
      const run = await getProcessSupervisor().spawn({
        mode: "child",
        argv: [this.options.command, ...(this.options.args ?? [])],
        cwd: this.options.cwd,
        env: this.childEnvironment(),
        stdinMode: "pipe-open",
        captureOutput: false,
        gracefulCancelMs: this.options.terminateGraceMs ?? 300,
        onStdout: (chunk) => this.onStdout(chunk),
        onStderr: (chunk) => {
          for (const line of chunk.split(/\r?\n/)) this.addLog(line);
        },
      });
      if (this.stopping || !run.stdin) {
        run.cancel();
        await run.waitForExtinction?.();
        throw new Error("P11 sidecar startup was stopped.");
      }
      const child: SidecarProcess = { run, stdin: run.stdin, exited: false, stopping: false };
      this.child = child;
      const onExit = (message: string) => {
        child.exited = true;
        if (this.child !== child) return;
        this.child = null;
        this.hello = null;
        if (!this.stopping) {
          this.crashCount += 1;
          const backoff = Math.min(30_000, 250 * 2 ** Math.max(0, this.crashCount - 1));
          this.nextRestartAt = Date.now() + backoff;
        }
        this.rejectAll(new Error(message));
      };
      void run.wait().then(
        (exit) => onExit(`P11 sidecar exited (code=${exit.exitCode ?? "null"}, signal=${exit.exitSignal ?? "null"}).`),
        (error: unknown) => onExit(error instanceof Error ? error.message : "P11 sidecar process failed."),
      );
    })();
    this.starting = starting;
    try {
      await starting;
    } finally {
      if (this.starting === starting) this.starting = null;
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const maxMessageBytes = this.options.maxMessageBytes ?? 2 * 1024 * 1024;
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > maxMessageBytes) {
      this.addLog("Sidecar output exceeded the bounded message buffer.");
      this.stdoutBuffer = "";
      const child = this.child;
      if (this.processIsAlive(child)) {
        child.stopping = true;
        child.run.cancel();
      }
      return;
    }
    for (;;) {
      const index = this.stdoutBuffer.indexOf("\n");
      if (index < 0) break;
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (!line) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        this.addLog("Invalid LEP JSON from sidecar: " + line);
        continue;
      }
      const parsed = lepMessageSchema.safeParse(raw);
      if (!parsed.success) {
        const handler = this.options.auxiliaryRequestHandler;
        if (!handler) {
          this.addLog("Invalid LEP message from sidecar.");
          continue;
        }
        void Promise.resolve(handler(raw)).then((response) => {
          if (response === null || response === undefined) {
            this.addLog("Unrecognized auxiliary sidecar message.");
            return;
          }
          const encoded = JSON.stringify(response);
          if (Buffer.byteLength(encoded, "utf8") > maxMessageBytes) {
            this.addLog("Auxiliary sidecar response exceeded the bounded message size.");
            return;
          }
          const child = this.child;
          if (this.processIsAlive(child) && !child.stopping) child.stdin.write(encoded + "\n");
        }).catch((error) => {
          this.addLog(error instanceof Error ? error.message : "Auxiliary sidecar handler failed.");
        });
        continue;
      }
      const message = parsed.data;
      const pending = this.pending.get(message.requestId);
      if (!pending) {
        if (message.kind !== "progress" && this.cancellingRequests.has(message.requestId)) {
          const timer = this.cancellationTimers.get(message.requestId);
          if (timer) clearTimeout(timer);
          this.cancellationTimers.delete(message.requestId);
          this.cancellingRequests.delete(message.requestId);
        }
        continue;
      }
      if (message.kind === "progress") continue;
      clearTimeout(pending.timer);
      pending.cleanup();
      this.pending.delete(message.requestId);
      if (message.kind === "error") {
        pending.reject(new Error(`P11 sidecar ${message.code}: ${message.message}`));
      } else if (pending.expected.has(message.kind)) {
        pending.resolve(message);
      } else {
        pending.reject(new Error(`Unexpected LEP response kind ${message.kind}.`));
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.cleanup();
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }

  private rejectRequest(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.cleanup();
    this.pending.delete(requestId);
    pending.reject(error);
  }

  private sendCancelAndEnforceStop(targetRequestId: string): void {
    const child = this.child;
    if (!this.processIsAlive(child) || child.stopping) return;
    this.cancellingRequests.add(targetRequestId);
    try {
      const message = lepMessageSchema.parse({
        protocolVersion: LIOS_ENGINE_PROTOCOL_VERSION,
        kind: "cancel",
        requestId: crypto.randomUUID(),
        targetRequestId,
      });
      child.stdin.write(JSON.stringify(message) + "\n");
    } catch (error) {
      this.addLog(error instanceof Error ? error.message : "Failed to send LEP cancellation.");
    }
    const previous = this.cancellationTimers.get(targetRequestId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.cancellationTimers.delete(targetRequestId);
      this.cancellingRequests.delete(targetRequestId);
      if (this.child !== child || !this.processIsAlive(child)) return;
      this.addLog(`LEP request ${targetRequestId} did not stop after cancellation; terminating the sidecar.`);
      child.stopping = true;
      child.run.cancel();
    }, this.options.cancelGraceMs ?? 250);
    timer.unref();
    this.cancellationTimers.set(targetRequestId, timer);
  }

  private request(messageInput: LepMessage, expected: LepMessage["kind"][], timeoutMs?: number, signal?: AbortSignal): Promise<LepMessage> {
    const message = lepMessageSchema.parse(messageInput);
    const child = this.child;
    if (!this.processIsAlive(child) || child.stopping) throw new Error("P11 sidecar is not running.");
    const abortError = () => signal?.reason instanceof Error ? signal.reason : new Error("P11 sidecar request was cancelled.");
    if (signal?.aborted) throw abortError();
    return new Promise((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        this.rejectRequest(message.requestId, abortError());
        this.sendCancelAndEnforceStop(message.requestId);
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.rejectRequest(message.requestId, new Error(`P11 sidecar request ${message.requestId} timed out.`));
        if (message.kind === "execute") this.sendCancelAndEnforceStop(message.requestId);
      }, timeoutMs ?? this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(message.requestId, {
        requestKind: message.kind,
        expected: new Set(expected),
        resolve: (response) => { settled = true; resolve(response); },
        reject: (error) => { settled = true; reject(error); },
        timer,
        cleanup,
      });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdin.write(JSON.stringify(message) + "\n", (error) => {
        if (!error) return;
        this.rejectRequest(message.requestId, error);
      });
    });
  }

  async start(input: {
    packId: string;
    packVersion: string;
    componentId: string;
    componentVersion: string;
    capabilities: string[];
    inputSchemaVersion?: string;
    outputSchemaVersion?: string;
    buildHash?: string | null;
  }): Promise<LepMessage> {
    await this.spawnProcess();
    const requestId = crypto.randomUUID();
    const response = await this.request(lepMessageSchema.parse({
      protocolVersion: LIOS_ENGINE_PROTOCOL_VERSION,
      kind: "hello",
      requestId,
      packId: input.packId,
      packVersion: input.packVersion,
      componentId: input.componentId,
      componentVersion: input.componentVersion,
      capabilities: input.capabilities,
      schemaVersions: {
        input: input.inputSchemaVersion ?? "1",
        output: input.outputSchemaVersion ?? "1",
      },
      platform: `${process.platform}-${process.arch}`,
      buildHash: input.buildHash ?? null,
    }), ["hello"]);
    if (response.kind !== "hello"
      || response.packId !== input.packId
      || response.packVersion !== input.packVersion
      || response.componentId !== input.componentId
      || response.componentVersion !== input.componentVersion
      || response.platform !== `${process.platform}-${process.arch}`
      || response.schemaVersions.input !== (input.inputSchemaVersion ?? "1")
      || response.schemaVersions.output !== (input.outputSchemaVersion ?? "1")
      || response.capabilities.length !== new Set(input.capabilities).size
      || input.capabilities.some((capability) => !response.capabilities.includes(capability))) {
      this.stop("invalid-handshake");
      throw new Error("P11 sidecar handshake does not match the requested pack, component, platform or capabilities.");
    }
    this.hello = response;
    this.crashCount = 0;
    this.nextRestartAt = 0;
    return response;
  }

  async execute(input: {
    capability: string;
    payload: unknown;
    executionContextRef?: string | null;
    inputSchemaVersion?: string;
    outputSchemaVersion?: string;
    dataRefs?: unknown[];
    deadlineMs?: number;
    signal?: AbortSignal;
    onRequestId?: (requestId: string) => void;
  }): Promise<LepMessage> {
    const requestId = crypto.randomUUID();
    const handshake = this.hello;
    if (!handshake || handshake.kind !== "hello" || !handshake.capabilities.includes(input.capability)) {
      throw new Error(`P11 sidecar did not advertise capability ${input.capability}.`);
    }
    input.onRequestId?.(requestId);
    const response = await this.request(lepMessageSchema.parse({
      protocolVersion: LIOS_ENGINE_PROTOCOL_VERSION,
      kind: "execute",
      requestId,
      capability: input.capability,
      executionContextRef: input.executionContextRef ?? null,
      inputSchemaVersion: input.inputSchemaVersion ?? "1",
      outputSchemaVersion: input.outputSchemaVersion ?? "1",
      dataRefs: input.dataRefs ?? [],
      input: input.payload,
      deadlineMs: input.deadlineMs ?? this.options.requestTimeoutMs ?? 30_000,
    }), ["result"], input.deadlineMs, input.signal);
    if (response.kind !== "result" || response.capability !== input.capability || response.outputSchemaVersion !== (input.outputSchemaVersion ?? "1")) {
      throw new Error("P11 sidecar result capability or schema version does not match the request.");
    }
    return response;
  }

  async requestDiagnostics(): Promise<LepMessage> {
    const requestId = crypto.randomUUID();
    return this.request(lepMessageSchema.parse({
      protocolVersion: LIOS_ENGINE_PROTOCOL_VERSION,
      kind: "diagnostics",
      requestId,
      diagnostics: {},
    }), ["diagnostics"]);
  }

  cancel(targetRequestId: string): boolean {
    const pending = this.pending.get(targetRequestId);
    if (!pending || pending.requestKind !== "execute" || !this.processIsAlive() || this.child?.stopping) return false;
    this.rejectRequest(targetRequestId, new Error("P11 sidecar execution was cancelled."));
    this.sendCancelAndEnforceStop(targetRequestId);
    return true;
  }

  stop(reason = "requested"): void {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    for (const timer of this.cancellationTimers.values()) clearTimeout(timer);
    this.cancellationTimers.clear();
    this.cancellingRequests.clear();
    try {
      const message = lepMessageSchema.parse({
        protocolVersion: LIOS_ENGINE_PROTOCOL_VERSION,
        kind: "shutdown",
        requestId: crypto.randomUUID(),
        reason,
      });
      child.stdin.write(JSON.stringify(message) + "\n");
    } catch {
      // Fall through to process termination.
    }
    setTimeout(() => {
      if (this.child !== child || child.stopping) return;
      child.stopping = true;
      child.run.cancel();
    }, 100).unref();
  }
}
