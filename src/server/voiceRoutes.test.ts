import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Express, Request, Response } from "express";
import { registerSpeechOutputProvider, unregisterSpeechOutputProvider } from "./p12VoiceRuntime";
import { registerVoiceRoutes } from "./voiceRoutes";

type SpeakHandler = (req: Request, res: Response) => Promise<void>;

function speakFixture(providerId: string) {
  let handler: SpeakHandler | undefined;
  const app = {
    get() {},
    post(route: string, ...handlers: unknown[]) {
      if (route === "/api/voice/speak") handler = handlers.at(-1) as SpeakHandler;
    },
  } as unknown as Express;
  registerVoiceRoutes(app);
  assert.ok(handler);
  const speak = handler;
  const req = Object.assign(new EventEmitter(), {
    aborted: false,
    body: { text: "Read this reply", preference: { providerId, localOnly: true } },
  });
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    statusCode: 200,
    body: undefined as unknown,
    headers: new Map<string, string>(),
    writes: 0,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) {
      this.writes += 1;
      this.body = body;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    setHeader(name: string, value: string) { this.headers.set(name, value); return this; },
    send(body: Buffer) {
      this.writes += 1;
      this.body = body;
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
    destroy() {
      this.destroyed = true;
      this.emit("close");
      return this;
    },
  });
  return { req, res, run: () => speak(req as unknown as Request, res as unknown as Response) };
}

for (const event of ["aborted", "close", "timeout"] as const) {
  test(`speech ${event} cancels its provider, joins cleanup and never writes late audio`, async (t) => {
    const providerId = `test.route-cancel-${event}`;
    const started = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    registerSpeechOutputProvider({
      id: providerId,
      label: "Delayed local speech",
      local: true,
      async synthesize(input) {
        signal = input.signal;
        started.resolve();
        await cleanup.promise;
        return { audio: Buffer.from("late audio"), mimeType: "audio/wav" };
      },
    });
    t.after(() => { cleanup.resolve(); unregisterSpeechOutputProvider(providerId); });
    const fixture = speakFixture(providerId);
    let settled = false;
    const running = fixture.run().finally(() => { settled = true; });
    await started.promise;
    assert.ok(signal);
    if (event === "aborted") {
      fixture.req.aborted = true;
      fixture.req.emit("aborted");
    } else if (event === "close") {
      fixture.res.destroy();
    } else {
      fixture.res.emit("timeout");
      assert.equal(fixture.res.destroyed, true);
    }
    assert.equal(signal.aborted, true);
    await Promise.resolve();
    assert.equal(settled, false, "the route must await provider cleanup after disconnect");
    cleanup.resolve();
    await running;
    assert.equal(fixture.res.writes, 0);
    assert.equal(fixture.res.headers.size, 0);
    assert.equal(fixture.req.listenerCount("aborted"), 0);
    assert.equal(fixture.res.listenerCount("close"), 0);
    assert.equal(fixture.res.listenerCount("timeout"), 0);
  });
}

test("normal request-body completion does not cancel speech and successful response removes lifecycle listeners", async (t) => {
  const providerId = "test.route-normal-speech";
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  registerSpeechOutputProvider({
    id: providerId,
    label: "Local speech",
    local: true,
    async synthesize(input) {
      signal = input.signal;
      started.resolve();
      await finish.promise;
      return { audio: Buffer.from("audio"), mimeType: "audio/wav" };
    },
  });
  t.after(() => { finish.resolve(); unregisterSpeechOutputProvider(providerId); });
  const fixture = speakFixture(providerId);
  const running = fixture.run();
  await started.promise;
  fixture.req.emit("close");
  assert.equal(signal?.aborted, false, "IncomingMessage close is not a client cancellation");
  finish.resolve();
  await running;
  assert.equal(fixture.res.statusCode, 200);
  assert.deepEqual(fixture.res.body, Buffer.from("audio"));
  assert.equal(fixture.res.headers.get("Content-Type"), "audio/wav");
  assert.equal(fixture.res.headers.get("Content-Length"), "5");
  assert.equal(fixture.req.listenerCount("aborted"), 0);
  assert.equal(fixture.res.listenerCount("close"), 0);
  assert.equal(fixture.res.listenerCount("timeout"), 0);
  fixture.res.emit("close");
  assert.equal(signal?.aborted, false, "a normal completed response must not revoke completed speech");
});

test("speech never starts for an already aborted request or closed response", async (t) => {
  const providerId = "test.route-already-closed";
  let calls = 0;
  registerSpeechOutputProvider({
    id: providerId,
    label: "Local speech",
    local: true,
    async synthesize() { calls += 1; return { audio: Buffer.from("audio"), mimeType: "audio/wav" }; },
  });
  t.after(() => unregisterSpeechOutputProvider(providerId));
  for (const state of ["aborted", "destroyed", "writableEnded", "headersSent"] as const) {
    const fixture = speakFixture(providerId);
    if (state === "aborted") fixture.req.aborted = true;
    else fixture.res[state] = true;
    await fixture.run();
    assert.equal(fixture.res.writes, 0);
    assert.equal(fixture.req.listenerCount("aborted"), 0);
    assert.equal(fixture.res.listenerCount("close"), 0);
    assert.equal(fixture.res.listenerCount("timeout"), 0);
  }
  assert.equal(calls, 0);
});

test("speech does not write after another response owner sends headers or ends the response", async (t) => {
  const providerId = "test.route-response-owned";
  for (const state of ["headersSent", "writableEnded"] as const) {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    registerSpeechOutputProvider({
      id: providerId,
      label: "Local speech",
      local: true,
      async synthesize() {
        started.resolve();
        await finish.promise;
        throw new Error("private-provider-secret");
      },
    });
    t.after(() => { finish.resolve(); unregisterSpeechOutputProvider(providerId); });
    const fixture = speakFixture(providerId);
    const running = fixture.run();
    await started.promise;
    fixture.res[state] = true;
    finish.resolve();
    await running;
    assert.equal(fixture.res.writes, 0);
    assert.equal(fixture.res.headers.size, 0);
    assert.equal(fixture.req.listenerCount("aborted"), 0);
    assert.equal(fixture.res.listenerCount("close"), 0);
    assert.equal(fixture.res.listenerCount("timeout"), 0);
  }
});

test("speech provider failures stay secret-safe and release response listeners", async (t) => {
  const providerId = "test.route-failed-speech";
  registerSpeechOutputProvider({
    id: providerId,
    label: "Failed local speech",
    local: true,
    async synthesize() { throw new Error("private-provider-secret /private/local/path"); },
  });
  t.after(() => unregisterSpeechOutputProvider(providerId));
  const fixture = speakFixture(providerId);
  await fixture.run();
  assert.equal(fixture.res.statusCode, 422);
  assert.deepEqual(fixture.res.body, { error: "Speech synthesis failed." });
  assert.equal(fixture.res.headers.size, 0);
  assert.equal(fixture.req.listenerCount("aborted"), 0);
  assert.equal(fixture.res.listenerCount("close"), 0);
  assert.equal(fixture.res.listenerCount("timeout"), 0);
});
