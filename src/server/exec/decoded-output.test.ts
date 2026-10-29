// Adapted from OpenClaw src/process/{decoded-output.test.ts,supervisor/adapters/child.test.ts}
// (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS: node:test/assert and local deferred/UTF-8 decoder; adds raw ordering and concurrent-failure boundaries.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { describe, it } from "node:test";
import { createDeferredCore } from "./deferred";
import { createAwaitedDecodedOutput, joinProcessCompletionAndOutput, onDecodedOutput } from "./decoded-output";

it("owns independent decoders and delivers raw bytes before decoded split UTF-8", async () => {
  const source = new PassThrough();
  const first: string[] = [];
  const second: string[] = [];
  const ordered: string[] = [];
  const raw: Buffer[] = [];
  const a = onDecodedOutput(source, (chunk) => { first.push(chunk); ordered.push("text"); }, (chunk) => { raw.push(chunk); ordered.push("raw"); });
  const b = onDecodedOutput(source, (chunk) => second.push(chunk));
  const bytes = Buffer.from("A🙂éZ");
  for (const byte of bytes) { source.write(Buffer.from([byte])); }
  source.end();
  await finished(source);
  assert.equal(first.join(""), "A🙂éZ");
  assert.equal(second.join(""), "A🙂éZ");
  assert.deepEqual(Buffer.concat(raw), bytes);
  assert.deepEqual(ordered.slice(0, 2), ["raw", "text"]);
  a();
  b();
  assert.equal(source.listenerCount("data"), 0);
});

it("flushes an incomplete decoder sequence exactly once across end and close", async () => {
  const source = new PassThrough();
  const text: string[] = [];
  const unsubscribe = onDecodedOutput(source, (chunk) => text.push(chunk));
  source.end(Buffer.from([0xf0, 0x9f]));
  await finished(source);
  source.emit("close");
  assert.deepEqual(text, ["�"]);
  unsubscribe();
});

it("does not emit a decoder tail or a queued copied listener after unsubscribe", () => {
  const source = new PassThrough();
  const text: string[] = [];
  const unsubscribe = onDecodedOutput(source, (chunk) => text.push(chunk));
  source.write(Buffer.from([0xe2]));
  const copiedData = source.listeners("data")[0];
  const copiedClose = source.listeners("close")[0];
  unsubscribe();
  copiedData(Buffer.from("late"));
  copiedClose();
  assert.deepEqual(text, []);
  assert.equal(source.listenerCount("data"), 0);
  source.destroy();
});

it("retains other stream owners when one subscriber detaches", async () => {
  const source = new PassThrough();
  let first = "";
  let second = "";
  const detachFirst = onDecodedOutput(source, (chunk) => { first += chunk; });
  const detachSecond = onDecodedOutput(source, (chunk) => { second += chunk; });
  source.write("before");
  detachFirst();
  source.end("after");
  await finished(source);
  assert.equal(first, "before");
  assert.equal(second, "beforeafter");
  detachSecond();
});

it("fences decoded delivery when the raw observer revokes its own subscription", () => {
  const source = new PassThrough();
  let seen = "";
  const unsubscribe = onDecodedOutput(source, (chunk) => { seen += chunk; }, () => unsubscribe());
  source.write("revoked");
  assert.equal(seen, "");
  source.destroy();
});

