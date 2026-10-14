import crypto from "node:crypto";
import type { PreparedGovernedCommand } from "./exec/authority/governed-command";
import { createExecutionPolicySnapshot, ExecutionAuthorizationLease } from "./exec/execution-authorization";
import type { CurrentExecutionPolicy, ExecutionApprovalPermissionClass } from "./exec/execution-authorization";
import { getProjectChat } from "./projectChatStore";
import { and, eq } from "drizzle-orm";
import { conversationActionGrants } from "@shared/schema";
import { ACTION_POLICY_CLASS, type ApprovalGrant, type ConversationActionName } from "@shared/conversationRuntime";
import { getDb } from "./db";
import { getProject } from "./projectStore";
import { tenantContext } from "./tenantContext";
import type { TenantContext } from "./tenantContext";
import type { z } from "zod";
import type { RuntimePermissionClass } from "@shared/runtimeContracts";

/**
 * Server-side authority for conversation action grants (GM-11a, owner decision Q6).
 *
 *  - "Allow for this Project" is a row in `conversation_action_grants`, owned by the user and scoped to one Project.
 *  - "Allow once" is single-use and bound to the user, the pending request and the action. It lives in memory with a
 *    short lifetime: a restart simply asks again.
 *
 * A conversation request never carries grants. `applyServerApprovals` replaces whatever the body claimed, so a stale
 * browser cache, a pasted payload or another paired device cannot approve anything the user did not approve here.
 */

export const ONCE_APPROVAL_TTL_MS = 15 * 60_000;
const MAX_PENDING_ONCE = 500;

export type ConversationGrantUser = Parameters<typeof tenantContext>[0];
type GrantUser = ConversationGrantUser;

export class ConversationGrantError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ConversationGrantError";
  }
}

interface OnceGrant {
  kind: "action";
  expiresAt: number;
}

/** Pending tool grants share GM-11a's bounded, restart-ephemeral grant authority. */
interface PendingToolGrant {
  kind: "tool";
  expiresAt: number;
  binding: GovernedToolBinding;
  descriptor: GovernedToolApprovalDescriptor;
  role: string;
  policy: CurrentExecutionPolicy;
  runSignal: AbortSignal;
  currentPolicy: () => CurrentExecutionPolicy;
  approvedScope: "once" | "project" | null;
  reviewing: boolean;
  invalidated: boolean;
  authorization: GovernedToolAuthorization | null;
}

const onceGrants = new Map<string, OnceGrant | PendingToolGrant>();


interface PendingExactOperation {
  owner: { userId: number; projectId: number; chatId: number };
  /** Present for nested agent ExecIntents; binds this prepared command to the existing L2 tool call. */
  toolCallId: string | null;
  prepared: PreparedGovernedCommand;
  policy: CurrentExecutionPolicy;
  issuedAtMs: number;
  expiresAtMs: number;
  reviewing: boolean;
  /** Set only by the combined governed-tool owner review; not executable until governed authorization resolves. */
  governedReviewed: boolean;
  approved: boolean;
}

// This is approval authority, not a process/session registry. Restart discards grants;
// encrypted execution history remains owned by the existing journal.
const exactOperations = new Map<string, PendingExactOperation>();
const MAX_PENDING_EXACT_OPERATIONS = 100;
const EXACT_OPERATION_TTL_MS = 5 * 60_000;
const EXACT_TOOL_CALL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function pruneExactOperations(now: number): void {
  for (const [id, pending] of exactOperations) if (pending.expiresAtMs <= now) exactOperations.delete(id);
  while (exactOperations.size >= MAX_PENDING_EXACT_OPERATIONS) {
    const oldest = exactOperations.keys().next().value;
    if (oldest === undefined) break;
    exactOperations.delete(oldest);
  }
}

async function assertExactOperationOwner(user: GrantUser, projectId: number, chatId: number) {
  const ctx = tenantContext(user);
  const chat = await getProjectChat(ctx, chatId);
  if (chat.scope !== "project" || chat.projectId !== projectId) {
    throw new ConversationGrantError(404, "This exact operation is not in the requested Project/Chat.");
  }
  return ctx.userId;
}

