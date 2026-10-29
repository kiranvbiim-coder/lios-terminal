// Adapted from OpenClaw (MIT, Copyright (c) 2026 OpenClaw Foundation),
// c074824a27c96d3983043f9eeb33823cd1772d8c, src/gateway/node-invoke-placement-grant.ts
// and src/gateway/operator-approval-placement-grants.ts. Preserve owner-current,
// exact generation binding and retain/consume revalidation; replace donor rows,
// standing approvals and registries with the existing LiOS authority callback.
import type { ExecutionOwner } from "./execution-journal";
import type { ExecutionBackend, ExecutionBackendRequest } from "./backends/types";

export type ExecutionPlacementKind = "host" | "node-permission" | "container" | "paired-node";
export interface ExecutionPlacementTarget {
  nodeId: string;
  kind: ExecutionPlacementKind;
  owner: ExecutionOwner;
  generation: string;
  available: boolean;
  revoked: boolean;
  /** The actual backend selected by GM-11. Paired device advertisement is not a backend. */
  backend: ExecutionBackend | null;
  /** Explicit local endpoint for container engines; never an ambient engine context. */
  endpoint: string | null;
}
export interface ExecutionPlacementPolicy {
  revision: string;
  allowedKinds: readonly ExecutionPlacementKind[];
  dataLocality: "runtime-only" | "workspace-copy";
  secretLocality: "none" | "runtime-only";
  /** Server-owned opt-in. Existing conversation policies do not grant Home-service placement. */
  allowHomeService?: boolean;
}
export interface ExecutionPlacementAuthority {
  requestId: string;
  owner: ExecutionOwner;
  target: ExecutionPlacementTarget;
  policy: ExecutionPlacementPolicy;
  /** Internal Home lifecycle identity, never accepted from a Chat/Gateway request. */
  homeServiceId?: string;
}
export interface ExecutionPlacementFacts {
  requestId: string;
  owner: Readonly<ExecutionOwner>;
  nodeId: string;
  kind: Exclude<ExecutionPlacementKind, "paired-node">;
  backendId: "lios.execution.local" | "lios.execution.node-permission" | "lios.execution.docker" | "lios.execution.podman";
  generation: string;
  endpoint: string | null;
  policyRevision: string;
  trustPosture: "host-access" | "restricted-node" | "isolated-container";
  dataLocality: ExecutionPlacementPolicy["dataLocality"];
  secretLocality: ExecutionPlacementPolicy["secretLocality"];
  homeServiceId?: string;
}
export class ExecutionPlacementError extends Error {
  constructor(readonly reason: "wrong-owner" | "target-unavailable" | "unsupported-target" | "policy-denied" | "capability-denied" | "stale-grant" | "revoked-grant" | "scope-mismatch") {
    super(`Execution placement denied (${reason}).`);
    this.name = "ExecutionPlacementError";
  }
}
function sameOwner(left: ExecutionOwner, right: ExecutionOwner): boolean {
  return left.userId === right.userId && left.projectId === right.projectId && left.chatId === right.chatId;
}
function placementScopeKey(requestId: string, homeServiceId?: string): string {
  return homeServiceId === undefined ? `conversation:${requestId}` : `home-service:${homeServiceId}:${requestId}`;
}
function requireEligible(authority: ExecutionPlacementAuthority, request: ExecutionBackendRequest): ExecutionPlacementFacts {
  const { owner, target, policy, requestId } = authority;
  if (!sameOwner(owner, target.owner)) throw new ExecutionPlacementError("wrong-owner");
  if (target.revoked) throw new ExecutionPlacementError("revoked-grant");
  if (!target.available || !target.backend) throw new ExecutionPlacementError("target-unavailable");
  const backend = target.backend;
  const backendId = backend.id;
  if (backendId !== "lios.execution.local" && backendId !== "lios.execution.node-permission"
    && backendId !== "lios.execution.docker" && backendId !== "lios.execution.podman") {
    throw new ExecutionPlacementError("unsupported-target");
  }
  const expectedKind = backendId === "lios.execution.local" ? "host"
    : backendId === "lios.execution.node-permission" ? "node-permission" : "container";
  if (target.kind !== expectedKind || !target.nodeId.trim() || !target.generation.trim()) {
    throw new ExecutionPlacementError("unsupported-target");
  }
  if (expectedKind === "container" ? !target.endpoint || !/^unix:\/\/\/[^?\s#\0]+$/.test(target.endpoint) : target.endpoint !== null) {
    throw new ExecutionPlacementError("unsupported-target");
  }
  if (!policy.revision || !policy.allowedKinds.includes(expectedKind)
    || (request.workspaceTransfer && policy.dataLocality !== "workspace-copy")
    || (policy.secretLocality === "none" && Object.keys(request.env ?? {}).length > 0)) {
    throw new ExecutionPlacementError("policy-denied");
  }
  const homeServiceId = authority.homeServiceId;
  if (homeServiceId !== undefined) {
    if (typeof homeServiceId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(homeServiceId)) {
      throw new ExecutionPlacementError("scope-mismatch");
    }
    if (policy.allowHomeService !== true || !Number.isSafeInteger(owner.userId) || owner.userId <= 0 ||
        owner.projectId !== null || owner.chatId !== null || expectedKind !== "container" ||
        request.isolation.filesystem !== "sandbox" || request.isolation.network !== "deny" ||
        request.isolation.processes !== "sandbox" || policy.dataLocality !== "runtime-only" ||
        policy.secretLocality !== "none" || request.workspaceTransfer !== undefined ||
        Object.keys(request.env ?? {}).length > 0) {
      throw new ExecutionPlacementError("policy-denied");
    }
  }
  const caps = backend.capabilities;
  if (!caps.filesystem.includes(request.isolation.filesystem)
    || !caps.network.includes(request.isolation.network)
    || !caps.processes.includes(request.isolation.processes)
    || !caps.resourceControls.includes("wall-time") || !caps.resourceControls.includes("captured-output")
    || (request.resources.maxCpuTimeMs !== undefined && !caps.resourceControls.includes("cpu-time"))
    || (request.resources.maxMemoryBytes !== undefined && !caps.resourceControls.includes("memory"))
    || (request.resources.maxStorageBytes !== undefined && !caps.resourceControls.includes("storage"))
    || (request.resources.maxProcesses !== undefined && !caps.resourceControls.includes("process-count"))) {
    throw new ExecutionPlacementError("capability-denied");
  }
  if (request.scopeKey !== placementScopeKey(requestId, homeServiceId)) throw new ExecutionPlacementError("scope-mismatch");
  return Object.freeze({
    requestId, owner: Object.freeze({ ...owner }), nodeId: target.nodeId, kind: expectedKind,
    backendId, generation: target.generation, endpoint: target.endpoint,
    policyRevision: policy.revision,
    trustPosture: expectedKind === "host" ? "host-access" : expectedKind === "node-permission" ? "restricted-node" : "isolated-container",
    dataLocality: policy.dataLocality, secretLocality: policy.secretLocality,
    ...(homeServiceId === undefined ? {} : { homeServiceId }),
  });
}

// Donor's owner-current check: an unavailable/throwing authority is never permission.
function consumePlacementGrant(assertCurrent: () => void): { outcome: "consumed" } | { outcome: "rejected"; error: unknown } {
  try { assertCurrent(); return { outcome: "consumed" }; }
  catch (error) { return { outcome: "rejected", error }; }
}

/** A process-local binding, not an approval, registry, router or persistent session. */
export class ExecutionPlacementGrant {
  private constructor(
    readonly backend: ExecutionBackend,
    readonly facts: Readonly<ExecutionPlacementFacts>,
    readonly signal: AbortSignal,
    private readonly check: (request?: ExecutionBackendRequest) => void,
  ) { Object.freeze(this); }

  static select(input: {
    authority: ExecutionPlacementAuthority;
    request: ExecutionBackendRequest;
    currentAuthority: () => ExecutionPlacementAuthority;
    signal: AbortSignal;
  }): ExecutionPlacementGrant {
    const facts = requireEligible(input.authority, input.request);
    // Snapshot only the capabilities/limits required for eligibility, not sensitive argv/env.
    const request: ExecutionBackendRequest = {
      argv: [], scopeKey: input.request.scopeKey,
      isolation: { ...input.request.isolation }, resources: { ...input.request.resources },
      env: input.request.env ? Object.fromEntries(Object.keys(input.request.env).map((key) => [key, undefined])) : undefined,
      workspaceTransfer: input.request.workspaceTransfer,
    };
    // Like the donor's deleted stale grant, an invalidated binding cannot revive.
    let invalidated = false;
    const check = (actualRequest = request) => {
      if (invalidated || input.signal.aborted) throw new ExecutionPlacementError("revoked-grant");
      try {
        const current = input.currentAuthority();
        if (!sameOwner(current.owner, facts.owner)) throw new ExecutionPlacementError("wrong-owner");
        const currentFacts = requireEligible(current, actualRequest);
        if (JSON.stringify(currentFacts) !== JSON.stringify(facts)) throw new ExecutionPlacementError("stale-grant");
      } catch (error) {
        invalidated = true;
        throw error instanceof ExecutionPlacementError ? error : new ExecutionPlacementError("target-unavailable");
      }
    };
    const retained = consumePlacementGrant(check);
    if (retained.outcome === "rejected") throw retained.error;
    return new ExecutionPlacementGrant(input.authority.target.backend!, facts, input.signal, check);
  }

  assertCurrent(): void {
    const result = consumePlacementGrant(this.check);
    if (result.outcome === "rejected") throw result.error;
  }
  assertRequest(backend: ExecutionBackend, request: ExecutionBackendRequest): void {
    if (backend !== this.backend || request.scopeKey !== placementScopeKey(this.facts.requestId, this.facts.homeServiceId)) {
      throw new ExecutionPlacementError("scope-mismatch");
    }
    this.check(request);
  }
}
