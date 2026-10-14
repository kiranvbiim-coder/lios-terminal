// Written for LiOS, GM-10a: the one-shot runtime command entry point over the adapted OpenClaw supervisor.
import { getProcessSupervisor } from "./index";
import type { ProcessSupervisor, RunExit, SpawnInput, TerminationReason } from "./types";
import { currentConversationExecutionScope } from "./execution-scope";
import type { ChildEnvProfile } from "./env";
import { describeExecutionOperation } from "./operation-identity";
import type { ExecutionOperationDescriptor } from "./operation-identity";
import { ExecutionAuthorizationInvalidError } from "./execution-authorization";
import type { ExecutionBackendFinalization, ExecutionBackendLifecycle } from "./backends/types";

export interface CommandInput {
  argv: string[];
  timeoutMs: number;
  maxOutputChars?: number;
  cwd?: string;
  /** Explicit overlay, never a process.env snapshot; keys are checked at child launch. */
  env?: NodeJS.ProcessEnv;
  /** Fixed internal environment profile; python-runtime permits only its static key set. */
  envProfile?: ChildEnvProfile;
  signal?: AbortSignal;
  input?: string;
  /** Mutable script/config operands already identified by canonical command analysis. */
  operationFilePaths?: readonly string[];
  scopeKey?: string;
  /** Approval-bound operation digest from describeCommandOperation(). */
  expectedOperationDigest?: string;
}

export type CommandOperationDescriptor = ExecutionOperationDescriptor;

export async function describeCommandOperation(
  input: Pick<CommandInput, "argv" | "cwd" | "env" | "envProfile" | "input" | "operationFilePaths">,
): Promise<CommandOperationDescriptor> {
  return describeExecutionOperation({ ...input, filePaths: input.operationFilePaths });
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  wallDurationMs: number;
  /**
   * Present only when backend-governed execution produced verified completion
   * data (for example declared workspace write-return files). Ordinary command
   * and empty-finalization result shapes remain unchanged.
   */
  backendFinalization?: ExecutionBackendFinalization;
}

export class CommandExecutionError extends Error {
  constructor(readonly result: RunExit) {
    super(result.stdoutTruncated || result.stderrTruncated
      ? "Command output exceeded its capture limit."
      : `Command failed (${result.reason}, exit ${result.exitCode ?? result.exitSignal ?? "unknown"}).`);
    this.name = "CommandExecutionError";
  }
}

function throwJoinedErrors(errors: unknown[], message: string): void {
  const present = errors.filter((error) => error !== undefined && error !== null);
  if (present.length === 0) return;
  if (present.length === 1) throw present[0];
  throw new AggregateError(present, message);
}

function hasBackendFinalizationData(finalization: ExecutionBackendFinalization | undefined): boolean {
  return finalization?.workspaceOutputs !== undefined;
}

export interface PreparedSpawnSession {
  writeInput(data: string): Promise<void>;
  cancel(reason?: TerminationReason): void;
  wait(): Promise<CommandResult>
}

/**
 * Canonical GM-10 spawn admission for prepared operations. Both one-shot and
 * controlled session execution use this same supervisor/lifecycle path.
 */
