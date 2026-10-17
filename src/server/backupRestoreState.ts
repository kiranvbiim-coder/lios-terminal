import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Process-local admission supplements PGlite's existing inter-process ownership. */
const activeHomes = new Set<string>();
export const RESTORE_STATE_DIRECTORY = ".lios-restore-active";

export function markHomeRuntimeActive(root: string): void {
  assertNoPendingHomeRestore(root);
  const physical = fs.realpathSync(root);
  const marker = path.join(physical, ".lios-home-runtime.lock");
  assertHomeRestoreOffline(root);
  const token = crypto.randomUUID();
  const fd = fs.openSync(marker, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const release = () => {
    try {
      if (JSON.parse(fs.readFileSync(marker, "utf8")).token === token) fs.unlinkSync(marker);
    } catch { /* Preserve an unrecognized ownership marker. */ }
  };
  try { assertNoPendingHomeRestore(root); } catch (error) { release(); throw error; }
  activeHomes.add(physical);
  process.once("exit", release);
}

export function assertHomeRestoreOffline(root: string): void {
  if (activeHomes.has(fs.realpathSync(root))) {
    throw new Error("Stop the active LiOS Home before restoring its database and files.");
  }
  const marker = path.join(root, ".lios-home-runtime.lock");
  if (!fs.lstatSync(marker, { throwIfNoEntry: false })) return;
  try {
    const entry = fs.lstatSync(marker);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("unsafe runtime ownership marker");
    const owner = JSON.parse(fs.readFileSync(marker, "utf8")) as { pid?: unknown };
    if (!Number.isInteger(owner.pid) || Number(owner.pid) <= 0) throw new Error("unverifiable runtime owner");
    try {
      process.kill(Number(owner.pid), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") { fs.unlinkSync(marker); return; }
      throw error;
    }
  } catch (error) {
    throw new Error("Stop the LiOS Home before restoring: runtime ownership is active or unverifiable.", { cause: error });
  }
  throw new Error("Stop the active LiOS Home before restoring its database and files.");
}

export function restoreRecoveryMessage(root: string): string {
  return `LiOS Home restore is incomplete or active at ${path.join(root, RESTORE_STATE_DIRECTORY)}. Stop LiOS and other writers, then run npm run backup:restore -- --recover against this LIOS_DATA_ROOT. Recovery preserves the prior database export and file copies; do not delete the recovery directory.`;
}

export function assertNoPendingHomeRestore(root: string): void {
  if (fs.lstatSync(path.join(root, RESTORE_STATE_DIRECTORY), { throwIfNoEntry: false })) {
    throw new Error(restoreRecoveryMessage(root));
  }
}
