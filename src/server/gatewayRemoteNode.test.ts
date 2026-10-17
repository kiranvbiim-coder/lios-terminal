import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:https";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { WebSocketServer } from "ws";
import { buildDeviceProofPayload, fromBase64Url } from "@shared/devicePairing";
import { REMOTE_DIAGNOSIS_CAPABILITY, REMOTE_FINANCE_CAPABILITY, remoteDiagnosisReportSchema, remoteFinanceReportSchema, remoteNodeMethods, type RemoteFinanceSource } from "@shared/remoteNode";
import { GatewayClient } from "../client/src/lib/gateway/gatewayClient";
import { createDeviceIdentity, type CreatedDeviceIdentity } from "../client/src/lib/gateway/deviceIdentity";
import { GatewayHub, type GatewayAuthenticator } from "./gatewayHub";
import { loadOrCreateDeviceTlsIdentity } from "./deviceTls";
import { createPinnedDeviceSocket } from "./pinnedDeviceSocket";
import { createExecutionJournal } from "./exec/execution-journal";
import { registerRemoteNodeGateway } from "./gatewayRemoteNode";
import { readNodeRuntimeDiagnosis } from "./remoteNodeWorker";
import { randomUUID } from "node:crypto";
import { calculatePersonalFinanceSnapshot } from "./p6PersonalFinance";
import { executeNodeLocalFinanceSnapshot, loadNodeLocalFinanceSource } from "./remoteNodeFinance";

async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "lios-remote-node-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tls = await loadOrCreateDeviceTlsIdentity(path.join(directory, "tls"));
  const journal = await createExecutionJournal({ directory: path.join(directory, "journal"), keyDirectory: path.join(directory, "key") });
  const hub = new GatewayHub({ version: "remote-node-test" });
  const allowed = new Set<string>();
  const revoked = new Set<string>();
  registerRemoteNodeGateway(hub, { journal: async () => journal, requireCurrent: async (connection) => {
    if (revoked.has(connection.identity.deviceId!)) throw new Error("Current device revoked");
  } });
  const authenticator: GatewayAuthenticator = { authenticate: async ({ params, nonce }) => {
    const proof = params.device;
    assert.ok(proof && allowed.has(proof.id));
    const key = await crypto.subtle.importKey("raw", fromBase64Url(proof.publicKey) as BufferSource, "Ed25519", false, ["verify"]);
    const payload = buildDeviceProofPayload({ deviceId: proof.id, clientId: params.client.id, clientMode: params.client.mode, scopes: params.scopes ?? [], signedAt: proof.signedAt, nonce, pairingToken: "", capabilities: proof.capabilities, commands: proof.commands });
    assert.equal(await crypto.subtle.verify("Ed25519", key, fromBase64Url(proof.signature) as BufferSource, new TextEncoder().encode(payload)), true);
    return { kind: "accept", identity: { userId: 1, email: "node@example.test", role: "client_user", organizationId: null, grantedScopes: ["read"], deviceId: proof.id } };
  } };
  const server = createServer({ cert: tls.certificatePem, key: tls.privateKeyPem });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, (ws) => hub.attachUnauthenticated(ws, authenticator, request.socket.remoteAddress)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    await hub.shutdown("test");
    for (const ws of sockets.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    sockets.close();
  });
  const url = `wss://127.0.0.1:${address.port}/gateway/device`;
  const connect = async (existing?: CreatedDeviceIdentity) => {
    const created = existing ?? await createDeviceIdentity();
    allowed.add(created.identity.id);
    const client = new GatewayClient({ url, WebSocketImpl: createPinnedDeviceSocket(tls.fingerprint), scopes: ["read"], clientInfo: { id: "diagnosis-test", version: "1", platform: "node", mode: "test" }, device: { identity: created.identity } });
    t.after(() => client.stop());
    const ready = new Promise<void>((resolve) => client.onReady(() => resolve()));
    client.start();
    await ready;
    return { client, identity: created.identity, exportKeys: created.exportKeys };
  };
  return { directory, tls, journal, hub, allowed, revoked, url, connect };
}

async function discover(client: GatewayClient) {
  for (let i = 0; i < 100; i++) {
    const list = remoteNodeMethods["node.diagnosis.list"].result.parse(await client.requestRaw("node.diagnosis.list", {}));
    if (list.nodes.length) return list.nodes[0];
    await sleep(50);
  }
  throw new Error("A real paired worker did not become available");
}

