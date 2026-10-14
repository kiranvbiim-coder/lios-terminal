import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { GATEWAY_PROTOCOL_VERSION, gatewayFrameSchema, gatewayHelloOkSchema } from "@shared/gatewayProtocol";
import type { GatewayFrame, GatewayScope } from "@shared/gatewayProtocol";
import { GatewayHub } from "./gatewayHub";
import type { ConnectDecision, GatewayAuthenticator } from "./gatewayHub";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startHub(options: { granted?: GatewayScope[]; policy?: ConstructorParameters<typeof GatewayHub>[0]["policy"] } = {}) {
  const hub = new GatewayHub({ version: "test", policy: options.policy });
  hub.register("quotes.subscribe", ({ symbols }, connection) => {
    connection.state.set("symbols", new Set(symbols));
    return { subscribed: symbols, total: symbols.length };
  });
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (socket) => hub.attach(socket, { userId: 1, email: "t@example.test", role: "client_user", organizationId: null, grantedScopes: options.granted ?? ["read", "write"] }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    await hub.shutdown("test over");
    wss.clients.forEach((client) => client.terminate());
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return { hub, url };
}

function client(url: string) {
  const socket = new WebSocket(url);
  const frames: GatewayFrame[] = [];
  const waiters: Array<() => void> = [];
  socket.on("message", (data) => {
    frames.push(gatewayFrameSchema.parse(JSON.parse(data.toString())));
    waiters.splice(0).forEach((wake) => wake());
  });
  async function next(predicate: (frame: GatewayFrame) => boolean = () => true): Promise<GatewayFrame> {
    for (;;) {
      const index = frames.findIndex(predicate);
      if (index >= 0) return frames.splice(index, 1)[0]!;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }
  const opened = once(socket, "open");
  cleanups.push(async () => socket.terminate());
  return {
    socket,
    opened,
    next,
    send: (frame: unknown) => socket.send(JSON.stringify(frame)),
    closed: once(socket, "close") as Promise<[number, Buffer]>,
  };
}

const connectParams = (overrides: Record<string, unknown> = {}) => ({
  minProtocol: 1,
  maxProtocol: GATEWAY_PROTOCOL_VERSION,
  client: { id: "test", version: "1", platform: "node", mode: "test" },
  ...overrides,
});

async function connected(url: string, overrides: Record<string, unknown> = {}) {
  const c = client(url);
  await c.opened;
  c.send({ type: "req", id: "c1", method: "connect", params: connectParams(overrides) });
  const res = await c.next();
  return { c, res };
}

describe("Gateway hub", () => {
  it("answers connect with a schema-valid hello-ok listing only reachable methods", async () => {
    const { url, hub } = await startHub();
    const { res } = await connected(url);
    assert.equal(res.type, "res");
    assert.ok(res.type === "res" && res.ok);
    const hello = gatewayHelloOkSchema.parse(res.type === "res" ? res.payload : null);
    assert.equal(hello.protocol, GATEWAY_PROTOCOL_VERSION);
    assert.equal(hello.server.bootId, hub.bootId);
    assert.deepEqual(hello.auth.scopes, ["read", "write"]);
    assert.ok(hello.features.methods.includes("gateway.ping"));
    assert.ok(hello.features.events.includes("quotes.update"));
  });

  it("rejects a first frame that is not connect and closes", async () => {
    const { url } = await startHub();
    const c = client(url);
    await c.opened;
    c.send({ type: "req", id: "1", method: "gateway.ping" });
    const res = await c.next();
    assert.ok(res.type === "res" && !res.ok && res.error?.code === "INVALID_REQUEST");
    const [code] = await c.closed;
    assert.equal(code, 1008);
  });

  it("returns PROTOCOL_MISMATCH when no version overlaps", async () => {
    const { url } = await startHub();
    const { c, res } = await connected(url, { minProtocol: 2, maxProtocol: 3 });
    assert.ok(res.type === "res" && !res.ok && res.error?.code === "PROTOCOL_MISMATCH");
    await c.closed;
  });

  it("lets a client narrow scopes but never widen them", async () => {
    const { url } = await startHub();
    const narrow = await connected(url, { scopes: ["read"] });
    assert.deepEqual(gatewayHelloOkSchema.parse(narrow.res.type === "res" ? narrow.res.payload : null).auth.scopes, ["read"]);
    const wide = await connected(url, { scopes: ["read", "admin"] });
    assert.ok(wide.res.type === "res" && !wide.res.ok && wide.res.error?.code === "FORBIDDEN");
  });

  it("dispatches validated requests, rejects unknown methods and bad params, and survives them", async () => {
    const { url } = await startHub();
    const { c } = await connected(url);
    c.send({ type: "req", id: "p", method: "gateway.ping" });
    const ping = await c.next((f) => f.type === "res" && f.id === "p");
    assert.ok(ping.type === "res" && ping.ok);
    c.send({ type: "req", id: "u", method: "nope.nothing" });
    const unknown = await c.next((f) => f.type === "res" && f.id === "u");
    assert.ok(unknown.type === "res" && unknown.error?.code === "NOT_FOUND");
    c.send({ type: "req", id: "b", method: "quotes.subscribe", params: { symbols: [] } });
    const bad = await c.next((f) => f.type === "res" && f.id === "b");
    assert.ok(bad.type === "res" && bad.error?.code === "INVALID_REQUEST");
    c.send({ type: "req", id: "p2", method: "gateway.ping" });
    assert.ok((await c.next((f) => f.type === "res" && f.id === "p2")).type === "res");
  });

  it("publishes only to selected connections, with a gap-free per-connection seq", async () => {
    const { url, hub } = await startHub();
    const a = (await connected(url)).c;
    const b = (await connected(url)).c;
    for (let i = 0; i < 3; i += 1) {
      hub.publish("quotes.update", () => ({ quotes: [{ symbol: `S${i}` }] }));
    }
    hub.publish("quotes.update", (connection) => (connection.connId === "never" ? { quotes: [] } : null));
    const seqs: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const event = await a.next((f) => f.type === "event");
      seqs.push(event.type === "event" ? (event.seq ?? -1) : -1);
    }
    assert.deepEqual(seqs, [0, 1, 2]);
    await b.next((f) => f.type === "event");
  });

  it("closes a connection that never completes the handshake", async () => {
    const { url } = await startHub({ policy: { handshakeTimeoutMs: 50 } });
    const c = client(url);
    await c.opened;
    const [code] = await c.closed;
    assert.equal(code, 4000);
  });

  it("announces shutdown before closing", async () => {
    const { url, hub } = await startHub();
    const { c } = await connected(url);
    await hub.shutdown("maintenance", 5_000);
    const event = await c.next((f) => f.type === "event");
    assert.ok(event.type === "event" && event.event === "shutdown");
    const [code] = await c.closed;
    assert.equal(code, 1001);
  });

  it("rejects oversize frames and notifies close listeners", async () => {
    const { url, hub } = await startHub({ policy: { maxPayload: 256 } });
    let closed = 0;
    hub.onConnectionClosed(() => { closed += 1; });
    const { c } = await connected(url);
    c.send({ type: "req", id: "big", method: "gateway.ping", params: { pad: "x".repeat(400) } });
    const res = await c.next();
    assert.ok(res.type === "res" && res.error?.code === "PAYLOAD_TOO_LARGE");
    await c.closed;
    // The server observes the close on its own event-loop turn; wait for it instead of racing it.
    for (let i = 0; i < 200 && closed === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(closed, 1);
  });

  describe("device authenticator path", () => {
    async function startDeviceHub(decide: (nonce: string) => Promise<ConnectDecision>, policy?: ConstructorParameters<typeof GatewayHub>[0]["policy"]) {
      const hub = new GatewayHub({ version: "test", policy });
      const seen: Array<{ nonce: string; remoteAddress: string | undefined }> = [];
      const authenticator: GatewayAuthenticator = {
        authenticate: async ({ nonce, remoteAddress }) => {
          seen.push({ nonce, remoteAddress });
          return decide(nonce);
        },
      };
      const http = createServer();
      const wss = new WebSocketServer({ server: http });
      wss.on("connection", (socket, request) => hub.attachUnauthenticated(socket, authenticator, request.socket.remoteAddress));
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
      cleanups.push(async () => {
        await hub.shutdown("test over");
        wss.clients.forEach((client) => client.terminate());
        await new Promise<void>((resolve) => http.close(() => resolve()));
      });
      return { hub, url, seen };
    }

    it("sends a challenge first, passes its nonce to the authenticator, and accepts with the decided identity", async () => {
      const { url, seen } = await startDeviceHub(async () => ({
        kind: "accept",
        identity: { userId: 7, email: "d@example.test", role: "client_user", organizationId: null, grantedScopes: ["read", "write"], deviceId: "d".repeat(32) },
      }));
      const c = client(url);
      await c.opened;
      const challenge = await c.next();
      assert.ok(challenge.type === "event" && challenge.event === "connect.challenge");
      const nonce = (challenge.type === "event" ? challenge.payload : null) as { nonce: string };
      assert.ok(nonce.nonce.length >= 16);
      c.send({ type: "req", id: "c1", method: "connect", params: connectParams() });
      const res = await c.next();
      const hello = gatewayHelloOkSchema.parse(res.type === "res" ? res.payload : null);
      assert.equal(hello.auth.deviceId, "d".repeat(32));
      assert.deepEqual(hello.auth.scopes, ["read", "write"]);
      assert.equal(seen[0]?.nonce, nonce.nonce);
      assert.equal(seen[0]?.remoteAddress, "127.0.0.1");
    });

    it("answers a pairing request with pairing-pending, reports the outcome as an event, and closes", async () => {
      let settle!: (outcome: "approved" | "denied" | "expired") => void;
      const resolution = new Promise<"approved" | "denied" | "expired">((resolve) => { settle = resolve; });
      const { url } = await startDeviceHub(async () => ({ kind: "pending", pending: { type: "pairing-pending", pairingId: "11111111-1111-4111-8111-111111111111", expiresAt: "2026-10-03T00:05:00.000Z" }, resolution }));
      const c = client(url);
      await c.opened;
      await c.next();
      c.send({ type: "req", id: "c1", method: "connect", params: connectParams() });
      const res = await c.next();
      assert.ok(res.type === "res" && res.ok && (res.payload as { type: string }).type === "pairing-pending");
      // Nothing but the outcome may happen on this socket: it is not authenticated.
      c.send({ type: "req", id: "p", method: "gateway.ping" });
      const [code] = await c.closed;
      assert.equal(code, 1008);
      settle("approved");
    });

    it("delivers pairing.resolved and closes normally when the owner decides", async () => {
      const { promise, resolve } = Promise.withResolvers<"approved" | "denied" | "expired">();
      const { url } = await startDeviceHub(async () => ({ kind: "pending", pending: { type: "pairing-pending", pairingId: "22222222-2222-4222-8222-222222222222", expiresAt: "2026-10-03T00:05:00.000Z" }, resolution: promise }), { handshakeTimeoutMs: 40 });
      const c = client(url);
      await c.opened;
      await c.next();
      c.send({ type: "req", id: "c1", method: "connect", params: connectParams() });
      await c.next();
      // Longer than the handshake deadline: a pending pairing must not be cut off by it.
      await new Promise((r) => setTimeout(r, 120));
      resolve("denied");
      const event = await c.next((frame) => frame.type === "event");
      assert.ok(event.type === "event" && event.event === "pairing.resolved" && (event.payload as { outcome: string }).outcome === "denied");
      const [code] = await c.closed;
      assert.equal(code, 1000);
    });

    it("closes on reject, rejects a client that is not allowed to widen scopes, and revocation disconnects a ready device", async () => {
      const rejecting = await startDeviceHub(async () => ({ kind: "reject", error: { code: "UNAUTHORIZED", message: "no" } }));
      const a = client(rejecting.url);
      await a.opened;
      await a.next();
      a.send({ type: "req", id: "c1", method: "connect", params: connectParams() });
      const res = await a.next();
      assert.ok(res.type === "res" && !res.ok && res.error?.code === "UNAUTHORIZED");
      await a.closed;

      const accepting = await startDeviceHub(async () => ({ kind: "accept", identity: { userId: 1, email: "d@example.test", role: "client_user", organizationId: null, grantedScopes: ["read", "write"], deviceId: "e".repeat(32) } }));
      const wide = client(accepting.url);
      await wide.opened;
      await wide.next();
      wide.send({ type: "req", id: "c1", method: "connect", params: connectParams({ scopes: ["read", "admin"] }) });
      const denied = await wide.next();
      assert.ok(denied.type === "res" && !denied.ok && denied.error?.code === "FORBIDDEN");

      const ready = client(accepting.url);
      await ready.opened;
      await ready.next();
      ready.send({ type: "req", id: "c1", method: "connect", params: connectParams() });
      assert.ok((await ready.next()).type === "res");
      accepting.hub.disconnectDevice("e".repeat(32));
      const [code] = await ready.closed;
      assert.equal(code, 4001);
    });
  });
});
