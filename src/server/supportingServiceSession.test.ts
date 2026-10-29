import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after } from "node:test";
import { startSupportingServiceSession } from "./supportingServiceSession";
import { createContainerExecutionBackend } from "./exec/backends/container";
import { ExecutionPlacementGrant, type ExecutionPlacementAuthority } from "./exec/placement-grant";
import { prepareAnalyzedGovernedCommand } from "./exec/authority/governed-command";
import { ExecutionAuthorizationLease, createExecutionPolicySnapshot } from "./exec/execution-authorization";
import type { ExecutionBackendRequest } from "./exec/backends/types";
import { createStubSupervisor, createStubChildAdapter } from "./exec/supervisor.test-support";
import { installContainerAdmissionIdentity } from "./exec/container-admission.test-support";

after(installContainerAdmissionIdentity());

async function preparedFixture() {
  const serviceId = crypto.randomUUID(), requestId = crypto.randomUUID();
  const owner = { userId: 7, projectId: null, chatId: null };
  const revision = "a".repeat(64), endpoint = "unix:///var/run/owned.sock";
  const backend = createContainerExecutionBackend({ engine: "docker", engineTarget: endpoint, image: "sha256:" + "b".repeat(64), user: "10001:10001", maxMemoryBytes: 512 * 1024 * 1024, maxProcesses: 32 });
  const authority: ExecutionPlacementAuthority = { requestId, homeServiceId: serviceId, owner,
    target: { nodeId: "owned-home", kind: "container", owner, generation: "runtime-1", available: true, revoked: false, backend, endpoint },
    policy: { revision, allowedKinds: ["container"], allowHomeService: true, dataLocality: "runtime-only", secretLocality: "none" } };
  const request: ExecutionBackendRequest = { argv: ["/usr/bin/node", "-e", "process.exit(0)"], stdinMode: "pipe-open", interactiveInputPolicy: "sandbox-broker-rpc", scopeKey: `home-service:${serviceId}:${requestId}`,
    isolation: { filesystem: "sandbox", network: "deny", processes: "sandbox" }, resources: { maxWallTimeMs: 5000, maxCapturedOutputChars: 4096 } };
  const controller = new AbortController();
  const placement = ExecutionPlacementGrant.select({ authority, request, currentAuthority: () => authority, signal: controller.signal });
  const prepared = await prepareAnalyzedGovernedCommand({ backend, request, placement });
  const now = Date.now();
  const lease = new ExecutionAuthorizationLease(createExecutionPolicySnapshot({ permissionClass: "user_confirm", policyRevision: revision, issuedAtMs: now, expiresAtMs: now + 60_000 }));
  return { authority, prepared, lease, binding: { sessionId: requestId, generation: crypto.randomUUID(), accountBindingId: crypto.randomUUID(), launchNonce: "c".repeat(64) },
    authorization: { approvedDigest: prepared.approvalDigest, approvedOperationDigest: prepared.operation.digest, lease, currentPolicy: () => ({ permissionClass: "user_confirm" as const, policyRevision: revision }) } };
}

test("mismatched exact approval, session identity, and revoked placement reach no process", async t => {
  for (const scenario of ["approval", "session", "revoked"] as const) {
    const f = await preparedFixture();
    const { supervisor, createAdapter } = createStubSupervisor([createStubChildAdapter()]);
    t.after(async () => { await supervisor.shutdown(); f.lease.close(); });
    if (scenario === "approval") f.authorization.approvedDigest = "d".repeat(64);
    if (scenario === "session") f.binding.sessionId = crypto.randomUUID();
    if (scenario === "revoked") f.authority.policy.allowHomeService = false;
    await assert.rejects(startSupportingServiceSession({ ...f, supervisor, buildSha256: "e".repeat(64), operations: ["transport.health"], assertAccountCurrent: () => undefined, onFrame: async () => {} }));
    assert.equal(createAdapter.mock.calls.length, 0);
  }
});

test("account revocation during asynchronous admission cannot produce an approved native spawn", async t => {
  const f = await preparedFixture();
  const { supervisor, createAdapter } = createStubSupervisor([createStubChildAdapter()]);
  t.after(async () => { await supervisor.shutdown(); f.lease.close(); });
  await assert.rejects(startSupportingServiceSession({ ...f, supervisor, buildSha256: "e".repeat(64), operations: ["transport.health"],
    assertAccountCurrent: async () => { await Promise.resolve(); f.authority.target.revoked = true; }, onFrame: async () => {} }));
  assert.equal(createAdapter.mock.calls.length, 0);
});

test("a blocked account lookup is cancellable before process construction", { timeout: 5000 }, async t => {
  const f = await preparedFixture();
  const { supervisor, createAdapter } = createStubSupervisor([createStubChildAdapter()]);
  t.after(async () => { await supervisor.shutdown(); f.lease.close(); });
  const entered = Promise.withResolvers<void>();
  const pending = startSupportingServiceSession({ ...f, supervisor, buildSha256: "e".repeat(64), operations: ["transport.health"],
    assertAccountCurrent: async () => { entered.resolve(); await new Promise(() => {}); }, onFrame: async () => {} });
  const refused = assert.rejects(pending, /could not start/);
  await entered.promise;
  f.lease.close();
  await refused;
  assert.equal(createAdapter.mock.calls.length, 0);
});
