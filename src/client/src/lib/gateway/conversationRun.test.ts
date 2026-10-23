import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GatewayClient, type GatewaySocketConstructor } from "./gatewayClient";
import { FakeWebSocket } from "./fakeWebSocket";
import { runConversation, attachConversationRun, cancelConversationRun, resumeConversationRun } from "./conversationRun";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

const ID = "44444444-4444-4444-8444-444444444444";
const at = "2026-10-03T00:00:00.000Z";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const status = (message: string): ConversationRuntimeEvent => ({ type: "status", requestId: ID, at, stepId: null, message, state: "running" });
const text = (value: string): ConversationRuntimeEvent => ({ type: "text", requestId: ID, at, text: value, label: "deterministic" });
const done = (): ConversationRuntimeEvent => ({ type: "done", requestId: ID, at, status: "completed" });

function hello(bootId: string) {
  return {
    type: "hello-ok", protocol: 1,
    server: { version: "1", connId: "c", bootId },
    features: { methods: [], events: [] },
    auth: { role: "operator", scopes: ["read", "write"] },
    policy: { maxPayload: 1_000_000, maxBufferedBytes: 4_000_000, tickIntervalMs: 15_000, handshakeTimeoutMs: 15_000 },
  };
}

async function readyClient(bootId = "boot-1") {
  const client = new GatewayClient({
    url: "ws://test/gateway",
    clientInfo: { id: "t", version: "1", platform: "node", mode: "test" },
    WebSocketImpl: FakeWebSocket as unknown as GatewaySocketConstructor,
    reconnect: { initialMs: 5, maxMs: 20, multiplier: 2, jitter: 0 },
  });
  client.start();
  await accept(bootId);
  return client;
}
async function accept(bootId: string) {
  const ws = FakeWebSocket.last;
  ws.open();
  const connect = ws.sent[ws.sent.length - 1];
  ws.serverSend({ type: "res", id: connect.id, ok: true, payload: hello(bootId) });
  await sleep(0);
  return ws;
}
const lastRequest = (ws: FakeWebSocket, method: string) => [...ws.sent].reverse().find((frame) => frame.method === method);
const emit = (ws: FakeWebSocket, runSeq: number, event: ConversationRuntimeEvent) =>
  ws.serverSend({ type: "event", event: "conversation.event", payload: { requestId: ID, runSeq, event } });

beforeEach(() => FakeWebSocket.reset());

test("start, stream and finish: events are delivered once, in order, with the final text", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  const seen: string[] = [];
  const pending = runConversation(client, { chatId: 9, body: { requestId: ID, message: "hi" }, onEvent: (e) => seen.push(e.type) });
  await sleep(0);
  const start = lastRequest(ws, "conversation.start");
  assert.deepEqual(start.params, { chatId: 9, body: { requestId: ID, message: "hi" } });
  emit(ws, 0, status("a"));
  ws.serverSend({ type: "res", id: start.id, ok: true, payload: { requestId: ID } });
  emit(ws, 0, status("a")); // duplicate
  emit(ws, 1, text("answer"));
  emit(ws, 2, done());
  const result = await pending;
  assert.deepEqual(seen, ["status", "text", "done"]);
  assert.equal(result.ok, true);
  assert.equal(result.text, "answer");
  client.stop();
});

test("waiting_approval keeps the same Gateway observer alive until the resumed run truly finishes", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  const seen: ConversationRuntimeEvent[] = [];
  let settled = false;
  const pending = runConversation(client, {
    chatId: 9,
    body: { requestId: ID, message: "run governed tool", agent: true },
    onEvent: (event) => seen.push(event),
  });
  void pending.then(() => { settled = true; });

  await sleep(0);
  const start = lastRequest(ws, "conversation.start");
  ws.serverSend({ type: "res", id: start.id, ok: true, payload: { requestId: ID } });

  emit(ws, 0, { type: "done", requestId: ID, at, status: "waiting_approval" });
  await sleep(0);
  assert.equal(settled, false, "approval pause is non-terminal for the same requestId");
  assert.equal(seen.at(-1)?.type, "done");
  assert.equal(seen.at(-1)?.type === "done" ? seen.at(-1)!.status : null, "waiting_approval");

  emit(ws, 1, status("continued after first review"));
  emit(ws, 2, { type: "done", requestId: ID, at, status: "waiting_approval" });
  await sleep(0);
  assert.equal(settled, false, "a repeated approval pause retains the original observer");
  assert.equal(ws.sent.filter((frame) => frame.method === "conversation.start").length, 1);
  emit(ws, 3, text("approved result"));
  emit(ws, 4, done());
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.text, "approved result");
  assert.deepEqual(
    seen.filter((event) => event.type === "done").map((event) => event.type === "done" ? event.status : ""),
    ["waiting_approval", "waiting_approval", "completed"],
  );
  client.stop();
});

