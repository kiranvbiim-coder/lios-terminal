// Relevant cases adapted from OpenClaw operator-approval-placement-grants.test.ts
// (MIT, Copyright (c) 2026 OpenClaw Foundation), c074824a27c96d3983043f9eeb33823cd1772d8c.
import assert from "node:assert/strict";
import test from "node:test";
import { GATEWAY_METHODS } from "../../shared/gatewayProtocol";
import { localExecutionBackend } from "./backends/local";
import { nodePermissionExecutionBackend } from "./backends/node-permission";
import { createContainerExecutionBackend } from "./backends/container";
import type { ExecutionBackendRequest } from "./backends/types";
import { ExecutionPlacementGrant, ExecutionPlacementError, type ExecutionPlacementAuthority } from "./placement-grant";
import { prepareAnalyzedGovernedCommand, executePreparedGovernedCommand } from "./authority/governed-command";
import { executeJournaledGovernedCommand } from "./authority/governed-command-journal";
import { createProcessSupervisor } from "./supervisor";
import { createExecutionPolicySnapshot, ExecutionAuthorizationLease } from "./execution-authorization";
import { createStubChildAdapter, createStubSupervisor } from "./supervisor.test-support";
import type { ExecutionJournal } from "./execution-journal";

const REQUEST_ID = "961b6b26-e25e-4a65-9eae-6889bc80de5d";
const REVISION = "a".repeat(64);
const OWNER = { userId: 7, projectId: 11, chatId: 13 };
function fixture() {
  let current: ExecutionPlacementAuthority = {
    requestId: REQUEST_ID, owner: { ...OWNER },
    target: {
      nodeId: "current-home", kind: "host", owner: { ...OWNER }, generation: "runtime-1",
      available: true, revoked: false, backend: localExecutionBackend, endpoint: null,
    },
    policy: { revision: REVISION, allowedKinds: ["host"], dataLocality: "runtime-only", secretLocality: "none" },
  };
  const controller = new AbortController();
  const request: ExecutionBackendRequest = {
    argv: [process.execPath, "-e", "process.stdout.write('safe')"], cwd: process.cwd(),
    scopeKey: `conversation:${REQUEST_ID}`,
    isolation: { filesystem: "host", network: "inherit", processes: "host" },
    resources: { maxWallTimeMs: 5000, maxCapturedOutputChars: 8192 },
  };
  return {
    request, controller,
    get current() { return current; },
    set current(value: ExecutionPlacementAuthority) { current = value; },
    select() { return ExecutionPlacementGrant.select({ authority: current, request, currentAuthority: () => current, signal: controller.signal }); },
  };
}
function denied(reason: ExecutionPlacementError["reason"]) {
  return (error: unknown) => {
    assert.ok(error instanceof ExecutionPlacementError);
    assert.equal(error.reason, reason);
    return true;
  };
}

test("safe local selection preserves the canonical owned request and truthfully reports host access", { timeout: 15_000 }, async (t) => {
  const f = fixture();
  const placement = f.select();
  const prepared = await prepareAnalyzedGovernedCommand({ backend: placement.backend, request: f.request, placement });
  assert.equal(prepared.facts.placement?.requestId, REQUEST_ID);
  assert.deepEqual(prepared.facts.placement?.owner, OWNER);
  assert.equal(prepared.facts.placement?.trustPosture, "host-access");
  assert.equal(prepared.launchSnapshot().scopeKey, `conversation:${REQUEST_ID}`);
  const supervisor = createProcessSupervisor();
  t.after(() => supervisor.shutdown());
  const now = Date.now();
  const authorization = {
    approvedOperationDigest: prepared.operation.digest, approvedDigest: prepared.approvalDigest,
    lease: new ExecutionAuthorizationLease(createExecutionPolicySnapshot({ permissionClass: "user_confirm", policyRevision: REVISION, issuedAtMs: now, expiresAtMs: now + 60000 })),
    currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision: REVISION }),
  };
  const result = await executePreparedGovernedCommand(prepared, authorization, supervisor);
  assert.equal(result.stdout, "safe");
  assert.equal(result.stderr, "");
});

