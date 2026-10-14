import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RunExit } from "../types";

const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 64;
const TAR_BLOCK = 512;
const TAR_PATH_BYTES = 100;

export type WorkspaceTransferMode = "ingress-only" | "write-return";

export interface ExecutionWorkspaceTransferRequest {
  root: string;
  inputs: string[];
  outputs?: string[];
  mode: WorkspaceTransferMode;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface WorkspaceFileFact {
  path: string;
  size: number;
  sha256: string;
}

export interface PreparedWorkspaceTransfer {
  readonly stdinBase64: string;
  readonly archiveBytes: number;
  readonly facts: {
    mode: WorkspaceTransferMode;
    inputs: readonly WorkspaceFileFact[];
    outputs: readonly string[];
  };
  /** Return a private, bounded stream collector for this execution. */
  createOutputStream(token: string, maxCapturedOutputChars: number): WorkspaceOutputStream;
  /** Shell statements that emit only declared, verified regular files. */
  outputScript(): string;
}

export interface WorkspaceReturnedFile extends WorkspaceFileFact {
  data: Buffer;
}

export interface WorkspaceOutputStream {
  onStdout(chunk: Buffer): void;
  onStderr(chunk: Buffer): void;
  acceptExit(exit: RunExit): RunExit;
  collectOutputs(): WorkspaceReturnedFile[];
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizeRelativePath(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes(":") ||
    /[\r\n]/.test(value) ||
    path.posix.isAbsolute(value)
  ) {
    throw new Error("Workspace transfer paths must be relative POSIX paths.");
  }
  // Do not normalize away a caller's traversal spelling before authorization.
  // Both GM-11 workspace transfers and P13 brokered reads use this contract.
  if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Workspace transfer paths cannot contain empty or dot segments.");
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("./") ||
    normalized.includes("/../") ||
    Buffer.byteLength(normalized, "utf8") > TAR_PATH_BYTES
  ) {
    throw new Error("Workspace transfer path escapes or exceeds the bounded path format.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Workspace transfer path contains an invalid segment.");
  }
  return normalized;
}

function dedupePaths(values: readonly string[], label: string): string[] {
  if (values.length > MAX_FILES) {
    throw new Error(`Workspace transfer ${label} exceeds ${MAX_FILES} files.`);
  }
  const normalized = values.map(normalizeRelativePath);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Workspace transfer ${label} contains duplicate paths.`);
  }
  return normalized;
}

function canonicalRoot(root: string): string {
  const resolved = fs.realpathSync.native(path.resolve(root));
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error("Workspace transfer root must be a directory.");
  }
  return resolved;
}

function ensureNoSymlinkComponents(root: string, relativePath: string): string {
  let current = root;
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Workspace transfer rejects symbolic links: ${relativePath}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Workspace transfer parent is not a directory: ${relativePath}`);
    }
  }
  return current;
}

