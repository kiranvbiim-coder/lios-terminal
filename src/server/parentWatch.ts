// Written for LiOS. The desktop shell spawns this server as a child process. If the shell is force-quit, crashes or the
// machine loses power, nothing stops the server: macOS and Windows do not reap children, so it would keep the port,
// the database lock and its Python sidecar until reboot, and the next launch could not start cleanly.

export const LAUNCHER_PID_ENV = "LIOS_PARENT_PID";
const DEFAULT_POLL_MS = 2_000;

/** The launcher's pid from the environment; `null` when absent (a hand-run server). Invalid values fail closed. */
export function launcherPidFromEnvironment(env: NodeJS.ProcessEnv): number | null {
  const raw = env[LAUNCHER_PID_ENV]?.trim();
  if (!raw) return null;
  const pid = Number(raw);
  if (!Number.isSafeInteger(pid) || pid <= 1 || String(pid) !== raw) throw new Error(`Invalid ${LAUNCHER_PID_ENV}: ${raw}`);
  return pid;
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else; only ESRCH means it is gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Calls `onOrphaned` once, as soon as the launcher is gone, and stops polling. Returns a function that stops the watch. */
export function watchLauncher(pid: number, onOrphaned: () => void, intervalMs = DEFAULT_POLL_MS): () => void {
  if (!processIsAlive(pid)) {
    onOrphaned();
    return () => undefined;
  }
  const timer = setInterval(() => {
    if (processIsAlive(pid)) return;
    clearInterval(timer);
    onOrphaned();
  }, intervalMs);
  // The server is kept alive by its listener, not by this timer.
  timer.unref();
  return () => clearInterval(timer);
}