describe("awaited decoded output", { timeout: 5_000 }, () => {
  it("retains stdout when the source resumes and ends before subscription", async () => {
    const source = new PassThrough();
    const output = createAwaitedDecodedOutput(source, () => {});
    try {
      source.end("output before subscription");
      source.resume();
      await finished(source);
      let received = "";
      await output.consume((chunk) => { received += chunk; });
      assert.equal(received, "output before subscription");
    } finally {
      output.close();
      source.destroy();
    }
  });

  for (const alreadyClosed of [false, true]) {
    it(`rejects closure before EOF (already closed: ${alreadyClosed})`, async () => {
      const source = new PassThrough();
      if (alreadyClosed) { source.destroy(); }
      const stopped = createDeferredCore<unknown>();
      const output = createAwaitedDecodedOutput(source, (error) => stopped.resolve(error));
      const consumed = output.consume(() => {});
      try {
        source.destroy();
        await assert.rejects(consumed, /stdout closed before EOF/);
        assert.deepEqual(await stopped.promise, new Error("Process stdout closed before EOF"));
      } finally {
        output.close();
        source.destroy();
        await consumed.catch(() => undefined);
      }
    });
  }

  it("requests stop for rejection and joins native completion before rejecting", async () => {
    const source = new PassThrough();
    const stopped = createDeferredCore<unknown>();
    const completion = createDeferredCore<{ code: number }>();
    const failure = new Error("synthetic rejected consumer");
    let stopCount = 0;
    const output = createAwaitedDecodedOutput(source, (error) => {
      stopCount += 1;
      stopped.resolve(error);
    });
    const consumed = output.consume(async () => { throw failure; });
    const joined = joinProcessCompletionAndOutput(completion.promise, consumed);
    let settled = false;
    void joined.then(() => { settled = true; }, () => { settled = true; });
    try {
      source.write("input");
      assert.equal(await stopped.promise, failure);
      source.end("discard after stop");
      await finished(source);
      await consumed.catch(() => undefined);
      await Promise.resolve();
      assert.equal(stopCount, 1);
      assert.equal(settled, false);
      completion.resolve({ code: 0 });
      await assert.rejects(joined, (error) => error === failure);
    } finally {
      completion.resolve({ code: 0 });
      output.close();
      source.destroy();
      await joined.catch(() => undefined);
    }
  });

  it("keeps native backpressure and ordered delivery while consumption waits", async () => {
    const source = new PassThrough();
    const output = createAwaitedDecodedOutput(source, () => {});
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const chunks: string[] = [];
    const consumed = output.consume(async (chunk) => {
      chunks.push(chunk);
      if (chunks.length === 1) {
        entered.resolve();
        await release.promise;
      }
    });
    try {
      source.write("first");
      await entered.promise;
      const remaining = "x".repeat(source.writableHighWaterMark);
      source.write(remaining);
      assert.equal(source.write(remaining), false);
      source.end();
      assert.equal(output.drain(), consumed);
      assert.deepEqual(chunks, ["first"]);
      let settled = false;
      void consumed.then(() => { settled = true; });
      await Promise.resolve();
      assert.equal(settled, false);
      release.resolve();
      await consumed;
      assert.equal(chunks.join(""), `first${remaining}${remaining}`);
    } finally {
      release.resolve();
      output.close();
      source.destroy();
      await consumed.catch(() => undefined);
    }
  });

  it("joins the decoder tail consumer after source EOF", async () => {
    const source = new PassThrough();
    const output = createAwaitedDecodedOutput(source, () => {});
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const chunks: string[] = [];
    const consumed = output.consume(async (chunk) => {
      chunks.push(chunk);
      entered.resolve();
      await release.promise;
    });
    try {
      source.write(Buffer.from([0xf0]));
      source.end(Buffer.from([0x9f]));
      await entered.promise;
      assert.deepEqual(chunks, ["�"]);
      let settled = false;
      void consumed.then(() => { settled = true; });
      await Promise.resolve();
      assert.equal(settled, false);
      release.resolve();
      await consumed;
    } finally {
      release.resolve();
      output.close();
      source.destroy();
      await consumed.catch(() => undefined);
    }
  });

  it("rejects disposal after EOF while the sink finish event is queued", async () => {
    const source = new PassThrough();
    let stopCount = 0;
    const output = createAwaitedDecodedOutput(source, () => { stopCount += 1; });
    const firstChunk = createDeferredCore();
    const consumed = output.consume(async () => {
      await Promise.resolve();
      firstChunk.resolve();
    });
    try {
      source.write("accepted");
      await firstChunk.promise;
      source.end();
      await finished(source);
      await Promise.resolve();
      output.close();
      await assert.rejects(consumed, /stdout consumption closed/);
      assert.equal(stopCount, 0);
    } finally {
      output.close();
      source.destroy();
      await consumed.catch(() => undefined);
    }
  });

  it("retains accepted work after disposal and never delivers queued chunks", async () => {
    const source = new PassThrough();
    let stopCount = 0;
    const output = createAwaitedDecodedOutput(source, () => { stopCount += 1; });
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const chunks: string[] = [];
    const consumed = output.consume(async (chunk) => {
      chunks.push(chunk);
      entered.resolve();
      await release.promise;
    });
    try {
      source.write("accepted");
      await entered.promise;
      source.write("queued");
      output.close();
      let settled = false;
      void consumed.then(() => { settled = true; }, () => { settled = true; });
      await Promise.resolve();
      assert.equal(settled, false);
      release.resolve();
      await assert.rejects(consumed, /stdout consumption closed/);
      assert.deepEqual(chunks, ["accepted"]);
      assert.equal(stopCount, 0);
    } finally {
      release.resolve();
      output.close();
      source.destroy();
      await consumed.catch(() => undefined);
    }
  });

  it("preserves original raw bytes before split UTF-8 and rejects duplicate ownership", async () => {
    const source = new PassThrough();
    const output = createAwaitedDecodedOutput(source, () => {});
    const events: string[] = [];
    const raw: Buffer[] = [];
    const consumed = output.consume((text) => { events.push(text); }, (chunk) => {
      raw.push(chunk);
      events.push(`raw:${chunk.toString("hex")}`);
    });
    await assert.rejects(output.consume(() => {}), /already owned or closed/);
    source.write(Buffer.from([0xf0, 0x9f]));
    source.end(Buffer.from([0x99, 0x82]));
    await consumed;
    assert.equal(Buffer.concat(raw).toString("hex"), "f09f9982");
    assert.deepEqual(events, ["raw:f09f", "raw:9982", "🙂"]);
    output.close();
  });

  it("retains source failure and a later accepted consumer rejection", async () => {
    const source = new PassThrough();
    const sourceFailure = new Error("source failed");
    const consumerFailure = new Error("accepted work failed");
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const stopped = createDeferredCore();
    const output = createAwaitedDecodedOutput(source, () => stopped.resolve());
    const consumed = output.consume(async () => {
      entered.resolve();
      await release.promise;
      throw consumerFailure;
    });
    source.write("accepted");
    await entered.promise;
    source.destroy(sourceFailure);
    await stopped.promise;
    release.resolve();
    await assert.rejects(consumed, (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [sourceFailure, consumerFailure]);
      return true;
    });
    output.close();
  });

  it("retains consumption and stop failures without an unhandled rejection", async () => {
    const source = new PassThrough();
    const failure = new Error("consumer failed");
    const stopFailure = new Error("stop failed");
    const output = createAwaitedDecodedOutput(source, () => { throw stopFailure; });
    const consumed = output.consume(async () => { throw failure; });
    source.end("input");
    await assert.rejects(consumed, (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failure, stopFailure]);
      return true;
    });
    output.close();
    source.destroy();
  });

  it("joins independent native/output failures without duplicating the same rejection", async () => {
    const nativeFailure = new Error("native failed");
    const outputFailure = new Error("output failed");
    await assert.rejects(joinProcessCompletionAndOutput(Promise.reject(nativeFailure), Promise.reject(outputFailure)), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [nativeFailure, outputFailure]);
      return true;
    });
    await assert.rejects(joinProcessCompletionAndOutput(Promise.reject(outputFailure), Promise.reject(outputFailure)),
      (error) => error === outputFailure);
  });
});
