import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GatewayClient, type GatewayClientOptions, type GatewaySocketConstructor } from "./gatewayClient";
import { GatewayClosedError, GatewayNotReadyError, GatewayRequestError, GatewayResultError, GatewayTimeoutError } from "./gatewayErrors";
import { FakeWebSocket } from "./fakeWebSocket";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hello(bootId = "boot-1", tickIntervalMs = 15_000) {
  return {
    type: "hello-ok", protocol: 1,
    server: { version: "1", connId: "c1", bootId },
    features: { methods: [], events: [] },
    auth: { role: "operator", scopes: ["read"] },
    policy: { maxPayload: 1_000_000, maxBufferedBytes: 4_000_000, tickIntervalMs, handshakeTimeoutMs: 15_000 },
  };
}

function makeClient(overrides: Partial<GatewayClientOptions> = {}) {
  return new GatewayClient({
    url: "ws://test/gateway",
    clientInfo: { id: "t", version: "1", platform: "node", mode: "test" },
    WebSocketImpl: FakeWebSocket as unknown as GatewaySocketConstructor,
    reconnect: { initialMs: 5, maxMs: 40, multiplier: 2, jitter: 0 },
    ...overrides,
  });
}

/** Opens the latest socket and answers its connect request. */
async function connectOk(client: GatewayClient, bootId = "boot-1", tickIntervalMs = 15_000) {
  const ws = FakeWebSocket.last;
  ws.open();
  const connect = ws.sent[ws.sent.length - 1];
  assert.equal(connect.method, "connect");
  ws.serverSend({ type: "res", id: connect.id, ok: true, payload: hello(bootId, tickIntervalMs) });
  await sleep(0);
  return ws;
}

beforeEach(() => FakeWebSocket.reset());

test("handshake sends the protocol range and becomes ready with hello", async () => {
  const client = makeClient({ scopes: ["read"] });
  const states: string[] = [];
  client.onState((s) => states.push(s));
  client.start();
  const ws = await connectOk(client);
  assert.deepEqual(ws.sent[0].params, { minProtocol: 1, maxProtocol: 1, client: { id: "t", version: "1", platform: "node", mode: "test" }, scopes: ["read"] });
  assert.equal(client.state, "ready");
  assert.equal(client.hello?.server.bootId, "boot-1");
  assert.deepEqual(states, ["connecting", "ready"]);
  client.stop();
  assert.equal(client.state, "stopped");
  assert.equal(ws.closed, true);
});

for (const code of ["PROTOCOL_MISMATCH", "UNAUTHORIZED"] as const) {
  test(`terminal connect error ${code} fails without reconnecting`, async () => {
    const client = makeClient();
    client.start();
    const ws = FakeWebSocket.last;
    ws.open();
    ws.serverSend({ type: "res", id: ws.sent[0].id, ok: false, error: { code, message: "no" } });
    await sleep(40);
    assert.equal(client.state, "failed");
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(ws.closed, true);
  });
}

test("unexpected close reconnects with backoff and onReady fires each time, restarted tracks bootId", async () => {
  const client = makeClient();
  const ready: boolean[] = [];
  client.onReady((info) => ready.push(info.restarted));
  client.start();
  let ws = await connectOk(client, "boot-1");
  ws.serverClose();
  assert.equal(client.state, "reconnecting");
  await sleep(30);
  assert.equal(FakeWebSocket.instances.length, 2);
  ws = await connectOk(client, "boot-1");
  ws.serverClose();
  await sleep(30);
  await connectOk(client, "boot-2");
  assert.deepEqual(ready, [false, false, true]);
  client.stop();
});

test("non-terminal connect failure backs off exponentially and keeps retrying", async () => {
  const delays: number[] = [];
  const client = makeClient({ reconnect: { initialMs: 20, maxMs: 1000, multiplier: 2, jitter: 0 } });
  client.start();
  let last = Date.now();
  for (let i = 0; i < 3; i++) {
    const ws = FakeWebSocket.last;
    ws.open();
    ws.serverSend({ type: "res", id: ws.sent[0].id, ok: false, error: { code: "UNAVAILABLE", message: "busy" } });
    last = Date.now();
    const before = FakeWebSocket.instances.length;
    while (FakeWebSocket.instances.length === before) await sleep(2);
    delays.push(Date.now() - last);
  }
  assert.ok(delays[0] >= 15 && delays[0] < 38, String(delays[0]));
  assert.ok(delays[1] >= 35 && delays[1] < 70, String(delays[1]));
  assert.ok(delays[2] >= 75, String(delays[2]));
  client.stop();
});

