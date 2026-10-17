import assert from "node:assert/strict";
import { createServer } from "node:https";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { WebSocketServer } from "ws";
import { buildDeviceProofPayload, fromBase64Url } from "@shared/devicePairing";
import { REMOTE_DIAGNOSIS_CAPABILITY, REMOTE_FINANCE_CAPABILITY, remoteNodeMethods } from "@shared/remoteNode";
import { GatewayClient } from "../client/src/lib/gateway/gatewayClient";
import { createDeviceIdentity } from "../client/src/lib/gateway/deviceIdentity";
import { GatewayHub } from "./gatewayHub";
import { loadOrCreateDeviceTlsIdentity } from "./deviceTls";
import { createPinnedDeviceSocket } from "./pinnedDeviceSocket";
import { createExecutionJournal } from "./exec/execution-journal";
import { registerRemoteNodeGateway } from "./gatewayRemoteNode";
import { executeNodeLocalFinanceSnapshot, loadNodeLocalFinanceSource } from "./remoteNodeFinance";
import { calculatePersonalFinanceSnapshot } from "./p6PersonalFinance";
import { createNodeFinanceTool, nodeFinanceToolOutputSchema } from "./nodeFinanceTool";

const call = { source: "workflow" as const, requestId: "63f90487-219f-4d6e-9609-af1b224108fe", userId: 1, sourceScope: "my_data" as const };

test("node finance refuses missing session, agent exposure and source-scope broadening before dispatch", async () => {
  const tool = createNodeFinanceTool({ sessionForCall: () => null });
  const input = { policy: { capability: REMOTE_FINANCE_CAPABILITY, source: { sourceId: "owned", inputHash: "a".repeat(64) }, approvedDeviceIds: ["device"], hardware: null } };
  await assert.rejects(tool.invoke(input, new AbortController().signal, call), /Gateway session/);
  await assert.rejects(tool.invoke(input, new AbortController().signal, { ...call, source: "agent" }), /owner-requested/);
  await assert.rejects(tool.invoke(input, new AbortController().signal, { ...call, sourceScope: "web" }), /owner-requested/);
});

test("governed node finance tool executes canonical P6 through actual signed pinned Gateway worker and journals exact source", { timeout: 120_000, skip: process.platform === "win32" }, async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "lios-node-finance-tool-")));
  const clients: GatewayClient[] = [];
  const tls = await loadOrCreateDeviceTlsIdentity(path.join(directory, "tls"));
  const journal = await createExecutionJournal({ directory: path.join(directory, "journal"), keyDirectory: path.join(directory, "key") });
  const hub = new GatewayHub({ version: "node-finance-tool-test" });
  const allowed = new Set<string>();
  registerRemoteNodeGateway(hub, { journal: async () => journal, requireCurrent: async connection => { assert.ok(allowed.has(connection.identity.deviceId!)); } });
  const server = createServer({ cert: tls.certificatePem, key: tls.privateKeyPem });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, ws => hub.attachUnauthenticated(ws, { authenticate: async ({ params, nonce }) => {
    const proof = params.device; assert.ok(proof && allowed.has(proof.id));
    const key = await crypto.subtle.importKey("raw", fromBase64Url(proof.publicKey) as BufferSource, "Ed25519", false, ["verify"]);
    const payload = buildDeviceProofPayload({ deviceId: proof.id, clientId: params.client.id, clientMode: params.client.mode, scopes: params.scopes ?? [], signedAt: proof.signedAt, nonce, pairingToken: "", capabilities: proof.capabilities, commands: proof.commands });
    assert.equal(await crypto.subtle.verify("Ed25519", key, fromBase64Url(proof.signature) as BufferSource, new TextEncoder().encode(payload)), true);
    return { kind: "accept", identity: { userId: 1, email: "node@example.test", role: "client_user", organizationId: null, grantedScopes: ["read"], deviceId: proof.id } };
  } }, request.socket.remoteAddress)));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  t.after(async () => {
    for (const client of clients) client.stop();
    await hub.shutdown("test");
    for (const ws of sockets.clients) ws.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    sockets.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const connect = async () => {
    const identity = await createDeviceIdentity(); allowed.add(identity.identity.id);
    const client = new GatewayClient({ url: `wss://127.0.0.1:${address.port}/gateway/device`, WebSocketImpl: createPinnedDeviceSocket(tls.fingerprint), scopes: ["read"], clientInfo: { id: "node-finance-tool-test", version: "1", platform: "node", mode: "test" }, device: { identity: identity.identity } });
    clients.push(client);
    // Real TLS/WebSocket readiness cannot use a virtual clock; this is a failure deadline, not a fixed wait.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Signed pinned Gateway handshake did not become ready")), 30_000);
      const unsubscribe = client.onReady(() => { clearTimeout(timer); unsubscribe(); resolve(); });
      client.start();
    });
    return { client, deviceId: identity.identity.id };
  };
  const requester = await connect(); const worker = await connect();
  const profile = { schemaVersion: "1" as const, asOf: "2020-01-01", accounts: [{ id: "private-account-never-transmitted", kind: "bank" as const, balance: 250000, currency: "INR" }], transactions: [], debts: [], goals: [], retirement: null };
  const profilePath = path.join(directory, "private-profile.json"); await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
  const configuration = { sourceId: "owned-profile", profilePath, ownerApproved: true as const, dataRights: "user-owned-profile" as const };
  const source = (await loadNodeLocalFinanceSource(configuration)).source;
  await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY, financeSources: [source] });
  const tool = createNodeFinanceTool({ sessionForCall: () => ({ userId: 1, request: (method, params) => requester.client.requestRaw(method, params) }) });
  const input = { policy: { capability: REMOTE_FINANCE_CAPABILITY, source, approvedDeviceIds: [worker.deviceId], hardware: null } };
  const pending = tool.invoke(input, new AbortController().signal, call);
  let operation;
  const dispatchDeadline = Date.now() + 30_000;
  // The actual worker polls the actual Gateway; wait for dispatch, never assume it after a fixed sleep.
  while (Date.now() < dispatchDeadline) {
    const poll = remoteNodeMethods["node.operation.poll"].result.parse(await worker.client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY, financeSources: [source] }));
    if (poll.operation) { operation = poll.operation; break; } await sleep(20);
  }
  assert.ok(operation); assert.equal(operation.capability, REMOTE_FINANCE_CAPABILITY);
  const report = await executeNodeLocalFinanceSnapshot(configuration, source);
  await worker.client.requestRaw("node.operation.result", { binding: operation, report });
  const result = nodeFinanceToolOutputSchema.parse(await pending);
  const canonical = calculatePersonalFinanceSnapshot(profile);
  assert.equal(result.output.report.netWorth, canonical.netWorth);
  assert.equal(result.output.report.engineInputHash, canonical.inputHash);
  assert.equal(result.output.composition.maxAiCalls, 0);
  assert.equal(result.output.composition.inferenceRequired, false);
  assert.equal(result.output.outcome.independentHardwareVerification, false);
  const record = await journal.read(operation.requestId, { userId: 1, projectId: null, chatId: null });
  assert.equal(record?.status, "completed"); assert.match(record!.stdout, new RegExp(source.inputHash));
  assert.doesNotMatch(JSON.stringify(result) + record!.stdout, /private-account-never-transmitted|private-profile\.json|profilePath/);
  allowed.delete(worker.deviceId);
  await assert.rejects(tool.invoke(input, new AbortController().signal, call), /No current owner-approved node/);
});
