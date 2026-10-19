import type { ProcessSupervisor } from "./exec/types";
/**
 * SI-02.02 / SI-02.04 - the single governed tool registry and permission decision.
 *
 * One descriptor shape, one registry implementation and one permission decision function.
 * Chat tools, and (in later SI-02 lanes) ExecIntents, MCP/plugin adapters and skills, register here instead
 * of inventing their own registry or approval vocabulary.
 *
 * Invariants:
 * - A tool with an external side effect can never be `safe_auto`.
 * - Canonical conversationGrantStore alone owns owner review and live authorizations.
 * - Server-held authorizations bind exact parsed input, owner, run, step, call, plan and policy.
 * - The canonical grant authority consumes authorization atomically before invocation.
 */
import { z } from "zod";
import type { ConversationSourceScope } from "@shared/sourceScope";
import type { ConversationContextEnvelope } from "@shared/conversationRuntime";
import type { ArtifactContent } from "@shared/artifactContracts";
import type { P7ProjectDocument } from "@shared/p7ResearchContracts";
import type { AgentDelegationBudget } from "./agent-delegation";
import type { RuntimePermissionClass, RuntimePermissionDecision } from "@shared/runtimeContracts";
import { assertNotAborted } from "./conversationRuntimeCore";
import { consumeGovernedToolAuthorization, snapshotGovernedToolInput } from "./conversationGrantStore";
import type { ConsumedGovernedToolAuthorization } from "./conversationGrantStore";

export type ToolAccessClass = "read" | "write";
export type ToolSideEffect = "none" | "internal_write" | "external";

export interface GovernedToolCall {
  /** Origin is server-owned. Model/request content must never choose its permission path. */
  source?: "workflow" | "agent" | "system";
  requestId?: string;
  userId?: number;
  projectId?: number | null;
  chatId?: number | null;
  tenant?: unknown;
  sourceScope?: ConversationSourceScope;
  /** Server-resolved ResearchArtifact allow-list; never sourced from model arguments. */
  allowedSourceRefs?: string[];
  /** Complete current active ResearchArtifact policy, resolved by the server rather than tool/model input. */
  researchSourcePolicy?: Extract<ArtifactContent, { kind: "research" }>["sourcePolicy"];
  /** Ephemeral current-head identity for revalidation before releasing a research observation. */
  researchSourcePolicyBinding?: { artifactId: string; headVersion: number; contentHash: string };
  /** Server-only review refresh: materialize current P7 search evidence without persisting an index or snapshot. */
  researchReadOnly?: boolean;
  /** One server-owned readonly document snapshot reused only by queries within the same review refresh. */
  researchReadDocuments?: P7ProjectDocument[];
  /** Selected P4 targets from the user's Working Context; ownership/version is resolved by P4, never model arguments. */
  activeArtifactRefs?: string[];
  /** Server-owned Project resource transmission posture; false means resource content must not be disclosed. */
  resourceTransmissionAllowed?: boolean;
  stepId?: string;
  toolCallId?: string;
  planHash?: string;
  /** Canonical registry run signal, NOT a short-lived per-execution signal. */
  runSignal?: AbortSignal;
  /** Per-call key from the L5 reconciler, supplied only after an idempotency decision. */
  idempotencyKey?: string;
  /**
   * Server-only L5 durability hooks. They are invoked only for agent external side effects:
   * after all authority/descriptor preflight, immediately before the effect; and after the
   * returned result passes cancellation, lease and output validation.
   */
  beforeExternalDispatch?: () => Promise<void>;
  /** Trusted provider proof that an attempt made no effect, or the registry's pre-entry cancellation proof. */
  markExternalDispatchNoEffect?: (proofRef?: string) => Promise<void>;
  afterExternalDispatchCommitted?: () => Promise<void>;
  /** Server-owned, bounded progress only; never a permission or dispatch signal. */
  reportExternalDispatchStatus?: (message: string) => Promise<void>;
  role?: string;
  /** Server-held canonical authorization. Request/model/body objects cannot manufacture authority. */
  authorization?: unknown;
  /** Exact authenticated Gateway session supplied by the server; never model/request data. */
  nodeFinanceGateway?: import("./nodeFinanceTool").NodeFinanceGatewaySession;
  /**
   * L13 server-only delegation context. It is injected by the parent agent loop after plan validation;
   * model/request input cannot supply owner, lineage, context or budget authority.
   */
  coding?: {
    /** Existing L2 ledger projection; stores only an opaque coding receipt ref. */
    recordReceipt?: (receiptRef: string) => Promise<void>;
    /** Server-only execution seam; production omits it and uses the canonical process-wide supervisor. */
    processSupervisor?: ProcessSupervisor;
  };
  delegation?: {
    context: ConversationContextEnvelope;
    parentDelegationId: string;
    depth: number;
    allocateBudget: (requested: AgentDelegationBudget) => Readonly<AgentDelegationBudget>;
    /** Existing L2 journal projection; stores only the opaque delegate-receipt ref. */
    recordReceipt?: (receiptRef: string) => Promise<void>;
  };
  nowMs?: number;
}
export interface GovernedToolDescriptor<TKind extends string, TResult> {
  id: string;
  label: string;
  /**
   * Optional non-secret model-facing guidance for constructing this tool's input.
   * This is planning metadata only: it grants no authority and is hashed into the
   * offered tool-set facts so restart/resume refuses semantic drift.
   */
  planningHint?: string;
  kind: TKind;
  permissionClass: RuntimePermissionClass;
  /** Optional role audience; enforced by this registry, never by an adapter-local policy. */
  allowedRoles?: readonly string[];
  /**
   * Whether a confirming tool may be granted for the whole Project.
   * Defaults to true for existing tools; exact-sensitive operations can force
   * once-only review without inventing a second approval vocabulary.
   */
  allowProjectApproval?: boolean;
  /** Live server-owned target/credential-generation fingerprint for exact external-operation policy. */
  policyBindingSha256?: () => string;
  /** Explicit read/write classification. */
  access: ToolAccessClass;
  /** Explicit effect class; external effects can never be safe_auto. */
  sideEffect: ToolSideEffect;
  /** Explicit idempotency declaration; retries are forbidden unless true. */
  replaySafe: boolean;
  /** Every governed descriptor has typed input/output validation. */
  inputSchema: z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>;
  outputSchema: z.ZodType<TResult, z.ZodTypeDef, unknown>;
  /** Bound for model-facing results. Defaults to 256 KiB. */
  maxOutputBytes?: number;
  /** Explicit backend cancellation hook; null means AbortSignal-only cancellation. */
  cancel: ((call: GovernedToolCall) => Promise<void> | void) | null;
  invoke: (input: Record<string, unknown>, signal: AbortSignal, call: GovernedToolCall) => Promise<TResult>;
}