test("request resolves and validates the typed result", async () => {
  const client = makeClient();
  client.start();
  const ws = await connectOk(client);
  const pending = client.request("quotes.subscribe", { symbols: ["AAPL"] });
  const req = ws.sent[1];
  assert.equal(req.method, "quotes.subscribe");
  ws.serverSend({ type: "res", id: req.id, ok: true, payload: { subscribed: ["AAPL"], total: 1 } });
  assert.deepEqual(await pending, { subscribed: ["AAPL"], total: 1 });

  const bad = client.request("quotes.unsubscribe", { symbols: ["AAPL"] });
  ws.serverSend({ type: "res", id: ws.sent[2].id, ok: true, payload: { total: "x" } });
  await assert.rejects(bad, GatewayResultError);

  const failing = client.requestRaw("nope");
  ws.serverSend({ type: "res", id: ws.sent[3].id, ok: false, error: { code: "NOT_FOUND", message: "unknown", retryable: false, retryAfterMs: 5 } });
  await assert.rejects(failing, (e: unknown) => e instanceof GatewayRequestError && e.code === "NOT_FOUND" && e.retryAfterMs === 5);
  client.stop();
});

test("request times out and a late response is ignored", async () => {
  const client = makeClient();
  client.start();
  const ws = await connectOk(client);
  const pending = client.requestRaw("slow", undefined, { timeoutMs: 10 });
  await assert.rejects(pending, GatewayTimeoutError);
  ws.serverSend({ type: "res", id: ws.sent[1].id, ok: true, payload: 1 });
  assert.equal(client.state, "ready");
  client.stop();
});

test("request abort rejects with an abort error", async () => {
  const client = makeClient();
  client.start();
  await connectOk(client);
  const controller = new AbortController();
  const pending = client.requestRaw("slow", undefined, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "GatewayAbortError" });
  client.stop();
});

test("in-flight requests are rejected on close and never replayed", async () => {
  const client = makeClient();
  client.start();
  const ws = await connectOk(client);
  const pending = client.requestRaw("work");
  ws.serverClose();
  await assert.rejects(pending, GatewayClosedError);
  await sleep(30);
  const ws2 = await connectOk(client);
  assert.equal(ws2.sent.filter((f) => f.method === "work").length, 0);
  client.stop();
});

test("requests while not ready are rejected unless queueUntilReady, which flushes on ready", async () => {
  const client = makeClient();
  await assert.rejects(client.requestRaw("x"), GatewayNotReadyError);
  client.start();
  await assert.rejects(client.requestRaw("x"), GatewayNotReadyError);
  const queued = client.requestRaw("later", { a: 1 }, { queueUntilReady: true });
  const ws = await connectOk(client);
  const req = ws.sent.find((f) => f.method === "later");
  assert.ok(req);
  assert.deepEqual(req.params, { a: 1 });
  ws.serverSend({ type: "res", id: req.id, ok: true, payload: "done" });
  assert.equal(await queued, "done");
  client.stop();
});

test("queued requests are rejected when the client stops", async () => {
  const client = makeClient();
  client.start();
  const queued = client.requestRaw("later", undefined, { queueUntilReady: true });
  client.stop();
  await assert.rejects(queued, GatewayClosedError);
});

test("events are validated; invalid payloads are dropped and reported", async () => {
  const client = makeClient();
  const issues: string[] = [];
  const ticks: number[] = [];
  client.onProtocolError((i) => issues.push(i.kind));
  client.onEvent("tick", (p) => ticks.push(p.ts));
  client.start();
  const ws = await connectOk(client);
  ws.serverSend({ type: "event", event: "tick", payload: { ts: 5 }, seq: 0 });
  ws.serverSend({ type: "event", event: "tick", payload: { ts: "bad" }, seq: 1 });
  assert.deepEqual(ticks, [5]);
  assert.deepEqual(issues, ["invalid-event"]);
  client.stop();
});

test("event seq gap is reported", async () => {
  const client = makeClient();
  const gaps: unknown[] = [];
  client.onGap((g) => gaps.push(g));
  client.start();
  const ws = await connectOk(client);
  ws.serverSend({ type: "event", event: "tick", payload: { ts: 1 }, seq: 0 });
  ws.serverSend({ type: "event", event: "tick", payload: { ts: 2 }, seq: 1 });
  ws.serverSend({ type: "event", event: "tick", payload: { ts: 3 }, seq: 5 });
  assert.deepEqual(gaps, [{ expected: 2, received: 5 }]);
  client.stop();
});

test("tick watchdog closes a silent socket and reconnects", async () => {
  const client = makeClient();
  client.start();
  const ws = await connectOk(client, "boot-1", 20);
  await sleep(30);
  ws.serverSend({ type: "event", event: "tick", payload: { ts: 1 }, seq: 0 }); // keeps it alive past the first deadline
  await sleep(30);
  assert.equal(client.state, "ready");
  await sleep(60);
  assert.equal(ws.closed, true);
  assert.equal(client.state, "reconnecting");
  client.stop();
});

test("listener disposers are bound to their own registration", async () => {
  const client = makeClient();
  const calls: string[] = [];
  const listener = () => calls.push("hit");
  const disposeFirst = client.onEvent("tick", listener);
  disposeFirst();
  client.onEvent("tick", listener);
  disposeFirst(); // stale disposer must not remove the new registration
  client.start();
  const ws = await connectOk(client);
  ws.serverSend({ type: "event", event: "tick", payload: { ts: 1 }, seq: 0 });
  assert.deepEqual(calls, ["hit"]);
  client.stop();
});
