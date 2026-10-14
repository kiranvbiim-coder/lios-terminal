import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { redactSensitiveText } from "./error-format";

const MAX_FILES = 2048;
const MAX_INSPECT_FILES = 32;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_PATCH_FILES = 16;
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_DIFF_CHARS = 64 * 1024;
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache"]);

export type CodingCheckKind = "npm-check" | "npm-test" | "git-diff-check" | "node-test";

export interface CodingFileFact {
  path: string;
  size: number;
  sha256: string;
}

export interface CodingWorkspaceSnapshot {
  workspaceSha256: string;
  fileCount: number;
  files: CodingFileFact[];
}

export interface CodingPatchChange {
  path: string;
  beforeSha256: string;
  content: string;
}

export interface CodingPatchPreview {
  workspaceSha256: string;
  previewSha256: string;
  diff: string;
  files: Array<{ path: string; beforeSha256: string; afterSha256: string }>;
}

export interface CodingCheckResult {
  check: CodingCheckKind;
  targets: string[];
  commandDigest: string;
  outcome: "passed" | "failed";
  durationMs: number;
  stdout: string;
  stderr: string;
  outputSha256: string;
  workspaceSha256After: string;
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeRelativePath(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 500 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value)
  ) throw new Error("Coding workspace paths must be bounded relative POSIX paths.");
  const normalized = path.posix.normalize(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("./") ||
    normalized.includes("/../") ||
    /[\r\n]/u.test(normalized)
  ) throw new Error("Coding workspace path escapes its repository.");
  return normalized;
}

export async function resolveCodingWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const configured = env.LIOS_CODING_WORKSPACE_ROOT?.trim();
  if (!configured || !path.isAbsolute(configured) || configured.includes("\0")) {
    throw new Error("Governed coding workspace is not configured.");
  }
  const root = await fs.realpath(configured);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Governed coding workspace root is not a directory.");
  return root;
}

function insideRoot(root: string, filename: string): boolean {
  const relative = path.relative(root, filename);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

async function resolveRegularFile(root: string, relativePath: string): Promise<{ filename: string; stat: Awaited<ReturnType<typeof fs.stat>> }> {
  const clean = normalizeRelativePath(relativePath);
  let current = root;
  for (const segment of clean.split("/")) {
    current = path.join(current, segment);
    const lst = await fs.lstat(current);
    if (lst.isSymbolicLink()) throw new Error("Coding workspace refuses symbolic-link paths.");
  }
  const real = await fs.realpath(current);
  if (!insideRoot(root, real)) throw new Error("Coding workspace path escaped its repository.");
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error("Coding workspace operations require regular files.");
  return { filename: real, stat };
}

async function hashFile(filename: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filename);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function walk(root: string): Promise<CodingFileFact[]> {
  const files: CodingFileFact[] = [];
  const visit = async (directory: string, relative: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) throw new Error("Coding workspace exceeds the bounded file-count limit.");
      if (entry.isSymbolicLink()) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(child, childRelative);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(child);
      files.push({ path: childRelative, size: Number(stat.size), sha256: await hashFile(child) });
    }
  };
  await visit(root, "");
  return files;
}

function workspaceDigest(files: readonly CodingFileFact[]): string {
  return sha256(JSON.stringify({
    version: 1,
    files: files.map((file) => [file.path, file.size, file.sha256]),
  }));
}

export async function snapshotCodingWorkspace(env: NodeJS.ProcessEnv = process.env): Promise<CodingWorkspaceSnapshot> {
  const root = await resolveCodingWorkspaceRoot(env);
  const files = await walk(root);
  return { workspaceSha256: workspaceDigest(files), fileCount: files.length, files };
}

