import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { buildDeviceProofPayload, fromBase64Url } from "@shared/devicePairing";
import { GatewayClient, type GatewayClientOptions, type GatewaySocketConstructor, type GatewayState } from "./gatewayClient";
import { createDeviceIdentity, restoreDeviceIdentity } from "./deviceIdentity";
import { FakeWebSocket } from "./fakeWebSocket";

/** Resolves when the client reaches `target` (immediately if it already has), so tests wait for the real change, not a guessed delay. */
function untilState(client: GatewayClient, target: GatewayState): Promise<void> {
  if (client.state === target) return Promise.resolve();
  const reached = Promise.withResolvers<void>();
  const off = client.onState((state) => {
    if (state === target) {
      off();
      reached.resolve();
    }
  });
  return reached.promise;
}
const NONCE = "n".repeat(24);
const INFO = { id: "t", version: "1", platform: "node", mode: "test" };
const PAIRING_ID = "11111111-1111-4111-8111-111111111111";

function hello(deviceId?: string) {
  return {
    type: "hello-ok", protocol: 1,
    server: { version: "1", connId: "c1", bootId: "b1" },
    features: { methods: [], events: [] },
    auth: { role: "operator", scopes: ["read"], ...(deviceId ? { deviceId } : {}) },
    policy: { maxPayload: 1_000_000, maxBufferedBytes: 4_000_000, tickIntervalMs: 15_000, handshakeTimeoutMs: 15_000 },
  };
}

async function deviceClient(
  overrides: Partial<GatewayClientOptions> = {},
  pairing?: { token: string; deviceName: string },
  surface: { capabilities?: string[]; commands?: string[] } = {},
) {
  const { identity } = await createDeviceIdentity();
  const client = new GatewayClient({
    url: "ws://test/gateway/device",
    clientInfo: INFO,
    scopes: ["write", "read"],
    WebSocketImpl: FakeWebSocket as unknown as GatewaySocketConstructor,
    reconnect: { initialMs: 5, maxMs: 40, multiplier: 2, jitter: 0 },
    device: { identity, pairing, ...surface },
    ...overrides,
  });
  return { client, identity };
}

async function challenge(ws: FakeWebSocket) {
  ws.open();
  assert.equal(ws.sent.length, 0, "connect must wait for the challenge");
  ws.serverSend({ type: "event", event: "connect.challenge", payload: { nonce: NONCE } });
  const connect = await ws.frame(0);
  assert.equal(connect.method, "connect");
  return connect;
}

async function verify(publicKey: string, signature: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", fromBase64Url(publicKey) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, fromBase64Url(signature) as BufferSource, new TextEncoder().encode(payload));
}

beforeEach(() => FakeWebSocket.reset());

test("paired device signs the challenge, including its canonical advertised surface", async () => {
  const { client, identity } = await deviceClient({}, undefined, {
    capabilities: ["screen", "camera", "camera"],
    commands: ["screen.capture", "camera.snap"],
  });
  client.start();
  const ws = FakeWebSocket.last;
  const connect = await challenge(ws);
  const device = connect.params.device;
  assert.equal(device.id, identity.id);
  assert.equal(device.publicKey, identity.publicKey);
  assert.equal(connect.params.pairing, undefined);
  assert.deepEqual(device.capabilities, ["camera", "screen"]);
  assert.deepEqual(device.commands, ["camera.snap", "screen.capture"]);
  const payload = buildDeviceProofPayload({
    deviceId: identity.id, clientId: "t", clientMode: "test", scopes: ["read", "write"],
    signedAt: device.signedAt, nonce: NONCE, pairingToken: "",
    capabilities: device.capabilities, commands: device.commands,
  });
  assert.equal(await verify(identity.publicKey, device.signature, payload), true);
  ws.serverSend({ type: "res", id: connect.id, ok: true, payload: hello(identity.id) });
  await untilState(client, "ready");
  assert.equal(client.state, "ready");
  assert.equal(client.hello?.auth.deviceId, identity.id);
  client.stop();
});

