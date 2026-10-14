// Written for LiOS, GM-10a. The donor's src/process/kill-tree.test.ts mocks node:fs and
// node:child_process with vitest module mocks to script /proc and taskkill; those cases
// are not ported. These tests exercise the verbatim donor module against real processes.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";
import { killProcessTree, signalProcessTree } from "./kill-tree";

const posixOnly = { skip: process.platform === "win32" };
const TEST_TIMEOUT = 20_000;

const GRANDCHILD_SOURCE = "setInterval(() => {}, 1 << 30)";
const TREE_SOURCE = `
const { spawn } = require("node:child_process");
const gc = spawn(process.execPath, ["-e", ${JSON.stringify(GRANDCHILD_SOURCE)}], { stdio: ["ignore", "inherit", "inherit"] });
console.log("tree " + process.pid + " " + gc.pid);
setInterval(() => {}, 1 << 30);
`;
const TRAP_SOURCE = `
process.on("SIGTERM", () => console.log("got-term"));
console.log("ready " + process.pid);
setInterval(() => {}, 1 << 30);
`;

const spawned: ChildProcess[] = [];

function start(source: string, detached: boolean): ChildProcess {
  const child = spawn(process.execPath, ["-e", source], {
    detached,
    stdio: ["ignore", "pipe", "inherit"],
  });
  spawned.push(child);
  return child;
}

/** Resolves with the first stdout line starting with `prefix`. */
async function lineWithPrefix(child: ChildProcess, prefix: string): Promise<string[]> {
  const lines = createInterface({ input: child.stdout as NodeJS.ReadableStream });
  for await (const line of lines) {
    if (line.startsWith(prefix)) {
      lines.close();
      return line.split(" ");
    }
  }
  throw new Error(`child ended before printing "${prefix}"`);
}

function isGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * A non-child process has no exit event, and a just-killed process can linger as a
 * zombie until init reaps it; poll the kernel's answer (ESRCH) until it flips.
 */
async function waitUntilGone(pid: number): Promise<void> {
  while (!isGone(pid)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    await once(child, "exit");
  }
}

process.on("exit", () => {
  for (const child of spawned) {
    child.kill("SIGKILL");
  }
});

describe("killProcessTree (real processes)", () => {
  it("rejects invalid pids without throwing", () => {
    assert.equal(killProcessTree(0), undefined);
    assert.equal(killProcessTree(-5), undefined);
    assert.equal(killProcessTree(Number.NaN), undefined);
    signalProcessTree(0, "SIGTERM");
  });

  it("signalProcessTree reports completion even for invalid pids", () => {
    let completed = 0;
    signalProcessTree(-1, "SIGKILL", { onComplete: () => (completed += 1) });
    assert.equal(completed, 1);
  });

  it("kills a detached process and its grandchild", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const parent = start(TREE_SOURCE, true);
    const [, parentPid, grandchildPid] = await lineWithPrefix(parent, "tree ");
    const pid = Number(parentPid);
    const gpid = Number(grandchildPid);
    assert.equal(pid, parent.pid);
    assert.equal(isGone(pid), false);
    assert.equal(isGone(gpid), false);

    killProcessTree(pid, { detached: true, graceMs: 5_000 });

    await exited(parent);
    await waitUntilGone(gpid);
    await waitUntilGone(pid);
    assert.equal(parent.signalCode, "SIGTERM");
  });

  it("detects a group leader without the detached option", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const parent = start(TREE_SOURCE, true);
    const [, parentPid, grandchildPid] = await lineWithPrefix(parent, "tree ");
    killProcessTree(Number(parentPid), { graceMs: 5_000 });
    await exited(parent);
    await waitUntilGone(Number(grandchildPid));
  });

  it("force option sends SIGKILL to the whole tree at once", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const parent = start(TREE_SOURCE, true);
    const [, parentPid, grandchildPid] = await lineWithPrefix(parent, "tree ");
    assert.equal(killProcessTree(Number(parentPid), { detached: true, force: true }), undefined);
    await exited(parent);
    await waitUntilGone(Number(grandchildPid));
    assert.equal(parent.signalCode, "SIGKILL");
  });

  it("escalates to SIGKILL for a process that traps SIGTERM (explicit force)", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const child = start(TRAP_SOURCE, true);
    const [, pid] = await lineWithPrefix(child, "ready ");
    const handle = killProcessTree(Number(pid), { detached: true, graceMs: 60_000 });
    assert.ok(handle);
    await lineWithPrefix(child, "got-term");
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    assert.equal(isGone(Number(pid)), false);
    handle.force();
    await exited(child);
    assert.equal(child.signalCode, "SIGKILL");
    await waitUntilGone(Number(pid));
  });

  it("escalates to SIGKILL after the grace period elapses", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const child = start(TRAP_SOURCE, true);
    const [, pid] = await lineWithPrefix(child, "ready ");
    killProcessTree(Number(pid), { detached: true, graceMs: 100 });
    await exited(child);
    assert.equal(child.signalCode, "SIGKILL");
  });

  it("force() is idempotent and safe after the process is gone", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const child = start(TRAP_SOURCE, true);
    const [, pid] = await lineWithPrefix(child, "ready ");
    const handle = killProcessTree(Number(pid), { detached: true, graceMs: 60_000 });
    assert.ok(handle);
    handle.force();
    await exited(child);
    assert.doesNotThrow(() => handle.force());
  });

  it("does not throw for an already-dead pid", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const child = spawn(process.execPath, ["-e", ""], { detached: true, stdio: "ignore" });
    const pid = child.pid as number;
    await once(child, "exit");
    assert.doesNotThrow(() => killProcessTree(pid, { detached: true, graceMs: 10 })?.force());
    assert.doesNotThrow(() => killProcessTree(pid));
    assert.doesNotThrow(() => killProcessTree(pid, { force: true }));
    assert.doesNotThrow(() => signalProcessTree(pid, "SIGTERM"));
    assert.doesNotThrow(() => signalProcessTree(pid, "SIGKILL", { detached: true }));
  });

  it("never signals the caller's own process group for a non-leader child", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const child = start(TRAP_SOURCE, false);
    const [, pid] = await lineWithPrefix(child, "ready ");
    // The child shares our process group, so the default must signal only the pid.
    const handle = killProcessTree(Number(pid), { graceMs: 60_000 });
    await lineWithPrefix(child, "got-term");
    handle?.force();
    await exited(child);
    assert.equal(child.signalCode, "SIGKILL");
  });

  it("signalProcessTree delivers one signal to a group and calls onComplete", posixOnly, { timeout: TEST_TIMEOUT }, async () => {
    const parent = start(TREE_SOURCE, true);
    const [, parentPid, grandchildPid] = await lineWithPrefix(parent, "tree ");
    let completed = 0;
    signalProcessTree(Number(parentPid), "SIGKILL", { detached: true, onComplete: () => (completed += 1) });
    assert.equal(completed, 1);
    await exited(parent);
    await waitUntilGone(Number(grandchildPid));
  });
});