export async function inspectCodingWorkspace(
  requestedPaths: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodingWorkspaceSnapshot & { previews: Array<CodingFileFact & { text: string | null }> }> {
  if (requestedPaths.length > MAX_INSPECT_FILES) throw new Error("Coding inspection requested too many files.");
  const root = await resolveCodingWorkspaceRoot(env);
  const snapshot = await snapshotCodingWorkspace(env);
  const selected = requestedPaths.length ? requestedPaths.map(normalizeRelativePath) : snapshot.files.slice(0, MAX_INSPECT_FILES).map((file) => file.path);
  const previews: Array<CodingFileFact & { text: string | null }> = [];
  for (const relativePath of selected) {
    const { filename, stat } = await resolveRegularFile(root, relativePath);
    const digest = await hashFile(filename);
    let text: string | null = null;
    if (Number(stat.size) <= MAX_FILE_BYTES) {
      const bytes = await fs.readFile(filename);
      const candidate = bytes.toString("utf8");
      if (!candidate.includes("\u0000")) text = redactSensitiveText(candidate).slice(0, 20_000);
    }
    previews.push({ path: relativePath, size: Number(stat.size), sha256: digest, text });
  }
  return { ...snapshot, previews };
}

function diffFor(pathname: string, before: string, after: string): string {
  if (before === after) return `--- a/${pathname}\n+++ b/${pathname}\n(no changes)\n`;
  const left = before.split("\n");
  const right = after.split("\n");
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix += 1;
  const removed = left.slice(prefix, left.length - suffix);
  const added = right.slice(prefix, right.length - suffix);
  const lines = [
    `--- a/${pathname}`,
    `+++ b/${pathname}`,
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.slice(0, 80).map((line) => `-${redactSensitiveText(line).slice(0, 500)}`),
    ...added.slice(0, 80).map((line) => `+${redactSensitiveText(line).slice(0, 500)}`),
  ];
  if (removed.length > 80 || added.length > 80) lines.push("... diff truncated ...");
  return lines.join("\n") + "\n";
}

async function materializePatch(
  workspaceSha256: string,
  changes: readonly CodingPatchChange[],
  env: NodeJS.ProcessEnv,
): Promise<{ root: string; preview: CodingPatchPreview; originals: Array<{ path: string; filename: string; data: Buffer; mode: number }> }> {
  if (changes.length < 1 || changes.length > MAX_PATCH_FILES) throw new Error("Coding patch must change between 1 and 16 files.");
  const snapshot = await snapshotCodingWorkspace(env);
  if (snapshot.workspaceSha256 !== workspaceSha256) throw new Error("Coding workspace changed since inspection; inspect again before patching.");
  const root = await resolveCodingWorkspaceRoot(env);
  let total = 0;
  const seen = new Set<string>();
  const originals: Array<{ path: string; filename: string; data: Buffer; mode: number }> = [];
  const fileFacts: CodingPatchPreview["files"] = [];
  const diffParts: string[] = [];
  for (const raw of changes) {
    const relativePath = normalizeRelativePath(raw.path);
    if (seen.has(relativePath)) throw new Error("Coding patch contains duplicate files.");
    seen.add(relativePath);
    const contentBytes = Buffer.from(raw.content, "utf8");
    total += contentBytes.length;
    if (contentBytes.length > MAX_FILE_BYTES || total > MAX_PATCH_BYTES) throw new Error("Coding patch exceeds the bounded byte limit.");
    const resolved = await resolveRegularFile(root, relativePath);
    const data = await fs.readFile(resolved.filename);
    const beforeSha256 = sha256(data);
    if (beforeSha256 !== raw.beforeSha256) throw new Error("Coding patch target changed since inspection.");
    const afterSha256 = sha256(contentBytes);
    originals.push({ path: relativePath, filename: resolved.filename, data, mode: Number(resolved.stat.mode) & 0o777 });
    fileFacts.push({ path: relativePath, beforeSha256, afterSha256 });
    diffParts.push(diffFor(relativePath, data.toString("utf8"), raw.content));
  }
  const canonical = {
    version: 1,
    workspaceSha256,
    files: fileFacts.map((file) => [file.path, file.beforeSha256, file.afterSha256]),
  };
  return {
    root,
    originals,
    preview: {
      workspaceSha256,
      previewSha256: sha256(JSON.stringify(canonical)),
      diff: diffParts.join("\n").slice(0, MAX_DIFF_CHARS),
      files: fileFacts,
    },
  };
}

export async function previewCodingPatch(
  workspaceSha256: string,
  changes: readonly CodingPatchChange[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodingPatchPreview> {
  return (await materializePatch(workspaceSha256, changes, env)).preview;
}

async function atomicReplace(filename: string, data: Buffer, mode: number): Promise<void> {
  const directory = path.dirname(filename);
  const temp = path.join(directory, `.${path.basename(filename)}.lios-${crypto.randomUUID()}.tmp`);
  const handle = await fs.open(temp, "wx", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, filename);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function applyCodingPatch(
  workspaceSha256: string,
  previewSha256: string,
  changes: readonly CodingPatchChange[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodingPatchPreview & { workspaceSha256After: string }> {
  const prepared = await materializePatch(workspaceSha256, changes, env);
  if (prepared.preview.previewSha256 !== previewSha256) throw new Error("Coding patch preview digest does not match the approved patch.");
  const applied: typeof prepared.originals = [];
  try {
    for (let index = 0; index < prepared.originals.length; index += 1) {
      const original = prepared.originals[index]!;
      const current = await fs.readFile(original.filename);
      const expected = prepared.preview.files[index]!.beforeSha256;
      if (sha256(current) !== expected) throw new Error("Coding patch target drifted immediately before write.");
      await atomicReplace(original.filename, Buffer.from(changes[index]!.content, "utf8"), original.mode);
      applied.push(original);
    }
  } catch (error) {
    for (const original of applied.reverse()) {
      await atomicReplace(original.filename, original.data, original.mode).catch(() => undefined);
    }
    throw error;
  }
  const after = await snapshotCodingWorkspace(env);
  return { ...prepared.preview, workspaceSha256After: after.workspaceSha256 };
}

export function codingCheckArgv(check: CodingCheckKind, targets: readonly string[]): string[] {
  if (check === "npm-check") return [process.platform === "win32" ? "npm.cmd" : "npm", "run", "check"];
  if (check === "npm-test") return [process.platform === "win32" ? "npm.cmd" : "npm", "test"];
  if (check === "git-diff-check") return ["git", "diff", "--check"];
  if (targets.length < 1 || targets.length > 10) throw new Error("node-test requires between 1 and 10 test files.");
  return [process.execPath, "--test", ...targets.map(normalizeRelativePath)];
}

export async function codingWorkspaceConfigured(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    await resolveCodingWorkspaceRoot(env);
    return true;
  } catch {
    return false;
  }
}
