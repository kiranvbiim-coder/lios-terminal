import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { acquirePgliteOwnership, PgliteOwnershipError, recoverStalePgliteLock } from "./pgliteLock";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lios-pglite-lock-"));
}

test("PGlite lock recovery reports missing marker", () => {
  const dir = tempDir();
  try {
    const result = recoverStalePgliteLock(dir);
    assert.equal(result.action, "missing");
    assert.equal(result.pid, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite lock recovery removes invalid non-positive marker", () => {
  const dir = tempDir();
  const lockPath = path.join(dir, "postmaster.pid");
  fs.writeFileSync(lockPath, "-42\n/pglite/data\n", "utf8");
  try {
    const result = recoverStalePgliteLock(dir);
    assert.equal(result.action, "removed_stale");
    assert.equal(result.pid, null);
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite lock recovery removes marker for an exited process", () => {
  const dir = tempDir();
  const lockPath = path.join(dir, "postmaster.pid");
  // PID 999999 is outside normal process allocation on this workstation.
  fs.writeFileSync(lockPath, "999999\n", "utf8");
  try {
    const result = recoverStalePgliteLock(dir);
    assert.equal(result.action, "removed_stale");
    assert.equal(result.pid, 999999);
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite lock recovery preserves a live process marker", () => {
  const dir = tempDir();
  const lockPath = path.join(dir, "postmaster.pid");
  fs.writeFileSync(lockPath, `${process.pid}\n`, "utf8");
  try {
    const result = recoverStalePgliteLock(dir);
    assert.equal(result.action, "preserved_active");
    assert.equal(result.pid, process.pid);
    assert.equal(fs.existsSync(lockPath), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite ownership is exclusive and release permits reacquisition", () => {
  const dir = tempDir();
  try {
    const first = acquirePgliteOwnership(dir);
    assert.throws(() => acquirePgliteOwnership(dir), (error) =>
      error instanceof PgliteOwnershipError && error.ownerPid === process.pid,
    );
    first.release();
    const second = acquirePgliteOwnership(dir);
    assert.notEqual(second.token, first.token);
    second.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite ownership atomically recovers an exited owner", () => {
  const dir = tempDir();
  const ownerPath = path.join(dir, ".limuria-pglite-owner.json");
  fs.writeFileSync(ownerPath, JSON.stringify({ pid: 999999, token: "stale", acquiredAt: "2020-01-01T00:00:00.000Z" }), "utf8");
  try {
    const owner = acquirePgliteOwnership(dir);
    assert.equal(owner.pid, process.pid);
    owner.release();
    assert.equal(fs.existsSync(ownerPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite ownership fails closed on a recent incomplete marker", () => {
  const dir = tempDir();
  const ownerPath = path.join(dir, ".limuria-pglite-owner.json");
  fs.writeFileSync(ownerPath, "", "utf8");
  try {
    assert.throws(() => acquirePgliteOwnership(dir), PgliteOwnershipError);
    assert.equal(fs.existsSync(ownerPath), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite release cannot delete a marker replaced by another owner token", () => {
  const dir = tempDir();
  const ownerPath = path.join(dir, ".limuria-pglite-owner.json");
  try {
    const owner = acquirePgliteOwnership(dir);
    fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token: "replacement", acquiredAt: new Date().toISOString() }), "utf8");
    owner.release();
    assert.equal(fs.existsSync(ownerPath), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