test("wrong owner, missing target, paired advertisement and denied policy cannot fall back to host", () => {
  for (const scenario of ["owner", "missing", "paired", "policy", "capability"] as const) {
    const f = fixture();
    if (scenario === "owner") f.current.target.owner = { ...OWNER, userId: 8 };
    if (scenario === "missing") f.current.target.available = false;
    if (scenario === "paired") f.current.target.kind = "paired-node";
    if (scenario === "policy") f.current.policy.allowedKinds = ["container"];
    if (scenario === "capability") f.request.isolation.network = "deny";
    assert.throws(() => f.select(), denied(scenario === "owner" ? "wrong-owner" : scenario === "missing" ? "target-unavailable" : scenario === "paired" ? "unsupported-target" : scenario === "policy" ? "policy-denied" : "capability-denied"));
  }
});

test("generation, owner, policy, availability and revocation are revalidated after selection", () => {
  for (const scenario of ["generation", "owner", "policy", "unavailable", "revoked", "signal"] as const) {
    const f = fixture();
    const grant = f.select();
    if (scenario === "generation") f.current.target.generation = "runtime-2";
    if (scenario === "owner") f.current.owner = { ...OWNER, chatId: 14 };
    if (scenario === "policy") f.current.policy.revision = "b".repeat(64);
    if (scenario === "unavailable") f.current.target.available = false;
    if (scenario === "revoked") f.current.target.revoked = true;
    if (scenario === "signal") f.controller.abort(new Error("private reason"));
    assert.throws(() => grant.assertCurrent(), denied(scenario === "owner" ? "wrong-owner" : scenario === "unavailable" ? "target-unavailable" : scenario === "revoked" || scenario === "signal" ? "revoked-grant" : "stale-grant"));
  }
});

test("a selected grant cannot admit secrets, different requests or a replacement backend", () => {
  const f = fixture();
  const grant = f.select();
  assert.throws(() => grant.assertRequest(localExecutionBackend, { ...f.request, env: { TOKEN: "private" } }), denied("policy-denied"));
  assert.throws(() => grant.assertRequest(localExecutionBackend, { ...f.request, scopeKey: "conversation:other" }), denied("scope-mismatch"));
  assert.throws(() => grant.assertRequest({ ...localExecutionBackend }, f.request), denied("scope-mismatch"));
});

test("existing Docker, Podman and restricted local Node capabilities are eligible, not invented remote targets", () => {
  for (const engine of ["docker", "podman"] as const) {
    const f = fixture();
    const endpoint = "unix:///var/run/owned.sock";
    f.current.target = { ...f.current.target, kind: "container", endpoint, backend: createContainerExecutionBackend({ engine, engineTarget: endpoint, image: "ghcr.io/example/sandbox@sha256:" + "b".repeat(64), user: "10001:10001", maxMemoryBytes: 512 * 1024 * 1024, maxProcesses: 32 }) };
    f.current.policy.allowedKinds = ["container"];
    f.request.isolation = { filesystem: "sandbox", network: "deny", processes: "sandbox" };
    assert.equal(f.select().facts.trustPosture, "isolated-container");
    f.current.target.endpoint = "ssh://user:credential@remote";
    assert.throws(() => f.select(), denied("unsupported-target"));
  }
  const f = fixture();
  f.current.target.kind = "node-permission";
  f.current.target.backend = nodePermissionExecutionBackend;
  f.current.policy.allowedKinds = ["node-permission"];
  f.request.isolation = { filesystem: "none", network: "deny", processes: "deny-child-process" };
  assert.equal(f.select().facts.trustPosture, "restricted-node");
});

