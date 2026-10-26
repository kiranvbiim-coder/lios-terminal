import { z } from "zod";
import type { DurableMemoryRow } from "@shared/schema";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import {
  correctDurableMemory,
  deleteDurableMemory,
  getDurableMemoryHistory,
  listDurableMemories,
} from "./aiMemory";
import { getRequestIdentity } from "./requestContext";
import { assertNotAborted } from "./conversationRuntimeCore";

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

const inspectInputSchema = z.object({
  memoryKey: z.string().trim().min(1).max(2_000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

const correctInputSchema = z.object({
  memoryKey: z.string().trim().min(1).max(2_000),
  expectedRevision: z.number().int().positive(),
  content: z.string().trim().min(1).max(200_000),
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict();

const deleteInputSchema = z.object({
  memoryKey: z.string().trim().min(1).max(2_000),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict();

const memoryViewSchema = z.object({
  memoryKey: z.string(),
  revision: z.number().int().positive(),
  state: z.enum(["active", "superseded", "deleted"]),
  scope: z.enum(["user", "project"]),
  projectId: z.number().int().positive().nullable(),
  kind: z.string(),
  content: z.string(),
  originClass: z.enum(["owner", "agent", "untrusted", "system"]),
  originKind: z.string(),
  epistemicStatus: z.enum(["observed", "inferred", "confirmed"]),
  sourceRefs: z.array(z.string()),
  observedAt: z.string().nullable(),
  updatedAt: z.string(),
}).strict();

const lifecycleOutputSchema = z.object({
  output: z.object({
    operation: z.enum(["inspect", "correct", "delete"]),
    memories: z.array(memoryViewSchema).max(100),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().trim().min(1).max(2_000)).max(500),
}).strict();

function revisionRef(row: DurableMemoryRow): string {
  return `${row.memoryKey}@r${row.revision}`;
}

function memoryView(row: DurableMemoryRow) {
  return {
    memoryKey: row.memoryKey,
    revision: row.revision,
    state: row.state,
    scope: row.scope,
    projectId: row.projectId,
    kind: row.kind,
    content: row.content,
    originClass: row.originClass,
    originKind: row.originKind,
    epistemicStatus: row.epistemicStatus,
    sourceRefs: row.sourceRefs,
    observedAt: row.observedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function memoryToolScope(call: Parameters<ConversationToolDefinition["invoke"]>[2]): {
  projectId: number | null;
} {
  if (call.source !== "agent") {
    throw new Error("Durable memory lifecycle tools are available only to the bounded agent loop.");
  }
  if (call.sourceScope && call.sourceScope !== "auto" && call.sourceScope !== "my_data") {
    throw new Error("Durable memory lifecycle tools require Auto or My Data source scope.");
  }
  const tenant = tenantSchema.parse(call.tenant);
  const identity = getRequestIdentity();
  if (!identity?.userId
    || identity.userId !== tenant.userId
    || identity.organizationId !== tenant.organizationId
    || call.userId !== tenant.userId
    || !call.requestId) {
    throw new Error("Durable memory lifecycle requires authenticated owner scope.");
  }
  const projectId = call.projectId == null ? null : Number(call.projectId);
  if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId <= 0)) {
    throw new Error("Durable memory lifecycle received an invalid Project scope.");
  }
  return { projectId };
}

export const memoryInspectTool: ConversationToolDefinition = {
  id: "lios.memory.inspect",
  label: "Inspect durable memory and revision history",
  kind: "retrieve",
  permissionClass: "user_confirm",
  allowProjectApproval: false,
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: inspectInputSchema,
  outputSchema: lifecycleOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 128 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    const { projectId } = memoryToolScope(call);
    const parsed = inspectInputSchema.parse(input);
    const rows = parsed.memoryKey
      ? await getDurableMemoryHistory({ memoryKey: parsed.memoryKey, projectId })
      : await listDurableMemories({ projectId, limit: parsed.limit ?? 50 });
    assertNotAborted(signal);
    return {
      output: { operation: "inspect", memories: rows.slice(0, 100).map(memoryView) },
      summary: parsed.memoryKey
        ? rows.length
          ? `Found ${rows.length} owned durable-memory revision${rows.length === 1 ? "" : "s"} for the requested logical memory.`
          : "No durable memory with that key exists in the active owner/Project scope."
        : `Found ${rows.length} active durable memor${rows.length === 1 ? "y" : "ies"} in the current owner/Project scope.`,
      deterministic: true,
      sourceRefs: rows.map(revisionRef).slice(0, 500),
    };
  },
};

export const memoryCorrectTool: ConversationToolDefinition = {
  id: "lios.memory.correct",
  label: "Correct one durable memory revision",
  kind: "calculate",
  permissionClass: "user_confirm",
  allowProjectApproval: false,
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema: correctInputSchema,
  outputSchema: lifecycleOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 32 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    const { projectId } = memoryToolScope(call);
    const parsed = correctInputSchema.parse(input);
    const corrected = await correctDurableMemory({ ...parsed, projectId });
    assertNotAborted(signal);
    return {
      output: { operation: "correct", memories: [memoryView(corrected)] },
      summary: `Corrected durable memory ${corrected.memoryKey} to revision ${corrected.revision}; the prior revision is superseded.`,
      deterministic: true,
      sourceRefs: [revisionRef(corrected), ...corrected.sourceRefs].slice(0, 500),
    };
  },
};

export const memoryDeleteTool: ConversationToolDefinition = {
  id: "lios.memory.delete",
  label: "Delete one durable memory and retain only a tombstone",
  kind: "calculate",
  permissionClass: "user_confirm",
  allowProjectApproval: false,
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema: deleteInputSchema,
  outputSchema: lifecycleOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 32 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    const { projectId } = memoryToolScope(call);
    const parsed = deleteInputSchema.parse(input);
    const tombstone = await deleteDurableMemory({ ...parsed, projectId });
    assertNotAborted(signal);
    return {
      output: { operation: "delete", memories: [memoryView(tombstone)] },
      summary: `Deleted durable memory ${tombstone.memoryKey}; remembered content was erased and revision ${tombstone.revision} is a non-sensitive tombstone.`,
      deterministic: true,
      sourceRefs: [revisionRef(tombstone)],
    };
  },
};

export function memoryLifecycleConversationTools(): ConversationToolDefinition[] {
  return [memoryInspectTool, memoryCorrectTool, memoryDeleteTool];
}
