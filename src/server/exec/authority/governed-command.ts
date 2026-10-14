import crypto from "node:crypto";
import type { ProcessSupervisor, SpawnInput } from "../types";
import { describeExecutionOperation, type ExecutionOperationDescriptor } from "../operation-identity";
import { startPreparedSpawn, runPreparedSpawn, type CommandResult, type PreparedSpawnSession } from "../run-command";
import { currentConversationExecutionScope } from "../execution-scope";
import { ExecutionPlacementGrant, type ExecutionPlacementFacts } from "../placement-grant";
import {
  ExecutionAuthorizationInvalidError,
  ExecutionAuthorizationLease,
  type CurrentExecutionPolicy,
} from "../execution-authorization";
import {
  analyzeExecutionCommand,
  type ExecutionCommandAnalysis,
  type ExecutionCommandAnalysisReason,
} from "./command-analysis";
import {
  buildInternalExecIntent,
  type InternalExecIntentDescriptor,
  type InternalExecIntentRequest,
} from "./exec-intents";
import type {
  ExecutionBackend,
  ExecutionBackendLaunchPlan,
  ExecutionBackendLifecycle,
  ExecutionBackendRequest,
  ExecutionIsolationRequirements,
  ExecutionResourceLimits,
} from "../backends/types";

export class GovernedCommandAnalysisError extends Error {
  constructor(readonly reason: ExecutionCommandAnalysisReason) {
    super(`Privileged command analysis is not safely complete (${reason}).`);
    this.name = "GovernedCommandAnalysisError";
  }
}

export type GovernedCommandAdmissionReason =
  | "backend-id-mismatch"
  | "isolation-facts-mismatch"
  | "resource-facts-mismatch"
  | "wall-time-weakened"
  | "output-bound-weakened"
  | "capture-disabled"
  | "scope-key-changed"
  | "conversation-scope-mismatch"
  | "authorization-signal-dropped"
  | "backend-injected-authority"
  | "backend-control-field-unsupported"
  | "approval-digest-mismatch"
  | "launch-invalid"
  | "intent-environment-key-unsupported";

export class GovernedCommandAdmissionError extends Error {
  constructor(readonly reason: GovernedCommandAdmissionReason) {
    super(`Governed execution admission failed (${reason}).`);
    this.name = "GovernedCommandAdmissionError";
  }
}

function sameIsolation(left: ExecutionIsolationRequirements, right: ExecutionIsolationRequirements): boolean {
  return left.filesystem === right.filesystem
    && left.network === right.network
    && left.processes === right.processes;
}

const HARD_RESOURCE_KEYS = [
  "maxCpuTimeMs",
  "maxMemoryBytes",
  "maxStorageBytes",
  "maxProcesses",
] as const satisfies readonly (keyof ExecutionResourceLimits)[];

function sameResources(left: ExecutionResourceLimits, right: ExecutionResourceLimits): boolean {
  return left.maxWallTimeMs === right.maxWallTimeMs
    && left.maxCapturedOutputChars === right.maxCapturedOutputChars
    && HARD_RESOURCE_KEYS.every((key) => {
      const admitted = right[key];
      const enforced = left[key];
      return enforced === undefined
        ? admitted === undefined
        : Number.isSafeInteger(enforced) && enforced > 0
          && (admitted === undefined || enforced <= admitted);
    });
}

function cloneSpawn(spawn: SpawnInput): SpawnInput {
  return {
    ...spawn,
    argv: [...spawn.argv],
    env: spawn.env ? { ...spawn.env } : undefined,
    operationFilePaths: spawn.operationFilePaths ? [...spawn.operationFilePaths] : undefined,
  };
}

function cloneBackendRequest(request: ExecutionBackendRequest): ExecutionBackendRequest {
  return {
    ...request,
    argv: [...request.argv],
    env: request.env ? { ...request.env } : undefined,
    isolation: { ...request.isolation },
    resources: { ...request.resources },
  };
}

