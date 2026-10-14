export const SP02_PACKAGED_CHECK_IDS = [
  "sp02.signin",
  "sp02.project_chat",
  "sp02.bounded_plan",
  "sp02.approval_pause",
  "sp02.approval_bound",
  "sp02.cancel_control",
  "sp02.restart_no_autoresume",
  "sp02.explicit_resume",
  "sp02.no_duplicate_side_effect",
  "sp02.receipt",
] as const;

export type Sp02PackagedCheckId = typeof SP02_PACKAGED_CHECK_IDS[number];

export interface Sp02PackagedCheck {
  id: Sp02PackagedCheckId;
  pass: boolean;
  detail: string;
}

export interface Sp02PackagedEvidence {
  schemaVersion: 2;
  generatedAt: string;
  commit: string;
  platform: string;
  app: string;
  sandboxImage: string;
  aiProvider: string;
  aiModel: string;
  screenshots: string[];
  request: string;
  requestId: string | null;
  projectId: number | null;
  chatId: number | null;
  passed: boolean;
  checks: Sp02PackagedCheck[];
  error?: string;
}

/**
 * The qualification request is intentionally imperative rather than conditional. A real production
 * external-effect capability must provide a provider-certified no-effect first attempt and one committed
 * retry. If the product has no such capability, the packaged journey remains RED; the harness never
 * installs a fixture, changes a tool, or treats assistant prose as evidence.
 */
export const SP02_DEFAULT_REQUEST = [
  "Work as a bounded agent on this Project and execute every step on one run identity.",
  "Create a multi-step plan with explicit maximum steps, duration, and AI-call budgets.",
  "Inspect this Project with lios.project.continuity using no input fields, then calculate 2 + 3 using agent.python.data with code print(2 + 3).",
  "Before the approval-required operation, pause this same run for opaque human review and continue only after I allow it once.",
  "Publish a JSON-backed report of that result through lios.project.publish_object to my configured authenticated external S3 destination using title and content fields. Include the correlation marker in the title and state the computed result in the content.",
  "If that external service is unavailable, use only its real certified no-effect recovery/backoff. When I press Stop, preserve the checkpoint without inventing a sleep/failure/test tool.",
  "After I explicitly resume following restart and allow a fresh request-bound review, retry that exact logical publication with the same idempotency key and an explicit link to the cancelled call. Commit one immutable external object and never dispatch a committed key again.",
  "Finish with a concise persisted result and trust receipt containing tools, sources, assumptions, and the useful result while keeping hidden reasoning private.",
  "If any required production capability or proof is unavailable, fail visibly instead of simulating success.",
].join(" ");

export function buildSp02Request(runMarker: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runMarker)) {
    throw new Error("SP-02 run marker must be a lowercase UUID.");
  }
  return `${SP02_DEFAULT_REQUEST} Correlation marker: ${runMarker}.`;
}

