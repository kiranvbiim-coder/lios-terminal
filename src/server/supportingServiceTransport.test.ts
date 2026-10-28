import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { SupportingServiceTransport, SupportingServiceTransportClosedError, type SupportingServiceTransportOptions } from "./supportingServiceTransport";
import { SUPPORTING_SERVICE_PROTOCOL, type SupportingServiceWorkerFrame } from "@shared/supportingServiceContracts";

const deferred = () => Promise.withResolvers<void>();
function fixture(extra: Partial<SupportingServiceTransportOptions> = {}) {
  const binding = { sessionId: crypto.randomUUID(), generation: crypto.randomUUID(), accountBindingId: crypto.randomUUID(), launchNonce: "a".repeat(64) };
  const buildSha256 = "b".repeat(64);
  let stopped = 0;
  const frames: SupportingServiceWorkerFrame[] = [];
  const writes: string[] = [];
  const transport = new SupportingServiceTransport({
    binding, buildSha256, operations: ["telegram.send"], assertCurrent: () => undefined,
    write: async bytes => { writes.push(bytes.toString()); }, stop: async () => { stopped++; },
    onFrame: async frame => { frames.push(frame); }, ...extra,
  });
  const envelope = { protocol: SUPPORTING_SERVICE_PROTOCOL, binding };
  const wire = (frame: object) => Buffer.from(JSON.stringify({ ...envelope, ...frame }) + "\n");
  const ready = () => transport.receive(wire({ kind: "ready", buildSha256, operations: ["telegram.send"] }));
  const open = async () => { const opening = transport.open(); await ready(); await opening; };
  const invoke = () => ({ ...envelope, kind: "invoke" as const, requestId: crypto.randomUUID(), operationId: "telegram.send", authorizationRef: crypto.randomUUID(), deadlineAt: Date.now() + 10_000, input: { text: "Confirmed recipient only" }, attachments: [] });
  return { transport, wire, ready, open, invoke, binding, frames, writes, stopped: () => stopped };
}

test("a stale generation or mismatched build cannot publish a ready service", async () => {
  for (const field of ["generation", "build"] as const) {
    const f = fixture();
    const opening = f.transport.open();
    const refused = assert.rejects(opening);
    await assert.rejects(f.transport.receive(f.wire({ kind: "ready", buildSha256: field === "build" ? "c".repeat(64) : "b".repeat(64), operations: ["telegram.send"], ...(field === "generation" ? { binding: { ...f.binding, generation: crypto.randomUUID() } } : {}) })));
    await refused;
    await f.transport.close();
    await assert.rejects(f.transport.send(f.invoke()));
    assert.equal(f.stopped(), 1);
  }
});

test("revocation while a write is queued prevents physical dispatch and closes admission", async () => {
  const writing = deferred();
  const entered = deferred();
  let current = true;
  const methods: string[] = [];
  const f = fixture({ assertCurrent: () => { if (!current) throw new Error("private credential detail"); }, write: async bytes => {
    const frame = JSON.parse(bytes.toString());
    methods.push(frame.kind);
    if (frame.kind === "invoke") { entered.resolve(); await writing.promise; }
  } });
  await f.open();
  const first = f.transport.send(f.invoke());
  const firstRefused = assert.rejects(first, error => error instanceof Error && !error.message.includes("private"));
  await entered.promise;
  const secondRefused = assert.rejects(f.transport.send(f.invoke()));
  current = false;
  writing.resolve();
  await Promise.all([firstRefused, secondRefused]);
  await f.transport.close();
  assert.deepEqual(methods, ["initialize", "invoke"]);
  assert.equal(f.stopped(), 1);
});

test("event handling is serialized, preserves fragmented UTF8, and rejects replay before another adoption", async () => {
  const entered = deferred(), release = deferred();
  const seen: string[] = [];
  const f = fixture({ onFrame: async frame => {
    if (frame.kind === "event") { seen.push(String(frame.payload.text)); entered.resolve(); await release.promise; }
  } });
  await f.open();
  const event = { kind: "event", eventId: crypto.randomUUID(), sequence: 0, eventType: "telegram.message", providerEventId: "update:1", providerConversationId: "chat:1", occurredAt: null, payload: { text: "漢😀" }, attachments: [] };
  const bytes = f.wire(event);
  const split = bytes.indexOf(Buffer.from("😀")) + 1;
  await f.transport.receive(bytes.subarray(0, split));
  const first = f.transport.receive(bytes.subarray(split));
  await entered.promise;
  const replay = f.transport.receive(f.wire(event));
  const replayRefused = assert.rejects(replay);
  assert.deepEqual(seen, ["漢😀"]);
  release.resolve();
  await first;
  await replayRefused;
  await f.transport.close();
  assert.deepEqual(seen, ["漢😀"]);
});

