// Adapted from OpenClaw (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// Upstream path: src/process/terminal-pty.ts
// LiOS (GM-10b): Node-only lazy @lydell/node-pty@1.2.0-beta.15 (MIT); no Bun workers or Windows shell/wrapper policy.
// - Allow-listed env, explicit batch rejection, dimension validation, injectable loader/tree signaling.
// - Native load failures alone permit pipe fallback; native spawn failures retain their original error.
// - Tree signaling always joins root native kill; errors are not swallowed. Native binaries must be packaged externally.
// - GM-10 hardening: the module is loaded at runtime through its app.asar path (see nativePtyLoadPath), which the
//   packaged app needs for node-pty to find its spawn-helper; it is never bundled into dist/index.cjs.
import { createRequire } from "node:module";
import path from "node:path";
import { buildChildEnv } from "./env";
import { signalPtySessionTree } from "./kill-tree";
import { resolvePtyTerminalName, setPtyTerminalName } from "./pty-terminal-name";

export type TerminalPtySubscription = { dispose(): void };
export type TerminalPtyHandle = {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  onData(listener: (chunk: string) => void): TerminalPtySubscription | void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): TerminalPtySubscription | void;
  kill(signal?: string): void;
};
export type TerminalPtySpawnParams = {
  file: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  name?: string;
  cols: number;
  rows: number;
};
export type NativePtyModule = {
  spawn(file: string, args: string[], options: {
    name: string; cols: number; rows: number; cwd?: string; env: Record<string, string>;
  }): TerminalPtyHandle;
};
export type TerminalPtyDependencies = {
  loadNative?: () => Promise<NativePtyModule>;
  signalTree?: typeof signalPtySessionTree;
};

/** Only this error denotes native availability, never an executable/cwd/authorization failure. */
export class NativePtyUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Native PTY module is unavailable", { cause });
    this.name = "NativePtyUnavailableError";
  }
}

/**
 * node-pty finds its `spawn-helper` by rewriting the first `app.asar` in its own path to `app.asar.unpacked`. The packaged
 * app already runs the server from the unpacked tree, which that rewrite turns into `app.asar.unpacked.unpacked`, so
 * every spawn failed with ENOENT. Loading it through the equivalent `app.asar` path lets its rewrite land correctly.
 * Paths outside a packaged app are returned unchanged.
 */
export function nativePtyLoadPath(resolved: string): string {
  const unpacked = `${path.sep}app.asar.unpacked${path.sep}`;
  return resolved.includes(unpacked) ? resolved.replace(unpacked, `${path.sep}app.asar${path.sep}`) : resolved;
}

function isNativePtyModule(value: unknown): value is NativePtyModule {
  return typeof value === "object" && value !== null && "spawn" in value && typeof value.spawn === "function";
}

const moduleBase = typeof __dirname !== "undefined" ? __dirname : path.dirname(process.argv[1] || process.cwd());

/** Loaded at runtime (never bundled) and only when a terminal is opened, so ordinary server startup never loads the addon. */
export async function loadNativePty(): Promise<NativePtyModule> {
  try {
    // Platform-specific optional addon: a static import cannot work when its native binary is unavailable.
    const requireFromHere = createRequire(path.join(moduleBase, "noop.cjs"));
    const native: unknown = requireFromHere(nativePtyLoadPath(requireFromHere.resolve("@lydell/node-pty")));
    if (!isNativePtyModule(native)) {
      throw new Error("Native PTY module has no spawn export");
    }
    return native;
  } catch (error) {
    throw new NativePtyUnavailableError(error);
  }
}

export function validateTerminalDimensions(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0 || cols > 65535 || rows > 65535) {
    throw new RangeError("Terminal dimensions must be integers between 1 and 65535");
  }
}

export function validateTerminalCommand(argv: string[]): void {
  if (!argv[0] || argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("Terminal argv must contain a nonempty executable and NUL-free string arguments");
  }
  if (/\.(?:bat|cmd)$/i.test(argv[0])) {
    throw new Error("Batch scripts cannot be launched directly; provide an explicitly authorized executable invocation");
  }
}

export async function spawnTerminalPty(
  params: TerminalPtySpawnParams,
  dependencies: TerminalPtyDependencies = {},
): Promise<TerminalPtyHandle> {
  validateTerminalDimensions(params.cols, params.rows);
  validateTerminalCommand([params.file, ...params.args]);
  const env = buildChildEnv(params.env);
  // TERM=dumb describes the server, not the newly allocated interactive terminal.
  const name = resolvePtyTerminalName(params.name ?? env.TERM);
  setPtyTerminalName({ env, name, platform: process.platform });
  const native = await (dependencies.loadNative ?? loadNativePty)();
  // Deliberately outside the loader's availability catch: failed execution must never trigger a second launch.
  const pty = native.spawn(params.file, params.args, { name, cols: params.cols, rows: params.rows, cwd: params.cwd, env });
  return {
    get pid() { return pty.pid; },
    write: (data) => pty.write(data),
    resize: (cols, rows) => { validateTerminalDimensions(cols, rows); pty.resize(cols, rows); },
    pause: () => pty.pause(),
    resume: () => pty.resume(),
    onData: (listener) => pty.onData(listener),
    onExit: (listener) => pty.onExit(listener),
    kill: (signal) => signalTerminalPtyTree(pty.pid, signal, (sig) => {
      if (process.platform === "win32") { pty.kill(); } else { pty.kill(sig); }
    }, dependencies.signalTree),
  };
}

/** Descendants are signaled before the native root is torn down (Darwin needs its controlling tty). */
export function signalTerminalPtyTree(
  pid: number,
  signal: string | undefined,
  signalDirect: (signal: NodeJS.Signals) => void,
  signalTree: typeof signalPtySessionTree = signalPtySessionTree,
): void {
  const sig = (signal ?? "SIGKILL") as NodeJS.Signals;
  try {
    if ((sig === "SIGKILL" || sig === "SIGTERM") && pid > 0) {
      signalTree(pid, sig);
    }
  } finally {
    // node-pty owns platform-specific native handles in addition to the process tree.
    signalDirect(sig);
  }
}