async function receiveOperation(client: GatewayClient, financeSources: RemoteFinanceSource[] = []) {
  for (let i = 0; i < 100; i++) {
    const poll = remoteNodeMethods["node.operation.poll"].result.parse(await client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY, financeSources }));
    if (poll.operation) return poll;
    await sleep(20);
  }
  throw new Error("Home did not dispatch the admitted operation");
}

async function recordHardwareObservation(requester: GatewayClient, worker: GatewayClient) {
  await worker.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  assert.ok(worker.hello?.auth.deviceId);
  const requestId = randomUUID();
  const target = { deviceId: worker.hello.auth.deviceId, generationId: worker.hello.server.connId, capability: REMOTE_DIAGNOSIS_CAPABILITY };
  const result = requester.requestRaw("node.diagnosis.run", { ...target, requestId });
  const poll = await receiveOperation(worker);
  assert.ok(poll.operation);
  const report = readNodeRuntimeDiagnosis();
  await worker.requestRaw("node.operation.result", { binding: poll.operation, report });
  assert.equal(remoteNodeMethods["node.diagnosis.run"].result.parse(await result).status, "completed");
  return { target, requestId, report };
}

test("two processes: signed pinned worker executes actual OS read and Home durably records remote-reported outcome", { timeout: 20000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const workerIdentity = await createDeviceIdentity();
  home.allowed.add(workerIdentity.identity.id);
  const filename = path.join(home.directory, "worker.json");
  await writeFile(filename, JSON.stringify({ url: home.url, fingerprint: home.tls.fingerprint, keys: await workerIdentity.exportKeys() }), { mode: 0o600 });
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("script/remote_node_worker.ts"), filename], { cwd: process.cwd(), stdio: "pipe" });
  const childExit = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await childExit; });
  const target = await discover(requester.client);
  assert.equal(target.deviceId, workerIdentity.identity.id);
  const requestId = randomUUID();
  const policy = { capability: REMOTE_DIAGNOSIS_CAPABILITY, approvedDeviceIds: [target.deviceId], hardware: null };
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId, policy }));
  assert.deepEqual(selection.target, target);
  const result = remoteNodeMethods["node.diagnosis.run"].result.parse(await requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId, placement: { policy, selection } }));
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "remote-reported");
  assert.equal(result.independentHardwareVerification, false);
  const report = remoteDiagnosisReportSchema.parse(result.report);
  assert.equal(report.nodeVersion, process.version);
  assert.equal(report.execution, "synchronous-node-os-read-no-subprocess");
  const record = await home.journal.read(requestId, { userId: 1, projectId: null, chatId: null });
  assert.equal(record?.status, "completed");
  assert.equal(record?.exitCode, null);
  assert.match(record!.stdout, /remote-reported/);
  assert.match(record!.stdout, new RegExp(target.generationId));
  assert.match(record!.stdout, new RegExp(selection.policyHash));
  assert.ok(result.binding.placementDigest);
  await assert.rejects(requester.client.requestRaw("node.diagnosis.run", { ...target, requestId }), /The request failed/);
});

test("disconnect after dispatch persists unknown outcome, rejects stale generation and never replays", { timeout: 20000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  const target = await discover(requester.client);
  const requestId = randomUUID();
  const result = requester.client.requestRaw("node.diagnosis.run", { ...target, requestId });
  const poll = await receiveOperation(worker.client);
  assert.ok(poll.operation);
  worker.client.stop();
  const outcome = remoteNodeMethods["node.diagnosis.run"].result.parse(await result);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.outcome, "outcome-unknown");
  assert.equal(outcome.reason, "disconnected");
  assert.equal((await home.journal.read(requestId, { userId: 1, projectId: null, chatId: null }))?.status, "failed");
  const replacement = await home.connect();
  await replacement.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  await assert.rejects(replacement.client.requestRaw("node.operation.result", { binding: poll.operation, report: readNodeRuntimeDiagnosis() }), /exact, live/);
  await assert.rejects(requester.client.requestRaw("node.diagnosis.run", { ...target, requestId: randomUUID() }), /unavailable/);
});

