import type { RunExit, SpawnInput, TerminationReason } from "../types";
import { getProcessSupervisor } from "../index";
import { sleepWithAbort } from "../retry-timing";
import type { ExecutionBackendFinalization } from "./types";

export interface ContainerControlResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ContainerControlRunner = (argv: readonly string[]) => Promise<ContainerControlResult>;

const CONTROL_TIMEOUT_MS = 10_000;
const CONTROL_MAX_OUTPUT_CHARS = 64 * 1024;
const DEFAULT_FINALIZE_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 50;
const NOT_FOUND = /no such (?:container|object)|does not exist|no container with name or id/i;
const WINDOWS_DOCKER_NPIPE = /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/;

export async function runContainerControlCommand(
  argv: readonly string[],
): Promise<ContainerControlResult> {
  const supervisor = getProcessSupervisor();
  const run = await supervisor.spawn({
    mode: "child",
    argv: [...argv],
    timeoutMs: CONTROL_TIMEOUT_MS,
    maxCapturedOutputChars: CONTROL_MAX_OUTPUT_CHARS,
    captureOutput: true,
    stdinMode: "pipe-closed",
  });
  const result = await run.wait();
  await run.waitForExtinction?.();
  return {
    code: result.reason === "exit" ? (result.exitCode ?? 1) : 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function engineTargetArg(engine: "docker" | "podman", target: string): string {
  if (target.includes("\0")) {
    throw new Error("Container lifecycle requires an explicit local unix:// socket or Windows Docker npipe:// endpoint.");
  }
  if (engine === "docker" && WINDOWS_DOCKER_NPIPE.test(target)) return "--host=" + target;
  if (!target.startsWith("unix:///")) {
    throw new Error("Container lifecycle requires an explicit local unix:// socket or Windows Docker npipe:// endpoint.");
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error("Container lifecycle requires an explicit local unix:// socket or Windows Docker npipe:// endpoint.");
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error("Container lifecycle requires an explicit local unix:// socket or Windows Docker npipe:// endpoint.");
  }
  if (
    parsed.protocol !== "unix:" ||
    parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    !decodedPath.startsWith("/") ||
    decodedPath === "/" ||
    decodedPath.includes("\0")
  ) {
    throw new Error("Container lifecycle requires an explicit local unix:// socket or Windows Docker npipe:// endpoint.");
  }
  return engine === "docker" ? "--host=" + parsed.href : "--url=" + parsed.href;
}

export class ContainerExtinctionError extends Error {
  constructor(
    readonly engine: "docker" | "podman",
    readonly generationId: string,
    detail: string,
  ) {
    super(`Could not prove ${engine} sandbox generation ${generationId} extinct: ${detail}`);
    this.name = "ContainerExtinctionError";
  }
}

export interface ContainerExecutionLifecycle {
  readonly generationId: string;
  onCancel(reason: TerminationReason): void;
  onStdoutRaw?: SpawnInput["onStdoutRaw"];
  onStderrRaw?: SpawnInput["onStderrRaw"];
  acceptExit?(exit: RunExit): RunExit;
  /**
   * Must be awaited only after the engine client process is itself extinct.
   * This ordering closes the race where an early remove observes "not found"
   * while docker/podman is still creating the named generation.
   */
  finalize(): Promise<ExecutionBackendFinalization>;
}

export function createContainerExecutionLifecycle(input: {
  engine: "docker" | "podman";
  engineTarget: string;
  generationId: string;
  runner?: ContainerControlRunner;
  finalizeAttempts?: number;
  retryDelayMs?: number;
  beforeRemove?: () => Promise<ExecutionBackendFinalization | void>;
  onStdoutRaw?: SpawnInput["onStdoutRaw"];
  onStderrRaw?: SpawnInput["onStderrRaw"];
  acceptExit?: (exit: RunExit) => RunExit;
}): ContainerExecutionLifecycle {
  const runner = input.runner ?? runContainerControlCommand;
  const targetArg = engineTargetArg(input.engine, input.engineTarget);
  const attempts = input.finalizeAttempts ?? DEFAULT_FINALIZE_ATTEMPTS;
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error("Container lifecycle finalizeAttempts must be between 1 and 10.");
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5_000) {
    throw new Error("Container lifecycle retryDelayMs must be between 0 and 5000.");
  }

  let earlyCleanup: Promise<void> | null = null;
  let finalization: Promise<ExecutionBackendFinalization> | null = null;
  let cancelled = false;

  const inspectAbsent = async (): Promise<boolean> => {
    const inspected = await runner([
      input.engine,
      targetArg,
      "inspect",
      "--format",
      "{{.Id}}",
      input.generationId,
    ]);
    if (inspected.code === 0) return false;
    const detail = `${inspected.stderr}\n${inspected.stdout}`;
    if (NOT_FOUND.test(detail)) return true;
    throw new ContainerExtinctionError(
      input.engine,
      input.generationId,
      `inspect exited ${inspected.code}`,
    );
  };

  const removeOnce = async (): Promise<void> => {
    const removed = await runner([input.engine, targetArg, "rm", "-f", input.generationId]);
    if (removed.code === 0) return;
    const detail = `${removed.stderr}\n${removed.stdout}`;
    if (NOT_FOUND.test(detail)) return;
    // Do not trust rm failure alone; authoritative inspect below decides whether
    // a generation is still alive. This also tolerates harmless CLI races.
  };

  const ensureExtinct = async (): Promise<void> => {
    let lastDetail = "generation remained observable";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await removeOnce();
        if (await inspectAbsent()) return;
      } catch (error) {
        lastDetail = error instanceof ContainerExtinctionError
          ? error.message
          : "control command failed";
      }
      // Cleanup must survive caller cancellation and keep shutdown referenced.
      // Retry admission remains this bounded extinction loop, not the timing utility.
      if (attempt < attempts && retryDelayMs > 0) await sleepWithAbort(retryDelayMs);
    }
    throw new ContainerExtinctionError(input.engine, input.generationId, lastDetail);
  };

  return {
    generationId: input.generationId,
    onStdoutRaw: input.onStdoutRaw,
    onStderrRaw: input.onStderrRaw,
    acceptExit: input.acceptExit,
    onCancel() {
      cancelled = true;
      // Best effort only. Authoritative proof belongs to finalize() after the
      // docker/podman client process has reached native extinction.
      earlyCleanup ??= ensureExtinct();
      void earlyCleanup.catch(() => undefined);
    },
    finalize() {
      return (finalization ??= (async () => {
        if (earlyCleanup) {
          try {
            await earlyCleanup;
          } catch {
            // The client may still have been creating the container. Retry
            // authoritatively now that the caller has joined client extinction.
          }
        }

        let result: ExecutionBackendFinalization = {};
        let exportError: unknown;
        if (!cancelled && input.beforeRemove) {
          try {
            result = (await input.beforeRemove()) ?? {};
          } catch (error) {
            exportError = error;
          }
        }

        let extinctionError: unknown;
        try {
          await ensureExtinct();
        } catch (error) {
          extinctionError = error;
        }

        if (exportError && extinctionError) {
          throw new AggregateError(
            [exportError, extinctionError],
            "Container output return failed and extinction could not be proven.",
          );
        }
        if (extinctionError) throw extinctionError;
        if (exportError) throw exportError;
        return result;
      })());
    },
  };
}
