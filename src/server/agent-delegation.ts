import crypto from "node:crypto";
import {
  AGENT_ROLE_REGISTRY,
  conversationContextEnvelopeSchema,
  type AgentRole,
  type ConversationContextEnvelope,
} from "@shared/conversationRuntime";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RECEIPT_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,299}$/;
const SECRET_WORD = /(secret|password|passwd|token|api[-_]?key|authorization|bearer)/i;
export const MAX_AGENT_DELEGATION_DEPTH = 4;

export interface AgentDelegationOwner {
  userId: number;
  organizationId: number | null;
}

export interface AgentDelegationBudget {
  maxSteps: number;
  maxAiCalls: number;
  maxRevisions: number;
  maxDurationMs: number;
}

export interface AgentDelegationRecord {
  version: 1;
  /** The canonical conversation run id. Children never get a second session identity. */
  requestId: string;
  delegationId: string;
  parentDelegationId: string | null;
  depth: number;
  role: AgentRole;
  owner: Readonly<AgentDelegationOwner>;
  contextSha256: string;
  objectiveSha256: string;
  budget: Readonly<AgentDelegationBudget>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(
    typeof value === "string" ? value : canonicalJson(value),
  ).digest("hex");
}

function assertRequestId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("Agent delegation requires the canonical lowercase UUID requestId.");
  }
  return value;
}

function assertOpaqueId(value: string, field: string): string {
  if (!OPAQUE_ID.test(value)) throw new Error(`Agent delegation ${field} is invalid.`);
  return value;
}

function assertOwner(owner: AgentDelegationOwner, label: string): AgentDelegationOwner {
  if (!Number.isSafeInteger(owner.userId) || owner.userId <= 0) {
    throw new Error(`Agent delegation ${label} userId is invalid.`);
  }
  if (owner.organizationId !== null && (!Number.isSafeInteger(owner.organizationId) || owner.organizationId <= 0)) {
    throw new Error(`Agent delegation ${label} organizationId is invalid.`);
  }
  return owner;
}

function assertBudget(
  budget: AgentDelegationBudget,
  label: string,
  options: { allowExhausted: boolean },
): AgentDelegationBudget {
  const integer = (value: number, field: keyof AgentDelegationBudget, minimum: number): number => {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`Agent delegation ${label} ${field} is invalid.`);
    }
    return value;
  };
  return Object.freeze({
    maxSteps: integer(budget.maxSteps, "maxSteps", options.allowExhausted ? 0 : 1),
    maxAiCalls: integer(budget.maxAiCalls, "maxAiCalls", 0),
    maxRevisions: integer(budget.maxRevisions, "maxRevisions", 0),
    maxDurationMs: integer(budget.maxDurationMs, "maxDurationMs", options.allowExhausted ? 0 : 1_000),
  });
}

export function agentDelegationContextSha256(context: ConversationContextEnvelope): string {
  const parsed = conversationContextEnvelopeSchema.parse(context);
  return sha256(parsed);
}

/**
 * Allocate one child budget from the parent's remaining pool.
 *
 * The returned remainder is intended to become the next authoritative
 * remaining-budget input, so sibling allocations cannot collectively exceed
 * the parent when the caller serializes allocations through its run owner.
 */
export function allocateAgentDelegationBudget(
  parentRemainingInput: AgentDelegationBudget,
  requestedInput: AgentDelegationBudget,
): {
  child: Readonly<AgentDelegationBudget>;
  remainingParent: Readonly<AgentDelegationBudget>;
} {
  const parent = assertBudget(parentRemainingInput, "parent budget", { allowExhausted: true });
  const requested = assertBudget(requestedInput, "child budget", { allowExhausted: false });

  for (const field of ["maxSteps", "maxAiCalls", "maxRevisions", "maxDurationMs"] as const) {
    if (requested[field] > parent[field]) {
      throw new Error(`Agent delegation child ${field} exceeds the parent remaining budget.`);
    }
  }

  return Object.freeze({
    child: requested,
    remainingParent: Object.freeze({
      maxSteps: parent.maxSteps - requested.maxSteps,
      maxAiCalls: parent.maxAiCalls - requested.maxAiCalls,
      maxRevisions: parent.maxRevisions - requested.maxRevisions,
      maxDurationMs: parent.maxDurationMs - requested.maxDurationMs,
    }),
  });
}