test("current revocation refuses result and durably fails the in-flight operation", { timeout: 20000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  const target = await discover(requester.client);
  const result = requester.client.requestRaw("node.diagnosis.run", { ...target, requestId: randomUUID() });
  const poll = await receiveOperation(worker.client);
  assert.ok(poll.operation);
  home.revoked.add(worker.identity.id);
  await assert.rejects(worker.client.requestRaw("node.operation.result", { binding: poll.operation, report: readNodeRuntimeDiagnosis() }), /The request failed/);
  const outcome = remoteNodeMethods["node.diagnosis.run"].result.parse(await result);
  assert.equal(outcome.reason, "authority-changed");
  assert.equal(outcome.outcome, "outcome-unknown");
  assert.equal(outcome.report, null);
});

test("lost result times out durably; repeated polls never dispatch twice", { timeout: 20000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  const target = await discover(requester.client);
  const result = requester.client.requestRaw("node.diagnosis.run", { ...target, requestId: randomUUID() });
  const poll = await receiveOperation(worker.client);
  assert.ok(poll.operation);
  const second = remoteNodeMethods["node.operation.poll"].result.parse(await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY }));
  assert.equal(second.operation, null);
  const outcome = remoteNodeMethods["node.diagnosis.run"].result.parse(await result);
  assert.equal(outcome.reason, "timeout");
  assert.equal(outcome.outcome, "outcome-unknown");
  await assert.rejects(worker.client.requestRaw("node.operation.result", { binding: poll.operation, report: readNodeRuntimeDiagnosis() }), /exact, live/);
});

test("result binds device, owner, generation, request and capability; unsupported execution never starts", { timeout: 20000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  const stranger = await home.connect();
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  const target = await discover(requester.client);
  await assert.rejects(requester.client.requestRaw("node.diagnosis.run", { ...target, requestId: randomUUID(), capability: "shell.exec" }), /Parameters do not match/);
  const requestId = randomUUID();
  const result = requester.client.requestRaw("node.diagnosis.run", { ...target, requestId });
  const poll = await receiveOperation(worker.client);
  assert.ok(poll.operation);
  const report = readNodeRuntimeDiagnosis();
  await assert.rejects(stranger.client.requestRaw("node.operation.result", { binding: poll.operation, report }), /exact, live/);
  for (const mismatch of [{ userId: 2 }, { deviceId: stranger.identity.id }, { generationId: "stale-generation" }, { requestId: randomUUID() }]) {
    await assert.rejects(worker.client.requestRaw("node.operation.result", { binding: { ...poll.operation, ...mismatch }, report }), /exact, live/);
  }
  await worker.client.requestRaw("node.operation.result", { binding: poll.operation, report });
  const outcome = remoteNodeMethods["node.diagnosis.run"].result.parse(await result);
  assert.equal(outcome.status, "completed");
  await assert.rejects(worker.client.requestRaw("node.operation.result", { binding: poll.operation, report }), /exact, live/);
});

test("requester revocation after admission cannot release an operation", { timeout: 20000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  const target = await discover(requester.client);
  const requestId = randomUUID();
  const result = requester.client.requestRaw("node.diagnosis.run", { ...target, requestId });
  for (let i = 0; i < 100; i++) {
    if (await home.journal.read(requestId, { userId: 1, projectId: null, chatId: null })) break;
    await sleep(20);
  }
  home.revoked.add(requester.identity.id);
  await assert.rejects(worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY }), /The request failed/);
  const outcome = remoteNodeMethods["node.diagnosis.run"].result.parse(await result);
  assert.equal(outcome.reason, "authority-changed");
  assert.equal(outcome.outcome, "not-dispatched");
  assert.equal(outcome.report, null);
});