function uniqueFilePaths(...groups: Array<readonly string[] | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group ?? []) {
      if (seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function isLifecycleBoundPrivateOutput(plan: ExecutionBackendLaunchPlan): boolean {
  return plan.spawn.captureOutput === false
    && typeof plan.lifecycle?.acceptExit === "function"
    && typeof plan.lifecycle.onStdoutRaw === "function"
    && typeof plan.lifecycle.onStderrRaw === "function"
    && plan.spawn.onStdoutRaw === plan.lifecycle.onStdoutRaw
    && plan.spawn.onStderrRaw === plan.lifecycle.onStderrRaw;
}

function hasPrivateOutputControls(plan: ExecutionBackendLaunchPlan): boolean {
  return plan.spawn.onStdoutRaw !== undefined
    || plan.spawn.onStderrRaw !== undefined
    || plan.lifecycle?.onStdoutRaw !== undefined
    || plan.lifecycle?.onStderrRaw !== undefined
    || plan.lifecycle?.acceptExit !== undefined;
}

function assertBackendPlan(
  backend: ExecutionBackend,
  request: ExecutionBackendRequest,
  plan: ExecutionBackendLaunchPlan,
): void {
  if (plan.backendId !== backend.id) {
    throw new GovernedCommandAdmissionError("backend-id-mismatch");
  }
  if (!sameIsolation(plan.facts.isolation, request.isolation)) {
    throw new GovernedCommandAdmissionError("isolation-facts-mismatch");
  }
  if (!sameResources(plan.facts.resources, request.resources)) {
    throw new GovernedCommandAdmissionError("resource-facts-mismatch");
  }
  if (
    plan.spawn.mode !== "child"
    || !Array.isArray(plan.spawn.argv)
    || !plan.spawn.argv[0]
    || plan.spawn.argv.some((argument) => typeof argument !== "string" || argument.includes("\0"))
  ) {
    throw new GovernedCommandAdmissionError("launch-invalid");
  }
  if (
    typeof plan.spawn.timeoutMs !== "number"
    || !Number.isSafeInteger(plan.spawn.timeoutMs)
    || plan.spawn.timeoutMs <= 0
    || plan.spawn.timeoutMs > request.resources.maxWallTimeMs
  ) {
    throw new GovernedCommandAdmissionError("wall-time-weakened");
  }
  if (
    typeof plan.spawn.maxCapturedOutputChars !== "number"
    || !Number.isSafeInteger(plan.spawn.maxCapturedOutputChars)
    || plan.spawn.maxCapturedOutputChars < 256
    || plan.spawn.maxCapturedOutputChars > request.resources.maxCapturedOutputChars
  ) {
    throw new GovernedCommandAdmissionError("output-bound-weakened");
  }

  const privateOutputTransport = isLifecycleBoundPrivateOutput(plan);
  if (plan.spawn.captureOutput !== true) {
    if (hasPrivateOutputControls(plan) && !privateOutputTransport) {
      throw new GovernedCommandAdmissionError("backend-control-field-unsupported");
    }
    if (!privateOutputTransport) {
      throw new GovernedCommandAdmissionError("capture-disabled");
    }
  }
  if (plan.spawn.scopeKey !== request.scopeKey) {
    throw new GovernedCommandAdmissionError("scope-key-changed");
  }
  // A backend that closes stdin by default reports "pipe-closed"; a request that never opted into stdin means the same.
  if ((plan.spawn.stdinMode ?? "pipe-closed") !== (request.stdinMode ?? "pipe-closed")
    || plan.spawn.interactiveInputPolicy !== request.interactiveInputPolicy) {
    throw new GovernedCommandAdmissionError("backend-control-field-unsupported");
  }
  if (plan.signal !== request.signal) {
    throw new GovernedCommandAdmissionError("authorization-signal-dropped");
  }
  if (plan.lifecycle && (typeof plan.lifecycle.onCancel !== "function"
    || typeof plan.lifecycle.finalize !== "function"
    || plan.spawn.onCancel !== plan.lifecycle.onCancel)) {
    throw new GovernedCommandAdmissionError("backend-control-field-unsupported");
  }
  if (plan.facts.runtimeGenerationId !== undefined
    && (!plan.lifecycle
      || typeof plan.facts.runtimeGenerationId !== "string"
      || !/^lios-exec-[a-z0-9][a-z0-9-]{7,80}$/.test(plan.facts.runtimeGenerationId))) {
    throw new GovernedCommandAdmissionError("backend-control-field-unsupported");
  }
  if (plan.spawn.expectedOperationDigest || plan.spawn.authorizationCheck) {
    throw new GovernedCommandAdmissionError("backend-injected-authority");
  }
  if (
    plan.spawn.runId !== undefined
    || plan.spawn.replaceExistingScope !== undefined
    || plan.spawn.onStdout !== undefined
    || plan.spawn.onStderr !== undefined
    || ((plan.spawn.onStdoutRaw !== undefined || plan.spawn.onStderrRaw !== undefined) && !privateOutputTransport)
    || (hasPrivateOutputControls(plan) && !privateOutputTransport)
  ) {
    throw new GovernedCommandAdmissionError("backend-control-field-unsupported");
  }
}

function freezeOperation(operation: ExecutionOperationDescriptor): ExecutionOperationDescriptor {
  Object.freeze(operation.argv);
  Object.freeze(operation.environment.keys);
  for (const file of operation.files) Object.freeze(file);
  Object.freeze(operation.files);
  Object.freeze(operation.executable);
  Object.freeze(operation.environment);
  Object.freeze(operation.launch.stdin);
  Object.freeze(operation.launch);
  return Object.freeze(operation);
}

export interface GovernedCommandFacts {
  backendId: string;
  isolation: Readonly<ExecutionIsolationRequirements>;
  resources: Readonly<ExecutionResourceLimits>;
  runtimeGenerationId?: string;
  placement?: Readonly<ExecutionPlacementFacts>;
  analysis: Readonly<ExecutionCommandAnalysis> | null;
  intent: Readonly<InternalExecIntentDescriptor> | null;
}

export class PreparedGovernedCommand {
  readonly operation: ExecutionOperationDescriptor;
  readonly facts: GovernedCommandFacts;
  /** Secret-safe digest the approval layer must echo back at execution time. */
  readonly approvalDigest: string;

  private constructor(
    private readonly spawnSnapshot: SpawnInput,
    private readonly cancellationSignal: AbortSignal | undefined,
    private readonly backendLifecycle: ExecutionBackendLifecycle | undefined,
    private readonly placementGrant: ExecutionPlacementGrant | undefined,
    operation: ExecutionOperationDescriptor,
    facts: GovernedCommandFacts,
    approvalDigest: string,
  ) {
    this.operation = freezeOperation(operation);
    this.facts = facts;
    this.approvalDigest = approvalDigest;
    Object.freeze(this);
  }

  static create(
    spawn: SpawnInput,
    cancellationSignal: AbortSignal | undefined,
    lifecycle: ExecutionBackendLifecycle | undefined,
    operation: ExecutionOperationDescriptor,
    facts: GovernedCommandFacts,
    approvalDigest: string,
    placementGrant?: ExecutionPlacementGrant,
  ): PreparedGovernedCommand {
    return new PreparedGovernedCommand(cloneSpawn(spawn), cancellationSignal, lifecycle, placementGrant, operation, facts, approvalDigest);
  }

  launchSnapshot(): SpawnInput {
    return cloneSpawn(this.spawnSnapshot);
  }

  signal(): AbortSignal | undefined {
    return this.cancellationSignal;
  }

  lifecycle(): ExecutionBackendLifecycle | undefined {
    return this.backendLifecycle;
  }

  assertPlacementCurrent(): void {
    this.placementGrant?.assertCurrent();
  }
}

async function prepareFinalPlan(input: {
  backend: ExecutionBackend;
  request: ExecutionBackendRequest;
  operationFilePaths: readonly string[];
  analysis: ExecutionCommandAnalysis | null;
  intent: InternalExecIntentDescriptor | null;
  placement?: ExecutionPlacementGrant;
  retainAcrossApproval?: boolean;
}): Promise<PreparedGovernedCommand> {
  const request = cloneBackendRequest(input.request);
  if (input.placement) {
    input.placement.assertRequest(input.backend, request);
    request.signal = request.signal
      ? AbortSignal.any([request.signal, input.placement.signal])
      : input.placement.signal;
  }
  const conversationScope = currentConversationExecutionScope();
  if (conversationScope) {
    if (request.scopeKey !== undefined && request.scopeKey !== conversationScope.scopeKey) {
      throw new GovernedCommandAdmissionError("conversation-scope-mismatch");
    }
    request.scopeKey = conversationScope.scopeKey;
    if (!input.retainAcrossApproval) {
      request.signal = request.signal
        ? AbortSignal.any([conversationScope.signal, request.signal])
        : conversationScope.signal;
    }
  }
  if (request.signal?.aborted) throw new ExecutionAuthorizationInvalidError("cancelled");
  let plan: ExecutionBackendLaunchPlan;
  try {
    plan = await input.backend.prepare(request);
  } catch (error) {
    if (request.signal?.aborted) throw new ExecutionAuthorizationInvalidError("cancelled");
    throw error;
  }
  if (request.signal?.aborted) throw new ExecutionAuthorizationInvalidError("cancelled");
  input.placement?.assertCurrent();
  assertBackendPlan(input.backend, request, plan);

  const lifecycle = plan.lifecycle;
  const backendLifecycle: ExecutionBackendLifecycle | undefined = lifecycle && Object.freeze({
    onCancel: lifecycle.onCancel.bind(lifecycle),
    onStdoutRaw: lifecycle.onStdoutRaw?.bind(lifecycle),
    onStderrRaw: lifecycle.onStderrRaw?.bind(lifecycle),
    acceptExit: lifecycle.acceptExit?.bind(lifecycle),
    finalize: lifecycle.finalize.bind(lifecycle),
  });
  const finalSpawn = cloneSpawn(plan.spawn);
  if (backendLifecycle) {
    finalSpawn.onCancel = backendLifecycle.onCancel;
    if (backendLifecycle.onStdoutRaw) finalSpawn.onStdoutRaw = backendLifecycle.onStdoutRaw;
    if (backendLifecycle.onStderrRaw) finalSpawn.onStderrRaw = backendLifecycle.onStderrRaw;
  }
  finalSpawn.operationFilePaths = uniqueFilePaths(finalSpawn.operationFilePaths, input.operationFilePaths);
  const operation = await describeExecutionOperation({
    argv: finalSpawn.argv,
    cwd: finalSpawn.cwd,
    env: finalSpawn.env,
    envProfile: finalSpawn.envProfile,
    argv0: finalSpawn.argv0,
    windowsVerbatimArguments: finalSpawn.windowsVerbatimArguments,
    input: finalSpawn.input,
    stdinMode: finalSpawn.stdinMode,
    interactiveInputPolicy: finalSpawn.interactiveInputPolicy,
    filePaths: finalSpawn.operationFilePaths,
  });

  const analysis = input.analysis
    ? Object.freeze({
        ...input.analysis,
        carriers: Object.freeze([...input.analysis.carriers]) as unknown as string[],
        environmentAssignmentKeys: Object.freeze([...input.analysis.environmentAssignmentKeys]) as unknown as string[],
        operationFilePaths: Object.freeze([...input.analysis.operationFilePaths]) as unknown as string[],
      })
    : null;
  const facts: GovernedCommandFacts = Object.freeze({
    backendId: plan.backendId,
    isolation: Object.freeze({ ...plan.facts.isolation }),
    resources: Object.freeze({ ...plan.facts.resources }),
    runtimeGenerationId: plan.facts.runtimeGenerationId,
    placement: input.placement?.facts,
    analysis,
    intent: input.intent,
  });
  const privateOutputTransport = finalSpawn.captureOutput === false
    && typeof backendLifecycle?.acceptExit === "function"
    && typeof finalSpawn.onStdoutRaw === "function"
    && typeof finalSpawn.onStderrRaw === "function";
  const approvalDigest = crypto.createHash("sha256").update(JSON.stringify({
    version: 1,
    operationDigest: operation.digest,
    backendId: facts.backendId,
    runtimeGenerationId: facts.runtimeGenerationId ?? null,
    ...(facts.placement ? { placement: facts.placement } : {}),
    isolation: facts.isolation,
    resources: facts.resources,
    control: {
      scopeKey: finalSpawn.scopeKey ?? null,
      timeoutMs: finalSpawn.timeoutMs ?? null,
      noOutputTimeoutMs: finalSpawn.noOutputTimeoutMs ?? null,
      gracefulCancelMs: finalSpawn.gracefulCancelMs ?? null,
      captureOutput: finalSpawn.captureOutput === true,
      ...(privateOutputTransport ? { privateOutputTransport: true } : {}),
      maxCapturedOutputChars: finalSpawn.maxCapturedOutputChars ?? null,
      hasCancellationHook: finalSpawn.onCancel !== undefined,
    },
  })).digest("hex");
  return PreparedGovernedCommand.create(finalSpawn, plan.signal, backendLifecycle, operation, facts, approvalDigest, input.placement);
}

export async function prepareAnalyzedGovernedCommand(input: {
  backend: ExecutionBackend;
  request: ExecutionBackendRequest;
  placement?: ExecutionPlacementGrant;
}): Promise<PreparedGovernedCommand> {
  const analysis = analyzeExecutionCommand(input.request.argv);
  if (!analysis.analyzable || !analysis.reason && analysis.executable === null) {
    throw new GovernedCommandAnalysisError(analysis.reason ?? "unclassified-command-operands");
  }
  return prepareFinalPlan({
    backend: input.backend,
    request: input.request,
    placement: input.placement,
    operationFilePaths: analysis.operationFilePaths,
    analysis,
    intent: null,
  });
}

export async function prepareInternalExecIntent(input: {
  backend: ExecutionBackend;
  intent: InternalExecIntentRequest;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  isolation: ExecutionIsolationRequirements;
  signal?: AbortSignal;
  scopeKey?: string;
  hardLimits?: Pick<ExecutionResourceLimits, "maxCpuTimeMs" | "maxMemoryBytes" | "maxStorageBytes" | "maxProcesses">;
  placement?: ExecutionPlacementGrant;
  /**
   * The prepared command will wait for a human approval that outlives the preparing run's scope. It keeps the scope
   * key (replay fence) but not that scope's abort signal; the resumed run supplies its own signal at execution.
   */
  retainAcrossApproval?: boolean;
}): Promise<PreparedGovernedCommand> {
  const intent = buildInternalExecIntent(input.intent);
  const allowedEnvironment = new Set(intent.environmentKeys);
  if (Object.keys(input.env ?? {}).some((key) => !allowedEnvironment.has(key))) {
    throw new GovernedCommandAdmissionError("intent-environment-key-unsupported");
  }
  const resources: ExecutionResourceLimits = {
    maxWallTimeMs: intent.timeoutMs,
    maxCapturedOutputChars: intent.maxOutputChars,
    ...input.hardLimits,
  };
  return prepareFinalPlan({
    retainAcrossApproval: input.retainAcrossApproval,
    backend: input.backend,
    placement: input.placement,
    request: {
      argv: [...intent.argv],
      cwd: input.cwd,
      env: input.env ? { ...input.env } : undefined,
      envProfile: intent.envProfile === "default" ? undefined : intent.envProfile,
      isolation: { ...input.isolation },
      resources,
      stdinMode: intent.stdinMode,
      interactiveInputPolicy: intent.interactiveInputPolicy,
      signal: input.signal,
      scopeKey: input.scopeKey,
    },
    operationFilePaths: intent.operationFilePaths,
    analysis: null,
    intent,
  });
}

function sameDigest(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string"
    || !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function secretSafeCancellationSignal(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const sources = Array.from(new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined)));
  const controller = new AbortController();
  const cancel = () => {
    if (!controller.signal.aborted) controller.abort(new ExecutionAuthorizationInvalidError("cancelled"));
  };
  for (const source of sources) source.addEventListener("abort", cancel, { once: true });
  if (sources.some((source) => source.aborted)) cancel();
  return {
    signal: controller.signal,
    dispose: () => { for (const source of sources) source.removeEventListener("abort", cancel); },
  };
}

/**
 * Starts the single approved interactive session. Input is exposed only for the
 * fixed read-only console ExecIntent; each write revalidates the same lease.
 */
export async function startPreparedGovernedCommand(
  prepared: PreparedGovernedCommand,
  authorization: {
    approvedOperationDigest: string;
    approvedDigest: string;
    lease: ExecutionAuthorizationLease;
    currentPolicy: () => CurrentExecutionPolicy;
  },
  supervisor?: ProcessSupervisor,
  options?: {
    signal?: AbortSignal;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  },
): Promise<PreparedSpawnSession> {
  if (!(prepared instanceof PreparedGovernedCommand)) {
    throw new GovernedCommandAdmissionError("launch-invalid");
  }
  if (!sameDigest(prepared.operation.digest, authorization.approvedOperationDigest)
    || !sameDigest(prepared.approvalDigest, authorization.approvedDigest)) {
    throw new GovernedCommandAdmissionError("approval-digest-mismatch");
  }
  if (
    prepared.facts.intent?.intentId !== "sandbox.terminal.readonly" ||
    prepared.facts.intent.interactiveInputPolicy !== "sandbox-readonly-console"
  ) {
    throw new GovernedCommandAdmissionError("launch-invalid");
  }

  authorization.lease.attachCancellationSource(prepared.signal());
  authorization.lease.attachCancellationSource(options?.signal);
  authorization.lease.assertCurrent(authorization.currentPolicy());
  prepared.assertPlacementCurrent();
  const spawn = prepared.launchSnapshot();
  if (spawn.stdinMode !== "pipe-open" || spawn.interactiveInputPolicy !== "sandbox-readonly-console") {
    throw new GovernedCommandAdmissionError("launch-invalid");
  }
  spawn.expectedOperationDigest = authorization.approvedOperationDigest;
  spawn.authorizationCheck = () => {
    prepared.assertPlacementCurrent();
    authorization.lease.assertCurrent(authorization.currentPolicy());
  };
  const combinedSignal = secretSafeCancellationSignal(authorization.lease.signal, prepared.signal(), options?.signal);
  let session: PreparedSpawnSession;
  try {
    session = await startPreparedSpawn(spawn, combinedSignal.signal, supervisor, {
      scopeMode: "exact",
      lifecycle: prepared.lifecycle(),
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });
  } catch (error) {
    combinedSignal.dispose();
    authorization.lease.close();
    throw error;
  }
  let wait: Promise<CommandResult> | null = null;
  return {
    cancel: session.cancel,
    async writeInput(data) {
      authorization.lease.assertCurrent(authorization.currentPolicy());
      prepared.assertPlacementCurrent();
      if (!prepared.facts.intent?.allowedInteractiveInputs?.includes(data)) {
        throw new GovernedCommandAdmissionError("launch-invalid");
      }
      await session.writeInput(data + "\n");
    },
    wait() {
      if (!wait) {
        wait = session.wait().finally(() => {
          combinedSignal.dispose();
          authorization.lease.close();
        });
      }
      return wait;
    },
  };
}

export async function executePreparedGovernedCommand(
  prepared: PreparedGovernedCommand,
  authorization: {
    /** Digest recorded by the independent exact-operation approval decision, not derived here. */
    approvedOperationDigest: string;
    /** Digest of the approved backend, limits, generation and launch controls. */
    approvedDigest: string;
    lease: ExecutionAuthorizationLease;
    currentPolicy: () => CurrentExecutionPolicy;
  },
  supervisor?: ProcessSupervisor,
  options?: { signal?: AbortSignal },
): Promise<CommandResult> {
  if (!(prepared instanceof PreparedGovernedCommand)) {
    throw new GovernedCommandAdmissionError("launch-invalid");
  }
  if (!sameDigest(prepared.operation.digest, authorization.approvedOperationDigest)
    || !sameDigest(prepared.approvalDigest, authorization.approvedDigest)) {
    throw new GovernedCommandAdmissionError("approval-digest-mismatch");
  }

  // First check avoids doing any supervisor admission for already stale work.
  authorization.lease.attachCancellationSource(prepared.signal());
  authorization.lease.attachCancellationSource(options?.signal);
  authorization.lease.assertCurrent(authorization.currentPolicy());
  prepared.assertPlacementCurrent();
  const spawn = prepared.launchSnapshot();
  spawn.expectedOperationDigest = authorization.approvedOperationDigest;
  spawn.authorizationCheck = () => {
    prepared.assertPlacementCurrent();
    authorization.lease.assertCurrent(authorization.currentPolicy());
  };

  const combinedSignal = secretSafeCancellationSignal(authorization.lease.signal, prepared.signal(), options?.signal);
  try {
    return await runPreparedSpawn(spawn, combinedSignal.signal, supervisor, {
      scopeMode: "exact",
      lifecycle: prepared.lifecycle(),
    });
  } finally {
    combinedSignal.dispose();
    authorization.lease.close();
  }
}
