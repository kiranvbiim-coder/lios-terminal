/**
 * Spawns and talks to the Limuria Python sidecar (python-service/), the
 * Node/TS Terminal's on-ramp to real Python quant libraries (QuantLib,
 * and more as later engines get ported) instead of hand-reimplementing
 * every formula natively in TS. Same "AI validates, never calculates"
 * boundary as the rest of the app: this process does deterministic math
 * only, called from server routes exactly like any other internal service
 * (quantConsensusService.ts, challengeAssumptionService.ts) -- it is never
 * reachable directly from the client and never touches an LLM.
 *
 * Same graceful-degradation shape used for FRED/Gemini/SMTP elsewhere in
 * this codebase: if the sidecar never comes up (missing python3, deps not
 * installed), the rest of the Terminal keeps working -- only routes that
 * call into this fail cleanly with a clear error, not a crash.
 */
import { getProcessSupervisor } from "./exec";
import { z } from "zod";
import { createSafeConversationCancellationReason, currentConversationSignal } from "./exec/execution-scope";
import type { ManagedRun } from "./exec";
import { randomBytes } from "crypto";
import net from "net";
import path from "path";
import fs from "fs";
import { log } from "./logger";
import { managedRuntimePythonPath } from "./pythonRuntimeManager";
import {
  effectiveSandboxIsolationMode,
  sandboxIsolationMode,
} from "./exec/sandbox-runtime-profile";
import { callIsolatedPythonService, IsolatedPythonInputError } from "./isolatedPythonService";
import { strictSandboxInventoryFingerprint } from "./exec/strict-sandbox-inventory";
import { assertStrictNumericalPackInventory } from "./strictPythonRuntimeInventory";

const dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(process.argv[1] || process.cwd());
// Same resourcesBase pattern already used for script/download_history.py in
// marketData.ts and for server/data/seed-db in db.ts: a packaged app's
// bundled dist/index.cjs has no "../python-service" relative to itself
// (extraResources are placed at Contents/Resources/, a sibling of
// Contents/Resources/app/ where dist/ lives, not inside it) -- resolving
// blindly off __dirname pointed at a directory that only ever existed in
// dev, so the sidecar's cwd didn't exist in the packaged app and every
// spawn ENOENT'd. process.resourcesPath / ELECTRON_RESOURCES_PATH is exactly
// Contents/Resources/ in a packaged build.
const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
const SERVICE_DIR = resourcesBase
  ? path.join(resourcesBase, "python-service")
  : path.resolve(dirname, "../python-service");

export const SIDECAR_TOKEN_HEADER = "X-LiOS-Sidecar-Token";
const SIDECAR_TOKEN_ENV = "LIOS_SIDECAR_TOKEN";

/** A fresh unguessable credential. One is generated per Node server process. */
export function createSidecarToken(): string {
  return randomBytes(32).toString("base64url");
}

// Never logged and only ever placed in the environment of the child we spawn
// and in requests to that child's loopback URL (never to a remote service).
const SIDECAR_TOKEN = createSidecarToken();
let isolatedInventory: { key: string; python: string; packages: Record<string, string> } | null = null;
function isolatedInventoryKey(): string {
  return strictSandboxInventoryFingerprint();
}
let localPort: number | null = null;

/** Reserves a free ephemeral loopback port by binding port 0, reading it, and releasing it. */
export function reserveLoopbackPort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = net.createServer();
  server.unref();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Unable to reserve a loopback port."));
      return;
    }
    server.close((error) => (error ? reject(error) : resolve(address.port)));
  });
  return promise;
}

function localBaseUrl(): string {
  if (localPort === null) throw new Error("Python sidecar has not been launched by this process.");
  return `http://127.0.0.1:${localPort}`;
}