test("two processes: node-local owner-approved P6 snapshot binds source bytes and retains no raw accounts", { timeout: 20000, skip: process.platform === "win32" }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const workerIdentity = await createDeviceIdentity();
  home.allowed.add(workerIdentity.identity.id);
  const profile = { schemaVersion: "1" as const, asOf: "2020-01-01", accounts: [{ id: "private-account-must-not-leave", kind: "bank" as const, balance: 250000, currency: "INR" }], transactions: [], debts: [], goals: [], retirement: null };
  const profilePath = path.join(home.directory, "private-profile.json");
  await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
  const finance = { sourceId: "owner-approved-profile", profilePath, ownerApproved: true as const, dataRights: "user-owned-profile" as const };
  const expectedSource = (await loadNodeLocalFinanceSource(finance)).source;
  const filename = path.join(home.directory, "worker-finance.json");
  await writeFile(filename, JSON.stringify({ url: home.url, fingerprint: home.tls.fingerprint, keys: await workerIdentity.exportKeys(), finance }), { mode: 0o600 });
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("script/remote_node_worker.ts"), filename], { cwd: process.cwd(), stdio: "pipe" });
  const childExit = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await childExit; });
  let target;
  for (let i = 0; i < 100; i++) {
    const list = remoteNodeMethods["node.finance.list"].result.parse(await requester.client.requestRaw("node.finance.list", {}));
    target = list.nodes[0];
    if (target) break;
    await sleep(50);
  }
  assert.ok(target);
  assert.deepEqual(target.source, expectedSource);
  const requestId = randomUUID();
  const policy = { capability: REMOTE_FINANCE_CAPABILITY, source: expectedSource, approvedDeviceIds: [target.deviceId], hardware: null };
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId, policy }));
  assert.deepEqual(selection.target, target);
  const result = remoteNodeMethods["node.finance.run"].result.parse(await requester.client.requestRaw("node.finance.run", { ...selection.target, requestId, placement: { policy, selection } }));
  assert.equal(result.outcome, "remote-reported");
  assert.equal(result.status, "completed");
  assert.equal(result.binding.capability, REMOTE_FINANCE_CAPABILITY);
  const report = remoteFinanceReportSchema.parse(result.report);
  const canonical = calculatePersonalFinanceSnapshot(profile);
  assert.equal(report.netWorth, canonical.netWorth);
  assert.equal(report.engineInputHash, canonical.inputHash);
  assert.deepEqual(report.source, expectedSource);
  const stored = await home.journal.read(requestId, { userId: 1, projectId: null, chatId: null });
  assert.equal(stored?.status, "completed");
  assert.match(stored!.stdout, new RegExp(expectedSource.inputHash));
  assert.doesNotMatch(JSON.stringify(result) + stored!.stdout, /private-account-must-not-leave|private-profile\\.json|profilePath/);
  await writeFile(profilePath, JSON.stringify({ ...profile, accounts: [{ ...profile.accounts[0], balance: 300000 }] }), { mode: 0o600 });
  // The stale binding is either denied at Home discovery/admission or refused
  // by the real node reread; neither path may return the new input as old.
  try {
    const stale = remoteNodeMethods["node.finance.run"].result.parse(await requester.client.requestRaw("node.finance.run", { ...target, requestId: randomUUID() }));
    assert.equal(stale.status, "failed");
    assert.equal(stale.report, null);
    assert.equal(stale.reason, "source-unavailable");
  } catch (error) {
    assert.match(String(error), /source is unavailable or changed/);
  }
});

test("finance execution rereads source bytes after dispatch and Home rejects a mismatched report hash", { timeout: 20000, skip: process.platform === "win32" }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  const profilePath = path.join(home.directory, "private-reread-profile.json");
  const profile = { schemaVersion: "1", asOf: "2020-01-01", accounts: [], transactions: [], debts: [], goals: [], retirement: null };
  await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
  const configuration = { sourceId: "reread-profile", profilePath, ownerApproved: true as const, dataRights: "user-owned-profile" as const };
  const source = (await loadNodeLocalFinanceSource(configuration)).source;
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY, financeSources: [source] });
  const target = remoteNodeMethods["node.finance.list"].result.parse(await requester.client.requestRaw("node.finance.list", {})).nodes[0];
  assert.ok(target);
  const run = requester.client.requestRaw("node.finance.run", { ...target, requestId: randomUUID() });
  const poll = await receiveOperation(worker.client, [source]);
  assert.ok(poll.operation);
  const correctReport = await executeNodeLocalFinanceSnapshot(configuration, source);
  await assert.rejects(worker.client.requestRaw("node.operation.result", { binding: poll.operation, report: { ...correctReport, source: { ...source, inputHash: "0".repeat(64) } } }), /does not match/);
  await writeFile(profilePath, JSON.stringify(profile) + " ");
  await assert.rejects(executeNodeLocalFinanceSnapshot(configuration, source), /hash/);
  await worker.client.requestRaw("node.operation.result", { binding: poll.operation, report: null, failure: "source-unavailable" });
  const outcome = remoteNodeMethods["node.finance.run"].result.parse(await run);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "source-unavailable");
  assert.equal(outcome.report, null);
});

