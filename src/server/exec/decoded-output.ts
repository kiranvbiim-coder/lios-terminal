// Adapted from OpenClaw src/process/decoded-output.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS: local UTF-8 StringDecoder replaces infra/windows-encoding (legacy Windows code pages are unsupported);
// awaited delivery retains raw-before-decoded observers, joins accepted work and preserves concurrent failures.
import { Writable, type Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { toErrorObject } from "./coerce";
import { createDeferredCore } from "./deferred";

type OutputDecoder = { decode: (chunk: Buffer | string) => string; flush: () => string };

/** UTF-8 decoder that carries split multi-byte sequences across chunks. */
function createOutputDecoder(): OutputDecoder {
  const decoder = new StringDecoder("utf8");
  return {
    decode: (chunk: Buffer | string) => (typeof chunk === "string" ? chunk : decoder.write(chunk)),
    flush: () => decoder.end(),
  };
}

export function onDecodedOutput(
  stream: Readable,
  listener: (chunk: string) => void,
  onRaw?: (chunk: Buffer) => void,
): () => void {
  const decoder = createOutputDecoder();
  let detached = false;
  const emit = (text: string) => {
    if (text && !detached) {
      listener(text);
    }
  };
  let flushed = false;
  const flush = () => {
    if (flushed) {
      return;
    }
    flushed = true;
    emit(decoder.flush());
  };
  const onData = (chunk: Buffer | string) => {
    if (detached) {
      return;
    }
    onRaw?.(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    emit(decoder.decode(chunk));
  };
  stream.on("data", onData);
  stream.once("end", flush);
  stream.once("close", flush);
  return () => {
    // A queued close may still invoke its copied listener, so suppress flush before detaching.
    flushed = true;
    detached = true;
    stream.off("data", onData);
    stream.off("end", flush);
    stream.off("close", flush);
  };
}

/** One opted-in consumer holds native pipe backpressure until each decoded chunk settles. */
export function createAwaitedDecodedOutput(stream: Readable, onFailure: (error: unknown) => void) {
  type Consumer = { listener: (chunk: string) => void | Promise<void>; onRaw?: (chunk: Buffer) => void };
  const subscription = createDeferredCore<Consumer | undefined>();
  let subscribed = false;
  let closed = false;
  let decoder: OutputDecoder | undefined;
  let inFlight = Promise.resolve();
  const deliver = (read: (consumer: Consumer) => string, callback: (error?: Error | null) => void) => {
    inFlight = (async () => {
      const consumer = await subscription.promise;
      if (closed || !consumer) {
        return;
      }
      const text = read(consumer);
      if (text && !closed) {
        await consumer.listener(text);
      }
    })().catch((error: unknown) => {
      throw toErrorObject(error, "Process stdout consumption failed");
    });
    void inFlight.then(() => callback(), (error: Error) => callback(error));
  };
  const sink = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      deliver((consumer) => {
        consumer.onRaw?.(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        return closed ? "" : (decoder ??= createOutputDecoder()).decode(chunk);
      }, callback);
    },
    final(callback) {
      deliver(() => decoder?.flush() ?? "", callback);
    },
  });
  const onSourceError = (error: Error) => sink.destroy(error);
  const onSourceClose = () => {
    if (stream.readableEnded) {
      sink.end();
    } else {
      sink.destroy(new Error("Process stdout closed before EOF"));
    }
  };
  stream.once("error", onSourceError);
  stream.once("close", onSourceClose);
  const done = (async () => {
    let failure: { error: unknown } | undefined;
    try {
      // A queued finish can precede destroy's error event; retain its listener through close.
      await finished(sink);
      if (sink.errored) {
        throw sink.errored;
      }
    } catch (error) {
      failure = { error };
      if (!closed) {
        closed = true;
        try {
          onFailure(error);
        } catch (stopError) {
          failure.error = new AggregateError([error, stopError], "Process stdout consumption and stop failed", { cause: stopError });
        } finally {
          // Stop owns the failure; discard unread bytes instead of buffering behind a failed consumer.
          stream.unpipe(sink);
          stream.resume();
        }
      }
    } finally {
      stream.unpipe(sink);
      subscription.resolve(undefined);
      // Destroy may settle the sink before its accepted consumer has returned.
      try {
        await inFlight;
      } catch (error) {
        if (!failure) {
          failure = { error };
        } else if (failure.error !== error && !(failure.error instanceof AggregateError && failure.error.errors.includes(error))) {
          failure.error = new AggregateError([failure.error, error], "Process stdout and accepted consumption failed");
        }
      }
      stream.off("error", onSourceError);
      stream.off("close", onSourceClose);
    }
    if (failure) {
      throw failure.error;
    }
  })();
  void done.catch(() => undefined);
  // Node resumes child pipes on exit, so own writes before the caller subscribes.
  stream.pipe(sink);
  if (stream.errored) {
    sink.destroy(stream.errored);
  } else if (stream.destroyed) {
    onSourceClose();
  }
  const consume = (listener: Consumer["listener"], onRaw?: Consumer["onRaw"]): Promise<void> => {
    if (closed || subscribed) {
      return Promise.reject(new Error("Process stdout consumption is already owned or closed"));
    }
    subscribed = true;
    subscription.resolve({ listener, onRaw });
    return done;
  };
  return {
    consume,
    drain: () => (subscribed || closed ? done : consume(() => {})),
    close: () => {
      closed = true;
      subscription.resolve(undefined);
      if (!sink.writableFinished) {
        stream.unpipe(sink);
        sink.destroy(new Error("Process stdout consumption closed"));
      }
    },
  };
}

/** Output failure requests stop separately; both completion paths settle before returning. */
export async function joinProcessCompletionAndOutput<T>(completion: Promise<T>, output: Promise<void>): Promise<T> {
  const [outcome, consumed] = await Promise.allSettled([completion, output]);
  if (outcome.status === "rejected") {
    if (consumed.status === "rejected" && consumed.reason instanceof AggregateError && consumed.reason.errors.includes(outcome.reason)) {
      throw consumed.reason;
    }
    if (consumed.status === "rejected" && outcome.reason instanceof AggregateError && outcome.reason.errors.includes(consumed.reason)) {
      throw outcome.reason;
    }
    if (consumed.status === "rejected" && outcome.reason !== consumed.reason) {
      throw new AggregateError([outcome.reason, consumed.reason], "Process and stdout consumption failed");
    }
    throw outcome.reason;
  }
  if (consumed.status === "rejected") {
    throw consumed.reason;
  }
  return outcome.value;
}

