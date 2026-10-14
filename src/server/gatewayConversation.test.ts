import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { GATEWAY_METHODS, GATEWAY_PROTOCOL_VERSION, gatewayFrameSchema } from "@shared/gatewayProtocol";
import type { GatewayFrame } from "@shared/gatewayProtocol";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { GatewayHub } from "./gatewayHub";
import { registerGatewayConversation } from "./gatewayConversation";
import { ConversationRunRegistry } from "./conversationRunRegistry";
import { ConversationStartError } from "./conversationRunService";
import type { ExecutionJournalRecord } from "./exec/execution-journal";

const ID = "33333333-3333-4333-8333-333333333333";
const HISTORY_ID = "44444444-4444-4444-8444-444444444444";
const at = "2026-10-03T00:00:00.000Z";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function setup() {
  const hub = new GatewayHub({ version: "t" });
  const runs = new ConversationRunRegistry();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const cancelled: string[] = [];
  const resumed: Array<{ userId: number; requestId: string }> = [];
  const terminalInputs: Array<{ requestId: string; userId: number; projectId: number | null; chatId: number | null; input: string }> = [];
  const persisted: ExecutionJournalRecord[] = [{
    version: 1 as const,
    id: HISTORY_ID,
    owner: { userId: 1, projectId: 77, chatId: 5 },
    label: "Conversation execution",
    status: "interrupted" as const,
    startedAt: "2026-10-03T00:00:00.000Z",
    endedAt: "2026-10-03T00:01:00.000Z",
    stdout: "retained transcript",
    stderr: "",
    exitCode: null,
    trust: {
      version: 1 as const,
      requestId: HISTORY_ID,
      operationDigest: "a".repeat(64),
      approvalDigest: "c".repeat(64),
      permissionClass: "user_confirm" as const,
      policyRevision: "b".repeat(64),
      decision: "approved" as const,
      denialReason: null,
      backendId: "lios.execution.local",
      deviceId: null,
      backendGenerationId: null,
      runtimeReceiptId: null,
    },
  }];
  persisted.push({
    ...persisted[0],
    id: "55555555-5555-4555-8555-555555555555",
    status: "denied" as const,
    label: "Denied operation",
    stdout: "",
    trust: {
      ...persisted[0].trust,
      requestId: "55555555-5555-4555-8555-555555555555",
      decision: "denied" as const,
      denialReason: "approval-mismatch" as const,
      backendId: null,
      approvalDigest: null,
    },
  });
  registerGatewayConversation(hub, {
    startProject: async (user, chatId, body) => {
      if ((body as { reject?: number })?.reject) throw new ConversationStartError((body as { reject: number }).reject, { error: "nope", code: "x" });
      const started = runs.start({
        requestId: ID,
        userId: user.id,
        projectId: chatId === null ? null : 77,
        chatId,
      }, async (emit) => {
        emit({ type: "status", requestId: ID, at, stepId: null, message: "working", state: "running" });
        await gate;
        emit({ type: "text", requestId: ID, at, text: "answer", label: "deterministic" });
        emit({ type: "done", requestId: ID, at, status: "completed" });
      });
      runs.setInputHandlerScoped(ID, { userId: user.id, projectId: 77, chatId }, async (input) => {
        terminalInputs.push({ requestId: ID, userId: user.id, projectId: 77, chatId, input });
      });
      return started;
    },
    startTemporary: async () => { throw new ConversationStartError(428, { error: "review", code: "voice_transcript_review_required" }); },
    resume: async (user, requestId) => {
      if (requestId === "66666666-6666-4666-8666-666666666666") throw new ConversationStartError(409, { code: "agent_resume_drift", error: "changed" });
      if (requestId === "77777777-7777-4777-8777-777777777777") throw new ConversationStartError(404, { code: "interrupted_run_not_found", error: "missing" });
      resumed.push({ userId: user.id, requestId });
      return runs.start({ requestId, userId: user.id, projectId: 77, chatId: 5 }, async (emit) => {
        emit({ type: "status", requestId, at, stepId: null, message: "resumed", state: "running" });
        emit({ type: "done", requestId, at, status: "completed" });
      });
    },
    cancel: (requestId, userId) => { cancelled.push(`${requestId}:${userId}`); return true; },
    runs,
    journal: async () => ({
      read: async (sessionId, owner) => persisted.find((record) =>
        record.id === sessionId
        && record.owner.userId === owner.userId
        && record.owner.projectId === owner.projectId
        && record.owner.chatId === owner.chatId
      ) ?? null,
      list: async (owner) => persisted.filter((record) =>
        record.owner.userId === owner.userId
        && record.owner.projectId === owner.projectId
        && record.owner.chatId === owner.chatId
      ),
    }),
  });
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  const users = [1, 2];
  let next = 0;
  wss.on("connection", (socket) => hub.attach(socket, { userId: users[next++ % 2 === 0 ? 0 : 1]!, email: "a@example.test", role: "client_user", organizationId: null, grantedScopes: ["read", "write"] }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}`;
  cleanups.push(async () => { await hub.shutdown("done"); wss.clients.forEach((c) => c.terminate()); await new Promise<void>((r) => http.close(() => r())); });
  return { url, release, cancelled, resumed, runs, terminalInputs };
}

async function open(url: string) {
  const socket = new WebSocket(url);
  const frames: GatewayFrame[] = [];
  socket.on("message", (d) => frames.push(gatewayFrameSchema.parse(JSON.parse(d.toString()))));
  await once(socket, "open");
  cleanups.push(async () => { socket.terminate(); });
  const call = async (id: string, method: string, params?: unknown) => {
    socket.send(JSON.stringify({ type: "req", id, method, params }));
    for (let i = 0; i < 200; i += 1) {
      const found = frames.find((f) => f.type === "res" && f.id === id);
      if (found && found.type === "res") return found;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("timeout " + method);
  };
  await call("c", "connect", { minProtocol: 1, maxProtocol: GATEWAY_PROTOCOL_VERSION, client: { id: "t", version: "1", platform: "node", mode: "test" } });
  const events = () => frames.flatMap((f) => (f.type === "event" && f.event === "conversation.event"
    ? [f.payload as { runSeq: number; event: ConversationRuntimeEvent }]
    : []));
  const sessionEvents = () => frames.flatMap((f) => (f.type === "event" && f.event === "execution.session.event"
    ? [f.payload as {
        sessionId: string;
        projectId: number | null;
        chatId: number | null;
        runSeq: number;
        event: ConversationRuntimeEvent;
      }]
    : []));
  return { call, events, sessionEvents, socket };
}
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), "condition not met in time");
}

describe("Gateway conversation methods", () => {
  it("streams a started run live to the connection that started it and lists it as active", async () => {
    const { url, release } = await setup();
    const c = await open(url);
    assert.ok((await c.call("1", "conversation.start", { chatId: 5, body: {} })).ok);
    await waitFor(() => c.events().length === 1);
    assert.deepEqual(c.events().map((e) => e.event.type), ["status"]);
    const active = await c.call("2", "conversation.active");
    assert.deepEqual((active.payload as { runs: Array<{ requestId: string; chatId: number }> }).runs.map((r) => [r.requestId, r.chatId]), [[ID, 5]]);
    release();
    await waitFor(() => c.events().length === 3);
    assert.deepEqual(c.events().map((e) => [e.runSeq, e.event.type]), [[0, "status"], [1, "text"], [2, "done"]]);
    assert.deepEqual((await c.call("3", "conversation.active")).payload, { runs: [] });
  });

  it("lets chat and Terminal observe one scoped execution session without duplicate execution", async () => {
    const { url, release } = await setup();
    const c = await open(url);
    assert.ok((await c.call("1", "conversation.start", { chatId: 5, body: {} })).ok);
    await waitFor(() => c.events().length === 1);

    const attached = await c.call("2", "execution.session.attach", {
      sessionId: ID,
      projectId: 77,
      chatId: 5,
      afterSeq: -1,
    });
    assert.ok(attached.ok);
    assert.deepEqual(attached.payload, {
      status: "running",
      lastSeq: 0,
      session: {
        sessionId: ID,
        projectId: 77,
        chatId: 5,
        startedAt: (attached.payload as { session: { startedAt: string } }).session.startedAt,
      },
    });
    await waitFor(() => c.sessionEvents().length === 1);
    assert.deepEqual(
      c.sessionEvents().map((entry) => [entry.sessionId, entry.projectId, entry.chatId, entry.runSeq, entry.event.type]),
      [[ID, 77, 5, 0, "status"]],
    );

    release();
    await waitFor(() => c.events().length === 3 && c.sessionEvents().length === 3);
    assert.deepEqual(
      c.events().map((entry) => [entry.runSeq, entry.event.type]),
      c.sessionEvents().map((entry) => [entry.runSeq, entry.event.type]),
    );
  });

  it("execution session attach/cancel is denied for the wrong user, Project or Chat", async () => {
    const { url, cancelled } = await setup();
    const owner = await open(url);
    const stranger = await open(url);
    assert.ok((await owner.call("1", "conversation.start", { chatId: 5, body: {} })).ok);

    for (const [id, client, params] of [
      ["2", owner, { sessionId: ID, projectId: 78, chatId: 5, afterSeq: -1 }],
      ["3", owner, { sessionId: ID, projectId: 77, chatId: 6, afterSeq: -1 }],
      ["4", stranger, { sessionId: ID, projectId: 77, chatId: 5, afterSeq: -1 }],
    ] as const) {
      const denied = await client.call(id, "execution.session.attach", params);
      assert.ok(!denied.ok && denied.error?.code === "NOT_FOUND");
    }

    const wrongCancel = await owner.call("5", "execution.session.cancel", {
      sessionId: ID,
      projectId: 77,
      chatId: 6,
    });
    assert.ok(!wrongCancel.ok && wrongCancel.error?.code === "NOT_FOUND");
    assert.deepEqual(cancelled, []);

    const correct = await owner.call("6", "execution.session.cancel", {
      sessionId: ID,
      projectId: 77,
      chatId: 5,
    });
    assert.deepEqual(correct.payload, { cancelled: true });
    assert.deepEqual(cancelled, [`${ID}:1`]);
  });

  it("accepts fixed terminal input only in the owning Project/Chat session", async () => {
    const { url, release, terminalInputs } = await setup();
    const owner = await open(url);
    const stranger = await open(url);
    assert.ok((await owner.call("1", "conversation.start", { chatId: 5, body: {} })).ok);

    const wrongChat = await owner.call("2", "execution.session.input", {
      sessionId: ID, projectId: 77, chatId: 6, input: "pwd",
    });
    const wrongUser = await stranger.call("3", "execution.session.input", {
      sessionId: ID, projectId: 77, chatId: 5, input: "pwd",
    });
    const arbitrary = await owner.call("4", "execution.session.input", {
      sessionId: ID, projectId: 77, chatId: 5, input: "pwd; touch /tmp/denied",
    });
    assert.ok(!wrongChat.ok && wrongChat.error?.code === "NOT_FOUND");
    assert.ok(!wrongUser.ok && wrongUser.error?.code === "NOT_FOUND");
    assert.ok(!arbitrary.ok && arbitrary.error?.code === "INVALID_REQUEST");
    assert.deepEqual(terminalInputs, []);

    assert.deepEqual((await owner.call("5", "execution.session.input", {
      sessionId: ID, projectId: 77, chatId: 5, input: "pwd",
    })).payload, { written: true });
    assert.deepEqual(terminalInputs, [{
      requestId: ID, userId: 1, projectId: 77, chatId: 5, input: "pwd",
    }]);
    release();
  });

  it("execution session detach stops Terminal events without affecting the chat observer or run", async () => {
    const { url, release } = await setup();
    const c = await open(url);
    assert.ok((await c.call("1", "conversation.start", { chatId: 5, body: {} })).ok);
    await waitFor(() => c.events().length === 1);

    assert.ok((await c.call("2", "execution.session.attach", {
      sessionId: ID,
      projectId: 77,
      chatId: 5,
      afterSeq: -1,
    })).ok);
    await waitFor(() => c.sessionEvents().length === 1);

    assert.deepEqual((await c.call("3", "execution.session.detach", {
      sessionId: ID,
      projectId: 77,
      chatId: 5,
    })).payload, { detached: true });

    release();
    await waitFor(() => c.events().length === 3);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(c.sessionEvents().length, 1);
    assert.deepEqual(c.events().map((entry) => entry.event.type), ["status", "text", "done"]);
  });

  it("delivers missed events after reconnect and enforces per-user isolation", async () => {
    const { url, release, runs } = await setup();
    const owner = await open(url);        // user 1
    const stranger = await open(url);     // user 2
    assert.ok((await owner.call("1", "conversation.start", { chatId: 5, body: {} })).ok);
    const denied = await stranger.call("1", "conversation.subscribe", { requestId: ID });
    assert.ok(!denied.ok && denied.error?.code === "NOT_FOUND");
    assert.deepEqual((await stranger.call("2", "conversation.active")).payload, { runs: [] });

    owner.socket.terminate();
    release();
    await waitFor(() => runs.active(1).length === 0);
    const returning = await open(url);    // user 1 again
    const subscribed = await returning.call("1", "conversation.subscribe", { requestId: ID, afterSeq: 0 });
    assert.ok(subscribed.ok);
    assert.equal((subscribed.payload as { status: string }).status, "finished");
    assert.deepEqual(returning.events().map((e) => e.event.type), ["text", "done"]);
    assert.deepEqual(returning.events().map((e) => e.runSeq), [1, 2]);
  });

  it("reads restart-safe interrupted history without creating or resuming a live run", async () => {
    const { url, runs } = await setup();
    const owner = await open(url);
    const stranger = await open(url);

    assert.deepEqual(runs.active(1), []);
    const read = await owner.call("1", "execution.session.read", {
      sessionId: HISTORY_ID,
      projectId: 77,
      chatId: 5,
    });
    assert.ok(read.ok);
    assert.deepEqual(read.payload, {
      sessionId: HISTORY_ID,
      status: "interrupted",
      label: "Conversation execution",
      startedAt: "2026-10-03T00:00:00.000Z",
      endedAt: "2026-10-03T00:01:00.000Z",
      stdout: "retained transcript",
      stderr: "",
      exitCode: null,
      trust: {
        version: 1,
        requestId: HISTORY_ID,
        operationDigest: "a".repeat(64),
        approvalDigest: "c".repeat(64),
        permissionClass: "user_confirm",
        policyRevision: "b".repeat(64),
        decision: "approved",
        denialReason: null,
        backendId: "lios.execution.local",
        deviceId: null,
        backendGenerationId: null,
        runtimeReceiptId: null,
      },
    });
    assert.deepEqual(runs.active(1), [], "reading journal history never re-admits execution");

    const history = await owner.call("2", "execution.session.history", {
      projectId: 77,
      chatId: 5,
    });
    assert.deepEqual(
      (history.payload as { sessions: Array<{ sessionId: string; status: string }> }).sessions
        .map((session) => [session.sessionId, session.status]),
      [[HISTORY_ID, "interrupted"], ["55555555-5555-4555-8555-555555555555", "denied"]],
    );
    const deniedHistory = await owner.call("7", "execution.session.read", {
      sessionId: "55555555-5555-4555-8555-555555555555",
      projectId: 77,
      chatId: 5,
    });
    const deniedReceipt = GATEWAY_METHODS["execution.session.read"].result.parse(deniedHistory.payload);
    assert.equal(deniedReceipt.trust?.denialReason, "approval-mismatch");
    assert.deepEqual(runs.active(1), [], "denied journal history never admits execution");
    const attachDenied = await owner.call("8", "execution.session.attach", {
      sessionId: "55555555-5555-4555-8555-555555555555",
      projectId: 77,
      chatId: 5,
      afterSeq: -1,
    });
    assert.ok(!attachDenied.ok && attachDenied.error?.code === "NOT_FOUND");
    const foreignDenied = await stranger.call("9", "execution.session.read", {
      sessionId: "55555555-5555-4555-8555-555555555555",
      projectId: 77,
      chatId: 5,
    });
    assert.ok(!foreignDenied.ok && foreignDenied.error?.code === "NOT_FOUND");

    for (const [id, client, params] of [
      ["3", owner, { sessionId: HISTORY_ID, projectId: 78, chatId: 5 }],
      ["4", owner, { sessionId: HISTORY_ID, projectId: 77, chatId: 6 }],
      ["5", stranger, { sessionId: HISTORY_ID, projectId: 77, chatId: 5 }],
    ] as const) {
      const denied = await client.call(id, "execution.session.read", params);
      assert.ok(!denied.ok && denied.error?.code === "NOT_FOUND");
    }
    assert.deepEqual(
      (await stranger.call("6", "execution.session.history", { projectId: 77, chatId: 5 })).payload,
      { sessions: [] },
    );
  });

  it("maps start rejections to protocol errors with the original status and body, and forwards cancel", async () => {
    const { url, cancelled } = await setup();
    const c = await open(url);
    const too = await c.call("1", "conversation.start", { chatId: 5, body: { reject: 413 } });
    assert.ok(!too.ok && too.error?.code === "PAYLOAD_TOO_LARGE");
    assert.deepEqual((too.error?.details as { status: number; code: string }), { error: "nope", code: "x", status: 413 });
    const voice = await c.call("2", "conversation.start", { chatId: null, body: {} });
    assert.ok(!voice.ok && voice.error?.code === "INVALID_REQUEST");
    assert.equal((voice.error?.details as { code: string }).code, "voice_transcript_review_required");
    const unavailable = await c.call("3", "conversation.start", { chatId: 5, body: { reject: 503 } });
    assert.ok(!unavailable.ok && unavailable.error?.retryable === true);
    const cancel = await c.call("4", "conversation.cancel", { requestId: ID });
    assert.deepEqual(cancel.payload, { cancelled: true });
    assert.deepEqual(cancelled, [`${ID}:1`]);
  });

  it("conversation.resume takes only a requestId, re-registers the SAME run and streams it live to the resuming connection", async () => {
    const { url, runs, resumed } = await setup();
    const c = await open(url);
    for (const params of [{}, { requestId: "not-a-uuid" }, { requestId: ID, chatId: 5 }, { requestId: ID, objective: "do it" }, { requestId: ID, adapterId: "x", checkpointRef: "y", authorization: {} }]) {
      const bad = await c.call(`bad-${JSON.stringify(params).length}`, "conversation.resume", params);
      assert.ok(!bad.ok && bad.error?.code === "INVALID_REQUEST", JSON.stringify(params));
    }
    assert.deepEqual(resumed, [], "no authority-bearing field ever reaches the service");

    const ok = await c.call("r1", "conversation.resume", { requestId: ID });
    assert.ok(ok.ok);
    assert.deepEqual(ok.payload, { requestId: ID });
    assert.deepEqual(resumed, [{ userId: 1, requestId: ID }]);
    await waitFor(() => c.events().some((entry) => entry.event.type === "done"));
    assert.deepEqual(c.events().map((entry) => entry.event.type), ["status", "done"]);
    assert.equal(runs.getScoped(ID, { userId: 1, projectId: 77, chatId: 5 })?.requestId, ID);
  });

  it("conversation.resume maps refusals to protocol errors carrying the service status and typed code", async () => {
    const { url } = await setup();
    const c = await open(url);
    const drift = await c.call("1", "conversation.resume", { requestId: "66666666-6666-4666-8666-666666666666" });
    assert.ok(!drift.ok && drift.error?.code === "INVALID_REQUEST");
    assert.deepEqual(drift.error?.details, { code: "agent_resume_drift", error: "changed", status: 409 });
    const missing = await c.call("2", "conversation.resume", { requestId: "77777777-7777-4777-8777-777777777777" });
    assert.ok(!missing.ok && missing.error?.code === "NOT_FOUND");
  });
});