test("placement deterministically selects only approved usable nodes and executes that exact target", { timeout: 15000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const a = await home.connect();
  const b = await home.connect();
  for (const node of [a, b]) await node.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  const approvedDeviceIds = [b.identity.id, a.identity.id];
  const policy = { capability: REMOTE_DIAGNOSIS_CAPABILITY, approvedDeviceIds, hardware: null };
  const requestId = randomUUID();
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId, policy }));
  const ordered = [a, b].sort((left, right) => left.identity.id < right.identity.id ? -1 : 1);
  assert.equal(selection.target.deviceId, ordered[0].identity.id);
  assert.equal(selection.hardwareEvidence, null);
  const run = requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId, placement: { policy, selection } });
  const poll = await receiveOperation(ordered[0].client);
  assert.ok(poll.operation?.placementDigest);
  await ordered[0].client.requestRaw("node.operation.result", { binding: poll.operation, report: readNodeRuntimeDiagnosis() });
  const outcome = remoteNodeMethods["node.diagnosis.run"].result.parse(await run);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.binding.deviceId, selection.target.deviceId);
  assert.equal(outcome.binding.generationId, selection.target.generationId);
  const other = remoteNodeMethods["node.operation.poll"].result.parse(await ordered[1].client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY }));
  assert.equal(other.operation, null);
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy: { ...policy, approvedDeviceIds: ["unapproved-node"] } }), /No current owner-approved/);
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy: { ...policy, capability: "shell.exec" } }), /Parameters do not match/);
});

test("placement requires fresh same-generation remote-reported hardware and refuses unknown or independently attested requirements", { timeout: 15000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  const policy = { capability: REMOTE_DIAGNOSIS_CAPABILITY, approvedDeviceIds: [worker.identity.id], hardware: { minimumFreeMemoryBytes: 0, maxAgeMs: 30000, evidence: "remote-reported" } };
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy }), /No current owner-approved/);
  const observed = await recordHardwareObservation(requester.client, worker.client);
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy }));
  assert.equal(selection.hardwareEvidence?.requestId, observed.requestId);
  assert.equal(selection.hardwareEvidence?.generationId, observed.target.generationId);
  assert.equal(selection.hardwareEvidence?.trust, "remote-reported");
  assert.equal(selection.hardwareEvidence?.freeMemoryBytes, observed.report.freeMemoryBytes);
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy: { ...policy, hardware: { ...policy.hardware, evidence: "independent-attestation" } } }), /Independent hardware attestation is unavailable/);
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy: { ...policy, hardware: { ...policy.hardware, minimumFreeMemoryBytes: observed.report.totalMemoryBytes + 1 } } }), /No current owner-approved/);
  await sleep(20);
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy: { ...policy, hardware: { ...policy.hardware, maxAgeMs: 1 } } }), /No current owner-approved/);
  worker.client.stop();
  for (let i = 0; i < 100 && home.hub.readyConnections().some((connection) => connection.connId === observed.target.generationId); i++) await sleep(20);
  const otherGeneration = await home.connect(worker);
  assert.equal(otherGeneration.identity.id, worker.identity.id);
  assert.notEqual(otherGeneration.client.hello?.server.connId, observed.target.generationId);
  await otherGeneration.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy }), /No current owner-approved/);
});

test("placement refuses changed policy, tampered selection, different request and disconnected generation without fallback", { timeout: 15000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  const alternative = await home.connect();
  for (const node of [worker, alternative]) await node.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY });
  const policy = { capability: REMOTE_DIAGNOSIS_CAPABILITY, approvedDeviceIds: [worker.identity.id], hardware: null };
  const requestId = randomUUID();
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId, policy }));
  await assert.rejects(requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId, placement: { policy: { ...policy, approvedDeviceIds: [alternative.identity.id] }, selection } }), /policy, owner, request/);
  await assert.rejects(requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId: randomUUID(), placement: { policy, selection } }), /policy, owner, request/);
  await assert.rejects(requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId, placement: { policy, selection: { ...selection, hardwareEvidence: null, policyHash: "0".repeat(64) } } }), /altered/);
  worker.client.stop();
  for (let i = 0; i < 100 && home.hub.readyConnections().some((connection) => connection.connId === selection.target.generationId); i++) await sleep(20);
  await assert.rejects(requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId, placement: { policy, selection } }), /unavailable/);
  const other = remoteNodeMethods["node.operation.poll"].result.parse(await alternative.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY }));
  assert.equal(other.operation, null);
  assert.equal(await home.journal.read(requestId, { userId: 1, projectId: null, chatId: null }), null);
});