/** The backend plan must already exist server-side. Never accept client argv or a client-minted digest. */
export async function proposeExactConversationOperation(input: {
  user: GrantUser;
  projectId: number;
  chatId: number;
  requestId: string;
  /** Optional existing L2 call identity. L9 always supplies this; legacy exact-operation callers may omit it. */
  toolCallId?: string | null;
  prepared: PreparedGovernedCommand;
  policy: CurrentExecutionPolicy;
  now?: number;
}): Promise<{
  requestId: string;
  label: string;
  argv: readonly string[];
  cwd: string;
  backendId: string;
  operationDigest: string;
  approvalDigest: string;
  policyRevision: string;
  permissionClass: ExecutionApprovalPermissionClass;
  expiresAtMs: number;
}> {
  const userId = await assertExactOperationOwner(input.user, input.projectId, input.chatId);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(input.requestId)
    || (input.toolCallId != null && !EXACT_TOOL_CALL_ID.test(input.toolCallId))
    || !(input.prepared.operation.digest && input.prepared.approvalDigest)) {
    throw new ConversationGrantError(400, "An exact operation must have a valid request and prepared identity.");
  }
  const now = input.now ?? Date.now();
  const snapshot = createExecutionPolicySnapshot({
    ...input.policy, issuedAtMs: now, expiresAtMs: now + EXACT_OPERATION_TTL_MS,
  });
  pruneExactOperations(now);
  if (exactOperations.has(input.requestId)) throw new ConversationGrantError(409, "An operation already uses this request id.");
  exactOperations.set(input.requestId, {
    owner: { userId, projectId: input.projectId, chatId: input.chatId },
    toolCallId: input.toolCallId ?? null,
    prepared: input.prepared,
    policy: { permissionClass: snapshot.permissionClass, policyRevision: snapshot.policyRevision },
    issuedAtMs: now,
    expiresAtMs: snapshot.expiresAtMs,
    reviewing: false,
    governedReviewed: false,
    approved: false,
  });
  return {
    requestId: input.requestId,
    label: input.prepared.facts.intent?.label ?? "Governed sandbox operation",
    argv: input.prepared.operation.argv,
    cwd: input.prepared.operation.cwd,
    backendId: input.prepared.facts.backendId,
    operationDigest: input.prepared.operation.digest,
    approvalDigest: input.prepared.approvalDigest,
    policyRevision: snapshot.policyRevision,
    permissionClass: snapshot.permissionClass,
    expiresAtMs: snapshot.expiresAtMs,
  };
}

/** A signed-in human must explicitly accept the displayed exact operation and backend digest. */
export async function reviewExactConversationOperation(input: {
  user: GrantUser;
  projectId: number;
  chatId: number;
  requestId: string;
  operationDigest: string;
  approvalDigest: string;
  allow: boolean;
  now?: number;
}): Promise<{ allowed: boolean; prepared: PreparedGovernedCommand; policy: CurrentExecutionPolicy }> {
  const userId = await assertExactOperationOwner(input.user, input.projectId, input.chatId);
  const pending = exactOperations.get(input.requestId);
  if (!pending || pending.owner.userId !== userId || pending.owner.projectId !== input.projectId
    || pending.owner.chatId !== input.chatId) throw new ConversationGrantError(404, "Exact operation not found.");
  if (pending.expiresAtMs <= (input.now ?? Date.now())) {
    exactOperations.delete(input.requestId);
    throw new ConversationGrantError(409, "Exact operation review expired.");
  }
  if (pending.toolCallId !== null) {
    throw new ConversationGrantError(409, "Agent exact operations must be reviewed with their governed tool call.");
  }
  if (pending.reviewing || pending.approved) throw new ConversationGrantError(409, "Exact operation is reviewing or was already approved.");
  if (input.operationDigest !== pending.prepared.operation.digest
    || input.approvalDigest !== pending.prepared.approvalDigest) {
    throw new ConversationGrantError(409, "The reviewed exact operation changed.");
  }
  if (!input.allow) {
    exactOperations.delete(input.requestId);
    return { allowed: false, prepared: pending.prepared, policy: pending.policy };
  }
  pending.approved = true;
  return { allowed: true, prepared: pending.prepared, policy: pending.policy };
}