test("a legacy non-agent approval ends its follow attempt for explicit continuation", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  const pending = runConversation(client, { chatId: 9, body: { requestId: ID, message: "review an action" }, onEvent: () => {} });
  await sleep(0);
  const start = lastRequest(ws, "conversation.start");
  ws.serverSend({ type: "res", id: start.id, ok: true, payload: { requestId: ID } });
  emit(ws, 0, { type: "done", requestId: ID, at, status: "waiting_approval" });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.events.at(-1)?.type, "done");
  assert.equal(ws.sent.filter((frame) => frame.method === "conversation.start").length, 1);
  client.stop();
});

test("reattaching to an agent plan preserves a pause published before its review card", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  let settled = false;
  const pending = attachConversationRun(client, ID, () => {});
  void pending.then(() => { settled = true; });
  await sleep(0);
  const subscribe = lastRequest(ws, "conversation.subscribe");
  ws.serverSend({ type: "res", id: subscribe.id, ok: true, payload: { requestId: ID } });
  emit(ws, 0, {
    type: "plan", requestId: ID, at,
    plan: {
      schemaVersion: "1", requestId: ID,
      intent: { action: "research", confidence: 1, entityRefs: [], parameters: {}, requiresAI: true, requiresDeterministicCompute: false },
      capabilities: [],
      steps: [{ id: "step-1", kind: "agent", label: "Inspect", componentId: null, permissionClass: "safe_auto", dependsOn: [] }],
      budget: { maxSteps: 12, maxDurationMs: 90_000, maxAiCalls: 2 },
    },
  });
  emit(ws, 1, { type: "done", requestId: ID, at, status: "waiting_approval" });
  await sleep(0);
  assert.equal(settled, false);
  emit(ws, 2, status("owner review continued this run"));
  emit(ws, 3, done());
  assert.equal((await pending).ok, true);
  assert.equal(ws.sent.filter((frame) => frame.method === "conversation.start").length, 0);
  client.stop();
});

test("a rejected start returns the original status and message (428 voice review, 413, ...)", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  const pending = runConversation(client, { chatId: null, body: { requestId: ID }, onEvent: () => {} });
  await sleep(0);
  const start = lastRequest(ws, "conversation.start");
  ws.serverSend({ type: "res", id: start.id, ok: false, error: { code: "INVALID_REQUEST", message: "x", details: { status: 428, error: "Review the transcript.", code: "voice_transcript_review_required" } } });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.status, 428);
  assert.equal(result.error, "Review the transcript.");
  assert.equal(result.errorCode, "voice_transcript_review_required");
  client.stop();
});

test("invalid context and clarification retain their typed start errors without producing a run", async () => {
  for (const [statusCode, errorCode, message] of [
    [400, "working_context_invalid", "Discard unsafe context."],
    [409, "working_context_clarification_required", "Which company: $MSFT or $NVDA?"],
  ] as const) {
    const client = await readyClient();
    const ws = FakeWebSocket.last;
    const seen: ConversationRuntimeEvent[] = [];
    const pending = runConversation(client, { chatId: null, body: { requestId: ID }, onEvent: (event) => seen.push(event) });
    await sleep(0);
    const start = lastRequest(ws, "conversation.start");
    ws.serverSend({ type: "res", id: start.id, ok: false, error: { code: "INVALID_REQUEST", message, details: { status: statusCode, error: message, code: errorCode } } });
    const result = await pending;
    assert.equal(result.errorCode, errorCode);
    assert.equal(result.status, statusCode);
    assert.equal(result.error, message);
    assert.equal(result.ok, false);
    assert.deepEqual(seen, []);
    client.stop();
  }
});

test("explicit done null reaches the consumer to clear stale Temporary context", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  let context: unknown = { stale: true };
  const pending = runConversation(client, {
    chatId: null,
    body: { requestId: ID },
    onEvent: (event) => { if (event.type === "done" && event.workingContext !== undefined) context = event.workingContext; },
  });
  await sleep(0);
  ws.serverSend({ type: "res", id: lastRequest(ws, "conversation.start").id, ok: true, payload: { requestId: ID } });
  emit(ws, 0, { type: "done", requestId: ID, at, status: "completed", workingContext: null });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(context, null);
  client.stop();
});

test("after a reconnect to the same Home the run is re-subscribed from the last seen sequence", async () => {
  const client = await readyClient();
  const first = FakeWebSocket.last;
  const seen: number[] = [];
  const pending = runConversation(client, { chatId: 9, body: { requestId: ID }, onEvent: (e) => seen.push(e.type === "text" ? 1 : 0) });
  await sleep(0);
  first.serverSend({ type: "res", id: lastRequest(first, "conversation.start").id, ok: true, payload: { requestId: ID } });
  await sleep(0);
  emit(first, 0, status("a"));
  emit(first, 1, status("b"));
  first.serverClose();
  await sleep(15);
  const second = await accept("boot-1");
  const subscribe = lastRequest(second, "conversation.subscribe");
  assert.deepEqual(subscribe.params, { requestId: ID, afterSeq: 1 });
  second.serverSend({ type: "res", id: subscribe.id, ok: true, payload: { status: "running", lastSeq: 3 } });
  emit(second, 2, text("final"));
  emit(second, 3, done());
  const result = await pending;
  assert.equal(result.text, "final");
  assert.equal(result.ok, true);
  client.stop();
});