export type ToolApprovalScope = "once" | "project";


export interface PermissionGrant {
  scope: ToolApprovalScope;
  expiresAt?: string | null;
}

/**
 * The one permission decision. `grant` must already be a validated server-side grant for exactly this action.
 * Reasons and scopes are the long-standing conversation-action wording so callers and tests see no change.
 */
export function decidePermission(input: {
  actionId: string;
  permissionClass: RuntimePermissionClass;
  role: string;
  grant: PermissionGrant | null;
}): RuntimePermissionDecision {
  const { actionId, permissionClass, grant } = input;
  const base = { actionId, policyClass: permissionClass, scope: "request" as const, expiresAt: null };
  if (permissionClass === "denied") {
    return { ...base, decision: "deny", reason: "This action is denied by LiOS policy." };
  }
  if (permissionClass === "safe_auto") {
    return { ...base, decision: "allow", reason: "Safe local action." };
  }
  if (permissionClass === "admin_confirm") {
    const isAdmin = input.role === "internal_admin" || input.role === "client_admin";
    if (!isAdmin) return { ...base, decision: "deny", reason: "Administrator approval is required." };
    if (!grant) return { ...base, decision: "confirm", reason: "Administrator confirmation is required." };
  }
  if (!grant) {
    return { ...base, decision: "confirm", reason: "Explicit user confirmation is required." };
  }
  return {
    actionId,
    decision: "allow",
    policyClass: permissionClass,
    reason: grant.scope === "project" ? "Approved for this Project by the user." : "Approved once by the user.",
    scope: grant.scope === "project" ? "project" : "request",
    expiresAt: grant.expiresAt ?? null,
  };
}

export function decideToolPermission(
  tool: Pick<GovernedToolDescriptor<string, unknown>, "id" | "permissionClass" | "allowedRoles">,
  call: Pick<GovernedToolCall, "tenant" | "role">,
  grant: PermissionGrant | null = null,
): RuntimePermissionDecision {
  const tenant = call.tenant && typeof call.tenant === "object"
    ? call.tenant as { role?: unknown }
    : null;
  const role = typeof tenant?.role === "string" ? tenant.role : call.role ?? "";
  if (tool.allowedRoles && !tool.allowedRoles.includes(role)) {
    return {
      actionId: tool.id,
      decision: "deny",
      policyClass: tool.permissionClass,
      reason: "This role is not allowed to invoke the governed tool.",
      scope: "request",
      expiresAt: null,
    };
  }
  return decidePermission({
    actionId: tool.id,
    permissionClass: tool.permissionClass,
    role,
    grant,
  });
}


