import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionIsolationRequirements,
  ExecutionResourceLimits,
} from "./backends/types";
import { backendSupportsIsolationClaim } from "./isolation-coverage";

export const BROWSER_RUNTIME_ISOLATION: Readonly<ExecutionIsolationRequirements> = Object.freeze({
  filesystem: "sandbox",
  network: "brokered",
  processes: "sandbox",
});

/**
 * L12 keeps the browser worker bounded even before it is exposed as a governed tool.
 * Page/navigation limits remain owned by BrowserConnectorPolicy; these are process-level ceilings only.
 */
export const BROWSER_RUNTIME_RESOURCES: Readonly<ExecutionResourceLimits> = Object.freeze({
  maxWallTimeMs: 5 * 60_000,
  maxCapturedOutputChars: 64 * 1024,
  maxMemoryBytes: 512 * 1024 * 1024,
  maxProcesses: 128,
});

export class BrowserRuntimeIsolationUnavailableError extends Error {
  readonly code = "browser_runtime_isolation_unavailable" as const;

  constructor(message = "No canonical browser runtime currently proves sandboxed filesystem/process isolation with brokered Project-policy egress.") {
    super(message);
    this.name = "BrowserRuntimeIsolationUnavailableError";
  }
}

/**
 * Canonical SI-01.12 browser admission check.
 *
 * This validates capability only. It does not grant permission and does not
 * launch a browser. L12 additionally prepares the browser worker through the
 * admitted backend before any transport may start Chromium.
 */
export function assertBrowserRuntimeIsolationBackend(
  backend: ExecutionBackend | undefined,
): ExecutionBackend {
  if (!backend) throw new BrowserRuntimeIsolationUnavailableError();
  if (
    !backendSupportsIsolationClaim(
      backend.capabilities,
      BROWSER_RUNTIME_ISOLATION,
      ["wall-time", "memory", "process-count"],
    )
  ) {
    throw new BrowserRuntimeIsolationUnavailableError(
      `Execution backend ${backend.id} cannot satisfy the canonical browser isolation boundary.`,
    );
  }
  return backend;
}

export interface BrowserBackendWorkerRequest {
  argv: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

function positiveBounded(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function sameIsolation(left: ExecutionIsolationRequirements, right: ExecutionIsolationRequirements): boolean {
  return left.filesystem === right.filesystem
    && left.network === right.network
    && left.processes === right.processes;
}

function assertPreparedBrowserPlan(
  backend: ExecutionBackend,
  plan: ExecutionBackendLaunchPlan,
  signal: AbortSignal | undefined,
): ExecutionBackendLaunchPlan {
  if (plan.backendId !== backend.id || !sameIsolation(plan.facts.isolation, BROWSER_RUNTIME_ISOLATION)) {
    throw new BrowserRuntimeIsolationUnavailableError(
      `Execution backend ${backend.id} weakened the canonical browser isolation boundary.`,
    );
  }
  if (signal && plan.signal !== signal) {
    throw new BrowserRuntimeIsolationUnavailableError(
      `Execution backend ${backend.id} did not preserve browser-run cancellation authority.`,
    );
  }
  if (
    plan.spawn.stdinMode !== "pipe-open"
    || plan.spawn.interactiveInputPolicy !== "sandbox-broker-rpc"
    || plan.spawn.input !== undefined
  ) {
    throw new BrowserRuntimeIsolationUnavailableError(
      `Execution backend ${backend.id} did not preserve the closed browser broker-RPC channel.`,
    );
  }
  if (
    !positiveBounded(plan.facts.resources.maxWallTimeMs, BROWSER_RUNTIME_RESOURCES.maxWallTimeMs)
    || !positiveBounded(
      plan.facts.resources.maxCapturedOutputChars,
      BROWSER_RUNTIME_RESOURCES.maxCapturedOutputChars,
    )
    || !positiveBounded(plan.facts.resources.maxMemoryBytes ?? 0, BROWSER_RUNTIME_RESOURCES.maxMemoryBytes!)
    || !positiveBounded(plan.facts.resources.maxProcesses ?? 0, BROWSER_RUNTIME_RESOURCES.maxProcesses!)
  ) {
    throw new BrowserRuntimeIsolationUnavailableError(
      `Execution backend ${backend.id} weakened the canonical browser resource boundary.`,
    );
  }
  return plan;
}

/**
 * SI-02 L12 browser transport admission.
 *
 * The browser worker command is supplied by the approved Browser Runtime Pack,
 * but the final launch shape is owned by ExecutionBackend. This function never
 * launches Chromium and never falls back to host Playwright. The returned plan
 * is the only plan an isolated transport may execute.
 */
export async function prepareBrowserRuntimeIsolationBackend(
  backendInput: ExecutionBackend | undefined,
  worker: BrowserBackendWorkerRequest,
): Promise<ExecutionBackendLaunchPlan> {
  const backend = assertBrowserRuntimeIsolationBackend(backendInput);
  if (!worker.argv.length || worker.argv.some((part) => typeof part !== "string" || !part || part.includes("\0"))) {
    throw new BrowserRuntimeIsolationUnavailableError("Approved browser runtime worker command is invalid.");
  }
  if (worker.signal?.aborted) {
    throw new BrowserRuntimeIsolationUnavailableError("Browser run was cancelled before backend admission.");
  }

  let plan: ExecutionBackendLaunchPlan;
  try {
    plan = await backend.prepare({
      argv: [...worker.argv],
      cwd: worker.cwd,
      env: worker.env ? { ...worker.env } : undefined,
      stdinMode: "pipe-open",
      interactiveInputPolicy: "sandbox-broker-rpc",
      isolation: { ...BROWSER_RUNTIME_ISOLATION },
      resources: { ...BROWSER_RUNTIME_RESOURCES },
      signal: worker.signal,
    });
  } catch (error) {
    if (worker.signal?.aborted) {
      throw new BrowserRuntimeIsolationUnavailableError("Browser run was cancelled during backend admission.");
    }
    throw error;
  }

  if (worker.signal?.aborted) {
    throw new BrowserRuntimeIsolationUnavailableError("Browser run was cancelled before isolated transport startup.");
  }
  return assertPreparedBrowserPlan(backend, plan, worker.signal);
}
