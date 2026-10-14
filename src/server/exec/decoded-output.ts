// Adapted from OpenClaw src/process/decoded-output.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a) modifications: local UTF-8 StringDecoder replaces infra/windows-encoding (legacy Windows
// code pages are not supported); omitted the awaited-consumer branch, which has no child-mode caller.
import { type Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/** UTF-8 decoder that carries split multi-byte sequences across chunks. */
function createOutputDecoder() {
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

