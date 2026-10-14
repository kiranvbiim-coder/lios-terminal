import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { ConversationRunConflictError, ConversationRunRegistry } from "./conversationRunRegistry";
import type { RunEntry } from "./conversationRunRegistry";

const ID = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-03T00:00:00.000Z";
const text = (value: string): ConversationRuntimeEvent => ({ type: "text", requestId: ID, at, text: value, label: "deterministic" });
const status = (message: string): ConversationRuntimeEvent => ({ type: "status", requestId: ID, at, stepId: null, message, state: "running" });
const done = (outcome: "completed" | "failed" = "completed"): ConversationRuntimeEvent => ({ type: "done", requestId: ID, at, status: outcome });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("Conversation run registry", () => {
  it("replays missed events to a late listener, then streams live without duplicates", async () => {
    const registry = new ConversationRunRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    registry.start({ requestId: ID, userId: 1, projectId: 9, chatId: 7 }, async (emit) => {
      emit(status("a"));
      emit(status("b"));
      await gate;
      emit(status("c"));
      emit(done());
    });
    await tick();
    const seen: RunEntry[] = [];
    const subscription = registry.subscribe(ID, 1, 0, (entry) => seen.push(entry))!;
    assert.equal(subscription.status, "running");
    assert.deepEqual(seen.map((entry) => entry.seq), [1]);
    release();
    await tick();
    assert.deepEqual(seen.map((entry) => entry.seq), [1, 2, 3]);
    assert.equal(seen.at(-1)?.event.type, "done");
    assert.equal(registry.active(1).length, 0);
  });

  it("keeps only the latest cumulative text event in the replay buffer", async () => {
    const registry = new ConversationRunRegistry();
    registry.start({ requestId: ID, userId: 1, projectId: null, chatId: null }, async (emit) => {
      emit(text("Hel"));
      emit(text("Hello"));
      emit(text("Hello world"));
      emit(done());
    });
    await tick();
    const replay: RunEntry[] = [];
    registry.subscribe(ID, 1, -1, (entry) => replay.push(entry));
    assert.deepEqual(replay.map((entry) => entry.event.type), ["text", "done"]);
    assert.equal((replay[0]!.event as { text: string }).text, "Hello world");
    assert.deepEqual(replay.map((entry) => entry.seq), [2, 3]);
  });

  it("never lets another user see or join a run", async () => {
    const registry = new ConversationRunRegistry();
    registry.start({ requestId: ID, userId: 1, projectId: null, chatId: null }, async (emit) => { emit(done()); });
    await tick();
    assert.equal(registry.subscribe(ID, 2, -1, () => {}), null);
    assert.equal(registry.get(ID, 2), null);
    assert.deepEqual(registry.active(2), []);
    assert.throws(() => registry.start({ requestId: ID, userId: 2, projectId: null, chatId: null }, async () => {}), ConversationRunConflictError);
  });

  it("uses requestId as the one canonical execution session and enforces user/Project/Chat scope", async () => {
    const registry = new ConversationRunRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = registry.start(
      { requestId: ID, userId: 1, projectId: 9, chatId: 7 },
      async (emit) => {
        emit(status("scoped"));
        await gate;
        emit(done());
      },
    );
    assert.equal(started.requestId, ID);
    assert.equal(started.projectId, 9);
    assert.equal(started.chatId, 7);

    await tick();
    const terminal: RunEntry[] = [];
    const exact = registry.subscribeScoped(
      ID,
      { userId: 1, projectId: 9, chatId: 7 },
      -1,
      (entry) => terminal.push(entry),
    );
    assert.ok(exact);
    assert.equal(exact.run.requestId, ID);
    assert.equal(exact.run.projectId, 9);
    assert.equal(exact.run.chatId, 7);
    assert.deepEqual(terminal.map((entry) => entry.seq), [0]);

    for (const owner of [
      { userId: 2, projectId: 9, chatId: 7 },
      { userId: 1, projectId: 10, chatId: 7 },
      { userId: 1, projectId: 9, chatId: 8 },
      { userId: 1, projectId: null, chatId: 7 },
    ]) {
      assert.equal(registry.getScoped(ID, owner), null);
      assert.equal(registry.subscribeScoped(ID, owner, -1, () => {}), null);
    }

    release();
    await tick();
    assert.deepEqual(terminal.map((entry) => [entry.seq, entry.event.type]), [
      [0, "status"],
      [1, "done"],
    ]);
  });

  it("routes controlled terminal input through the same scoped run and rejects foreign or late writes", async () => {
    const registry = new ConversationRunRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inputs: string[] = [];
    registry.start({ requestId: ID, userId: 1, projectId: 9, chatId: 7 }, async (emit) => {
      emit(status("ready"));
      await gate;
      emit(done());
    });
    const owner = { userId: 1, projectId: 9, chatId: 7 };
    assert.equal(registry.setInputHandlerScoped(ID, owner, async (input) => { inputs.push(input); }), true);
    await assert.rejects(
      registry.writeInputScoped(ID, { userId: 2, projectId: 9, chatId: 7 }, "pwd"),
      /does not accept input/,
    );
    await assert.rejects(
      registry.writeInputScoped(ID, owner, "pwd\nid -u"),
      /single-line/,
    );
    await Promise.all([
      registry.writeInputScoped(ID, owner, "pwd"),
      registry.writeInputScoped(ID, owner, "id -u"),
    ]);
    assert.deepEqual(inputs, ["pwd", "id -u"]);
    release();
    await tick();
    await assert.rejects(registry.writeInputScoped(ID, owner, "help"), /does not accept input/);
  });

  it("turns a thrown runtime into error + failed done, and a silent return into failed done", async () => {
    const registry = new ConversationRunRegistry();
    registry.start({ requestId: ID, userId: 1, projectId: null, chatId: null }, async () => { throw new Error("boom"); });
    await tick();
    const thrown: RunEntry[] = [];
    registry.subscribe(ID, 1, -1, (entry) => thrown.push(entry));
    assert.deepEqual(thrown.map((entry) => entry.event.type), ["error", "done"]);
    assert.equal((thrown[0]!.event as { message: string }).message, "boom");

    const reported = "55555555-5555-4555-8555-555555555555";
    registry.start({ requestId: reported, userId: 1, projectId: null, chatId: null }, async (emit) => {
      emit({ type: "error", requestId: reported, at, code: "no_provider", message: "No provider" });
      throw new Error("No provider");
    });
    await tick();
    const once: RunEntry[] = [];
    registry.subscribe(reported, 1, -1, (entry) => once.push(entry));
    assert.deepEqual(once.map((entry) => entry.event.type), ["error", "done"]);

    const other = "22222222-2222-4222-8222-222222222222";
    registry.start({ requestId: other, userId: 1, projectId: null, chatId: null }, async () => {});
    await tick();
    const silent: RunEntry[] = [];
    registry.subscribe(other, 1, -1, (entry) => silent.push(entry));
    assert.deepEqual(silent.map((entry) => (entry.event.type === "done" ? entry.event.status : entry.event.type)), ["failed"]);
  });

  it("rejects a duplicate running id, allows reuse after finish, and ignores events after done", async () => {
    const registry = new ConversationRunRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    registry.start({ requestId: ID, userId: 1, projectId: null, chatId: null }, async (emit) => { await gate; emit(done()); emit(status("late")); });
    assert.throws(() => registry.start({ requestId: ID, userId: 1, projectId: null, chatId: null }, async () => {}), ConversationRunConflictError);
    release();
    await tick();
    const entries: RunEntry[] = [];
    registry.subscribe(ID, 1, -1, (entry) => entries.push(entry));
    assert.deepEqual(entries.map((entry) => entry.event.type), ["done"]);
    registry.start({ requestId: ID, userId: 1, projectId: null, chatId: null }, async (emit) => { emit(done("failed")); });
    await tick();
  });

  it("bounds buffered entries and the number of concurrent runs per user, and a throwing listener does not stop the run", async () => {
    const small = new ConversationRunRegistry({ maxBufferedEntries: 3 });
    small.start({ requestId: ID, userId: 1, projectId: null, chatId: null }, async (emit) => {
      for (let i = 0; i < 10; i += 1) emit(status(String(i)));
      emit(done());
    });
    await tick();
    const replay: RunEntry[] = [];
    small.subscribe(ID, 1, -1, (entry) => replay.push(entry));
    assert.equal(replay.length, 3);
    assert.equal(replay.at(-1)?.seq, 10);

    const limited = new ConversationRunRegistry({ maxRunsPerUser: 2 });
    const hold = new Promise<void>(() => {});
    limited.start({ requestId: "a1111111-1111-4111-8111-111111111111", userId: 1, projectId: null, chatId: null }, () => hold);
    limited.start({ requestId: "b1111111-1111-4111-8111-111111111111", userId: 1, projectId: null, chatId: null }, () => hold);
    assert.throws(() => limited.start({ requestId: "c1111111-1111-4111-8111-111111111111", userId: 1, projectId: null, chatId: null }, () => hold), /Too many/);
    limited.start({ requestId: "d1111111-1111-4111-8111-111111111111", userId: 2, projectId: null, chatId: null }, () => hold);

    const guarded = new ConversationRunRegistry();
    let emitter!: (event: ConversationRuntimeEvent) => void;
    guarded.start({ requestId: ID, userId: 1, projectId: null, chatId: null }, (emit) => { emitter = emit; return new Promise<void>(() => {}); });
    const good: RunEntry[] = [];
    guarded.subscribe(ID, 1, -1, () => { throw new Error("bad observer"); });
    guarded.subscribe(ID, 1, -1, (entry) => good.push(entry));
    emitter(status("x"));
    emitter(status("y"));
    assert.equal(good.length, 2);
  });
  it("hands the run's abort signal to execute, and only the owner can cancel through the registry", async () => {
    const registry = new ConversationRunRegistry();
    let seen: AbortSignal | null = null;
    registry.start({ requestId: ID, userId: 1, projectId: 9, chatId: 7 }, async (emit, signal) => {
      seen = signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      emit(done("failed"));
    });
    await tick();
    assert.ok(seen);
    assert.equal((seen as AbortSignal).aborted, false);
    assert.equal(registry.cancel(ID, 2), false);
    assert.equal((seen as AbortSignal).aborted, false);
    assert.equal(registry.cancelScoped(ID, { userId: 1, projectId: 9, chatId: 8 }), false);
    assert.equal((seen as AbortSignal).aborted, false);
    assert.equal(registry.cancel(ID, 1), true);
    assert.equal((seen as AbortSignal).aborted, true);
    await tick();
    assert.equal(registry.cancel(ID, 1), false, "a finished run cannot be cancelled again");
  });
});