/** Synchronous removal fences replay before any asynchronous launch or journal admission. */
export async function consumeExactConversationOperation(input: {
  user: GrantUser;
  projectId: number;
  chatId: number;
  requestId: string;
  /** Required when the pending exact operation is bound to an L2 agent tool call. */
  toolCallId?: string | null;
  now?: number;
}): Promise<{
  prepared: PreparedGovernedCommand;
  approvedOperationDigest: string;
  approvedDigest: string;
  lease: ExecutionAuthorizationLease;
  policy: CurrentExecutionPolicy;
}> {
  const userId = await assertExactOperationOwner(input.user, input.projectId, input.chatId);
  const pending = exactOperations.get(input.requestId);
  if (!pending || pending.owner.userId !== userId || pending.owner.projectId !== input.projectId
    || pending.owner.chatId !== input.chatId || !pending.approved
    || (pending.toolCallId !== null && pending.toolCallId !== input.toolCallId)) {
    throw new ConversationGrantError(404, "Approved exact operation not found.");
  }
  exactOperations.delete(input.requestId);
  const now = input.now ?? Date.now();
  if (now >= pending.expiresAtMs) throw new ConversationGrantError(409, "Exact operation approval expired.");
  const snapshot = createExecutionPolicySnapshot({
    ...pending.policy, issuedAtMs: pending.issuedAtMs, expiresAtMs: pending.expiresAtMs,
  });
  return {
    prepared: pending.prepared,
    approvedOperationDigest: pending.prepared.operation.digest,
    approvedDigest: pending.prepared.approvalDigest,
    lease: new ExecutionAuthorizationLease(snapshot),
    policy: pending.policy,
  };
}

function onceKey(userId: number, requestId: string, subject: string): string {
  return `${userId}:${requestId}:${subject}`;
}

function pruneOnce(now: number): void {
  for (const [key, grant] of onceGrants) {
    if (grant.expiresAt <= now) {
      if (grant.kind === "tool") grant.authorization?.lease.close();
      onceGrants.delete(key);
    }
  }
  // Bounded: the oldest approvals go first if something floods the endpoint.
  while (onceGrants.size > MAX_PENDING_ONCE) {
    const oldest = onceGrants.keys().next().value;
    if (oldest === undefined) break;
    const grant = onceGrants.get(oldest);
    if (grant?.kind === "tool") grant.authorization?.lease.close();
    onceGrants.delete(oldest);
  }
}

/** Only actions that need a decision can be granted; auto-allowed and denied actions never get a grant. */
export function assertGrantable(action: ConversationActionName): void {
  const policy = ACTION_POLICY_CLASS[action];
  if (policy !== "user_confirm" && policy !== "admin_confirm") {
    throw new ConversationGrantError(400, `"${action}" does not need an approval.`);
  }
}

export interface RecordGrantInput {
  user: GrantUser;
  action: ConversationActionName;
  scope: ApprovalGrant["scope"];
  /** The pending request being approved (required for "once"). */
  requestId?: string | null;
  /** The Project the grant belongs to (required for "project"). */
  projectId?: number | null;
  now?: number;
}

export async function recordConversationGrant(input: RecordGrantInput): Promise<void> {
  assertGrantable(input.action);
  const ctx = tenantContext(input.user);
  if (input.scope === "once") {
    if (!input.requestId) throw new ConversationGrantError(400, "A one-time approval must name the request it approves.");
    const now = input.now ?? Date.now();
    pruneOnce(now);
    onceGrants.set(onceKey(ctx.userId, input.requestId, input.action), { kind: "action", expiresAt: now + ONCE_APPROVAL_TTL_MS });
    return;
  }
  if (!input.projectId) throw new ConversationGrantError(400, "A Project approval must name its Project.");
  await getProject(ctx, input.projectId); // throws if the user cannot access this Project
  await getDb().insert(conversationActionGrants).values({
    id: crypto.randomUUID(),
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    projectId: input.projectId,
    action: input.action,
  }).onConflictDoNothing();
}

export async function listProjectGrants(user: GrantUser, projectId: number): Promise<ApprovalGrant[]> {
  const ctx = tenantContext(user);
  await getProject(ctx, projectId);
  const rows = await getDb().select({ action: conversationActionGrants.action }).from(conversationActionGrants)
    .where(and(eq(conversationActionGrants.projectId, projectId), eq(conversationActionGrants.ownerUserId, ctx.userId)));
  return rows
    .filter((row): row is { action: ConversationActionName } => row.action in ACTION_POLICY_CLASS)
    .map((row) => ({ action: row.action, scope: "project" as const }));
}

export async function revokeProjectGrant(user: GrantUser, projectId: number, action: ConversationActionName): Promise<void> {
  const ctx = tenantContext(user);
  await getProject(ctx, projectId);
  await getDb().delete(conversationActionGrants).where(and(
    eq(conversationActionGrants.projectId, projectId),
    eq(conversationActionGrants.ownerUserId, ctx.userId),
    eq(conversationActionGrants.action, action),
  ));
}