export async function startPreparedSpawn(
  input: SpawnInput,
  signal?: AbortSignal,
  supervisor: ProcessSupervisor = getProcessSupervisor(),
  options: {
    scopeMode?: "inherit" | "exact";
    lifecycle?: ExecutionBackendLifecycle;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {},
): Promise<PreparedSpawnSession> {
  const scope = currentConversationExecutionScope();
  const scopeMode = options.scopeMode ?? "inherit";
  if (scopeMode === "exact" && scope && input.scopeKey !== scope.scopeKey) {
    throw new Error("Prepared execution scope does not match the active conversation scope.");
  }
  const combinedSignal = scopeMode === "inherit"
    ? (scope && signal ? AbortSignal.any([scope.signal, signal]) : scope?.signal ?? signal)
    : signal;
  if (combinedSignal?.aborted) throw new ExecutionAuthorizationInvalidError("cancelled");
  const run = await supervisor.spawn({
    ...input,
    argv: [...input.argv],
    env: input.env ? { ...input.env } : undefined,
    operationFilePaths: input.operationFilePaths ? [...input.operationFilePaths] : undefined,
    scopeKey: scopeMode === "inherit" ? scope?.scopeKey ?? input.scopeKey : input.scopeKey,
    onStdout: options.onStdout
      ? (chunk) => { input.onStdout?.(chunk); options.onStdout?.(chunk); }
      : input.onStdout,
    onStderr: options.onStderr
      ? (chunk) => { input.onStderr?.(chunk); options.onStderr?.(chunk); }
      : input.onStderr,
  });
  const cancel = (reason: TerminationReason = "manual-cancel") => run.cancel(reason);
  const onAbort = () => cancel("manual-cancel");
  combinedSignal?.addEventListener("abort", onAbort, { once: true });
  // Abort may have happened while admission was pending, before the listener could be registered.
  if (combinedSignal?.aborted) onAbort();

  let completion: Promise<CommandResult> | null = null;
  const wait = (): Promise<CommandResult> => {
    if (completion) return completion;
    completion = (async () => {
      let exit: RunExit | undefined;
      let backendFinalization: ExecutionBackendFinalization | undefined;
      let waitError: unknown;
      let extinctionError: unknown;
      let acceptError: unknown;
      let finalizationError: unknown;
      try {
        try {
          exit = await run.wait();
        } catch (error) {
          waitError = error;
        }
        if (options.lifecycle && !run.waitForExtinction) {
          extinctionError = new Error("Native extinction proof unavailable for backend lifecycle.");
        } else {
          try {
            await run.waitForExtinction?.();
          } catch (error) {
            extinctionError = error;
          }
        }
        // Private transport is consumed only after native process extinction.
        if (!extinctionError && exit && options.lifecycle?.acceptExit) {
          try {
            exit = options.lifecycle.acceptExit(exit);
          } catch (error) {
            acceptError = error;
          }
        }
        // Cleanup stays mandatory even when private transport validation fails, but never without proven extinction.
        if (!extinctionError && options.lifecycle) {
          try {
            backendFinalization = await options.lifecycle.finalize();
          } catch (error) {
            finalizationError = error;
          }
        }
        throwJoinedErrors(
          [waitError, extinctionError, acceptError, finalizationError],
          "Command execution, private output acceptance, or backend finalization failed.",
        );
        if (!exit) throw new Error("Prepared command completed without a terminal result.");
        if (exit.reason !== "exit" || exit.exitCode !== 0 || exit.stdoutTruncated || exit.stderrTruncated) {
          throw new CommandExecutionError(exit);
        }
        return {
          stdout: exit.stdout,
          stderr: exit.stderr,
          wallDurationMs: Math.max(1, exit.durationMs),
          ...(hasBackendFinalizationData(backendFinalization) ? { backendFinalization } : {}),
        };
      } finally {
        combinedSignal?.removeEventListener("abort", onAbort);
      }
    })();
    return completion;
  };

  return {
    async writeInput(data) {
      if (combinedSignal?.aborted) throw new ExecutionAuthorizationInvalidError("cancelled");
      const stdin = run.stdin;
      if (!stdin || stdin.destroyed || stdin.writable === false || stdin.writableEnded) {
        throw new Error("Interactive input is unavailable for this execution session.");
      }
      await new Promise<void>((resolve, reject) => {
        stdin.write(data, (error) => error ? reject(error) : resolve());
      });
    },
    cancel,
    wait,
  };
}

export async function runPreparedSpawn(
  input: SpawnInput,
  signal?: AbortSignal,
  supervisor: ProcessSupervisor = getProcessSupervisor(),
  options: {
    scopeMode?: "inherit" | "exact";
    lifecycle?: ExecutionBackendLifecycle;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {},
): Promise<CommandResult> {
  const session = await startPreparedSpawn(input, signal, supervisor, options);
  return session.wait();
}

/**
 * Await bounded output and cleanup; never hand partial/truncated JSON to a caller as a successful result.
 * Optional server-only supervisor injection isolates callers/tests from ambient host state.
 * Omission retains the process-wide supervisor and its production resource-reservation policy.
 */
export async function runCommand(input: CommandInput, supervisor?: ProcessSupervisor): Promise<CommandResult> {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) throw new Error("A command requires a positive finite timeout.");
  if (input.maxOutputChars !== undefined && (!Number.isFinite(input.maxOutputChars) || input.maxOutputChars < 256)) {
    throw new Error("Command capture limit must be at least 256 characters.");
  }
  return runPreparedSpawn({
    mode: "child",
    argv: input.argv,
    cwd: input.cwd,
    env: input.env,
    envProfile: input.envProfile,
    timeoutMs: input.timeoutMs,
    maxCapturedOutputChars: input.maxOutputChars,
    captureOutput: true,
    input: input.input,
    operationFilePaths: input.operationFilePaths,
    scopeKey: input.scopeKey,
    expectedOperationDigest: input.expectedOperationDigest,
  }, input.signal, supervisor);
}