function remoteServiceUrl(): string | null {
  const raw = process.env.PYTHON_REMOTE_SERVICE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function serviceBaseUrl(): string {
  return remoteServiceUrl() ?? localBaseUrl();
}

/**
 * Headers for a sidecar request. The per-launch token is sent only to the
 * sidecar this process spawned; a remote service is the operator's
 * responsibility and receives only its own bearer token.
 */
export function buildSidecarRequestHeaders(
  target: { remote: boolean },
  tokens: { localToken: string; remoteToken?: string },
): Record<string, string> {
  if (target.remote) {
    const remoteToken = tokens.remoteToken?.trim();
    return remoteToken ? { Authorization: `Bearer ${remoteToken}` } : {};
  }
  return { [SIDECAR_TOKEN_HEADER]: tokens.localToken };
}

function serviceHeaders(): Record<string, string> {
  return buildSidecarRequestHeaders(
    { remote: remoteServiceUrl() !== null },
    { localToken: SIDECAR_TOKEN, remoteToken: process.env.PYTHON_REMOTE_SERVICE_TOKEN },
  );
}

/**
 * True only for a sidecar that enforces our token: /runtime-info must be
 * rejected with 401 without the token and succeed with it. Anything else on
 * the port (a foreign or unauthenticated listener) is never trusted.
 */
export async function isOwnedSidecar(baseUrl: string, token: string): Promise<boolean> {
  try {
    const anonymous = await fetch(`${baseUrl}/runtime-info`, { signal: AbortSignal.timeout(1_000) });
    if (anonymous.status !== 401) return false;
    const authorized = await fetch(`${baseUrl}/runtime-info`, {
      headers: { [SIDECAR_TOKEN_HEADER]: token },
      signal: AbortSignal.timeout(1_000),
    });
    if (!authorized.ok) return false;
    const body = (await authorized.json()) as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}

let child: ManagedRun | null = null;
let launchGeneration = 0;
let readyPromise: Promise<boolean> | null = null;
let environmentPromise: Promise<{ python: string; packages: Record<string, string> }> | null = null;

const SAFE_PYTHON_SIDECAR_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
] as const;

const SECRET_ENV_NAME = /(?:api[_-]?key|token|secret|password|credential|authorization|cookie|private[_-]?key)/i;

export function buildPythonSidecarEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
  };
  for (const name of SAFE_PYTHON_SIDECAR_ENV_KEYS) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    if (name !== SIDECAR_TOKEN_ENV && SECRET_ENV_NAME.test(name)) {
      throw new Error(`Python sidecar secrets must not be passed through environment variable ${name}.`);
    }
    env[name] = value;
  }
  // Signed desktop resources are immutable. Callers cannot disable these
  // Python runtime guards through an execution override.
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.PYTHONNOUSERSITE = "1";
  env.PYTHONUTF8 = "1";
  return env;
}

// Local dev installs into python-service/.venv (see docs/LIOS_LOCAL_RUN.md for the
// one-time `python3 -m venv .venv && pip install -r requirements.txt`
// setup, run from python-service/). A container deploy has no venv -- the image
// installs straight into the container's global site-packages,
// so PYTHON_EXECUTABLE/plain `python3` is correct there instead.
//
// The packaged macOS desktop app doesn't bundle python-service/.venv (not in
// electron-builder's "files"/"extraResources"), so it falls to the "python3"
// case below -- but bare "python3" is resolved by Node's own PATH search,
// which walks directories in order and hits Apple's Command Line Tools stub
// at /usr/bin/python3 (no pip packages installed there at all) before ever
// reaching the real interpreter, even when main.cjs appends the real one's
// directory to PATH -- appending puts it after /usr/bin, not before. Same
// class of bug as resolveNodeBinary() in main.cjs; same fix -- resolve an
// absolute path instead of trusting PATH order. This list is macOS-specific
// on purpose: none of these paths exist on a Linux container, so a
function packagedSidecarExecutable(): string | null {
  if (!resourcesBase) return null;
  const executable = process.platform === "win32" ? "lios-python-sidecar.exe" : "lios-python-sidecar";
  const candidate = path.join(resourcesBase, "python-sidecar-dist", "lios-python-sidecar", executable);
  return fs.existsSync(candidate) ? candidate : null;
}