export interface EffectiveApprovalsInput {
  user: GrantUser;
  /** Project chats see Project grants; Quick and Temporary chats never do. */
  projectId: number | null;
  /** The original request being continued after an approval, if any. Each once-approval is consumed here. */
  continuationOf: string | null;
  now?: number;
}

/** The grants this run is allowed to rely on. Consumes any one-time approvals it uses. */
export async function effectiveApprovals(input: EffectiveApprovalsInput): Promise<ApprovalGrant[]> {
  const ctx: TenantContext = tenantContext(input.user);
  const grants: ApprovalGrant[] = input.projectId ? await listProjectGrants(input.user, input.projectId) : [];
  if (input.continuationOf) {
    const now = input.now ?? Date.now();
    pruneOnce(now);
    for (const action of Object.keys(ACTION_POLICY_CLASS) as ConversationActionName[]) {
      const key = onceKey(ctx.userId, input.continuationOf, action);
      const once = onceGrants.get(key);
      if (!once || once.kind !== "action") continue;
      onceGrants.delete(key); // single-use
      if (once.expiresAt > now && !grants.some((grant) => grant.action === action)) grants.push({ action, scope: "once" });
    }
  }
  return grants;
}

/** Test seam: forget every pending one-time approval. */
export function clearOnceApprovals(): void {
  for (const grant of onceGrants.values()) {
    if (grant.kind === "tool") grant.authorization?.lease.close();
  }
  onceGrants.clear();
}

export interface GovernedToolBinding {
  readonly userId: number;
  readonly projectId: number | null;
  readonly chatId: number | null;
  readonly requestId: string;
  readonly stepId: string;
  readonly toolCallId: string;
  readonly toolId: string;
  readonly inputSha256: string;
  readonly planHash: string;
}

export interface GovernedToolAuthorization {
  readonly reviewId: string;
  readonly binding: GovernedToolBinding;
  readonly grant: Readonly<{ scope: "once" | "project"; expiresAt: string }>;
  readonly lease: ExecutionAuthorizationLease;
  readonly policy: Readonly<CurrentExecutionPolicy>;
}

/** Exact immutable object returned by the canonical tool registry, never a wire/list projection. */
export interface GovernedToolApprovalDescriptor {
  readonly id: string;
  readonly permissionClass: RuntimePermissionClass;
  readonly allowProjectApproval?: boolean;
  readonly inputSchema?: z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>;
}