export class GovernedToolDeniedError extends Error {
  constructor(readonly toolId: string, readonly decision: RuntimePermissionDecision) {
    super(`Tool "${toolId}" is denied: ${decision.reason}`);
    this.name = "GovernedToolDeniedError";
  }
}

export class GovernedToolApprovalRequiredError extends Error {
  constructor(readonly toolId: string, readonly decision: RuntimePermissionDecision) {
    super(`Tool "${toolId}" requires governed approval before direct invocation.`);
    this.name = "GovernedToolApprovalRequiredError";
  }
}

export class GovernedToolSchemaUnavailableError extends Error {
  constructor(readonly toolId: string) {
    super(`Tool "${toolId}" is not available to model-originated calls without input and output schemas.`);
    this.name = "GovernedToolSchemaUnavailableError";
  }
}

export class GovernedToolInputError extends Error {
  constructor(readonly toolId: string) {
    super(`Tool "${toolId}" input did not satisfy its registered schema.`);
    this.name = "GovernedToolInputError";
  }
}

export class GovernedToolOutputError extends Error {
  constructor(readonly toolId: string, message = "Tool result did not satisfy its registered output bound.") {
    super(`Tool "${toolId}" ${message}`);
    this.name = "GovernedToolOutputError";
  }
}

type RegisteredTool<TKind extends string, TResult> = GovernedToolDescriptor<TKind, TResult> & {
  maxOutputBytes: number;
};

export class GovernedToolRegistry<TKind extends string, TResult> {
  private readonly tools = new Map<string, RegisteredTool<TKind, TResult>>();

