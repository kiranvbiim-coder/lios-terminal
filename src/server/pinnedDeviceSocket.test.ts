import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { createServer } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { WebSocketServer } from "ws";
import { buildDeviceProofPayload, fromBase64Url } from "@shared/devicePairing";
import { GatewayClient } from "../client/src/lib/gateway/gatewayClient";
import { createDeviceIdentity } from "../client/src/lib/gateway/deviceIdentity";
import { GatewayHub } from "./gatewayHub";
import type { GatewayAuthenticator } from "./gatewayHub";
import { loadOrCreateDeviceTlsIdentity } from "./deviceTls";
import { createPinnedDeviceSocket } from "./pinnedDeviceSocket";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "lios-pinned-socket-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const identity = await loadOrCreateDeviceTlsIdentity(directory);
  const hub = new GatewayHub({ version: "pinned-test" });
  let upgradeCount = 0;
  let proofCount = 0;
  const authenticator: GatewayAuthenticator = {
    authenticate: async ({ params, nonce, remoteAddress }) => {
      proofCount += 1;
      assert.equal(remoteAddress, "127.0.0.1");
      assert.ok(nonce.length >= 16, "the signed proof is bound to a fresh Gateway challenge");
      assert.ok(params.device);
      const proof = params.device;
      const key = await crypto.subtle.importKey("raw", fromBase64Url(proof.publicKey) as BufferSource, "Ed25519", false, ["verify"]);
      const payload = buildDeviceProofPayload({ deviceId: proof.id, clientId: params.client.id, clientMode: params.client.mode, scopes: params.scopes ?? [], signedAt: proof.signedAt, nonce, pairingToken: params.pairing?.token ?? "" });
      assert.equal(await crypto.subtle.verify("Ed25519", key, fromBase64Url(proof.signature) as BufferSource, new TextEncoder().encode(payload)), true);
      return { kind: "accept", identity: { userId: 1, email: "device@example.test", role: "client_user", organizationId: null, grantedScopes: ["read", "write"], deviceId: proof.id } };
    },
  };
  const server = createServer({ cert: identity.certificatePem, key: identity.privateKeyPem, minVersion: "TLSv1.2" }, (_request, response) => response.writeHead(404).end());
  const webSockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on("upgrade", (request, socket, head) => {
    upgradeCount += 1;
    webSockets.handleUpgrade(request, socket, head, (ws) => hub.attachUnauthenticated(ws, authenticator, request.socket.remoteAddress));
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    for (const ws of webSockets.clients) ws.terminate();
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    server.closeAllConnections();
    await closed.promise;
    webSockets.close();
  });
  return { identity, url: `wss://127.0.0.1:${address.port}/gateway/device`, counts: () => ({ upgradeCount, proofCount }) };
}

test("a correctly pinned TLS connection receives a challenge and completes a real signed device handshake", { timeout: 10_000 }, async (t) => {
  const home = await fixture(t);
  const { identity } = await createDeviceIdentity();
  let signatures = 0;
  const ready = Promise.withResolvers<void>();
  const client = new GatewayClient({
    url: home.url,
    WebSocketImpl: createPinnedDeviceSocket(home.identity.fingerprint),
    clientInfo: { id: "pin-test", version: "1", platform: "node", mode: "test" },
    device: { identity: { ...identity, sign: async (payload) => { signatures += 1; return identity.sign(payload); } } },
  });
  t.after(() => client.stop());
  client.onReady(() => ready.resolve());
  client.start();
  await ready.promise;
  assert.equal(client.state, "ready");
  assert.equal(client.hello?.auth.deviceId, identity.id);
  assert.equal(signatures, 1);
  assert.deepEqual(home.counts(), { upgradeCount: 1, proofCount: 1 });
  const ping = await client.request("gateway.ping", {});
  assert.equal(typeof ping.bootId, "string");
});

test("wrong pin refuses TLS before any upgrade, device signature, proof, or pairing token is sent", { timeout: 10_000 }, async (t) => {
  const home = await fixture(t);
  const { identity } = await createDeviceIdentity();
  let signatures = 0;
  const failed = Promise.withResolvers<void>();
  const client = new GatewayClient({
    url: home.url,
    WebSocketImpl: createPinnedDeviceSocket(createHash("sha256").update("wrong certificate").digest("hex")),
    clientInfo: { id: "pin-test", version: "1", platform: "node", mode: "test" },
    device: { identity: { ...identity, sign: async (payload) => { signatures += 1; return identity.sign(payload); } }, pairing: { token: "a".repeat(43), deviceName: "must not leak" } },
  });
  t.after(() => client.stop());
  client.onState((state) => {
    if (state === "reconnecting" || state === "failed") {
      client.stop();
      failed.resolve();
    }
  });
  client.start();
  await failed.promise;
  assert.equal(signatures, 0);
  assert.deepEqual(home.counts(), { upgradeCount: 0, proofCount: 0 });
  assert.equal(client.hello, null);
});

test("pins and plaintext URLs fail synchronously and cannot open a connection", () => {
  for (const pin of ["", "a".repeat(63), "A".repeat(64), "aa:".repeat(32), "z".repeat(64)]) {
    assert.throws(() => createPinnedDeviceSocket(pin), /fingerprint/);
  }
  const Socket = createPinnedDeviceSocket("a".repeat(64));
  for (const url of ["ws://127.0.0.1:1/gateway/device", "http://localhost/", "https://localhost/", "wss://user:password@localhost/", "wss://localhost/#fragment"]) {
    assert.throws(() => new Socket(url), /require a wss/);
  }
});

test("even a correct pin refuses an expired peer before WebSocket open", { timeout: 10_000 }, async (t) => {
  const home = await fixture(t);
  const certificate = new X509Certificate(home.identity.certificatePem);
  t.mock.method(Date, "now", () => Date.parse(certificate.validTo) + 1);
  const Socket = createPinnedDeviceSocket(home.identity.fingerprint);
  const socket = new Socket(home.url);
  let opened = false;
  const failed = Promise.withResolvers<unknown>();
  const closed = Promise.withResolvers<void>();
  socket.onopen = () => { opened = true; };
  socket.onerror = failed.resolve;
  socket.onclose = () => closed.resolve();
  const error = await failed.promise;
  await closed.promise;
  assert.ok(error instanceof Error);
  assert.match(error.message, /expired or not yet valid/);
  assert.equal(opened, false);
  assert.deepEqual(home.counts(), { upgradeCount: 0, proofCount: 0 });
});
