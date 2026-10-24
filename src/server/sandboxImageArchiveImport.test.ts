import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import test, { type TestContext } from "node:test";
import { streamSandboxImageArchive } from "./sandboxImageArchiveImport";

function fixture(t: TestContext, content: Buffer): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-engine-load-pipe-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, "image.tar.gz");
  fs.writeFileSync(archive, gzipSync(content));
  return archive;
}

test("offline image import drains multi-megabyte engine stdout before its stdin load", { timeout: 12_000 }, async t => {
  const input = Buffer.from("pinned-image-content");
  const archive = fixture(t, input);
  // The child writes synchronously into stdout BEFORE reading stdin.
  // Without draining stdout its pipe fills and neither side progresses.
  const script = `
    const fs = require("node:fs");
    fs.writeSync(1, Buffer.alloc(1024 * 1024, 88));
    let size = 0;
    process.stdin.on("data", chunk => { size += chunk.length; });
    process.stdin.on("end", () => process.exit(size === ${input.length} ? 0 : 9));
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  await streamSandboxImageArchive(archive, child, 9_000);
  assert.equal(child.exitCode, 0);
  assert.equal(child.stdout.readableLength, 0, "untrusted engine output is never retained");
});

test("malformed packaged gzip input fails closed and child is extinct before returning", { timeout: 12_000 }, async t => {
  const archive = fixture(t, Buffer.from("valid"));
  fs.writeFileSync(archive, "this-is-not-a-gzip");
  const script = 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  await assert.rejects(streamSandboxImageArchive(archive, child, 9_000));
  assert.ok(child.exitCode !== null || child.signalCode !== null,
    "engine process must be joined before repair reports failure");
});

test("child exit failure cannot be recorded as a successful image import", { timeout: 12_000 }, async t => {
  const archive = fixture(t, Buffer.from("valid"));
  const script = 'process.stdin.resume(); process.stdin.on("end", () => { process.stderr.write("load denied"); process.exit(23); });';
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  await assert.rejects(streamSandboxImageArchive(archive, child, 9_000), /load denied|load failed/);
  assert.equal(child.exitCode, 23);
});
