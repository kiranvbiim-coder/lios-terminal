import fs from "fs";
import path from "path";

export type PgliteLockAction = "missing" | "preserved_active" | "removed_stale";

export interface PgliteLockRecoveryResult {
  action: PgliteLockAction;
  pid: number | null;
  path: string;
}

/**
 * Remove only a provably stale PGlite postmaster.pid marker.
 *
 * PGlite writes a Postgres-style lock marker before opening its data
 * directory. A crashed process can leave it behind and make the next
 * launch abort inside WASM. A positive PID is preserved when the process
 * still exists; an invalid/non-positive PID or an exited PID is removable.
 * Permission/unknown errors fail closed and preserve the marker.
 */
export function recoverStalePgliteLock(dataDir: string): PgliteLockRecoveryResult {
  const lockPath = path.join(dataDir, "postmaster.pid");
  if (!fs.existsSync(lockPath)) return { action: "missing", pid: null, path: lockPath };

  let firstLine = "";
  try {
    firstLine = fs.readFileSync(lockPath, "utf8").split(/\r?\n/, 1)[0]?.trim() ?? "";
  } catch {
    return { action: "preserved_active", pid: null, path: lockPath };
  }

  const pid = Number.parseInt(firstLine, 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    try {
      fs.rmSync(lockPath, { force: true });
      return { action: "removed_stale", pid: null, path: lockPath };
    } catch {
      return { action: "preserved_active", pid: null, path: lockPath };
    }
  }

  try {
    process.kill(pid, 0);
    return { action: "preserved_active", pid, path: lockPath };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code !== "ESRCH") return { action: "preserved_active", pid, path: lockPath };
    try {
      fs.rmSync(lockPath, { force: true });
      return { action: "removed_stale", pid, path: lockPath };
    } catch {
      return { action: "preserved_active", pid, path: lockPath };
    }
  }
}

const OWNER_FILE = ".limuria-pglite-owner.json";
const INCOMPLETE_OWNER_GRACE_MS = 30_000;

interface PgliteOwnerRecord {
  pid: number;
  token: string;
  acquiredAt: string;
}

export class PgliteOwnershipError extends Error {
  readonly code = "PGLITE_ALREADY_OWNED";
  constructor(readonly ownerPath: string, readonly ownerPid: number | null, detail: string) {
    super(`Embedded database is already owned${ownerPid ? ` by process ${ownerPid}` : ""}: ${detail}`);
    this.name = "PgliteOwnershipError";
  }
}

export interface PgliteOwnershipHandle {
  path: string;
  pid: number;
  token: string;
  release(): void;
}

function processState(pid: number): "active" | "missing" | "unknown" {
  try {
    process.kill(pid, 0);
    return "active";
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "ESRCH") return "missing";
    return "unknown";
  }
}

function readOwner(ownerPath: string): PgliteOwnerRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerPath, "utf8")) as Partial<PgliteOwnerRecord>;
    if (!Number.isInteger(parsed.pid) || Number(parsed.pid) <= 0 || typeof parsed.token !== "string" || !parsed.token) return null;
    return { pid: Number(parsed.pid), token: parsed.token, acquiredAt: String(parsed.acquiredAt ?? "") };
  } catch {
    return null;
  }
}

/**
 * Atomically claim exclusive ownership before PGlite touches its own
 * postmaster.pid. `openSync(..., "wx")` is the actual inter-process
 * exclusion boundary; checking postmaster.pid alone has a race where two
 * processes both observe it missing and then open the same WASM database.
 */
export function acquirePgliteOwnership(dataDir: string): PgliteOwnershipHandle {
  fs.mkdirSync(dataDir, { recursive: true });
  const ownerPath = path.join(dataDir, OWNER_FILE);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(ownerPath, "wx", 0o600);
      try {
        const record: PgliteOwnerRecord = { pid: process.pid, token, acquiredAt: new Date().toISOString() };
        fs.writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      let released = false;
      return {
        path: ownerPath,
        pid: process.pid,
        token,
        release() {
          if (released) return;
          released = true;
          const current = readOwner(ownerPath);
          if (current?.token !== token) return;
          try { fs.rmSync(ownerPath, { force: true }); } catch { /* best effort during shutdown */ }
        },
      };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "EEXIST") {
        throw new PgliteOwnershipError(ownerPath, null, error instanceof Error ? error.message : String(error));
      }

      const owner = readOwner(ownerPath);
      if (owner) {
        const state = processState(owner.pid);
        if (state !== "missing") {
          throw new PgliteOwnershipError(ownerPath, owner.pid, state === "active" ? "the owner process is still running" : "owner liveness could not be verified");
        }
        fs.rmSync(ownerPath, { force: true });
        continue;
      }

      let ageMs = 0;
      try { ageMs = Date.now() - fs.statSync(ownerPath).mtimeMs; } catch { /* handled below */ }
      if (ageMs >= INCOMPLETE_OWNER_GRACE_MS) {
        fs.rmSync(ownerPath, { force: true });
        continue;
      }
      throw new PgliteOwnershipError(ownerPath, null, "owner marker is incomplete or unreadable");
    }
  }

  throw new PgliteOwnershipError(ownerPath, null, "ownership could not be acquired after stale-owner recovery");
}