test("pairing request binds the token and resolves approved without reconnecting", async () => {
  const token = "T".repeat(40);
  const { client, identity } = await deviceClient({}, { token, deviceName: "Phone" });
  const states: GatewayState[] = [];
  client.onState((s) => states.push(s));
  const pendings: string[] = [];
  const outcomes: string[] = [];
  client.onPairing((p) => pendings.push(p.pairingId));
  client.onPairingResolved((o) => outcomes.push(o));
  client.start();
  const ws = FakeWebSocket.last;
  const connect = await challenge(ws);
  assert.deepEqual(connect.params.pairing, { token, deviceName: "Phone" });
  const payload = buildDeviceProofPayload({ deviceId: identity.id, clientId: "t", clientMode: "test", scopes: ["read", "write"], signedAt: connect.params.device.signedAt, nonce: NONCE, pairingToken: token });
  assert.equal(await verify(identity.publicKey, connect.params.device.signature, payload), true);
  // A proof without the token must not verify against the pairing payload.
  const unbound = buildDeviceProofPayload({ deviceId: identity.id, clientId: "t", clientMode: "test", scopes: ["read", "write"], signedAt: connect.params.device.signedAt, nonce: NONCE, pairingToken: "" });
  assert.equal(await verify(identity.publicKey, connect.params.device.signature, unbound), false);
  ws.serverSend({ type: "res", id: connect.id, ok: true, payload: { type: "pairing-pending", pairingId: PAIRING_ID, expiresAt: "2026-01-01T00:05:00.000Z" } });
  await untilState(client, "pairing");
  assert.equal(client.state, "pairing");
  assert.deepEqual(pendings, [PAIRING_ID]);
  ws.serverSend({ type: "event", event: "pairing.resolved", payload: { outcome: "approved" } });
  ws.serverClose();
  await untilState(client, "stopped");
  assert.deepEqual(outcomes, ["approved"]);
  assert.equal(client.state, "stopped");
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.deepEqual(states, ["connecting", "pairing", "stopped"]);
});

for (const outcome of ["denied", "expired"] as const) {
  test(`pairing ${outcome} stops the client`, async () => {
    const { client } = await deviceClient({}, { token: "T".repeat(40), deviceName: "Phone" });
    const outcomes: string[] = [];
    client.onPairingResolved((o) => outcomes.push(o));
    client.start();
    const ws = FakeWebSocket.last;
    const connect = await challenge(ws);
    ws.serverSend({ type: "res", id: connect.id, ok: true, payload: { type: "pairing-pending", pairingId: PAIRING_ID, expiresAt: "2026-01-01T00:05:00.000Z" } });
    await untilState(client, "pairing");
    ws.serverSend({ type: "event", event: "pairing.resolved", payload: { outcome } });
    await untilState(client, "stopped");
    assert.deepEqual(outcomes, [outcome]);
    assert.equal(client.state, "stopped");
    assert.equal(FakeWebSocket.instances.length, 1);
  });
}

test("missing challenge fails like a handshake timeout (reconnecting)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { client } = await deviceClient();
    client.start();
    const ws = FakeWebSocket.last;
    ws.open();
    mock.timers.tick(15_000);
    assert.equal(ws.closed, true);
    assert.equal(client.state, "reconnecting");
    assert.equal(ws.sent.length, 0);
    client.stop();
  } finally {
    mock.timers.reset();
  }
});

test("UNAUTHORIZED reject is terminal for a device", async () => {
  const { client } = await deviceClient();
  client.start();
  const ws = FakeWebSocket.last;
  const connect = await challenge(ws);
  ws.serverSend({ type: "res", id: connect.id, ok: false, error: { code: "UNAUTHORIZED", message: "no" } });
  await untilState(client, "failed");
  assert.equal(client.state, "failed");
  assert.equal(FakeWebSocket.instances.length, 1);
});

test("session flow without device still sends connect on open", () => {
  const client = new GatewayClient({ url: "ws://test/gateway", clientInfo: INFO, WebSocketImpl: FakeWebSocket as unknown as GatewaySocketConstructor });
  client.start();
  FakeWebSocket.last.open();
  assert.equal(FakeWebSocket.last.sent[0].method, "connect");
  assert.equal(FakeWebSocket.last.sent[0].params.device, undefined);
  client.stop();
});

test("restored identity keeps id and produces verifiable signatures", async () => {
  const { identity, exportKeys } = await createDeviceIdentity();
  const restored = await restoreDeviceIdentity(await exportKeys());
  assert.equal(restored.id, identity.id);
  assert.equal(await verify(restored.publicKey, await restored.sign("x"), "x"), true);
});