const TOOL_APPROVAL_TTL_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const TOOL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** Serialize validated JSON deterministically; reject values JSON would drop or reinterpret. */
function serializeGovernedToolInput(input: Record<string, unknown>): string {
  const seen = new Set<object>();
  function canonical(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== "object" || value === null || seen.has(value)) {
      throw new ConversationGrantError(400, "Tool approval requires finite JSON input.");
    }
    seen.add(value);
    let result: string;
    if (Array.isArray(value)) {
      // Holes and undefined must not hash as null.
      result = `[${Array.from(value, canonical).join(",")}]`;
    } else {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new ConversationGrantError(400, "Tool approval requires plain JSON input.");
      }
      const record = value as Record<string, unknown>;
      result = `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
    }
    seen.delete(value);
    return result;
  }
  return canonical(input);
}

export function governedToolInputSha256(input: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(serializeGovernedToolInput(input)).digest("hex");
}

/** Only schema-parsed JSON arguments are cloned; trusted tenant/functions/signals never enter this snapshot. */
export function snapshotGovernedToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = JSON.parse(serializeGovernedToolInput(input));
  function freeze(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  freeze(snapshot);
  return snapshot;
}

function toolGrantKey(reviewId: string): string {
  return `tool-review:${reviewId}`;
}

function pendingToolGrant(reviewId: string): PendingToolGrant {
  const pending = onceGrants.get(toolGrantKey(reviewId));
  if (!pending || pending.kind !== "tool") throw new ConversationGrantError(409, "Tool approval is unavailable or already consumed.");
  return pending;
}

function assertToolOwner(pending: PendingToolGrant, user: GrantUser, requestId: string): void {
  const ctx = tenantContext(user);
  if (ctx.userId !== pending.binding.userId || requestId !== pending.binding.requestId) {
    throw new ConversationGrantError(404, "Tool approval not found.");
  }
  if (pending.policy.permissionClass === "admin_confirm"
    && ctx.role !== "internal_admin" && ctx.role !== "client_admin") {
    throw new ConversationGrantError(403, "Administrator approval is required.");
  }
}

function assertPendingToolCurrent(pending: PendingToolGrant, now: number): void {
  const policy = pending.currentPolicy();
  if (pending.invalidated || pending.runSignal.aborted || now >= pending.expiresAt
    || policy.permissionClass !== pending.policy.permissionClass
    || policy.policyRevision.toLowerCase() !== pending.policy.policyRevision) {
    pending.invalidated = true;
    pending.authorization?.lease.close();
    throw new ConversationGrantError(409, "Tool approval expired, was cancelled, or policy changed.");
  }
}

async function hasProjectToolGrant(binding: GovernedToolBinding): Promise<boolean> {
  if (binding.projectId === null) return false;
  const rows = await getDb().select({ id: conversationActionGrants.id }).from(conversationActionGrants).where(and(
    eq(conversationActionGrants.ownerUserId, binding.userId),
    eq(conversationActionGrants.projectId, binding.projectId),
    eq(conversationActionGrants.action, `tool:${binding.toolId}`),
  ));
  return rows.length > 0;
}

/**
 * SERVER ONLY: L4 derives these identities from its held pause and the registered input schema.
 * No HTTP/model argument is allowed to construct this input. This stores grant facts, not run state.
 */
export async function proposeGovernedToolOperation(input: {
  user: GrantUser;
  projectId: number | null;
  chatId: number | null;
  requestId: string;
  stepId: string;
  toolCallId: string;
  toolId: string;
  input: Record<string, unknown>;
  descriptor: GovernedToolApprovalDescriptor;
  planHash: string;
  policy: CurrentExecutionPolicy;
  runSignal: AbortSignal;
  currentPolicy: () => CurrentExecutionPolicy;
  now?: number;
}): Promise<{ reviewId: string; binding: GovernedToolBinding; expiresAtMs: number }> {
  const ctx = tenantContext(input.user);
  if (!Number.isSafeInteger(ctx.userId) || ctx.userId <= 0
    || (input.projectId !== null && (!Number.isSafeInteger(input.projectId) || input.projectId <= 0))
    || (input.chatId !== null && (!Number.isSafeInteger(input.chatId) || input.chatId <= 0))) {
    throw new ConversationGrantError(400, "Tool approval requires an authenticated owner and canonical work ids.");
  }
  if (!UUID.test(input.requestId) || !TOOL_ID.test(input.stepId) || !TOOL_ID.test(input.toolCallId)
    || !TOOL_ID.test(input.toolId) || !SHA256.test(input.planHash)) {
    throw new ConversationGrantError(400, "Tool approval requires canonical run/step/call/tool/plan identities.");
  }
  if (!Object.isFrozen(input.descriptor) || input.descriptor.id !== input.toolId
    || input.descriptor.permissionClass !== input.policy.permissionClass || !input.descriptor.inputSchema) {
    throw new ConversationGrantError(400, "Tool approval requires its exact immutable registered descriptor.");
  }
  const parsed = input.descriptor.inputSchema.safeParse(input.input);
  if (!parsed.success || typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
    throw new ConversationGrantError(400, "Tool approval input did not satisfy its registered schema.");
  }
  const parsedInput = snapshotGovernedToolInput(parsed.data);
  if (input.projectId !== null) await getProject(ctx, input.projectId);
  if (input.chatId !== null) {
    const chat = await getProjectChat(ctx, input.chatId);
    if (chat.projectId !== input.projectId) throw new ConversationGrantError(404, "Tool approval Chat/Project mismatch.");
  } else if (input.projectId !== null) {
    throw new ConversationGrantError(400, "Project tool approval requires its Chat.");
  }
  const now = input.now ?? Date.now();
  const snapshot = createExecutionPolicySnapshot({ ...input.policy, issuedAtMs: now, expiresAtMs: now + TOOL_APPROVAL_TTL_MS });
  const binding = Object.freeze({
    userId: ctx.userId, projectId: input.projectId, chatId: input.chatId,
    requestId: input.requestId, stepId: input.stepId, toolCallId: input.toolCallId,
    toolId: input.toolId, inputSha256: governedToolInputSha256(parsedInput), planHash: input.planHash,
  });
  const pending: PendingToolGrant = {
    kind: "tool", binding, descriptor: input.descriptor, role: ctx.role,
    expiresAt: snapshot.expiresAtMs,
    policy: Object.freeze({ permissionClass: snapshot.permissionClass, policyRevision: snapshot.policyRevision }),
    runSignal: input.runSignal, currentPolicy: input.currentPolicy,
    approvedScope: null, authorization: null, reviewing: false, invalidated: false,
  };
  assertToolOwner(pending, input.user, input.requestId);
  assertPendingToolCurrent(pending, now);
  pruneOnce(now);
  for (const grant of onceGrants.values()) {
    if (grant.kind === "tool" && grant.binding.userId === ctx.userId && grant.binding.requestId === input.requestId) {
      throw new ConversationGrantError(409, "This run already has a pending tool approval.");
    }
  }
  const reviewId = crypto.randomUUID();
  onceGrants.set(toolGrantKey(reviewId), pending);
  pruneOnce(now);
  return { reviewId, binding, expiresAtMs: pending.expiresAt };
}

/** Authenticated owner review accepts an opaque review id, never client tool/step/input identities. */
export async function reviewGovernedToolOperation(input: {
  user: GrantUser;
  requestId: string;
  reviewId: string;
  allow: boolean;
  scope: "once" | "project";
  /**
   * L9-only bridge: when the paused governed call already prepared an exact backend command,
   * review that command under the SAME user decision. No argv/digest comes from the client.
   */
  exactToolCallId?: string | null;
  now?: number;
}): Promise<void> {
  const pending = pendingToolGrant(input.reviewId);
  assertToolOwner(pending, input.user, input.requestId);
  const now = input.now ?? Date.now();
  assertPendingToolCurrent(pending, now);
  if (pending.reviewing || pending.approvedScope || pending.authorization) throw new ConversationGrantError(409, "Tool approval was already reviewed.");

  const exact = input.exactToolCallId == null ? null : exactOperations.get(input.requestId) ?? null;
  if (exact) {
    if (exact.toolCallId !== input.exactToolCallId
      || exact.owner.userId !== pending.binding.userId
      || exact.owner.projectId !== pending.binding.projectId
      || exact.owner.chatId !== pending.binding.chatId) {
      throw new ConversationGrantError(409, "Prepared exact operation does not match the paused governed tool call.");
    }
    if (exact.expiresAtMs <= now) {
      exactOperations.delete(input.requestId);
      throw new ConversationGrantError(409, "Prepared exact operation review expired.");
    }
    if (exact.reviewing || exact.approved) throw new ConversationGrantError(409, "Prepared exact operation was already reviewed.");
  }

  if (!input.allow) {
    onceGrants.delete(toolGrantKey(input.reviewId));
    if (exact) exactOperations.delete(input.requestId);
    return;
  }
  if (input.scope !== "once" && input.scope !== "project") throw new ConversationGrantError(400, "Invalid tool approval scope.");
  if (input.scope === "project" && pending.descriptor.allowProjectApproval === false) {
    throw new ConversationGrantError(409, "This governed tool permits one-time approval only.");
  }

  // Reserve both live authorities before any await. A single UI decision can never race into
  // one approved half and one unreviewed half.
  pending.reviewing = true;
  if (exact) exact.reviewing = true;
  try {
    if (input.scope === "project") {
      if (pending.binding.projectId === null) throw new ConversationGrantError(400, "A Project approval requires a Project.");
      const ctx = tenantContext(input.user);
      await getProject(ctx, pending.binding.projectId);
      if (pendingToolGrant(input.reviewId) !== pending) throw new ConversationGrantError(409, "Tool approval changed during review.");
      assertPendingToolCurrent(pending, input.now ?? Date.now());
      if (exact && exactOperations.get(input.requestId) !== exact) throw new ConversationGrantError(409, "Prepared exact operation changed during review.");
      await getDb().insert(conversationActionGrants).values({
        id: crypto.randomUUID(), ownerUserId: ctx.userId, organizationId: ctx.organizationId,
        projectId: pending.binding.projectId, action: `tool:${pending.binding.toolId}`,
      }).onConflictDoNothing();
      if (pendingToolGrant(input.reviewId) !== pending) throw new ConversationGrantError(409, "Tool approval changed during review.");
      assertPendingToolCurrent(pending, input.now ?? Date.now());
      if (exact && exactOperations.get(input.requestId) !== exact) throw new ConversationGrantError(409, "Prepared exact operation changed during review.");
      pending.approvedScope = "project";
    } else {
      pending.approvedScope = "once";
    }
    if (exact) exact.governedReviewed = true;
  } catch (error) {
    onceGrants.delete(toolGrantKey(input.reviewId));
    if (exact) exactOperations.delete(input.requestId);
    throw error;
  } finally {
    pending.reviewing = false;
    if (exact) exact.reviewing = false;
  }
}

/**
 * SERVER ONLY: forgets the pending review of a run that was stopped while paused. Nothing is approved or minted. Unlike a
 * review it still works after the run's cancellation signal has fired, so an explicit later resume can propose a fresh
 * review for the same request instead of colliding with this dead one.
 */
export function discardGovernedToolOperation(input: { user: GrantUser; requestId: string; reviewId: string }): void {
  const pending = onceGrants.get(toolGrantKey(input.reviewId));
  if (!pending || pending.kind !== "tool") return;
  assertToolOwner(pending, input.user, input.requestId);
  pending.invalidated = true;
  pending.authorization?.lease.close();
  onceGrants.delete(toolGrantKey(input.reviewId));
  const exact = exactOperations.get(input.requestId);
  if (exact && exact.owner.userId === pending.binding.userId && exact.toolCallId === pending.binding.toolCallId) {
    exactOperations.delete(input.requestId);
  }
}

/** Consumes owner review exactly once BEFORE L4 releases its journal. It cannot mint again on replay. */
export async function resolveGovernedToolOperation(input: {
  user: GrantUser; requestId: string; reviewId: string; now?: number;
}): Promise<GovernedToolAuthorization> {
  const pending = pendingToolGrant(input.reviewId);
  assertToolOwner(pending, input.user, input.requestId);
  if (pending.reviewing || pending.authorization) throw new ConversationGrantError(409, "Tool approval is reviewing or already resolved.");
  const scope = pending.approvedScope === "once" ? "once"
    : pending.descriptor.allowProjectApproval === false ? null
    : await hasProjectToolGrant(pending.binding) ? "project" : null;
  // Re-read after SQL so concurrent resolution cannot recreate the authorization.
  if (pendingToolGrant(input.reviewId) !== pending || pending.reviewing || pending.authorization) {
    throw new ConversationGrantError(409, "Tool approval was already resolved.");
  }
  const now = input.now ?? Date.now();
  assertPendingToolCurrent(pending, now);
  if (!scope) throw new ConversationGrantError(409, "Owner tool review is required.");

  const exact = exactOperations.get(input.requestId) ?? null;
  if (exact?.toolCallId !== null && exact !== null && exact.toolCallId === pending.binding.toolCallId) {
    if (!exact.governedReviewed || exact.reviewing || exact.approved
      || exact.owner.userId !== pending.binding.userId
      || exact.owner.projectId !== pending.binding.projectId
      || exact.owner.chatId !== pending.binding.chatId) {
      throw new ConversationGrantError(409, "Prepared exact operation is not bound to the reviewed governed tool.");
    }
    if (exact.expiresAtMs <= now) {
      exactOperations.delete(input.requestId);
      throw new ConversationGrantError(409, "Prepared exact operation approval expired.");
    }
  }

  const lease = new ExecutionAuthorizationLease(createExecutionPolicySnapshot({
    ...pending.policy, issuedAtMs: now, expiresAtMs: pending.expiresAt,
  }), [pending.runSignal]);
  lease.assertCurrent(pending.currentPolicy(), now);
  const authorization: GovernedToolAuthorization = Object.freeze({
    reviewId: input.reviewId, binding: pending.binding,
    grant: Object.freeze({ scope, expiresAt: new Date(pending.expiresAt).toISOString() }),
    lease, policy: pending.policy,
  });
  pending.approvedScope = null; // owner review has been consumed, not held for the next invocation
  pending.authorization = authorization;
  if (exact?.toolCallId !== null && exact !== null && exact.toolCallId === pending.binding.toolCallId) {
    // Exact backend execution becomes consumable only after the canonical governed authorization exists.
    exact.approved = true;
  }
  return authorization;
}

/** L4 MUST await this live revalidation before durable release; persisted/copy objects are never authority. */
export async function assertGovernedToolAuthorizationCurrent(
  authorization: unknown, now: number = Date.now(),
): Promise<GovernedToolAuthorization> {
  if (!authorization || typeof authorization !== "object" || !("reviewId" in authorization)
    || typeof authorization.reviewId !== "string") throw new ConversationGrantError(409, "Invalid tool authorization.");
  const pending = pendingToolGrant(authorization.reviewId);
  if (!pending.authorization || pending.authorization !== authorization) throw new ConversationGrantError(409, "Invalid tool authorization identity.");
  const current = pending.authorization;
  current.lease.assertCurrent(pending.currentPolicy(), now);
  if (current.grant.scope === "project" && !await hasProjectToolGrant(current.binding)) {
    current.lease.close();
    onceGrants.delete(toolGrantKey(current.reviewId));
    throw new ConversationGrantError(409, "Project tool approval was revoked.");
  }
  if (pendingToolGrant(current.reviewId) !== pending || pending.authorization !== current) {
    throw new ConversationGrantError(409, "Tool authorization was already consumed.");
  }
  current.lease.assertCurrent(pending.currentPolicy(), now);
  return current;
}

export interface ConsumedGovernedToolAuthorization {
  authorization: GovernedToolAuthorization;
  role: string;
  currentPolicy: () => CurrentExecutionPolicy;
}

/** Server registry pause facts; `input` must be the registered schema's parsed output. */
export interface GovernedToolAuthorizationInvocation {
  authorization: unknown;
  userId: number;
  projectId: number | null;
  chatId: number | null;
  requestId: string;
  stepId: string;
  toolCallId: string;
  toolId: string;
  input: Record<string, unknown>;
  descriptor: GovernedToolApprovalDescriptor;
  planHash: string;
  permissionClass: string;
  runSignal: AbortSignal;
  now?: number;
}

/** L4 validates its held exact pause BEFORE durable release, including input and owner/Chat. No consumption. */
export async function assertGovernedToolAuthorizationMatches(
  input: GovernedToolAuthorizationInvocation,
): Promise<GovernedToolAuthorization> {
  const inputSha256 = governedToolInputSha256(input.input);
  const authorization = await assertGovernedToolAuthorizationCurrent(input.authorization, input.now);
  const pending = pendingToolGrant(authorization.reviewId);
  const binding = authorization.binding;
  if (binding.userId !== input.userId || binding.projectId !== input.projectId || binding.chatId !== input.chatId
    || binding.requestId !== input.requestId || binding.stepId !== input.stepId || binding.toolCallId !== input.toolCallId
    || binding.toolId !== input.toolId || binding.planHash !== input.planHash
    || binding.inputSha256 !== inputSha256 || pending.runSignal !== input.runSignal
    || pending.descriptor !== input.descriptor || input.descriptor.id !== input.toolId
    || input.descriptor.permissionClass !== input.permissionClass
    || authorization.policy.permissionClass !== input.permissionClass) {
    throw new ConversationGrantError(409, "Tool authorization does not match the exact invocation.");
  }
  authorization.lease.assertCurrent(pending.currentPolicy(), input.now);
  return authorization;
}

/** Atomic single-use claim immediately before invoke, including exact schema-parsed input identity. */
export async function consumeGovernedToolAuthorization(
  input: GovernedToolAuthorizationInvocation,
): Promise<ConsumedGovernedToolAuthorization> {
  const authorization = await assertGovernedToolAuthorizationMatches(input);
  const pending = pendingToolGrant(authorization.reviewId);
  if (pending.authorization !== authorization) throw new ConversationGrantError(409, "Tool authorization was already consumed.");
  authorization.lease.assertCurrent(pending.currentPolicy(), input.now);
  onceGrants.delete(toolGrantKey(authorization.reviewId)); // no await between claim and removal
  return { authorization, role: pending.role, currentPolicy: pending.currentPolicy };
}

export async function revokeProjectToolGrant(user: GrantUser, projectId: number, toolId: string): Promise<void> {
  const ctx = tenantContext(user);
  if (!TOOL_ID.test(toolId)) throw new ConversationGrantError(400, "Invalid tool id.");
  await getProject(ctx, projectId);
  function closeLiveGrants(): void {
    for (const [key, grant] of onceGrants) {
      if (grant.kind === "tool" && grant.binding.userId === ctx.userId
        && grant.binding.projectId === projectId && grant.binding.toolId === toolId
        && grant.authorization?.grant.scope === "project") {
        grant.authorization.lease.close();
        onceGrants.delete(key);
      }
    }
  }
  closeLiveGrants();
  await getDb().delete(conversationActionGrants).where(and(
    eq(conversationActionGrants.projectId, projectId), eq(conversationActionGrants.ownerUserId, ctx.userId),
    eq(conversationActionGrants.action, `tool:${toolId}`),
  ));
  closeLiveGrants();
}
