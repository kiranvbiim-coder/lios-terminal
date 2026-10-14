import path from "node:path";

/**
 * Minimal POSIX tar (ustar + pax `path`/`size` records) for LiOS backup archives. Plain tar+gzip means a user can
 * always open an unencrypted backup with any `tar`; there is no LiOS-only container and no entry-count or
 * size ceiling (unlike classic ZIP). Only regular files are written or accepted.
 */

const BLOCK = 512;
const MAX_OCTAL_SIZE = 0o77777777777; // 8 GiB - 1

function octal(value: number, width: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(width - 1, "0")}\0`, "ascii");
}

function writeField(header: Buffer, offset: number, value: Buffer | string, width: number): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  bytes.copy(header, offset, 0, Math.min(bytes.length, width));
}

function ustarHeader(name: string, size: number, typeflag: string, mtimeSeconds: number): Buffer {
  const header = Buffer.alloc(BLOCK);
  writeField(header, 0, name, 100);
  writeField(header, 100, octal(0o600, 8), 8);
  writeField(header, 108, octal(0, 8), 8);
  writeField(header, 116, octal(0, 8), 8);
  writeField(header, 124, octal(Math.min(size, MAX_OCTAL_SIZE), 12), 12);
  writeField(header, 136, octal(mtimeSeconds, 12), 12);
  header.fill(0x20, 148, 156);
  header[156] = typeflag.charCodeAt(0);
  writeField(header, 257, "ustar\0", 6);
  writeField(header, 263, "00", 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeField(header, 148, Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `, "ascii"), 8);
  return header;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
  return Buffer.from(`${length}${body}`, "utf8");
}

export function padTo512(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

/** Header blocks (including a pax header when the name or size does not fit ustar) for one regular file. */
export function tarFileHeader(name: string, size: number, mtime: Date): Buffer {
  const mtimeSeconds = Math.floor(mtime.getTime() / 1000);
  const records: Buffer[] = [];
  if (Buffer.byteLength(name) > 100 || /[^\x20-\x7e]/.test(name)) records.push(paxRecord("path", name));
  if (size > MAX_OCTAL_SIZE) records.push(paxRecord("size", String(size)));
  const fallbackName = Buffer.byteLength(name) > 100 || /[^\x20-\x7e]/.test(name) ? `pax/${mtimeSeconds}` : name;
  const blocks: Buffer[] = [];
  if (records.length) {
    const pax = Buffer.concat(records);
    blocks.push(ustarHeader("PaxHeader", pax.length, "x", mtimeSeconds), pax, padTo512(pax.length));
  }
  blocks.push(ustarHeader(fallbackName, size, "0", mtimeSeconds));
  return Buffer.concat(blocks);
}

export const TAR_END = Buffer.alloc(BLOCK * 2);

export interface TarReaderHandlers {
  onEntry(name: string, size: number): void;
  onData(chunk: Buffer): void;
  onEntryEnd(): void;
}

export class TarFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarFormatError";
  }
}

/** Push parser. Accepts regular files only; any link, device or directory-with-data entry is a format error. */
export class TarReader {
  private pending = Buffer.alloc(0);
  private remaining = 0;
  private padding = 0;
  private pax: { path?: string; size?: number } = {};
  private paxBytes = 0;
  private paxBuffer: Buffer[] = [];
  private sawEnd = false;

  constructor(private readonly handlers: TarReaderHandlers) {}

