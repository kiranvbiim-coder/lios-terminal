// Imported from OpenClaw src/process/bounded-line-framer.ts (MIT, Copyright (c) 2026 OpenClaw Foundation).
// Approved commit: c074824a27c96d3983043f9eeb33823cd1772d8c. Provenance header only.
/** Frames LF-delimited bytes without decoding or consuming an incomplete final line. */
export function createBoundedLineFramer(maxBytes: number, overflowMessage: string) {
  let chunks: Buffer[] = [];
  let byteLength = 0;
  const clear = () => {
    chunks = [];
    byteLength = 0;
  };
  return {
    get pendingByteLength() {
      return byteLength;
    },
    clear,
    *push(chunk: Buffer): Generator<Buffer> {
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline === -1 ? chunk.length : newline;
        byteLength += end - offset;
        if (byteLength > maxBytes) {
          throw new Error(overflowMessage);
        }
        chunks.push(chunk.subarray(offset, end));
        if (newline === -1) {
          break;
        }
        const line = Buffer.concat(chunks, byteLength);
        clear();
        offset = newline + 1;
        // A caller may retire after this frame; do not inspect later bytes until it resumes.
        yield line;
      }
    },
  };
}