describe("Conversation run registry: pausable runs (L4 seam)", () => {
  const owner = { userId: 1, projectId: 9, chatId: 7 };
  const waiting = (): ConversationRuntimeEvent => ({ type: "done", requestId: ID, at, status: "waiting_approval" });
  const doneStatus = (registry: ConversationRunRegistry) => {
    const seen: string[] = [];
    registry.subscribe(ID, 1, -1, ({ event }) => { if (event.type === "done") seen.push(event.status); });
    return seen;
  };

  it("keeps the run identity on waiting_approval only when the run is pausable", async () => {
    const plain = new ConversationRunRegistry();
    plain.start({ requestId: ID, ...owner }, async (emit) => { emit(waiting()); });
    await tick();
    assert.equal(plain.active(1).length, 0, "default runs keep the current behavior: waiting_approval finishes the run");
    assert.equal(plain.resumeScoped(ID, owner, async () => undefined), false);

    const pausable = new ConversationRunRegistry();
    pausable.start({ requestId: ID, ...owner }, async (emit) => { emit(waiting()); }, { pausable: true });
    await tick();
    assert.equal(pausable.active(1).length, 1);
    assert.equal(pausable.get(ID, 1)?.finished, false);
  });

  it("resumes the same run identity for its owner only, then finishes normally", async () => {
    const registry = new ConversationRunRegistry();
    let firstSignal!: AbortSignal;
    registry.start({ requestId: ID, ...owner }, async (emit, signal) => { firstSignal = signal; emit(waiting()); }, { pausable: true });
    await tick();
    assert.equal(registry.resumeScoped(ID, { ...owner, userId: 2 }, async () => undefined), false);
    assert.equal(registry.resumeScoped(ID, { ...owner, chatId: 8 }, async () => undefined), false);
    let resumedSignal!: AbortSignal;
    assert.equal(registry.resumeScoped(ID, owner, async (emit, signal) => { resumedSignal = signal; emit(done()); }), true);
    await tick();
    assert.equal(resumedSignal, firstSignal, "the same cancellation tree continues");
    assert.equal(registry.get(ID, 1)?.finished, true);
    assert.equal(registry.resumeScoped(ID, owner, async () => undefined), false, "a finished run cannot be resumed");
  });

  it("cancel while paused aborts the same controller and finalizes with done: cancelled", async () => {
    const registry = new ConversationRunRegistry();
    let signal!: AbortSignal;
    registry.start({ requestId: ID, ...owner }, async (emit, s) => { signal = s; emit(waiting()); }, { pausable: true });
    await tick();
    assert.equal(registry.cancel(ID, 2), false);
    assert.equal(registry.cancel(ID, 1), true);
    assert.equal(signal.aborted, true);
    assert.equal(registry.get(ID, 1)?.finished, true);
    assert.deepEqual(doneStatus(registry), ["waiting_approval", "cancelled"]);
  });

  it("persists paused cancellation before publishing the cancelled terminal event", async () => {
    const registry = new ConversationRunRegistry();
    const owner = { userId: 1, projectId: 9, chatId: 7 };
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    registry.start({ requestId: ID, ...owner }, async (emit) => {
      assert.equal(registry.stagePauseScoped(
        ID,
        owner,
        { opaque: true },
        async () => {
          order.push("persist-start");
          await gate;
          order.push("persist-done");
        },
      ), true);
      emit(waiting());
    }, { pausable: true });
    await tick();

    registry.subscribe(ID, owner.userId, -1, ({ event }) => {
      if (event.type === "done" && event.status === "cancelled") order.push("terminal-event");
    });

    assert.equal(registry.cancelScoped(ID, owner), true);
    await tick();
    assert.deepEqual(order, ["persist-start"]);
    assert.equal(registry.cancelScoped(ID, owner), false, "a cancellation already being persisted is single-shot");

    release();
    await tick();
    assert.deepEqual(order, ["persist-start", "persist-done", "terminal-event"]);
    assert.equal(registry.get(ID, owner.userId)?.finished, true);
  });

  it("a paused run expires by TTL as cancelled and can no longer be resumed", async () => {
    const registry = new ConversationRunRegistry({ pausedTtlMs: 20 });
    registry.start({ requestId: ID, ...owner }, async (emit) => { emit(waiting()); }, { pausable: true });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(registry.get(ID, 1)?.finished, true);
    assert.deepEqual(doneStatus(registry).at(-1), "cancelled");
    assert.equal(registry.resumeScoped(ID, owner, async () => undefined), false);
  });

  it("stages the live pause payload before event visibility and exposes it only to the paused owner", async () => {
    const registry = new ConversationRunRegistry({ pausedTtlMs: 40 });
    const payload = { secretGoal: "do not leak" };
    let runSignal!: AbortSignal;
    registry.start({ requestId: ID, ...owner }, async (emit, signal) => {
      runSignal = signal;
      assert.equal(registry.stagePauseScoped(ID, { ...owner, userId: 2 }, payload), false);
      assert.equal(registry.stagePauseScoped(ID, owner, null), false);
      assert.equal(registry.stagePauseScoped(ID, owner, payload), true);
      assert.equal(registry.stagePauseScoped(ID, owner, { secretGoal: "overwrite" }), false);
      assert.equal(registry.getPausedPayloadScoped(ID, owner), null, "staged payload stays unreadable until waiting_approval pauses the run");
      emit(waiting());
    }, { pausable: true });
    await tick();

    assert.equal(registry.stagePauseScoped(ID, owner, { secretGoal: "late" }), false, "a paused run cannot late-attach state");
    assert.equal(registry.getPausedPayloadScoped(ID, { ...owner, chatId: 8 }), null);
    const held = registry.getPausedPayloadScoped<typeof payload>(ID, owner);
    assert.ok(held);
    assert.equal(held.payload, payload);
    assert.equal(held.signal, runSignal, "approval authority receives the canonical run signal");
    assert.equal(registry.readPauseScoped(ID, owner), payload);
    assert.equal(JSON.stringify(registry.get(ID, 1)).includes("secretGoal"), false);
    const events: string[] = [];
    registry.subscribe(ID, 1, -1, ({ event }) => events.push(JSON.stringify(event)));
    assert.equal(events.some((event) => event.includes("secretGoal")), false);

    assert.equal(registry.resumeScoped(ID, owner, async () => undefined), true);
    assert.equal(registry.getPausedPayloadScoped(ID, owner), null, "cleared on resume");

    const cancelled = new ConversationRunRegistry();
    cancelled.start({ requestId: ID, ...owner }, async (emit) => {
      assert.equal(cancelled.stagePauseScoped(ID, owner, payload), true);
      emit(waiting());
    }, { pausable: true });
    await tick();
    cancelled.cancel(ID, 1);
    assert.equal(cancelled.getPausedPayloadScoped(ID, owner), null, "cleared on cancel");
    assert.equal(cancelled.stagePauseScoped(ID, owner, payload), false, "cannot stage on a finished run");

    const ttl = new ConversationRunRegistry({ pausedTtlMs: 20 });
    ttl.start({ requestId: ID, ...owner }, async (emit) => {
      assert.equal(ttl.stagePauseScoped(ID, owner, payload), true);
      emit(waiting());
    }, { pausable: true });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(ttl.getPausedPayloadScoped(ID, owner), null, "cleared on TTL expiry");
    assert.equal(ttl.signalScoped(ID, owner), null);
  });
});
