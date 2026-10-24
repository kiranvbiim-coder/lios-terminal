import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import { runExecutionBackendRequest, type ExecutionBackendRunner, type ExecutionBackendRunResult } from "./exec/run-backend";
import { resolveSandboxRuntimeProfile } from "./exec/sandbox-runtime-profile";
import { matchesWorkspaceOutputDigest } from "./exec/workspace-output-integrity";

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_FILES = 63; // The canonical transfer admits 64 files, including request.json.
const MAX_ERROR_CHARS = 4_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;

export class IsolatedPythonInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolatedPythonInputError";
  }
}

export interface IsolatedPythonServiceOptions {
  serviceDir: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Internal test seam, never populated from an HTTP request or runtime configuration. */
  runner?: ExecutionBackendRunner;
}

function unavailable(message: string): Error {
  return new Error(`Isolated Python service unavailable: ${message}`);
}

function cancelled(): Error {
  const error = new Error("Isolated Python request cancelled.");
  error.name = "AbortError";
  return error;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

function serializeRequest(route: string, body: unknown): string {
  if (typeof route !== "string" || !/^\/[a-z0-9/_-]{1,255}$/i.test(route)) {
    throw new IsolatedPythonInputError("Python service route is invalid.");
  }
  let admittedBytes = 0;
  let nodes = 0;
  try {
    const serialized = JSON.stringify({ route, body }, (key, value: unknown) => {
      if (++nodes > 1_000_000) throw new Error();
      admittedBytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 2;
      if (value === null || typeof value === "boolean" || typeof value === "string" ||
          (typeof value === "number" && Number.isFinite(value))) {
        admittedBytes += Buffer.byteLength(JSON.stringify(value), "utf8");
      } else if (typeof value !== "object") {
        throw new Error();
      }
      if (admittedBytes > MAX_JSON_BYTES) throw new Error();
      return value;
    });
    if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) throw new Error();
    return serialized;
  } catch {
    throw new IsolatedPythonInputError("Python service request must be finite JSON within the 8 MiB input bound.");
  }
}

function sameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function stageSources(serviceDir: string, root: string): string[] {
  try {
    if (!fs.lstatSync(serviceDir).isDirectory()) throw new Error();
    const sourceRoot = fs.realpathSync.native(serviceDir);
    const entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
    const names = entries.filter(({ name }) => name.endsWith(".py") &&
      !name.startsWith("test") && name !== "conftest.py").map(({ name }) => name).sort();
    if (!names.includes("engine_worker.py") || names.length > MAX_SOURCE_FILES) throw new Error();
    let totalBytes = 0;
    for (const name of names) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(name)) throw new Error();
      const filename = path.join(sourceRoot, name);
      const before = fs.lstatSync(filename);
      if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_SOURCE_FILE_BYTES) throw new Error();
      totalBytes += before.size;
      if (totalBytes > MAX_SOURCE_BYTES) throw new Error();
      const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fs.fstatSync(fd);
        if (!sameFile(before, opened) || !opened.isFile()) throw new Error();
        // A growing/replaced file cannot cause an unbounded read or enter the approved snapshot.
        const bytes = Buffer.alloc(opened.size + 1);
        let count = 0;
        while (count < bytes.length) {
          const read = fs.readSync(fd, bytes, count, bytes.length - count, null);
          if (!read) break;
          count += read;
        }
        if (count !== opened.size || !sameFile(opened, fs.fstatSync(fd)) ||
            !sameFile(opened, fs.lstatSync(filename))) throw new Error();
        fs.writeFileSync(path.join(root, name), bytes.subarray(0, count), { mode: 0o600, flag: "wx" });
      } finally {
        fs.closeSync(fd);
      }
    }
    return names;
  } catch {
    throw unavailable("trusted regular Python sources are missing, unsafe, changed, or exceed the source bounds.");
  }
}

function finiteJson(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === "number" && !Number.isFinite(current)) return false;
    if (current && typeof current === "object") {
      for (const child of Object.values(current)) pending.push(child);
    }
  }
  return true;
}

