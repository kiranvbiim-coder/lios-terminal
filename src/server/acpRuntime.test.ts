import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import type { ManagedRun, RunExit } from "./exec/types";
import { BoundAcpSession, acpSessionResource } from "./acp/session-binding";
import { inspectCodingRuntimeCapabilities, createCodingRuntimeAdapter } from "./acp/runtime-capabilities";
import { redactSensitiveText } from "./acp/error-format";
import { mergeSessionIdentity, createIdentityFromStatus } from "./acp/session-identity";
import { toAcpSessionLineageMeta } from "./acp/session-lineage-meta";

const owner: RuntimeExecutionContext = {
  requestId: "dbb0e154-e616-4629-ac98-b42c7df14e89", userId: 1, organizationId: 2,
  projectId: "CaseSensitiveProject", conversationId: 4, sessionId: null, activeObjectId: null,
  dataClassification: "private", approvedActions: [],
};
const exit: RunExit = {
  reason: "manual-cancel", exitCode: null, exitSignal: null, durationMs: 1,
  stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, timedOut: false, noOutputTimedOut: false,
};
function admittedRun(overrides: Partial<ManagedRun> = {}): ManagedRun {
  return { runId: "gm11-process", startedAtMs: 0, activity: { resultSettled: false, lastOutputAtMs: 0 },
    cancel() {}, wait: async () => exit, waitForExtinction: async () => {}, ...overrides };
}
function binding(run = admittedRun()): BoundAcpSession {
  return new BoundAcpSession(owner, {
    sessionKey: acpSessionResource(owner), agentId: "1", backend: "acpx", runtimeSessionName: "opaque-handle",
  }, run);
}

test("ACP locators are attributes bound to tenant, user, Project, Chat and request", () => {
  const session = binding();
  for (const changed of [
    { organizationId: 3 }, { userId: 2 }, { projectId: "casesensitiveproject" }, { conversationId: 5 },
    { requestId: "ddd0e154-e616-4629-ac98-b42c7df14e89" },
  ]) {
    const other = { ...owner, ...changed };
    assert.notEqual(acpSessionResource(other), acpSessionResource(owner));
    assert.throws(() => session.metadata(other), /another LiOS run/);
    assert.throws(() => session.cancel(other), /another LiOS run/);
  }
  assert.throws(() => new BoundAcpSession(owner, {
    sessionKey: acpSessionResource(owner), agentId: "other", backend: "acpx", runtimeSessionName: "opaque",
  }, admittedRun()), /does not bind/);
  assert.throws(() => new BoundAcpSession(owner, {
    sessionKey: "external-session-id", agentId: "1", backend: "acpx", runtimeSessionName: "opaque",
  }, admittedRun()), /does not bind/);
  assert.throws(() => acpSessionResource({ ...owner, userId: null }), /authenticated/);
});

test("metadata snapshots cannot mutate identity and stable locator drift fails closed", () => {
  const session = binding();
  session.observeStatus(owner, { backendSessionId: "backend-one", agentSessionId: "agent-one" });
  const snapshot = session.metadata(owner);
  snapshot.identity!.agentSessionId = "forged";
  assert.equal(session.metadata(owner).identity?.agentSessionId, "agent-one");
  assert.throws(() => session.observeStatus(owner, { backendSessionId: "different" }), /locator drift/);
  assert.equal(snapshot.requestId, owner.requestId);
  assert.equal(snapshot.lineage.sessionKey, owner.requestId);
});

test("cancel fences metadata, detaches output and joins exact GM-11 extinction once", async () => {
  const events: string[] = [];
  let extinct!: () => void;
  const extinction = new Promise<void>((resolve) => { extinct = resolve; });
  const session = binding(admittedRun({
    detachOutput() { events.push("detach"); }, cancel(reason) { events.push(reason!); },
    waitForExtinction: () => extinction,
  }));
  const first = session.cancel(owner);
  assert.equal(first, session.cancel(owner));
  assert.deepEqual(events, ["detach", "manual-cancel"]);
  assert.equal(session.metadata(owner).admissionClosed, true);
  assert.throws(() => session.observeStatus(owner, {}), /admission is closed/);
  let settled = false;
  void first.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  extinct();
  await first;
});