test("a restarted Home ends the run with a clear message instead of hanging", async () => {
  const client = await readyClient("boot-1");
  const first = FakeWebSocket.last;
  const pending = runConversation(client, { chatId: 9, body: { requestId: ID }, onEvent: () => {} });
  await sleep(0);
  first.serverSend({ type: "res", id: lastRequest(first, "conversation.start").id, ok: true, payload: { requestId: ID } });
  await sleep(0);
  first.serverClose();
  await sleep(15);
  await accept("boot-2");
  const result = await pending;
  assert.match(result.error ?? "", /Home restarted/);
  assert.equal(result.ok, false, "Home restart must not become successful completion");
  assert.equal(result.status, 503);
  assert.equal(result.errorCode, "run_interrupted");
  assert.ok(!result.events.some(e => e.type === "done"), "never fabricate a terminal Home event");
  client.stop();
});

test("a connection that drops while starting is reconciled: a run that never started is reported, not duplicated", async () => {
  const client = await readyClient();
  const first = FakeWebSocket.last;
  const pending = runConversation(client, { chatId: 9, body: { requestId: ID }, onEvent: () => {} });
  await sleep(0);
  first.serverClose();
  await sleep(15);
  const second = await accept("boot-1");
  await sleep(0);
  const subscribe = lastRequest(second, "conversation.subscribe");
  second.serverSend({ type: "res", id: subscribe.id, ok: false, error: { code: "NOT_FOUND", message: "no run" } });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  client.stop();
});

test("attach replays an already running run, and cancel goes through the Gateway", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  const pending = attachConversationRun(client, ID, () => {});
  await sleep(0);
  const subscribe = lastRequest(ws, "conversation.subscribe");
  assert.deepEqual(subscribe.params, { requestId: ID, afterSeq: -1 });
  emit(ws, 0, text("so far"));
  ws.serverSend({ type: "res", id: subscribe.id, ok: true, payload: { status: "running", lastSeq: 0 } });
  const cancelPromise = cancelConversationRun(client, ID);
  await sleep(0);
  const cancel = lastRequest(ws, "conversation.cancel");
  ws.serverSend({ type: "res", id: cancel.id, ok: true, payload: { cancelled: true } });
  assert.equal(await cancelPromise, true);
  emit(ws, 1, { type: "done", requestId: ID, at, status: "cancelled" });
  const result = await pending;
  assert.equal(result.text, "so far");
  client.stop();
});

test("explicit resume sends ONLY the requestId, follows the SAME run from its first event and finishes on done", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  const seen: string[] = [];
  const pending = resumeConversationRun(client, ID, (event) => seen.push(event.type));
  await sleep(0);
  const resume = lastRequest(ws, "conversation.resume");
  assert.deepEqual(resume.params, { requestId: ID }, "no objective, adapter, checkpoint, hash, context or authorization field");
  emit(ws, 0, status("resumed"));
  ws.serverSend({ type: "res", id: resume.id, ok: true, payload: { requestId: ID } });
  emit(ws, 1, text("continued"));
  emit(ws, 2, done());
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.text, "continued");
  assert.deepEqual(seen, ["status", "text", "done"]);
  client.stop();
});

test("a refused resume surfaces the server's typed status and code and nothing is followed", async () => {
  const client = await readyClient();
  const ws = FakeWebSocket.last;
  const pending = resumeConversationRun(client, ID, () => {});
  await sleep(0);
  const resume = lastRequest(ws, "conversation.resume");
  ws.serverSend({ type: "res", id: resume.id, ok: false, error: { code: "INVALID_REQUEST", message: "changed", details: { status: 409, code: "agent_resume_drift", error: "The tools changed." } } });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.errorCode, "agent_resume_drift");
  client.stop();
});

test("WS-22 failed re-subscription after a started run is interrupted, not completed or automatically replayed", async () => {
  const client = await readyClient();
  const first = FakeWebSocket.last;
  const seen: ConversationRuntimeEvent[] = [];
  const pending = runConversation(client,{ chatId:9,body:{requestId:ID,message:"do not replay"},onEvent:e=>seen.push(e)});
  await sleep(0);
  first.serverSend({type:"res",id:lastRequest(first,"conversation.start").id,ok:true,payload:{requestId:ID}});
  emit(first,0,status("running"));
  first.serverClose();
  await sleep(15);
  const second = await accept("boot-1");
  const subscribe = lastRequest(second,"conversation.subscribe");
  second.serverSend({type:"res",id:subscribe.id,ok:false,error:{code:"NOT_FOUND",message:"unknown run"}});
  const result = await pending;
  assert.equal(result.ok,false);
  assert.equal(result.status,503);
  assert.equal(result.errorCode,"run_interrupted");
  assert.equal(result.events.length,1);
  assert.deepEqual(seen.map(e=>e.type),["status"]);
  assert.equal(first.sent.filter(f=>f.method==="conversation.start").length,1);
  assert.equal(second.sent.filter(f=>f.method==="conversation.start").length,0);
  client.stop();
});