function parseResult<T>(data: Buffer): T {
  let envelope: unknown;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw unavailable("worker returned malformed JSON.");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !finiteJson(envelope)) {
    throw unavailable("worker returned an invalid result protocol.");
  }
  const record = envelope as Record<string, unknown>;
  if (Object.keys(record).length === 2 && record.ok === true && Object.hasOwn(record, "result")) {
    return record.result as T;
  }
  if (Object.keys(record).length === 2 && record.ok === false && record.error &&
      typeof record.error === "object" && !Array.isArray(record.error)) {
    const error = record.error as Record<string, unknown>;
    if (Object.keys(error).length === 2 && (error.kind === "input" || error.kind === "unavailable") &&
        typeof error.message === "string" && error.message.trim()) {
      const message = error.message.slice(0, MAX_ERROR_CHARS);
      if (error.kind === "input") throw new IsolatedPythonInputError(message);
      throw unavailable(message);
    }
  }
  throw unavailable("worker returned an invalid result protocol.");
}

/** One-shot numerical calls through the existing strict GM-11 execution/transfer authority. */
export async function callIsolatedPythonService<T>(
  routePath: string,
  body: unknown,
  options: IsolatedPythonServiceOptions,
): Promise<T> {
  checkAbort(options.signal);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new IsolatedPythonInputError("Python service timeout must be a positive integer no larger than 300000 ms.");
  }
  const input = serializeRequest(routePath, body);
  // An explicit strict caller must not inherit the legacy-host default or admit a fallback.
  const runtime = resolveSandboxRuntimeProfile({ ...process.env, LIOS_EXECUTION_ISOLATION: "strict" });
  if (runtime.mode !== "strict" || !runtime.backend || !runtime.tools.python) {
    throw unavailable("strict sandbox configuration with an approved Python tool is required.");
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-python-isolated-"));
  try {
    const sources = stageSources(options.serviceDir, root);
    fs.writeFileSync(path.join(root, "request.json"), input, { mode: 0o600, flag: "wx" });
    checkAbort(options.signal);
    let executed: ExecutionBackendRunResult;
    try {
      executed = await (options.runner ?? runExecutionBackendRequest)(runtime.backend, {
        argv: [runtime.tools.python, "/workspace/engine_worker.py", "/workspace/request.json", "/workspace/result.json"],
        isolation: { filesystem: "sandbox", network: "deny", processes: "sandbox" },
        resources: {
          maxWallTimeMs: timeoutMs,
          maxCapturedOutputChars: 4_096,
          maxMemoryBytes: 1024 * 1024 * 1024,
          maxProcesses: 32,
        },
        signal: options.signal,
        workspaceTransfer: {
          root,
          inputs: [...sources, "request.json"],
          outputs: ["result.json"],
          mode: "write-return",
          maxFileBytes: MAX_JSON_BYTES,
          maxTotalBytes: MAX_SOURCE_BYTES + MAX_JSON_BYTES,
        },
      });
    } catch {
      checkAbort(options.signal);
      // Backend errors/stdout/stderr may contain request values or private engine diagnostics.
      throw unavailable("isolated execution or authoritative cleanup failed.");
    }
    checkAbort(options.signal);
    if (executed.exit.timedOut || executed.exit.reason === "overall-timeout") {
      throw new DOMException("Isolated Python worker exceeded its execution deadline.", "TimeoutError");
    }
    if (executed.exit.reason !== "exit" || executed.exit.exitCode !== 0) {
      throw unavailable("worker failed before returning a valid result.");
    }
    const outputs = executed.finalization.workspaceOutputs;
    if (!outputs || outputs.length !== 1 || outputs[0]?.path !== "result.json") {
      throw unavailable("worker did not return exactly its declared result file.");
    }
    const returned = outputs[0];
    if (!Buffer.isBuffer(returned.data) || !Number.isSafeInteger(returned.size) ||
        returned.size <= 0 || returned.size > MAX_JSON_BYTES || returned.data.length !== returned.size) {
      throw unavailable("worker returned an empty, inconsistent, or oversized result file.");
    }
    if (!matchesWorkspaceOutputDigest(returned)) {
      throw unavailable("worker result file digest did not match the returned bytes.");
    }
    return parseResult<T>(returned.data);
  } finally {
    // The canonical runner joins native extinction and backend finalization before settling.
    // These are copy-only ingress files, never host-mounted into the runtime.
    fs.rmSync(root, { recursive: true, force: true });
  }
}
