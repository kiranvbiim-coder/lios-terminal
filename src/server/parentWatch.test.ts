import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { launcherPidFromEnvironment, processIsAlive } from "./parentWatch";

const WATCH_MODULE = fileURLToPath(new URL("./parentWatch.ts", import.meta.url));
const ORPHANED_EXIT_CODE = 42;

function exitOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

function spawnLauncher(): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
}

/** A real process that watches `pid` and exits with ORPHANED_EXIT_CODE when it disappears. */
function spawnWatcher(pid: number): ChildProcess {
  const script = `import(${JSON.stringify(WATCH_MODULE)}).then(({ watchLauncher }) => {
    watchLauncher(${pid}, () => process.exit(${ORPHANED_EXIT_CODE}), 50);
    process.stdout.write("watching\\n");
    setInterval(() => {}, 1000);
  });`;
  return spawn(process.execPath, ["--import", "tsx", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
}

function ready(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => { if (chunk.toString().includes("watching")) resolve(); });
    child.once("exit", () => reject(new Error("the watcher exited before it started watching")));
  });
}

test("a watching process exits by itself once its real launcher is killed", { timeout: 60_000 }, async () => {
  const launcher = spawnLauncher();
  const launcherPid = launcher.pid;
  assert.ok(launcherPid);
  const watcher = spawnWatcher(launcherPid);
  try {
    await ready(watcher);
    assert.equal(watcher.exitCode, null, "the watcher must keep running while the launcher is alive");
    const watcherExit = exitOf(watcher);
    launcher.kill("SIGKILL");
    assert.equal(await watcherExit, ORPHANED_EXIT_CODE);
  } finally {
    launcher.kill("SIGKILL");
    watcher.kill("SIGKILL");
  }
});

test("a launcher that is already gone is reported immediately", { timeout: 60_000 }, async () => {
  const launcher = spawnLauncher();
  const launcherPid = launcher.pid;
  assert.ok(launcherPid);
  const launcherExit = exitOf(launcher);
  launcher.kill("SIGKILL");
  await launcherExit;
  const watcher = spawnWatcher(launcherPid);
  assert.equal(await exitOf(watcher), ORPHANED_EXIT_CODE);
});

test("process liveness reflects a real process", async () => {
  const child = spawnLauncher();
  assert.ok(child.pid);
  assert.equal(processIsAlive(child.pid), true);
  const exited = exitOf(child);
  child.kill("SIGKILL");
  await exited;
  assert.equal(processIsAlive(child.pid), false);
});

test("the launcher pid is optional but never guessed from a bad value", () => {
  assert.equal(launcherPidFromEnvironment({}), null);
  assert.equal(launcherPidFromEnvironment({ LIOS_PARENT_PID: "  " }), null);
  assert.equal(launcherPidFromEnvironment({ LIOS_PARENT_PID: "4242" }), 4242);
  for (const bad of ["abc", "0", "1", "-5", "12.5", "12abc", "9999999999999999999"]) {
    assert.throws(() => launcherPidFromEnvironment({ LIOS_PARENT_PID: bad }), /Invalid LIOS_PARENT_PID/, bad);
  }
});
