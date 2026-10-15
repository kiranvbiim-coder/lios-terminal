import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * A cooperative, fail-closed writer lock for the canonical managed-runtime
 * data root. The exclusive-create operation is atomic across processes on
 * supported local filesystems; no stale-lock auto-stealing is permitted.
 *
 * A crash may leave the file behind. An operator must verify no installer or
 * rollback is active before manually clearing an abandoned lock.
 */
export class ManagedRuntimeBusyError extends Error {
  constructor() {
    super("Managed runtime installation or rollback is already in progress, or a prior process left an unresolved lifecycle lock.");
    this.name = "ManagedRuntimeBusyError";
  }
}

export const MANAGED_RUNTIME_LIFECYCLE_LOCK_NAME = ".lios-managed-lifecycle.lock";

export function acquireManagedRuntimeLifecycleLock(root: string): () => void {
  const directory = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!directory?.isDirectory() || directory.isSymbolicLink()) {
    throw new Error("Managed runtime lifecycle lock requires a safe canonical runtime directory.");
  }

  const lockPath = path.join(root, MANAGED_RUNTIME_LIFECYCLE_LOCK_NAME);
  let fd: number;
  try {
    fd = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ManagedRuntimeBusyError();
    }
    throw error;
  }

  let owned: fs.Stats;
  const token = randomUUID();
  const record = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token }) + "\n";
  try {
    owned = fs.fstatSync(fd);
    // Local lifecycle identification only: no caller data, user secrets or
    // package settings. A random ownership token also protects filesystems
    // that do not expose a reliable or unique inode.
    fs.writeSync(fd, record);
  } catch (error) {
    try { fs.closeSync(fd); } finally { fs.rmSync(lockPath, { force: true }); }
    throw error;
  }
  fs.closeSync(fd);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const actual = fs.lstatSync(lockPath, { throwIfNoEntry: false });
    // A replacement lock belongs to another process and must never be removed.
    if (actual?.isFile() && !actual.isSymbolicLink()
      && actual.dev === owned.dev && actual.ino === owned.ino
      && fs.readFileSync(lockPath, "utf8") === record) {
      fs.unlinkSync(lockPath);
    }
  };
}