function assertRealpathInside(root: string, filename: string, relativePath: string): void {
  const real = fs.realpathSync.native(filename);
  const relative = path.relative(root, real);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Workspace transfer path escaped its root: ${relativePath}`);
  }
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function readStableRegularFile(
  filename: string,
  maxFileBytes: number,
): { data: Buffer; stat: fs.Stats } {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error("Workspace transfer permits regular files only.");
  }
  if (before.size > maxFileBytes) {
    throw new Error(`Workspace transfer file exceeds ${maxFileBytes} bytes.`);
  }
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameIdentity(before, opened)) {
      throw new Error("Workspace transfer file changed during admission.");
    }
    const data = fs.readFileSync(fd);
    const afterFd = fs.fstatSync(fd);
    const afterPath = fs.lstatSync(filename);
    if (
      data.length !== opened.size ||
      !sameIdentity(opened, afterFd) ||
      !sameIdentity(opened, afterPath)
    ) {
      throw new Error("Workspace transfer file changed while being read.");
    }
    return { data, stat: opened };
  } finally {
    fs.closeSync(fd);
  }
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0") + "\0";
  buffer.write(text, offset, length, "ascii");
}

function tarHeader(relativePath: string, size: number): Buffer {
  const name = Buffer.from(relativePath, "utf8");
  if (name.length > TAR_PATH_BYTES) throw new Error("Workspace tar path is too long.");
  const header = Buffer.alloc(TAR_BLOCK);
  name.copy(header, 0);
  writeOctal(header, 100, 8, 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, value) => sum + value, 0);
  const checksumText = checksum.toString(8).padStart(6, "0") + "\0 ";
  header.write(checksumText, 148, 8, "ascii");
  return header;
}

function buildTar(entries: readonly { path: string; data: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    blocks.push(tarHeader(entry.path, entry.data.length), entry.data);
    const remainder = entry.data.length % TAR_BLOCK;
    if (remainder !== 0) blocks.push(Buffer.alloc(TAR_BLOCK - remainder));
  }
  blocks.push(Buffer.alloc(TAR_BLOCK * 2));
  return Buffer.concat(blocks);
}

function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function assertBound(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!positiveSafeInteger(selected) || selected > 64 * 1024 * 1024) {
    throw new Error(`${label} must be a positive safe integer no larger than 64 MiB.`);
  }
  return selected;
}

function quoteShell(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function boundedOutputStream(
  token: string,
  outputs: readonly string[],
  maxFileBytes: number,
  maxTotalBytes: number,
  maxCapturedOutputChars: number,
): WorkspaceOutputStream {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Workspace return token is invalid.");
  const begin = `\nLIOS-OUTPUT-${token}-BEGIN\n`;
  const done = `\nLIOS-OUTPUT-${token}-DONE\n`;
  const maxEncodedBytes = Math.ceil(maxTotalBytes / 3) * 4;
  const maxFrameBytes = maxEncodedBytes + Math.ceil(maxEncodedBytes / 48) * 2 +
    outputs.length * 256 + done.length + begin.length;
  const retainedLimit = maxFrameBytes + maxCapturedOutputChars * 4;
  const chunks: Buffer[] = [];
  let retainedBytes = 0;
  let stdoutDropped = false;
  let stderr = "";
  let stderrTruncated = false;
  let accepted = false;
  let successful = false;
  let frame = "";

  return {
    onStdout(chunk) {
      if (chunk.length === 0) return;
      chunks.push(chunk);
      retainedBytes += chunk.length;
      while (retainedBytes > retainedLimit) {
        const first = chunks[0]!;
        const excess = retainedBytes - retainedLimit;
        if (first.length <= excess) {
          chunks.shift();
          retainedBytes -= first.length;
        } else {
          chunks[0] = first.subarray(excess);
          retainedBytes -= excess;
        }
        stdoutDropped = true;
      }
    },
    onStderr(chunk) {
      const next = stderr + chunk.toString("utf8");
      if (next.length > maxCapturedOutputChars) {
        stderr = next.slice(-maxCapturedOutputChars);
        stderrTruncated = true;
      } else {
        stderr = next;
      }
    },
    acceptExit(exit) {
      if (accepted) throw new Error("Workspace output stream was already consumed.");
      accepted = true;
      const raw = Buffer.concat(chunks, retainedBytes).toString("utf8");
      const beginAt = raw.lastIndexOf(begin);
      const diagnostic = beginAt < 0 ? raw : raw.slice(0, beginAt);
      const stdoutTruncated = stdoutDropped || diagnostic.length > maxCapturedOutputChars;
      successful = exit.reason === "exit" && exit.exitCode === 0 && !exit.stdoutTruncated;
      if (successful && beginAt >= 0) frame = raw.slice(beginAt + begin.length);
      return {
        ...exit,
        stdout: diagnostic.slice(-maxCapturedOutputChars),
        stderr,
        stdoutTruncated,
        stderrTruncated: stderrTruncated || exit.stderrTruncated,
      };
    },
    collectOutputs() {
      if (!accepted || !successful) return [];
      if (!frame.endsWith(done)) throw new Error("Workspace output return was incomplete.");
      let remaining = frame.slice(0, -done.length);
      let total = 0;
      const returned: WorkspaceReturnedFile[] = [];
      for (let index = 0; index < outputs.length; index += 1) {
        const header = `LIOS-OUTPUT-${token}-FILE-${index}\n`;
        if (!remaining.startsWith(header)) throw new Error("Workspace output return frame is invalid.");
        remaining = remaining.slice(header.length);
        const boundary = `\nLIOS-OUTPUT-${token}-FILE-${index + 1}\n`;
        const next = index + 1 === outputs.length ? remaining.length : remaining.indexOf(boundary);
        if (next < 0) throw new Error("Workspace output return frame is incomplete.");
        const encoded = remaining.slice(0, next).replace(/\s/g, "");
        if (
          encoded.length > Math.ceil(maxFileBytes / 3) * 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
        ) {
          throw new Error("Workspace output return contains invalid or oversized data.");
        }
        const data = Buffer.from(encoded, "base64");
        if (data.length > maxFileBytes || data.toString("base64") !== encoded) {
          throw new Error("Workspace output return contains invalid or oversized data.");
        }
        total += data.length;
        if (total > maxTotalBytes) throw new Error("Workspace returned outputs exceed the declared byte limit.");
        returned.push(Object.freeze({ path: outputs[index]!, size: data.length, sha256: sha256(data), data }));
        remaining = index + 1 === outputs.length ? "" : remaining.slice(next + 1);
      }
      if (remaining) throw new Error("Workspace output return contains undeclared data.");
      return returned;
    },
  };
}

/** P13 may reuse the GM-11 stable regular-file identity and containment checks.
 * Canonical permission and Project grants are enforced by its calling owner.
 */
export function readWorkspaceRegularFile(input: {
  root: string;
  relativePath: string;
  maxFileBytes?: number;
}): WorkspaceReturnedFile {
  const root = canonicalRoot(input.root);
  const relativePath = normalizeRelativePath(input.relativePath);
  const maxFileBytes = assertBound(input.maxFileBytes, DEFAULT_MAX_FILE_BYTES, "maxFileBytes");
  const source = ensureNoSymlinkComponents(root, relativePath);
  assertRealpathInside(root, source, relativePath);
  const { data } = readStableRegularFile(source, maxFileBytes);
  ensureNoSymlinkComponents(root, relativePath);
  assertRealpathInside(root, source, relativePath);
  return Object.freeze({ path: relativePath, size: data.length, sha256: sha256(data), data });
}

/**
 * Host-owner validation only; does not write to the Project or guarantee
 * safe later persistence. The eventual canonical owner must revalidate the
 * destination using its own atomic, handle-backed write authority.
 *
 * Reuses the same strict relative path parser and no-symlink checks as
 * GM-11 workspace ingress, and permits only new regular-file names.
 */
export function validateWorkspaceWriteReturnDestination(input: {
  root: string;
  relativePath: string;
}): string {
  const root = canonicalRoot(input.root);
  // Unlike a normalized read path, a declared return path must never
  // contain dot segments or ambiguous empty components even if they
  // would normalize to an otherwise allowed output name.
  if (input.relativePath.split("/").some(segment =>
    !segment || segment === "." || segment === ".."
  )) {
    throw new Error("Workspace write-return rejects ambiguous traversal segments.");
  }
  const relativePath = normalizeRelativePath(input.relativePath);
  const parts = relativePath.split("/");
  let candidate = root;
  for (let i = 0; i < parts.length; i += 1) {
    candidate = path.join(candidate, parts[i]!);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && i === parts.length - 1) {
        const parent = fs.realpathSync.native(path.dirname(candidate));
        const relativeParent = path.relative(root, parent);
        if (relativeParent === ".." || relativeParent.startsWith(".." + path.sep) ||
            path.isAbsolute(relativeParent)) {
          throw new Error("Workspace write-return parent escaped its root.");
        }
        return relativePath;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("Workspace write-return rejects symbolic links.");
    if (i === parts.length - 1) {
      throw new Error("Workspace write-return cannot overwrite an existing destination.");
    }
    if (!stat.isDirectory()) throw new Error("Workspace write-return parent is not a directory.");
  }
  throw new Error("Workspace write-return destination is invalid.");
}

export function prepareWorkspaceTransfer(
  request: ExecutionWorkspaceTransferRequest,
): PreparedWorkspaceTransfer {
  const root = canonicalRoot(request.root);
  const maxFileBytes = assertBound(request.maxFileBytes, DEFAULT_MAX_FILE_BYTES, "maxFileBytes");
  const maxTotalBytes = assertBound(request.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, "maxTotalBytes");
  if (maxFileBytes > maxTotalBytes) {
    throw new Error("Workspace transfer maxFileBytes cannot exceed maxTotalBytes.");
  }

  const inputs = dedupePaths(request.inputs, "inputs");
  const outputs = dedupePaths(request.outputs ?? [], "outputs");
  if (request.mode === "ingress-only" && outputs.length > 0) {
    throw new Error("Ingress-only workspace transfer cannot declare returned outputs.");
  }

  let totalBytes = 0;
  const entries: Array<{ path: string; data: Buffer }> = [];
  const inputFacts: WorkspaceFileFact[] = [];
  for (const relativePath of inputs) {
    const source = ensureNoSymlinkComponents(root, relativePath);
    assertRealpathInside(root, source, relativePath);
    const { data } = readStableRegularFile(source, maxFileBytes);
    ensureNoSymlinkComponents(root, relativePath);
    assertRealpathInside(root, source, relativePath);
    totalBytes += data.length;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Workspace transfer inputs exceed ${maxTotalBytes} bytes.`);
    }
    entries.push({ path: relativePath, data });
    inputFacts.push(Object.freeze({
      path: relativePath,
      size: data.length,
      sha256: sha256(data),
    }));
  }

  const archive = buildTar(entries);
  const facts = Object.freeze({
    mode: request.mode,
    inputs: Object.freeze([...inputFacts]),
    outputs: Object.freeze([...outputs]),
  });

  return {
    stdinBase64: archive.toString("base64"),
    archiveBytes: archive.length,
    facts,
    createOutputStream(token, maxCapturedOutputChars) {
      return boundedOutputStream(token, outputs, maxFileBytes, maxTotalBytes, maxCapturedOutputChars);
    },
    outputScript() {
      const statements: string[] = ['printf "\\nLIOS-OUTPUT-%s-BEGIN\\n" "$token"'];
      for (let index = 0; index < outputs.length; index += 1) {
        const relativePath = outputs[index]!;
        const segments = relativePath.split("/");
        for (let length = 1; length <= segments.length; length += 1) {
          statements.push(`if [ -L ${quoteShell(segments.slice(0, length).join("/"))} ]; then exit 82; fi`);
        }
        statements.push(
          `if [ ! -f ${quoteShell(relativePath)} ]; then exit 82; fi`,
          `printf "LIOS-OUTPUT-%s-FILE-${index}\\n" "$token"`,
          `"$base64_path" < ${quoteShell(relativePath)}`,
          'printf "\\n"',
        );
      }
      statements.push('printf "\\nLIOS-OUTPUT-%s-DONE\\n" "$token"');
      return statements.join("; ");
    },
  };
}
