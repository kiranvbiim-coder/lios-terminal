import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireManagedRuntimeLifecycleLock,
  MANAGED_RUNTIME_LIFECYCLE_LOCK_NAME,
  ManagedRuntimeBusyError,
} from "./managedRuntimeLifecycleLock";

test("SI-07.10 lifecycle lock exclusively serializes writers and release is idempotent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-lifecycle-lock-"));
  const lockFile = path.join(root, MANAGED_RUNTIME_LIFECYCLE_LOCK_NAME);
  try {
    const release = acquireManagedRuntimeLifecycleLock(root);
    assert.equal(fs.existsSync(lockFile), true);
    assert.throws(
      () => acquireManagedRuntimeLifecycleLock(root),
      (error: unknown) => error instanceof ManagedRuntimeBusyError,
    );
    assert.equal(fs.existsSync(lockFile), true);
    release();
    release();
    assert.equal(fs.existsSync(lockFile), false);
    acquireManagedRuntimeLifecycleLock(root)();
    assert.equal(fs.existsSync(lockFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SI-07.10 an unresolved or crashed writer lock fails closed rather than being stolen", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-lifecycle-stale-"));
  const lockFile = path.join(root, MANAGED_RUNTIME_LIFECYCLE_LOCK_NAME);
  fs.writeFileSync(lockFile, "old-owner; operator verification required");
  try {
    assert.throws(
      () => acquireManagedRuntimeLifecycleLock(root),
      (error: unknown) => error instanceof ManagedRuntimeBusyError,
    );
    assert.equal(fs.readFileSync(lockFile, "utf8"), "old-owner; operator verification required");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SI-07.10 lock acquisition refuses a symlinked runtime root", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-lifecycle-root-link-"));
  const real = path.join(base, "real");
  const linked = path.join(base, "linked");
  fs.mkdirSync(real);
  try {
    try {
      fs.symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip("Host cannot create a directory symlink: " + String(error));
      return;
    }
    assert.throws(() => acquireManagedRuntimeLifecycleLock(linked), /safe canonical runtime directory/);
    assert.deepEqual(fs.readdirSync(real), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("SI-07.10 releasing a replaced lock never deletes a different process's ownership", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-lifecycle-replaced-"));
  const lockFile = path.join(root, MANAGED_RUNTIME_LIFECYCLE_LOCK_NAME);
  try {
    const release = acquireManagedRuntimeLifecycleLock(root);
    fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile, "replacement-owner-must-survive");
    release();
    assert.equal(fs.readFileSync(lockFile, "utf8"), "replacement-owner-must-survive");
    assert.throws(() => acquireManagedRuntimeLifecycleLock(root), ManagedRuntimeBusyError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