test("input flood refuses further frames while an accepted handler is blocked", async () => {
  const entered = deferred();
  const f = fixture({ maxFrameBytes: 1024, maxQueuedBytes: 1024, onFrame: async (_frame, signal) => {
    entered.resolve();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  } });
  await f.open();
  const pending = f.transport.receive(f.wire({ kind: "health", state: "available" }));
  const pendingRefused = assert.rejects(pending);
  await entered.promise;
  await assert.rejects(f.transport.receive(Buffer.alloc(1024, 65)));
  await pendingRefused;
  await f.transport.close();
  assert.equal(f.stopped(), 1);
});

test("stalled writes time out and supervisor cleanup is joined rather than repeated", async () => {
  const cleanup = deferred();
  let stops = 0;
  const f = fixture({ operationTimeoutMs: 20, write: async () => new Promise(() => {}), stop: async () => { stops++; await cleanup.promise; } });
  await assert.rejects(f.transport.open());
  let closed = false;
  const closing = f.transport.close().then(() => { closed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.equal(stops, 1);
  cleanup.resolve();
  await closing;
  await f.transport.close();
  assert.equal(stops, 1);
});

test("a partial final frame cannot be treated as a completed worker message", async () => {
  const f = fixture();
  await f.open();
  await f.transport.receive(Buffer.from('{"protocol":'));
  await assert.rejects(f.transport.end(), /mid-frame/);
  await f.transport.close();
  assert.equal(f.frames.length, 0);
});

test("fragmented active frames retain their full byte reservation until adoption completes", async () => {
  const entered = deferred(), release = deferred();
  let revoked = false;
  const f = fixture({ maxFrameBytes: 2048, maxQueuedBytes: 2048, onFrame: async (_frame, signal) => {
    signal.addEventListener("abort", () => { revoked = true; }, { once: true });
    entered.resolve();
    await release.promise;
  } });
  await f.open();
  const bytes = f.wire({ kind: "event", eventId: crypto.randomUUID(), sequence: 0, eventType: "telegram.message", providerEventId: "update:1", providerConversationId: "chat:1", occurredAt: null, payload: { text: "x".repeat(1000) }, attachments: [] });
  assert.ok(bytes.length < 2048);
  await f.transport.receive(bytes.subarray(0, bytes.length - 1));
  const firstRefused = assert.rejects(f.transport.receive(bytes.subarray(bytes.length - 1)));
  await entered.promise;
  const floodRefused = assert.rejects(f.transport.receive(Buffer.alloc(2047, 65)));
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(revoked, true, "Saturation must cancel the active handler before any later frame is accepted");
  } finally {
    release.resolve();
    await f.transport.close();
    await Promise.all([firstRefused, floodRefused]);
  }
});

test("an abort listener reentering close shares the original supervisor cleanup", async () => {
  const entered = deferred(), release = deferred(), cleanup = deferred();
  let reentry: Promise<void> | undefined;
  let stops = 0;
  const f = fixture({ stop: async () => { stops++; await cleanup.promise; }, onFrame: async (_frame, signal) => {
    signal.addEventListener("abort", () => { reentry = f.transport.close(); }, { once: true });
    entered.resolve();
    await release.promise;
  } });
  await f.open();
  const pendingRefused = assert.rejects(f.transport.receive(f.wire({ kind: "health", state: "available" })));
  await entered.promise;
  const closing = f.transport.close();
  assert.equal(reentry, closing);
  release.resolve();
  cleanup.resolve();
  await Promise.all([closing, pendingRefused]);
  await assert.rejects(f.transport.receive(f.wire({ kind: "health", state: "available" })), SupportingServiceTransportClosedError);
  assert.equal(stops, 1);
});

test("tiny incomplete input chunks cannot retain unbounded Buffer metadata below the byte budget", async () => {
  const f = fixture();
  await f.open();
  let accepted = 0;
  let refused = false;
  for (let i = 0; i < 4096; i++) {
    try { await f.transport.receive(Buffer.from("x")); accepted++; }
    catch { refused = true; break; }
  }
  await f.transport.close();
  assert.equal(refused, true);
  assert.ok(accepted < 4096, "A few KiB of wire bytes must not admit arbitrarily many retained fragments");
  assert.equal(f.stopped(), 1);
  assert.deepEqual(f.frames, []);
});

test("tiny queued writes have a count bound even when below the aggregate wire-byte budget", async () => {
  const entered = deferred(), release = deferred();
  let physicalAdoptions = 0;
  const f = fixture({ write: async bytes => {
    if (JSON.parse(bytes.toString()).kind === "adopt") {
      physicalAdoptions++;
      entered.resolve();
      await release.promise;
    }
  } });
  await f.open();
  const adoption = () => ({ protocol: SUPPORTING_SERVICE_PROTOCOL, binding: f.binding, kind: "adopt" as const, eventId: crypto.randomUUID(), providerEventId: "update:1" });
  const first = f.transport.send(adoption()).then(() => false, () => true);
  await entered.promise;
  const queued = Array.from({ length: 4096 }, () => f.transport.send(adoption()).then(() => false, () => true));
  release.resolve();
  const refused = await Promise.all([first, ...queued]);
  await f.transport.close();
  assert.ok(refused.some(Boolean), "Saturation must refuse admission rather than accumulate every pending write");
  assert.equal(physicalAdoptions, 1);
  assert.equal(f.stopped(), 1);
});

test("terminal replies require an actually dispatched request and each request ID is single-use", async () => {
  for (const scenario of ["unknown", "queued", "duplicate-result", "reused-request", "unadvertised-operation"] as const) {
    const gate = deferred(), entered = deferred();
    let writes = 0;
    const f = fixture({ write: async bytes => {
      const frame = JSON.parse(bytes.toString());
      if (frame.kind === "invoke") {
        writes++;
        if (scenario === "queued") { entered.resolve(); await gate.promise; }
      }
    } });
    await f.open();
    const request = f.invoke();
    const result = (requestId: string) => f.wire({ kind: "result", requestId, output: { text: "provider observation" }, attachments: [], delivery: null });
    if (scenario === "unknown") {
      await assert.rejects(f.transport.receive(result(request.requestId)));
    } else if (scenario === "queued") {
      const first = f.transport.send(request).catch(() => {});
      await entered.promise;
      const second = f.invoke();
      const queued = f.transport.send(second).catch(() => {});
      await assert.rejects(f.transport.receive(result(second.requestId)));
      gate.resolve();
      await Promise.all([first, queued]);
    } else if (scenario === "unadvertised-operation") {
      await assert.rejects(f.transport.send({ ...request, operationId: "telegram.unapproved" }));
    } else {
      await f.transport.send(request);
      await f.transport.receive(result(request.requestId));
      if (scenario === "duplicate-result") await assert.rejects(f.transport.receive(result(request.requestId)));
      else await assert.rejects(f.transport.send(request));
    }
    await f.transport.close();
    assert.equal(f.frames.filter(frame => frame.kind === "result").length, scenario === "duplicate-result" || scenario === "reused-request" ? 1 : 0);
    assert.equal(writes, scenario === "unknown" || scenario === "unadvertised-operation" ? 0 : 1);
  }
});

test("terminal errors release pending capacity but generation replay protection is never evicted to admit more work", async () => {
  const f = fixture();
  await f.open();
  for (let i = 0; i < 4096; i++) {
    const request = f.invoke();
    await f.transport.send(request);
    await f.transport.receive(f.wire({ kind: "error", requestId: request.requestId, code: "OUTCOME_UNKNOWN", retryAfterMs: null, delivery: null }));
  }
  assert.equal(f.frames.filter(frame => frame.kind === "error").length, 4096);
  await assert.rejects(f.transport.send(f.invoke()));
  assert.equal(f.writes.filter(wire => JSON.parse(wire).kind === "invoke").length, 4096);
  await f.transport.close();
});

test("unanswered dispatched requests have a finite count bound independent of wire-byte retention", async () => {
  const f = fixture();
  await f.open();
  for (let i = 0; i < 64; i++) await f.transport.send(f.invoke());
  await assert.rejects(f.transport.send(f.invoke()));
  assert.equal(f.writes.filter(wire => JSON.parse(wire).kind === "invoke").length, 64);
  await f.transport.close();
  assert.equal(f.stopped(), 1);
});

test("an early terminal reply cannot be published when the pipe write later fails without dispatch", async () => {
  const entered = deferred(), writeResult = deferred();
  const f = fixture({ write: async bytes => {
    if (JSON.parse(bytes.toString()).kind === "invoke") { entered.resolve(); await writeResult.promise; }
  } });
  await f.open();
  const request = f.invoke();
  const sending = f.transport.send(request).catch(() => {});
  await entered.promise;
  const receiving = f.transport.receive(f.wire({ kind: "result", requestId: request.requestId, output: {}, attachments: [], delivery: null })).catch(() => {});
  let publishedBeforeWriteCompleted = -1;
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    publishedBeforeWriteCompleted = f.frames.filter(frame => frame.kind === "result").length;
  } finally {
    writeResult.reject(new Error("pipe write refused before bytes were accepted"));
    await Promise.all([sending, receiving]);
    await f.transport.close();
  }
  assert.equal(publishedBeforeWriteCompleted, 0);
  assert.equal(f.frames.filter(frame => frame.kind === "result").length, 0);
});