test("placement generation changes exact approval facts and stale grants reach neither supervisor nor journal", async (t) => {
  const f = fixture();
  const placement = f.select();
  const first = await prepareAnalyzedGovernedCommand({ backend: placement.backend, request: f.request, placement });
  f.current.target.generation = "runtime-2";
  const secondPlacement = f.select();
  const second = await prepareAnalyzedGovernedCommand({ backend: secondPlacement.backend, request: f.request, placement: secondPlacement });
  assert.equal(first.operation.digest, second.operation.digest);
  assert.notEqual(first.approvalDigest, second.approvalDigest);
  const { supervisor, createAdapter } = createStubSupervisor([createStubChildAdapter()]);
  t.after(() => supervisor.shutdown());
  const now = Date.now();
  const authorization = {
    approvedOperationDigest: first.operation.digest, approvedDigest: first.approvalDigest,
    lease: new ExecutionAuthorizationLease(createExecutionPolicySnapshot({ permissionClass: "user_confirm", policyRevision: REVISION, issuedAtMs: now, expiresAtMs: now + 60000 })),
    currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision: REVISION }),
  };
  await assert.rejects(() => executePreparedGovernedCommand(first, authorization, supervisor), denied("stale-grant"));
  assert.equal(createAdapter.mock.calls.length, 0);
  // This incomplete journal intentionally proves rejection precedes any journal method.
  const inaccessibleJournal = {} as ExecutionJournal;
  await assert.rejects(() => executeJournaledGovernedCommand({ requestId: REQUEST_ID, owner: { ...OWNER, userId: 8 }, label: "test", prepared: first, decision: { decision: "denied", reason: "user-denied", policy: authorization.currentPolicy() }, journal: inaccessibleJournal }), denied("wrong-owner"));
});

test("placement projection schema rejects unexpected fields, spoofed facts and unsafe endpoints", () => {
  const f = fixture();
  const placement = f.select().facts;
  const proposal = {
    requestId: REQUEST_ID, label: "test", argv: ["node"], cwd: "/tmp", backendId: placement.backendId,
    operationDigest: REVISION, approvalDigest: REVISION, policyRevision: REVISION,
    permissionClass: "user_confirm", expiresAtMs: Date.now() + 60000,
    isolation: f.request.isolation, resources: f.request.resources, placement,
    interactiveInputPolicy: null, allowedInteractiveInputs: [],
  };
  const schema = GATEWAY_METHODS["execution.operation.propose"].result;
  assert.equal(schema.safeParse(proposal).success, true);
  for (const override of [{ credential: "private" }, { requestId: "38ff8712-f2d6-4d29-8aae-22ea9da4c30c" }, { policyRevision: "b".repeat(64) }, { owner: { ...OWNER, userId: -1 } }, { trustPosture: "isolated-container" }, { endpoint: "ssh://user:secret@host" }]) {
    assert.equal(schema.safeParse({ ...proposal, placement: { ...placement, ...override } }).success, false);
  }
});

test("placement drift at the final authorization fence creates no native process", async (t) => {
  const f = fixture();
  let launchChecks = 0;
  let launching = false;
  const placement = ExecutionPlacementGrant.select({
    authority: f.current, request: f.request, signal: f.controller.signal,
    currentAuthority: () => {
      if (launching && ++launchChecks === 2) f.current.target.generation = "runtime-replaced";
      return f.current;
    },
  });
  const prepared = await prepareAnalyzedGovernedCommand({ backend: placement.backend, request: f.request, placement });
  const { supervisor, createAdapter } = createStubSupervisor([createStubChildAdapter()]);
  t.after(() => supervisor.shutdown());
  const now = Date.now();
  launching = true;
  await assert.rejects(() => executePreparedGovernedCommand(prepared, {
    approvedOperationDigest: prepared.operation.digest, approvedDigest: prepared.approvalDigest,
    lease: new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
      permissionClass: "user_confirm", policyRevision: REVISION, issuedAtMs: now, expiresAtMs: now + 60000,
    })),
    currentPolicy: () => ({ permissionClass: "user_confirm", policyRevision: REVISION }),
  }, supervisor), denied("stale-grant"));
  assert.equal(createAdapter.mock.calls.length, 0);
  f.current.target.generation = "runtime-1";
  assert.throws(() => placement.assertCurrent(), denied("revoked-grant"));
});