/**
 * Secret-safe delegation metadata. This binds a child specialist to the same
 * conversation run, owner and five-level LiOS context without storing the raw
 * objective or context in a second runtime authority.
 */
export function createAgentDelegationRecord(input: {
  requestId: string;
  delegationId: string;
  parentDelegationId: string | null;
  depth: number;
  role: AgentRole;
  objective: string;
  parentOwner: AgentDelegationOwner;
  childOwner: AgentDelegationOwner;
  parentContext: ConversationContextEnvelope;
  childContext: ConversationContextEnvelope;
  budget: AgentDelegationBudget;
}): AgentDelegationRecord {
  const requestId = assertRequestId(input.requestId);
  const delegationId = assertOpaqueId(input.delegationId, "delegationId");
  const parentDelegationId = input.parentDelegationId === null
    ? null
    : assertOpaqueId(input.parentDelegationId, "parentDelegationId");

  if (!Number.isSafeInteger(input.depth) || input.depth < 0 || input.depth > MAX_AGENT_DELEGATION_DEPTH) {
    throw new Error(`Agent delegation depth must be between 0 and ${MAX_AGENT_DELEGATION_DEPTH}.`);
  }
  if (input.depth === 0 && parentDelegationId !== null) {
    throw new Error("Root delegation cannot declare a parent delegation.");
  }
  if (input.depth > 0 && parentDelegationId === null) {
    throw new Error("Child delegation requires a parent delegation.");
  }
  if (parentDelegationId === delegationId) {
    throw new Error("Agent delegation cannot be its own parent.");
  }

  const parentOwner = assertOwner(input.parentOwner, "parent owner");
  const childOwner = assertOwner(input.childOwner, "child owner");
  if (
    parentOwner.userId !== childOwner.userId ||
    parentOwner.organizationId !== childOwner.organizationId
  ) {
    throw new Error("Agent delegation cannot change run ownership.");
  }

  if (!(AGENT_ROLE_REGISTRY as readonly string[]).includes(input.role)) {
    throw new Error("Agent delegation role is invalid.");
  }

  const parentContext = conversationContextEnvelopeSchema.parse(input.parentContext);
  const childContext = conversationContextEnvelopeSchema.parse(input.childContext);
  if (
    parentContext.identity.userId !== parentOwner.userId ||
    parentContext.identity.organizationId !== parentOwner.organizationId
  ) {
    throw new Error("Agent delegation owner does not match the bound context identity.");
  }
  const parentContextSha256 = sha256(parentContext);
  const childContextSha256 = sha256(childContext);
  if (!crypto.timingSafeEqual(
    Buffer.from(parentContextSha256, "hex"),
    Buffer.from(childContextSha256, "hex"),
  )) {
    throw new Error("Agent delegation cannot widen or replace the parent context envelope.");
  }

  if (typeof input.objective !== "string" || !input.objective.trim() || input.objective.length > 5_000) {
    throw new Error("Agent delegation objective is invalid.");
  }

  const budget = assertBudget(input.budget, "budget", { allowExhausted: false });
  const objectiveSha256 = sha256(input.objective);
  if (!SHA256.test(objectiveSha256)) throw new Error("Agent delegation objective hash is invalid.");

  return Object.freeze({
    version: 1 as const,
    requestId,
    delegationId,
    parentDelegationId,
    depth: input.depth,
    role: input.role,
    owner: Object.freeze({ ...parentOwner }),
    contextSha256: parentContextSha256,
    objectiveSha256,
    budget,
  });
}


export type AgentDelegationReceiptStatus = "completed" | "failed" | "cancelled" | "denied" | "timed_out";