test("hardware policy drift after durable admission terminalizes without releasing work", { timeout: 15000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  await recordHardwareObservation(requester.client, worker.client);
  const policy = { capability: REMOTE_DIAGNOSIS_CAPABILITY, approvedDeviceIds: [worker.identity.id], hardware: { minimumFreeMemoryBytes: 0, maxAgeMs: 1000, evidence: "remote-reported" } };
  const requestId = randomUUID();
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId, policy }));
  const run = requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId, placement: { policy, selection } });
  for (let i = 0; i < 100; i++) {
    if (await home.journal.read(requestId, { userId: 1, projectId: null, chatId: null })) break;
    await sleep(20);
  }
  await sleep(1100);
  await assert.rejects(worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY }), /Fresh same-generation/);
  const outcome = remoteNodeMethods["node.diagnosis.run"].result.parse(await run);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.outcome, "not-dispatched");
  assert.equal(outcome.reason, "placement-changed");
  assert.equal((await home.journal.read(requestId, { userId: 1, projectId: null, chatId: null }))?.status, "failed");
});

test("placement finance policy binds exact source identity/hash and rechecks source drift before admission", { timeout: 15000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  const source = { sourceId: "owned-profile", inputHash: "a".repeat(64) };
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY, financeSources: [source] });
  const policy = { capability: REMOTE_FINANCE_CAPABILITY, source, approvedDeviceIds: [worker.identity.id], hardware: null };
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy: { ...policy, source: { ...source, sourceId: "unknown-profile" } } }), /No current owner-approved/);
  await assert.rejects(requester.client.requestRaw("node.operation.select", { requestId: randomUUID(), policy: { ...policy, source: { ...source, inputHash: "b".repeat(64) } } }), /No current owner-approved/);
  const requestId = randomUUID();
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId, policy }));
  assert.equal(selection.target.capability, REMOTE_FINANCE_CAPABILITY);
  if (selection.target.capability === REMOTE_FINANCE_CAPABILITY) assert.deepEqual(selection.target.source, source);
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY, financeSources: [{ ...source, inputHash: "b".repeat(64) }] });
  await assert.rejects(requester.client.requestRaw("node.finance.run", { ...selection.target, requestId, placement: { policy, selection } }), /source is unavailable or changed/);
  assert.equal(await home.journal.read(requestId, { userId: 1, projectId: null, chatId: null }), null);
});

test("a newer hardware observation invalidates an earlier selection even when minimum memory still qualifies", { timeout: 15000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  await recordHardwareObservation(requester.client, worker.client);
  const policy = { capability: REMOTE_DIAGNOSIS_CAPABILITY, approvedDeviceIds: [worker.identity.id], hardware: { minimumFreeMemoryBytes: 0, maxAgeMs: 30000, evidence: "remote-reported" } };
  const requestId = randomUUID();
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId, policy }));
  await recordHardwareObservation(requester.client, worker.client);
  await assert.rejects(requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId, placement: { policy, selection } }), /hardware observation changed/);
});

test("hardware evidence expiring after dispatch cannot be laundered into a completed receipt", { timeout: 15000 }, async (t) => {
  const home = await fixture(t);
  const requester = await home.connect();
  const worker = await home.connect();
  await recordHardwareObservation(requester.client, worker.client);
  const policy = { capability: REMOTE_DIAGNOSIS_CAPABILITY, approvedDeviceIds: [worker.identity.id], hardware: { minimumFreeMemoryBytes: 0, maxAgeMs: 1000, evidence: "remote-reported" } };
  const requestId = randomUUID();
  const selection = remoteNodeMethods["node.operation.select"].result.parse(await requester.client.requestRaw("node.operation.select", { requestId, policy }));
  const run = requester.client.requestRaw("node.diagnosis.run", { ...selection.target, requestId, placement: { policy, selection } });
  const poll = await receiveOperation(worker.client);
  assert.ok(poll.operation);
  await sleep(1100);
  await assert.rejects(worker.client.requestRaw("node.operation.result", { binding: poll.operation, report: readNodeRuntimeDiagnosis() }), /Fresh same-generation/);
  const outcome = remoteNodeMethods["node.diagnosis.run"].result.parse(await run);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.outcome, "outcome-unknown");
  assert.equal(outcome.reason, "placement-changed");
  assert.equal(outcome.report, null);
});