function resolvePythonExecutable(): string {
  if (process.env.PYTHON_EXECUTABLE) return process.env.PYTHON_EXECUTABLE;
  const managedPython = managedRuntimePythonPath();
  if (managedPython) return managedPython;
  const venvPython = path.join(SERVICE_DIR, ".venv", "bin", "python3");
  if (fs.existsSync(venvPython)) return venvPython;

  const macCandidates = [
    "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
  ];
  for (const candidate of macCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "python3";
}

async function pollHealth(maxAttempts: number, intervalMs: number): Promise<boolean> {
  const remote = remoteServiceUrl() !== null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const base = serviceBaseUrl();
      const res = await fetch(`${base}/health`, { headers: serviceHeaders(), signal: AbortSignal.timeout(1_000) });
      // The local sidecar must also prove it is the process we launched (it
      // enforces our token); /health alone is unauthenticated.
      if (res.ok && (remote || (await isOwnedSidecar(base, SIDECAR_TOKEN)))) return true;
    } catch {
      // Not up yet -- expected during the first couple of seconds while
      // uvicorn boots and QuantLib's C++ extension loads.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Starts the sidecar once and returns a promise that resolves true once it's
 * actually answering /health, false if it never came up within the timeout.
 * Safe to call multiple times -- subsequent calls return the same promise.
 */
export function startPythonService(): Promise<boolean> {
  if (sandboxIsolationMode() === "strict") {
    return getPythonServiceEnvironment().then(() => true, () => false);
  }
  if (readyPromise) return readyPromise;
  const generation = ++launchGeneration;

  readyPromise = (async () => {
    const remote = remoteServiceUrl();
    if (remote) {
      if (!process.env.PYTHON_REMOTE_SERVICE_TOKEN?.trim()) {
        console.warn("Remote Python service is configured without PYTHON_REMOTE_SERVICE_TOKEN.");
        return false;
      }
      const ready = await pollHealth(30, 500);
      if (ready) log(`Connected to remote Python service at ${remote}.`, "python-service");
      return ready;
    }

    // Small machines (a Raspberry Pi, a low-memory NAS or VPS) may not have room for the scientific Python
    // stack (SciPy/QuantLib/pandas) beside the Node server. The operator can opt out of the local sidecar
    // while the rest of LiOS stays online; a remote Python service configured above still takes precedence.
    if (process.env.PYTHON_LOCAL_SERVICE_DISABLED === "true") {
      log("Local Python sidecar disabled for this deployment; Python-backed routes will degrade cleanly.", "python-service");
      return false;
    }

    // A sidecar this process did not start does not know our per-launch token
    // and is never trusted or reused: always launch our own on a fresh port.
    localPort = await reserveLoopbackPort();

    const packagedSidecar = packagedSidecarExecutable();
    const python = resolvePythonExecutable();
    const executable = packagedSidecar ?? python;
    const args = packagedSidecar
      ? []
      : ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(localPort)];
    log(
      packagedSidecar
        ? `Starting bundled Python sidecar (${packagedSidecar}) on port ${localPort}...`
        : `Starting Python sidecar (${python}) on port ${localPort}...`,
      "python-service",
    );

    const run = await getProcessSupervisor().spawn({
      mode: "child",
      argv: [executable, ...args],
      scopeKey: "service:python",
      cwd: packagedSidecar ? path.dirname(packagedSidecar) : SERVICE_DIR,
      env: buildPythonSidecarEnvironment({
        PYTHON_SERVICE_PORT: String(localPort),
        LIOS_PYTHON_LOG_LEVEL: "warning",
        LIOS_PARENT_PID: String(process.pid),
        [SIDECAR_TOKEN_ENV]: SIDECAR_TOKEN,
      }),
      captureOutput: false,
      onStdout: (chunk) => log(chunk.trim(), "python-service"),
      onStderr: (chunk) => log(chunk.trim(), "python-service"),
    });
    if (generation !== launchGeneration) {
      run.cancel();
      await run.waitForExtinction?.();
      return false;
    }
    child = run;
    void run.wait().then((exit) => {
      if (exit.exitCode !== 0 && exit.reason !== "manual-cancel") {
        console.error(`Python sidecar exited (${exit.reason}, code=${exit.exitCode ?? "null"}).`);
      }
      if (child === run) {
        child = null;
        readyPromise = null;
        environmentPromise = null;
      }
    }, (error: unknown) => {
      console.error("Python sidecar failed:", error instanceof Error ? error.message : "process failure");
      if (child === run) {
        child = null;
        readyPromise = null;
        environmentPromise = null;
      }
    });

    const ready = await pollHealth(30, 500);
    if (generation !== launchGeneration) return false;
    if (ready) {
      log("Python sidecar ready.", "python-service");
    } else {
      console.warn(
        "Python sidecar did not become ready within 15s -- routes that depend on it will fail cleanly until it's fixed. " +
          "Check python-service/requirements.txt is installed (see docs/LIOS_LOCAL_RUN.md for setup).",
      );
      run.cancel();
    }
    return ready;
  })().then((ready) => {
    if (!ready && generation === launchGeneration && child === null) readyPromise = null;
    return ready;
  }, (error: unknown) => {
    if (generation === launchGeneration && child === null) readyPromise = null;
    throw error;
  });

  return readyPromise;
}

export function stopPythonService(): void {
  ++launchGeneration;
  child?.cancel();
  child = null;
  readyPromise = null;
  environmentPromise = null;
  isolatedInventory = null;
}

export function getPythonServiceEnvironment(): Promise<{ python: string; packages: Record<string, string> }> {
  if (sandboxIsolationMode() === "strict") {
    const key = isolatedInventoryKey();
    return callIsolatedPythonService<unknown>("/runtime-info", {}, { serviceDir: SERVICE_DIR, timeoutMs: 15_000 }).then(value => {
      const metadata = z.object({ python: z.string(), packages: z.record(z.string()) }).parse(value);
      // A successful inventory transport is not proof NumPy/SciPy/Pydantic are
      // available. Do not publish a ready state if mandatory valuation packs
      // are absent (optional packs may remain unavailable).
      assertStrictNumericalPackInventory(metadata.packages);
      // A mutable Home configuration may change while the isolated inventory probe is running.
      // Never cache (or report) a stale proof under the previous sandbox/image/tool authority.
      if (key !== isolatedInventoryKey()) {
        throw new Error("Strict Python sandbox configuration changed during runtime verification; retry health inspection.");
      }
      isolatedInventory = { key, ...metadata };
      return metadata;
    }, error => { isolatedInventory = null; throw error; });
  }
  if (environmentPromise) return environmentPromise;
  const pending = (async () => {
    if (!await startPythonService()) throw new Error("Python sidecar is not available.");
    const response = await fetch(`${serviceBaseUrl()}/runtime-info`, { headers: serviceHeaders(), signal: AbortSignal.timeout(2_000) });
    if (!response.ok) throw new Error("Python sidecar environment metadata is unavailable.");
    const body = await response.json() as { python?: string; packages?: Record<string, string> };
    return { python: body.python ?? "unknown", packages: body.packages ?? {} };
  })().catch((error: unknown) => {
    if (environmentPromise === pending) environmentPromise = null;
    throw error;
  });
  environmentPromise = pending;
  return pending;
}

/** Passive discovery/Doctor probe: never starts Python, installs packages or contacts an AI provider. */
export async function inspectRunningPythonService(): Promise<{ ready: boolean; packages: Record<string, string>; reason: string }> {
  if (sandboxIsolationMode() === "strict") {
    if (!isolatedInventory || isolatedInventory.key !== isolatedInventoryKey()) return { ready: false, packages: {}, reason: "Strict backend inventory has not been verified for the current image. Refresh runtime health; no host fallback is used." };
    return { ready: true, packages: isolatedInventory.packages, reason: "Verified isolated-image inventory; every invocation rechecks its sandbox and required pack. No probe or installation started by discovery." };
  }
  if (!child && !remoteServiceUrl()) return { ready: false, packages: {}, reason: "No running Python sidecar is currently owned by this Home. Review Connections runtime setup." };
  try {
    const remote = remoteServiceUrl() !== null;
    if (remote && !process.env.PYTHON_REMOTE_SERVICE_TOKEN?.trim()) return { ready: false, packages: {}, reason: "The configured remote Python service requires its owner-managed authentication token." };
    const base = serviceBaseUrl();
    if (!remote && !await isOwnedSidecar(base, SIDECAR_TOKEN)) return { ready: false, packages: {}, reason: "The local Python service did not prove current Home ownership." };
    const response = await fetch(`${base}/runtime-info`, { headers: serviceHeaders(), signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return { ready: false, packages: {}, reason: "The current Python service is not responding with authenticated runtime metadata." };
    const parsed = z.object({ packages: z.record(z.string()) }).safeParse(await response.json());
    if (!parsed.success) return { ready: false, packages: {}, reason: "Python runtime package inventory is invalid; review Doctor." };
    return { ready: true, packages: parsed.data.packages, reason: "Current authenticated Python runtime inventory observed; invocation still rechecks policy and inputs." };
  } catch {
    return { ready: false, packages: {}, reason: "The configured Python runtime is currently unreachable; no process was started." };
  }
}

// Thrown for a 4xx response from the sidecar itself -- the request reached
// it fine, but the *data* was rejected (e.g. FastAPI's HTTPException(400,
// "Singular matrix") when a regression can't converge on degenerate/
// separated input). Distinguished from a generic Error so callers can show
// the real reason instead of a blanket "unavailable right now", which would
// be misleading -- the engine is up, the input just doesn't fit the model.
export class PythonServiceDataError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = "PythonServiceDataError";
  }
}

/**
 * Calls one sidecar endpoint. Throws a clear error (never a raw
 * ECONNREFUSED) if the process never came up or the call itself fails --
 * route handlers should catch this the same way quantConsensusService's
 * callers already catch AI-provider failures, and return a clean 502
 * (or, for a PythonServiceDataError, a 400 with the real reason).
 */
export async function callPythonService<T>(
  routePath: string,
  body: unknown,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    isolationMode?: "legacy-host" | "strict";
  } = {},
): Promise<T> {
  if (effectiveSandboxIsolationMode(options.isolationMode) === "strict") {
    const scopeSignal = currentConversationSignal();
    const signal = options.signal && scopeSignal ? AbortSignal.any([options.signal, scopeSignal]) : options.signal ?? scopeSignal;
    try {
      return await callIsolatedPythonService<T>(routePath, body, {
        serviceDir: SERVICE_DIR,
        signal,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      if (error instanceof IsolatedPythonInputError) throw new PythonServiceDataError(error.message);
      throw error;
    }
  }

  const ready = await startPythonService();
  if (!ready) {
    throw new Error("Python sidecar is not available.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Python computation timed out.", "TimeoutError")), options.timeoutMs ?? 120_000);
  // A computation started under a conversation run is a child of that run's cancellation scope (SI-02.07).
  const scopeSignal = currentConversationSignal();
  const parentSignal = options.signal && scopeSignal ? AbortSignal.any([options.signal, scopeSignal]) : options.signal ?? scopeSignal;
  const abort = () => controller.abort(createSafeConversationCancellationReason());
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  try {
    const res = await fetch(`${serviceBaseUrl()}${routePath}`, {
      method: "POST",
      headers: { ...serviceHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch((error: unknown) => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return "";
      });
      if (res.status >= 400 && res.status < 500) {
        let detail = text;
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed.detail === "string") detail = parsed.detail;
        } catch {
          // Not JSON -- fall back to the raw text.
        }
        throw new PythonServiceDataError(detail || "Invalid input for this model.");
      }
      throw new Error(`Python sidecar ${routePath} returned ${res.status}: ${text}`);
    }
    return await res.json() as T;
  } catch (error) {
    // Native fetch body reads may throw a generic AbortError; preserve our
    // locally created timeout/cancellation classification, never caller reasons.
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abort);
  }
}