  push(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    for (;;) {
      if (this.sawEnd) return;
      if (this.paxBytes > 0) {
        const take = Math.min(this.paxBytes, this.pending.length);
        if (!take) return;
        this.paxBuffer.push(this.pending.subarray(0, take));
        this.pending = this.pending.subarray(take);
        this.paxBytes -= take;
        if (this.paxBytes === 0) this.parsePax(Buffer.concat(this.paxBuffer));
        continue;
      }
      if (this.remaining > 0) {
        const take = Math.min(this.remaining, this.pending.length);
        if (!take) return;
        this.handlers.onData(this.pending.subarray(0, take));
        this.pending = this.pending.subarray(take);
        this.remaining -= take;
        if (this.remaining === 0) this.handlers.onEntryEnd();
        continue;
      }
      if (this.padding > 0) {
        const take = Math.min(this.padding, this.pending.length);
        if (!take) return;
        this.pending = this.pending.subarray(take);
        this.padding -= take;
        continue;
      }
      if (this.pending.length < BLOCK) return;
      const header = this.pending.subarray(0, BLOCK);
      this.pending = this.pending.subarray(BLOCK);
      if (header.every((byte) => byte === 0)) {
        this.sawEnd = true;
        return;
      }
      this.parseHeader(header);
    }
  }

  /** Throws unless the archive ended cleanly (two zero blocks, nothing mid-entry). */
  finish(): void {
    if (!this.sawEnd || this.remaining || this.paxBytes) throw new TarFormatError("Archive is truncated.");
  }

  private parsePax(body: Buffer): void {
    this.paxBuffer = [];
    this.padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
    let offset = 0;
    while (offset < body.length) {
      const space = body.indexOf(0x20, offset);
      const length = Number(body.subarray(offset, space).toString("ascii"));
      if (space < 0 || !Number.isInteger(length) || length < 4 || offset + length > body.length) throw new TarFormatError("Malformed pax header.");
      const record = body.subarray(space + 1, offset + length - 1).toString("utf8");
      const eq = record.indexOf("=");
      const key = record.slice(0, eq);
      const value = record.slice(eq + 1);
      if (key === "path") this.pax.path = value;
      if (key === "size") this.pax.size = Number(value);
      offset += length;
    }
  }

  private parseHeader(header: Buffer): void {
    const stored = parseInt(header.subarray(148, 156).toString("ascii").replace(/\0.*$/, "").trim(), 8);
    let sum = 0;
    for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
    if (stored !== sum) throw new TarFormatError("Archive header checksum mismatch.");
    const typeflag = String.fromCharCode(header[156] as number);
    const rawSize = parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    if (!Number.isSafeInteger(rawSize)) throw new TarFormatError("Archive entry size is invalid.");
    if (typeflag === "x") {
      this.paxBytes = rawSize;
      this.paxBuffer = [];
      if (rawSize === 0) throw new TarFormatError("Empty pax header.");
      return;
    }
    if (typeflag !== "0" && typeflag !== "\0") throw new TarFormatError(`Unsupported archive entry type "${typeflag}".`);
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const base = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const name = this.pax.path ?? (prefix ? `${prefix}/${base}` : base);
    const size = this.pax.size ?? rawSize;
    this.pax = {};
    this.handlers.onEntry(name, size);
    this.padding = (BLOCK - (size % BLOCK)) % BLOCK;
    this.remaining = size;
    if (size === 0) this.handlers.onEntryEnd();
  }
}

/**
 * Archive path rules shared by creation, verification and extraction.
 * Adapted from OpenClaw `src/infra/backup-archive-path-policy.ts` (`normalizeArchivePath`, MIT, commit
 * c074824a27c96d3983043f9eeb33823cd1772d8c): relative, forward-slash, no traversal segments.
 */
export function normalizeArchivePath(entryPath: string, label = "Archive path"): string {
  const filename = entryPath.replace(/\/+$/u, "");
  if (!filename) throw new TarFormatError(`${label} is empty.`);
  if (filename.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filename)) throw new TarFormatError(`${label} must be relative: ${entryPath}`);
  if (filename.includes("\\") || filename.includes("\0")) throw new TarFormatError(`${label} must use forward slashes: ${entryPath}`);
  if (filename.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new TarFormatError(`${label} contains path traversal segments: ${entryPath}`);
  }
  const normalized = path.posix.normalize(filename);
  if (normalized !== filename) throw new TarFormatError(`${label} is not normalized: ${entryPath}`);
  return normalized;
}