export function hasCompleteSp02CheckSet(checks: readonly Pick<Sp02PackagedCheck, "id" | "pass">[]): boolean {
  if (checks.length !== SP02_PACKAGED_CHECK_IDS.length) return false;
  const byId = new Map(checks.map((check) => [check.id, check] as const));
  if (byId.size !== SP02_PACKAGED_CHECK_IDS.length) return false;
  return SP02_PACKAGED_CHECK_IDS.every((id) => byId.get(id)?.pass === true);
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Structured Gateway plan proof. Prompt/history strings cannot satisfy this predicate. */
export function hasBoundedPlanEvidence(value: unknown, requestId: string): boolean {
  const event = object(value);
  const plan = object(event?.plan);
  const budget = object(plan?.budget);
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (event?.type !== "plan" || event.requestId !== requestId || plan?.requestId !== requestId) return false;
  const maxSteps = number(budget?.maxSteps);
  const maxDurationMs = number(budget?.maxDurationMs);
  const maxAiCalls = number(budget?.maxAiCalls);
  return steps.length >= 2
    && maxSteps !== null && maxSteps >= steps.length && maxSteps <= 50
    && maxDurationMs !== null && maxDurationMs >= 1_000 && maxDurationMs <= 300_000
    && maxAiCalls !== null && maxAiCalls >= 1 && maxAiCalls <= 20;
}

export interface Sp02ApprovalLedgerProof {
  toolCallId: string;
  waitingSeq: number;
  resumedSeq: number;
}

/** Durable same-record proof that the exact waiting call was released; review prose is irrelevant. */
export function inspectApprovalLedger(events: readonly unknown[]): Sp02ApprovalLedgerProof | null {
  const waiting = events.map(object).filter((event): event is Record<string, unknown> => event?.kind === "tool_call_waiting_approval");
  if (waiting.length !== 1) return null;
  const toolCallId = string(waiting[0]?.toolCallId);
  const waitingSeq = number(waiting[0]?.seq);
  if (!toolCallId || waitingSeq === null) return null;
  const resumed = events.map(object).find((event) => event?.kind === "tool_call_resumed" && event.toolCallId === toolCallId);
  const resumedSeq = number(resumed?.seq);
  if (resumedSeq === null || resumedSeq <= waitingSeq || !string(resumed?.approvalRef)) return null;
  return { toolCallId, waitingSeq, resumedSeq };
}

export interface Sp02RecoveryLedgerProof {
  /** The call whose dispatch committed (the resumed call, or the same call for an in-call retry). */
  toolCallId: string;
  noEffectToolCallId: string;
  idempotencyKey: string;
  noEffectAttempt: number;
  committedAttempt: number;
  durableCommitCount: 1;
  commitRef: string;
}

interface LedgerEvent {
  [key: string]: unknown;
}

/**
 * Durable exactly-once proof for the induced recoverable external-effect failure, scoped to ONE idempotency key across
 * calls: exactly one dispatch proven no-effect, exactly one later commit, two dispatch intents, and one successful terminal
 * record for the committing call after that commit. When the retry ran in a different call, the committing call must be
 * explicitly linked (`resumesToolCallId`, transitively) to the call that held the no-effect attempt; every link target must
 * share step, tool and exact input and have been finished `cancelled` BEFORE the linked call started (no call reopened).
 */
export function inspectRecoveryLedger(events: readonly unknown[]): Sp02RecoveryLedgerProof | null {
  const parsed = events.map(object).filter((event): event is LedgerEvent => event !== null);
  const startedByCall = new Map<string, LedgerEvent>();
  for (const event of parsed) {
    const id = event.kind === "tool_call_started" ? string(event.toolCallId) : null;
    if (id && !startedByCall.has(id)) startedByCall.set(id, event);
  }
  const finishedByCall = new Map<string, LedgerEvent[]>();
  for (const event of parsed) {
    const id = event.kind === "tool_call_finished" ? string(event.toolCallId) : null;
    if (id) finishedByCall.set(id, [...(finishedByCall.get(id) ?? []), event]);
  }
  const dispatchKinds = ["tool_call_dispatch_intent", "tool_call_dispatch_no_effect", "tool_call_dispatch_committed"];
  const keys = new Set(parsed.filter((event) => dispatchKinds.includes(String(event.kind))).map((event) => string(event.idempotencyKey)));

  for (const key of keys) {
    if (!key) continue;
    const scoped = parsed.filter((event) => dispatchKinds.includes(String(event.kind)) && event.idempotencyKey === key);
    const intents = scoped.filter((event) => event.kind === "tool_call_dispatch_intent");
    const noEffects = scoped.filter((event) => event.kind === "tool_call_dispatch_no_effect");
    const commits = scoped.filter((event) => event.kind === "tool_call_dispatch_committed");
    if (intents.length !== 2 || noEffects.length !== 1 || commits.length !== 1) continue;
    const noEffect = noEffects[0]!;
    const commit = commits[0]!;
    const noEffectCall = string(noEffect.toolCallId);
    const commitCall = string(commit.toolCallId);
    const noEffectSeq = number(noEffect.seq);
    const commitSeq = number(commit.seq);
    const noEffectAttempt = number(noEffect.attempt);
    const committedAttempt = number(commit.attempt);
    const commitRef = string(commit.commitRef);
    if (!noEffectCall || !commitCall || noEffectSeq === null || commitSeq === null || noEffectAttempt === null || committedAttempt === null) continue;
    if (!commitRef || !string(noEffect.reconciliationRef) || noEffectSeq >= commitSeq) continue;

    // Each attempt has its own durable intent in the call that ran it: no-effect's before it, the commit's between the two.
    const firstIntent = intents.find((event) => event.toolCallId === noEffectCall && number(event.attempt) === noEffectAttempt && (number(event.seq) ?? Infinity) < noEffectSeq);
    const retryIntent = intents.find((event) => event !== firstIntent && event.toolCallId === commitCall && number(event.attempt) === committedAttempt
      && (number(event.seq) ?? -1) > noEffectSeq && (number(event.seq) ?? Infinity) < commitSeq);
    if (!firstIntent || !retryIntent) continue;

    const noEffectStart = startedByCall.get(noEffectCall);
    const commitStart = startedByCall.get(commitCall);
    if (!noEffectStart || !commitStart || noEffectStart.sideEffect !== "external" || commitStart.sideEffect !== "external") continue;
    if (["stepId", "toolId", "inputSha256"].some((field) => !string(commitStart[field]) || noEffectStart[field] !== commitStart[field])) continue;

    if (noEffectCall === commitCall) {
      if (noEffectAttempt !== 1 || committedAttempt !== 2) continue;
    } else {
      // Walk the explicit link chain from the committing call back to the call that held the no-effect attempt.
      let current = commitStart;
      let linked = false;
      for (let depth = 0; depth < 10 && !linked; depth += 1) {
        const previousId = string(current.resumesToolCallId);
        const previous = previousId ? startedByCall.get(previousId) : undefined;
        if (!previousId || !previous) break;
        if (["stepId", "toolId", "inputSha256"].some((field) => previous[field] !== current[field])) break;
        const closed = (finishedByCall.get(previousId) ?? []);
        const closedAt = number(closed[0]?.seq);
        const startedAt = number(current.seq);
        if (closed.length !== 1 || closed[0]?.status !== "cancelled" || closedAt === null || startedAt === null || closedAt >= startedAt) break;
        linked = previousId === noEffectCall;
        current = previous;
      }
      if (!linked) continue;
    }

    const finished = finishedByCall.get(commitCall) ?? [];
    const finishedSeq = number(finished[0]?.seq);
    if (finished.length !== 1 || finished[0]?.status !== "succeeded" || finishedSeq === null || finishedSeq <= commitSeq) continue;
    return {
      toolCallId: commitCall,
      noEffectToolCallId: noEffectCall,
      idempotencyKey: key,
      noEffectAttempt,
      committedAttempt,
      durableCommitCount: 1,
      commitRef,
    };
  }
  return null;
}

/** The renderer's compact receipt must contain one exact run and a completed terminal event. */
export function hasPersistedReceiptEvidence(events: readonly unknown[], requestId: string): boolean {
  if (!events.length) return false;
  const parsed = events.map(object);
  if (parsed.some((event) => event === null || event.requestId !== requestId)) return false;
  const plan = parsed.find((event) => event?.type === "plan");
  const done = parsed.findLast((event) => event?.type === "done");
  return hasBoundedPlanEvidence(plan, requestId) && done?.status === "completed";
}

const IMMUTABLE_SANDBOX_IMAGE = /^(?:[a-z0-9][a-z0-9._/:+-]*@)?sha256:[a-f0-9]{64}$/i;

/**
 * The strict-isolation image the packaged journey launches the app with. It must be supplied explicitly through
 * LIOS_SP02_SANDBOX_IMAGE (a named OCI reference pinned with @sha256:<64 hex>, or a local image id sha256:<64 hex>).
 * There is no default: a mutable tag or an absent value fails before the app is launched.
 */
export function requireImmutableSandboxImage(value: string | undefined): string {
  const image = value?.trim();
  if (!image) {
    throw new Error("LIOS_SP02_SANDBOX_IMAGE is required: set it to the approved immutable sandbox image (name@sha256:<64 hex> or sha256:<64 hex>). No default is used.");
  }
  if (!IMMUTABLE_SANDBOX_IMAGE.test(image)) {
    throw new Error("LIOS_SP02_SANDBOX_IMAGE must be pinned by sha256 digest; mutable tags are refused.");
  }
  return image;
}
