import { BROWSER_RUNTIME_ISOLATION } from "../browser-isolation";
import { backendSupportsIsolationClaim } from "../isolation-coverage";
import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionBackendRequest,
  ExecutionIsolationRequirements,
  ExecutionResourceLimits,
} from "./types";

const PHYSICAL_BROWSER_ISOLATION: Readonly<ExecutionIsolationRequirements> = Object.freeze({
  filesystem: "sandbox",
  network: "deny",
  processes: "sandbox",
});

const REQUIRED_RESOURCE_CONTROLS = Object.freeze(["wall-time", "captured-output"] as const);

export class BrowserBrokeredExecutionBackendUnavailableError extends Error {
  readonly code = "browser_brokered_execution_backend_unavailable" as const;

  constructor(message = "No physical sandbox backend can support the browser broker-RPC boundary.") {
    super(message);
    this.name = "BrowserBrokeredExecutionBackendUnavailableError";
  }
}

function sameIsolation(
  left: ExecutionIsolationRequirements,
  right: ExecutionIsolationRequirements,
): boolean {
  return left.filesystem === right.filesystem
    && left.network === right.network
    && left.processes === right.processes;
}

function positiveNoWider(actual: number, requested: number): boolean {
  return Number.isSafeInteger(actual)
    && actual > 0
    && Number.isSafeInteger(requested)
    && requested > 0
    && actual <= requested;
}

function assertResourcesNoWider(
  actual: ExecutionResourceLimits,
  requested: ExecutionResourceLimits,
): void {
  if (
    !positiveNoWider(actual.maxWallTimeMs, requested.maxWallTimeMs)
    || !positiveNoWider(actual.maxCapturedOutputChars, requested.maxCapturedOutputChars)
  ) {
    throw new BrowserBrokeredExecutionBackendUnavailableError(
      "Physical browser backend widened the admitted browser resource boundary.",
    );
  }
  for (const field of ["maxCpuTimeMs", "maxMemoryBytes", "maxStorageBytes", "maxProcesses"] as const) {
    const requestedValue = requested[field];
    const actualValue = actual[field];
    if (requestedValue !== undefined && (actualValue === undefined || !positiveNoWider(actualValue, requestedValue))) {
      throw new BrowserBrokeredExecutionBackendUnavailableError(
        "Physical browser backend dropped or widened an admitted hard resource limit.",
      );
    }
  }
}

function assertBrowserRequest(request: ExecutionBackendRequest): void {
  if (!sameIsolation(request.isolation, BROWSER_RUNTIME_ISOLATION)) {
    throw new BrowserBrokeredExecutionBackendUnavailableError(
      "Browser broker wrapper accepts only the canonical browser isolation boundary.",
    );
  }
  if (
    request.stdinMode !== "pipe-open"
    || request.interactiveInputPolicy !== "sandbox-broker-rpc"
    || request.input !== undefined
  ) {
    throw new BrowserBrokeredExecutionBackendUnavailableError(
      "Browser broker wrapper requires the closed broker-RPC stdin policy.",
    );
  }
}

function assertPhysicalPlan(
  delegate: ExecutionBackend,
  request: ExecutionBackendRequest,
  plan: ExecutionBackendLaunchPlan,
): void {
  if (plan.backendId !== delegate.id || !sameIsolation(plan.facts.isolation, PHYSICAL_BROWSER_ISOLATION)) {
    throw new BrowserBrokeredExecutionBackendUnavailableError(
      "Physical browser backend did not preserve deny-network sandbox isolation.",
    );
  }
  if (request.signal && plan.signal !== request.signal) {
    throw new BrowserBrokeredExecutionBackendUnavailableError(
      "Physical browser backend did not preserve browser cancellation authority.",
    );
  }
  if (
    plan.spawn.stdinMode !== "pipe-open"
    || plan.spawn.interactiveInputPolicy !== "sandbox-broker-rpc"
    || plan.spawn.input !== undefined
  ) {
    throw new BrowserBrokeredExecutionBackendUnavailableError(
      "Physical browser backend did not preserve the closed broker-RPC channel.",
    );
  }
  assertResourcesNoWider(plan.facts.resources, request.resources);
}

/**
 * SI-02 L12 semantic wrapper for browser egress.
 *
 * The delegate remains physically network-denied. This wrapper may advertise
 * `brokered` only because browser traffic is expected to leave the sandbox via
 * the separately required host-side broker-RPC transport. Constructing this
 * backend does not itself create sockets, launch Chromium, or grant URL access.
 */
export function createBrowserBrokeredExecutionBackend(delegate: ExecutionBackend): ExecutionBackend {
  if (
    !backendSupportsIsolationClaim(
      delegate.capabilities,
      PHYSICAL_BROWSER_ISOLATION,
      REQUIRED_RESOURCE_CONTROLS,
    )
  ) {
    throw new BrowserBrokeredExecutionBackendUnavailableError();
  }

  const id = `lios.browser-brokered@${delegate.id}`;
  return Object.freeze({
    id,
    capabilities: Object.freeze({
      filesystem: Object.freeze(["sandbox"] as const),
      network: Object.freeze(["brokered"] as const),
      processes: Object.freeze(["sandbox"] as const),
      resourceControls: Object.freeze([...delegate.capabilities.resourceControls]),
    }),
    async prepare(request: ExecutionBackendRequest): Promise<ExecutionBackendLaunchPlan> {
      assertBrowserRequest(request);
      const physicalRequest: ExecutionBackendRequest = {
        ...request,
        argv: [...request.argv],
        env: request.env ? { ...request.env } : undefined,
        isolation: { ...PHYSICAL_BROWSER_ISOLATION },
        resources: { ...request.resources },
      };
      const plan = await delegate.prepare(physicalRequest);
      assertPhysicalPlan(delegate, request, plan);

      return {
        backendId: id,
        spawn: {
          ...plan.spawn,
          argv: [...plan.spawn.argv],
          env: plan.spawn.env ? { ...plan.spawn.env } : undefined,
          operationFilePaths: plan.spawn.operationFilePaths
            ? [...plan.spawn.operationFilePaths]
            : undefined,
        },
        signal: plan.signal,
        lifecycle: plan.lifecycle,
        facts: Object.freeze({
          ...plan.facts,
          isolation: Object.freeze({ ...BROWSER_RUNTIME_ISOLATION }),
          resources: Object.freeze({ ...plan.facts.resources }),
        }),
      };
    },
  });
}
