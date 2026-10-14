// Imported from OpenClaw (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// Upstream path: src/utils/utf8-truncate.ts
// LiOS (GM-10a): unchanged except import specifiers (extensionless, flattened into server/exec).
import { Buffer } from "node:buffer";

function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

function truncateEncodedPrefix(bytes: Buffer, maxBytes: number): string {
  let end = maxBytes;
  while (end > 0 && isContinuationByte(bytes[end])) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

/** Keeps the longest UTF-8 prefix that fits within the byte limit. */
export function truncateUtf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  if (value.length <= maxBytes && Buffer.byteLength(value) <= maxBytes) {
    return value;
  }
  // Only this many UTF-16 units can contribute to the retained UTF-8 prefix.
  return truncateEncodedPrefix(Buffer.from(value.slice(0, maxBytes)), maxBytes);
}

/** Keeps the longest UTF-8 suffix that fits within the byte limit. */
export function truncateUtf8Suffix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  if (value.length <= maxBytes && Buffer.byteLength(value) <= maxBytes) {
    return value;
  }
  // Extra UTF-16 unit shields split surrogates; fractional limits need the original byte length.
  const bytes = Buffer.from(Number.isInteger(maxBytes) ? value.slice(-maxBytes - 1) : value);
  let start = bytes.byteLength - maxBytes;
  while (start < bytes.byteLength && isContinuationByte(bytes[start])) {
    start += 1;
  }
  return bytes.subarray(start).toString("utf8");
}