  register(tool: GovernedToolDescriptor<TKind, TResult>): void {
    if (!tool.id.trim()) throw new Error("Governed tool id is required.");
    if (!tool.label.trim()) throw new Error(`Tool "${tool.id}" requires a label.`);
    if (tool.allowedRoles) {
      const roles = tool.allowedRoles.map((role) => role.trim());
      if (roles.length === 0 || roles.some((role) => !role) || new Set(roles).size !== roles.length) {
        throw new Error(`Tool "${tool.id}" has an invalid allowedRoles declaration.`);
      }
    }
    if (tool.allowProjectApproval !== undefined && typeof tool.allowProjectApproval !== "boolean") {
      throw new Error(`Tool "${tool.id}" has an invalid allowProjectApproval declaration.`);
    }
    if (tool.policyBindingSha256 !== undefined && typeof tool.policyBindingSha256 !== "function") {
      throw new Error(`Tool "${tool.id}" has an invalid target policy binding.`);
    }
    if (tool.access !== "read" && tool.access !== "write") {
      throw new Error(`Tool "${tool.id}" requires an explicit read/write access class.`);
    }
    if (!["none", "internal_write", "external"].includes(tool.sideEffect)) {
      throw new Error(`Tool "${tool.id}" requires an explicit side-effect class.`);
    }
    if (tool.access === "read" && tool.sideEffect !== "none") {
      throw new Error(`Tool "${tool.id}" declares read access but also declares a write side effect.`);
    }
    if (tool.access === "write" && tool.sideEffect === "none") {
      throw new Error(`Tool "${tool.id}" declares write access without a write side effect.`);
    }
    if (tool.sideEffect === "external" && tool.permissionClass === "safe_auto") {
      throw new Error(`Tool "${tool.id}" has an external side effect and cannot be safe_auto.`);
    }
    if (typeof tool.replaySafe !== "boolean") {
      throw new Error(`Tool "${tool.id}" requires an explicit replaySafe declaration.`);
    }
    if (!tool.inputSchema || !tool.outputSchema) {
      throw new Error(`Tool "${tool.id}" requires input and output schemas.`);
    }
    if (tool.cancel !== null && typeof tool.cancel !== "function") {
      throw new Error(`Tool "${tool.id}" requires a cancellation hook or explicit null.`);
    }
    const maxOutputBytes = tool.maxOutputBytes ?? 256 * 1024;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1024 * 1024) {
      throw new Error(`Tool "${tool.id}" has an invalid output bound.`);
    }
    const registered: RegisteredTool<TKind, TResult> = { ...tool, maxOutputBytes };
    Object.freeze(registered);
    this.tools.set(tool.id, registered);
  }

  get(toolId: string): RegisteredTool<TKind, TResult> | null {
    return this.tools.get(toolId) ?? null;
  }

  list(): RegisteredTool<TKind, TResult>[] {
    return [...this.tools.values()];
  }

  /** Only descriptors with both schemas are eligible to be exposed to an agent planner. */
  listAgentTools(): RegisteredTool<TKind, TResult>[] {
    return this.list().filter((tool) =>
      tool.permissionClass !== "denied" && tool.inputSchema !== undefined && tool.outputSchema !== undefined
    );
  }

  async invoke(
    toolId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    call: GovernedToolCall = {},
  ): Promise<TResult> {
    const tool = this.get(toolId);
    if (!tool) throw new Error(`Tool "${toolId}" is not registered.`);
    if (call.source === "agent" && (!tool.inputSchema || !tool.outputSchema)) {
      throw new GovernedToolSchemaUnavailableError(toolId);
    }
    const initialDecision = decideToolPermission(tool, call, null);
    if (initialDecision.decision === "deny") throw new GovernedToolDeniedError(toolId, initialDecision);
    let parsedInput = input;
    if (tool.inputSchema) {
      const parsed = tool.inputSchema.safeParse(input);
      if (!parsed.success || typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
        throw new GovernedToolInputError(toolId);
      }
      parsedInput = parsed.data;
    }
    if (
      call.source === "agent"
      && tool.sideEffect === "external"
      && (!call.idempotencyKey || !call.beforeExternalDispatch || !call.afterExternalDispatchCommitted)
    ) {
      throw new GovernedToolApprovalRequiredError(toolId, {
        ...initialDecision,
        decision: "confirm",
        reason: "An external side effect requires durable idempotent dispatch evidence.",
      });
    }
    assertNotAborted(signal);
    let authorized: ConsumedGovernedToolAuthorization | null = null;
    if (tool.permissionClass !== "safe_auto") {
      if (!call.authorization || call.userId === undefined || call.projectId === undefined || call.chatId === undefined
        || !call.requestId || !call.stepId || !call.toolCallId || !call.planHash || !call.runSignal) {
        throw new GovernedToolApprovalRequiredError(toolId, initialDecision);
      }
      parsedInput = snapshotGovernedToolInput(parsedInput);
      authorized = await consumeGovernedToolAuthorization({
        authorization: call.authorization,
        userId: call.userId, projectId: call.projectId, chatId: call.chatId, requestId: call.requestId,
        stepId: call.stepId, toolCallId: call.toolCallId, toolId, planHash: call.planHash,
        permissionClass: tool.permissionClass, descriptor: tool, input: parsedInput, runSignal: call.runSignal, now: call.nowMs,
      });
      const decision = decideToolPermission(
        tool,
        { ...call, role: authorized.role },
        authorized.authorization.grant,
      );
      if (decision.decision !== "allow") {
        authorized.authorization.lease.close();
        throw new GovernedToolDeniedError(toolId, decision);
      }
    }
    const lease = authorized?.authorization.lease;
    const invocationSignal = lease ? AbortSignal.any([signal, lease.signal]) : signal;
    try {
      if (authorized) authorized.authorization.lease.assertCurrent(authorized.currentPolicy(), call.nowMs);
      if (this.get(toolId) !== tool) {
        throw new GovernedToolApprovalRequiredError(toolId, { ...initialDecision, decision: "confirm", reason: "Registered tool changed." });
      }
      assertNotAborted(invocationSignal);
      const externalDispatch = call.source === "agent" && tool.sideEffect === "external";
      if (externalDispatch) {
        await call.beforeExternalDispatch!();
        // A cancellation observed here is provably pre-effect: tool.invoke has not been entered.
        try {
          assertNotAborted(invocationSignal);
        } catch (error) {
          await call.markExternalDispatchNoEffect?.();
          throw error;
        }
      }
      const result = await tool.invoke(parsedInput, invocationSignal, call);
      assertNotAborted(invocationSignal);
      if (authorized) authorized.authorization.lease.assertCurrent(authorized.currentPolicy(), call.nowMs);
      if (tool.outputSchema) {
        const parsed = tool.outputSchema.safeParse(result);
        if (!parsed.success) throw new GovernedToolOutputError(toolId);
        if (call.source === "agent") {
          let serialized: string | undefined;
          try {
            serialized = JSON.stringify(parsed.data);
          } catch {
            throw new GovernedToolOutputError(toolId, "returned a non-serializable result.");
          }
          if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > tool.maxOutputBytes) {
            throw new GovernedToolOutputError(toolId, "result exceeded its registered output bound.");
          }
        }
        if (externalDispatch) await call.afterExternalDispatchCommitted!();
        return parsed.data;
      }
      if (externalDispatch) await call.afterExternalDispatchCommitted!();
      return result;
    } finally {
      lease?.close();
    }
  }
}