export interface AgentDelegationUsage {
  stepsUsed: number;
  aiCallsUsed: number;
  revisionsUsed: number;
  durationMs: number;
}

export interface AgentDelegationReceipt {
  version: 2;
  requestId: string;
  delegationId: string;
  parentDelegationId: string | null;
  role: AgentRole;
  status: AgentDelegationReceiptStatus;
  contextSha256: string;
  objectiveSha256: string;
  allocatedBudget: Readonly<AgentDelegationBudget>;
  /** Null means unmeasured partial execution, not zero consumption or a budget refund. */
  used: Readonly<AgentDelegationUsage> | null;
  sourceRefs: readonly string[];
  toolReceiptRefs: readonly string[];
  resultRef: string | null;
}

function assertReceiptRef(value: string, label: string): string {
  if (!RECEIPT_REF.test(value) || SECRET_WORD.test(value)) {
    throw new Error(`Agent delegation ${label} must be a bounded secret-safe reference.`);
  }
  return value;
}

function uniqueRefs(values: readonly string[], label: string): readonly string[] {
  if (values.length > 100) throw new Error(`Agent delegation ${label} exceeds the receipt bound.`);
  const checked = values.map((value) => assertReceiptRef(value, label));
  if (new Set(checked).size !== checked.length) {
    throw new Error(`Agent delegation ${label} must be unique.`);
  }
  return Object.freeze([...checked]);
}

function assertUsage(
  usage: AgentDelegationUsage,
  allocated: Readonly<AgentDelegationBudget>,
): Readonly<AgentDelegationUsage> {
  const value = {
    stepsUsed: usage.stepsUsed,
    aiCallsUsed: usage.aiCallsUsed,
    revisionsUsed: usage.revisionsUsed,
    durationMs: usage.durationMs,
  };
  for (const [field, amount] of Object.entries(value)) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`Agent delegation receipt ${field} is invalid.`);
    }
  }
  if (
    value.stepsUsed > allocated.maxSteps ||
    value.aiCallsUsed > allocated.maxAiCalls ||
    value.revisionsUsed > allocated.maxRevisions ||
    value.durationMs > allocated.maxDurationMs
  ) {
    throw new Error("Agent delegation receipt usage exceeds the allocated child budget.");
  }
  return Object.freeze(value);
}

/**
 * Creates the concise secret-safe receipt required for every terminal delegate.
 * It intentionally contains no objective text, prompt, tool arguments/results,
 * model reasoning or free-form summary. Rich output remains behind opaque refs.
 */
export function createAgentDelegationReceipt(
  delegation: AgentDelegationRecord,
  input: {
    status: AgentDelegationReceiptStatus;
    used: AgentDelegationUsage | null;
    sourceRefs?: readonly string[];
    toolReceiptRefs?: readonly string[];
    resultRef?: string | null;
  },
): AgentDelegationReceipt {
  if (!["completed", "failed", "cancelled", "denied", "timed_out"].includes(input.status)) {
    throw new Error("Agent delegation receipt status is invalid.");
  }
  if (input.status === "completed" && input.used === null) {
    throw new Error("Completed agent delegation requires measured usage.");
  }
  const sourceRefs = uniqueRefs(input.sourceRefs ?? [], "sourceRefs");
  const toolReceiptRefs = uniqueRefs(input.toolReceiptRefs ?? [], "toolReceiptRefs");
  const resultRef = input.resultRef == null ? null : assertReceiptRef(input.resultRef, "resultRef");
  return Object.freeze({
    version: 2 as const,
    requestId: delegation.requestId,
    delegationId: delegation.delegationId,
    parentDelegationId: delegation.parentDelegationId,
    role: delegation.role,
    status: input.status,
    contextSha256: delegation.contextSha256,
    objectiveSha256: delegation.objectiveSha256,
    allocatedBudget: delegation.budget,
    used: input.used === null ? null : assertUsage(input.used, delegation.budget),
    sourceRefs,
    toolReceiptRefs,
    resultRef,
  });
}