test("cancel preserves cleanup custody when a native hook throws and never retains secrets", async () => {
  let joined = false;
  const session = binding(admittedRun({
    cancel() { throw new Error("Authorization: Bearer private-key-secret"); },
    waitForExtinction: async () => { joined = true; },
  }));
  await assert.rejects(session.cancel(owner), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.cause, undefined);
    assert.equal(error.message.includes("private-key-secret"), false);
    return true;
  });
  assert.equal(joined, true);
  assert.throws(() => binding(admittedRun({ waitForExtinction: undefined })), /does not bind/);
});

test("imported identity merge retains resolved ids when pending observations arrive", () => {
  const current = createIdentityFromStatus({ status: { backendSessionId: "stable" }, now: 1 });
  const incoming = { state: "pending" as const, acpxRecordId: "provisional", source: "ensure" as const, lastUpdatedAt: 2 };
  const merged = mergeSessionIdentity({ current, incoming, now: 3 });
  assert.equal(merged?.state, "resolved");
  assert.equal(merged?.acpxSessionId, "stable");
  assert.equal(merged?.acpxRecordId, undefined);
  assert.deepEqual(toAcpSessionLineageMeta({ key: "run", parentSessionKey: "parent", spawnDepth: -1, subagentRole: "invalid" }),
    { sessionKey: "run", parentSessionId: "parent" });
});

test("imported redactor handles Digest, serialized bearer and assignment credentials", () => {
  for (const input of [
    'Authorization: Digest username="alice", realm="private", response="digest-secret"',
    'Authorization: Bearer bearer-secret',
    'API_KEY=assignment-secret',
    JSON.stringify({ Authorization: "Bearer json-secret" }),
  ]) {
    const output = redactSensitiveText(input);
    assert.equal(/digest-secret|bearer-secret|assignment-secret|json-secret/.test(output), false);
    assert.ok(output.includes("REDACTED"));
  }
});

test("runtime capability inventory distinguishes executable presence from governed availability", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lios-acp-inventory-"));
  try {
    const noModule = () => { throw new Error("Authorization: Bearer private-host-secret"); };
    const absent = await inspectCodingRuntimeCapabilities({ PATH: root }, "darwin", noModule);
    assert.equal(absent.reason, "runtime_not_installed");
    const binary = path.join(root, "acpx");
    await writeFile(binary, "not-executed");
    await chmod(binary, 0o600);
    assert.equal((await inspectCodingRuntimeCapabilities({ PATH: root }, "darwin", noModule)).installations[0].executableInstalled, false);
    await chmod(binary, 0o700);
    const installed = await inspectCodingRuntimeCapabilities({ PATH: root }, "darwin", noModule);
    assert.equal(installed.installations[0].executableInstalled, true);
    assert.equal(installed.reason, "governed_transport_unavailable");
    assert.equal(installed.governedCodingAvailable, false);
    assert.equal(installed.protocolVerified, false);
    assert.deepEqual(installed.controls, []);
    assert.equal(JSON.stringify(installed).includes(root), false);
    assert.equal(JSON.stringify(installed).includes("private-host-secret"), false);
    assert.equal((await inspectCodingRuntimeCapabilities({ PATH: "" }, "darwin", () => "resolved" )).acpxRuntimeModuleInstalled, true);
    const adapter = createCodingRuntimeAdapter({ PATH: root });
    assert.deepEqual(adapter.descriptor.capabilities, ["coding:runtime-inventory"]);
    assert.equal((await adapter.health!()).state, "disabled");
  } finally { await rm(root, { recursive: true, force: true }); }
});
