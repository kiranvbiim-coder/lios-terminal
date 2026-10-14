import crypto from "node:crypto";
import { and, asc, count, desc, eq, isNull, lt, sql } from "drizzle-orm";
import {
  projectChats,
  projectLedgerEvents,
  projectLedgerStreamHeads,
  projectSessions,
  projects,
  type ProjectLedgerEvent,
  type ProjectLedgerStreamHead,
} from "@shared/schema";
import {
  ledgerActorTypeSchema,
  ledgerEventTypeSchema,
  ledgerIntegrityReportSchema,
  ledgerLineageGraphSchema,
  type LedgerActorType,
  type LedgerEventType,
  type LedgerIntegrityReport,
  type LedgerLineageGraph,
} from "@shared/ledgerContracts";
import type { TenantContext } from "./tenantContext";
import { getDb } from "./db";

const SECRET_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|authorization|cookie|private[_-]?key)/i;
const MAX_LEDGER_STRING = 20_000;

export function canonicalLedgerValue(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalLedgerValue).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalLedgerValue(record[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return JSON.stringify(String(value));
  return JSON.stringify(value) ?? "null";
}

export function hashLedgerValue(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalLedgerValue(value)).digest("hex");
}

export function sanitizeLedgerPayload(value: unknown, depth = 0): unknown {
  if (depth > 24) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.length > MAX_LEDGER_STRING ? `${value.slice(0, MAX_LEDGER_STRING)}…[TRUNCATED]` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 5_000).map((item) => sanitizeLedgerPayload(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 5_000)) {
      out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : sanitizeLedgerPayload(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeLedgerPayload(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : { value: sanitized };
}

function tenantOrgClause(column: any, ctx: TenantContext) {
  return ctx.organizationId === null ? isNull(column) : eq(column, ctx.organizationId);
}

async function assertLedgerScopeWithDb(
  db: any,
  ctx: TenantContext,
  input: { projectId: number | null; chatId: number | null; sessionId: string | null },
): Promise<void> {
  if (input.projectId === null && input.chatId === null) throw new Error("Persistent Ledger events require a Project or persistent chat.");

  if (input.projectId !== null) {
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, input.projectId),
      eq(projects.ownerUserId, ctx.userId),
      tenantOrgClause(projects.organizationId, ctx),
    )).limit(1);
    if (!project) throw new Error("Project Ledger boundary violation.");
  }

  if (input.chatId !== null) {
    const [chat] = await db.select({ id: projectChats.id, projectId: projectChats.projectId }).from(projectChats).where(and(
      eq(projectChats.id, input.chatId),
      eq(projectChats.ownerUserId, ctx.userId),
      tenantOrgClause(projectChats.organizationId, ctx),
    )).limit(1);
    if (!chat) throw new Error("Chat Ledger boundary violation.");
    if (input.projectId !== null && chat.projectId !== input.projectId) throw new Error("Chat does not belong to the Ledger Project.");
    if (input.projectId === null && chat.projectId !== null) throw new Error("Project chat cannot be written into a Quick Chat Ledger stream.");
  }

  if (input.sessionId !== null) {
    const [session] = await db.select({ id: projectSessions.id, projectId: projectSessions.projectId }).from(projectSessions).where(and(
      eq(projectSessions.id, input.sessionId),
      eq(projectSessions.ownerUserId, ctx.userId),
      tenantOrgClause(projectSessions.organizationId, ctx),
    )).limit(1);
    if (!session) throw new Error("Session Ledger boundary violation.");
    if (input.projectId === null || session.projectId !== input.projectId) throw new Error("Session does not belong to the Ledger Project.");
  }
}

function ledgerStreamId(input: { projectId: number | null; chatId: number | null }): string {
  if (input.projectId !== null) return `project:${input.projectId}`;
  if (input.chatId !== null) return `chat:${input.chatId}`;
  throw new Error("Persistent Ledger stream cannot be derived.");
}

function headTenantFilter(ctx: TenantContext, streamId: string) {
  return and(
    eq(projectLedgerStreamHeads.streamId, streamId),
    eq(projectLedgerStreamHeads.ownerUserId, ctx.userId),
    tenantOrgClause(projectLedgerStreamHeads.organizationId, ctx),
  );
}

function eventTenantFilter(ctx: TenantContext) {
  return and(
    eq(projectLedgerEvents.ownerUserId, ctx.userId),
    tenantOrgClause(projectLedgerEvents.organizationId, ctx),
  );
}

export interface AppendLedgerEventInput {
  projectId: number | null;
  chatId?: number | null;
  sessionId?: string | null;
  eventType: LedgerEventType;
  actorType: LedgerActorType;
  requestId?: string | null;
  receiptId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  payload?: Record<string, unknown>;
  lineage?: LedgerLineageGraph;
  reversible?: boolean;
  inversePayload?: Record<string, unknown> | null;
  createdAt?: Date;
}

function hashMaterial(input: {
  id: string;
  streamId: string;
  sequence: number;
  projectId: number | null;
  chatId: number | null;
  sessionId: string | null;
  ownerUserId: number;
  organizationId: number | null;
  eventType: string;
  actorType: string;
  requestId: string | null;
  receiptId: string | null;
  correlationId: string | null;
  causationId: string | null;
  payload: Record<string, unknown>;
  lineage: Record<string, unknown>;
  reversible: boolean;
  inversePayload: Record<string, unknown> | null;
  previousHash: string | null;
  createdAt: string;
}) {
  return {
    schemaVersion: "1",
    ...input,
  };
}

export function computeLedgerEventHash(input: Parameters<typeof hashMaterial>[0]): string {
  return hashLedgerValue(hashMaterial(input));
}

export async function appendLedgerEventInTransaction(
  tx: any,
  ctx: TenantContext,
  raw: AppendLedgerEventInput,
): Promise<ProjectLedgerEvent> {
  const eventType = ledgerEventTypeSchema.parse(raw.eventType);
  const actorType = ledgerActorTypeSchema.parse(raw.actorType);
  const projectId = raw.projectId;
  const chatId = raw.chatId ?? null;
  const sessionId = raw.sessionId ?? null;
  await assertLedgerScopeWithDb(tx, ctx, { projectId, chatId, sessionId });

  const streamId = ledgerStreamId({ projectId, chatId });
  const createdAt = raw.createdAt ?? new Date();
  const payload = asRecord(raw.payload ?? {});
  const lineage = ledgerLineageGraphSchema.parse(sanitizeLedgerPayload(raw.lineage ?? { nodes: [], edges: [] })) as unknown as Record<string, unknown>;
  const reversible = raw.reversible ?? false;
  const inversePayload = raw.inversePayload ? asRecord(raw.inversePayload) : null;
  if (reversible && inversePayload === null) throw new Error("Reversible Ledger event requires inversePayload.");

  await tx.insert(projectLedgerStreamHeads).values({
    streamId,
    projectId,
    chatId: projectId === null ? chatId : null,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    nextSequence: 1,
    headHash: null,
  }).onConflictDoNothing();

  const [reserved] = await tx.update(projectLedgerStreamHeads)
    .set({
      nextSequence: sql`${projectLedgerStreamHeads.nextSequence} + 1`,
      updatedAt: createdAt,
    })
    .where(headTenantFilter(ctx, streamId))
    .returning({
      nextSequence: projectLedgerStreamHeads.nextSequence,
      previousHash: projectLedgerStreamHeads.headHash,
    });
  if (!reserved) throw new Error("Ledger stream not owned by requesting tenant.");

  const sequence = Number(reserved.nextSequence) - 1;
  const previousHash = reserved.previousHash ?? null;
  const id = `ledger:${crypto.randomUUID()}`;
  const material = {
    id,
    streamId,
    sequence,
    projectId,
    chatId,
    sessionId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    eventType,
    actorType,
    requestId: raw.requestId ?? null,
    receiptId: raw.receiptId ?? null,
    correlationId: raw.correlationId ?? null,
    causationId: raw.causationId ?? null,
    payload,
    lineage,
    reversible,
    inversePayload,
    previousHash,
    createdAt: createdAt.toISOString(),
  };
  const eventHash = computeLedgerEventHash(material);

  const [row] = await tx.insert(projectLedgerEvents).values({
    ...material,
    lineage,
    createdAt,
    eventHash,
  }).returning();

  await tx.update(projectLedgerStreamHeads)
    .set({ headHash: eventHash, updatedAt: createdAt })
    .where(headTenantFilter(ctx, streamId));

  return row;
}

export async function appendLedgerEvent(ctx: TenantContext, input: AppendLedgerEventInput): Promise<ProjectLedgerEvent> {
  const db: any = getDb();
  return db.transaction((tx: any) => appendLedgerEventInTransaction(tx, ctx, input));
}

export async function getLedgerEvent(ctx: TenantContext, eventId: string): Promise<ProjectLedgerEvent> {
  const [row] = await getDb().select().from(projectLedgerEvents)
    .where(and(eq(projectLedgerEvents.id, eventId), eventTenantFilter(ctx)))
    .limit(1);
  if (!row) throw new Error("Ledger event not found or not owned by the requesting user.");
  return row;
}

export async function getLedgerEventByReceiptId(ctx: TenantContext, receiptId: string): Promise<ProjectLedgerEvent> {
  const [row] = await getDb().select().from(projectLedgerEvents)
    .where(and(eq(projectLedgerEvents.receiptId, receiptId), eventTenantFilter(ctx)))
    .limit(1);
  if (!row) throw new Error("Reproducibility receipt not found.");
  return row;
}

export async function findLedgerRevert(ctx: TenantContext, eventId: string): Promise<ProjectLedgerEvent | null> {
  const [row] = await getDb().select().from(projectLedgerEvents)
    .where(and(
      eventTenantFilter(ctx),
      eq(projectLedgerEvents.causationId, eventId),
      eq(projectLedgerEvents.eventType, "state.reverted"),
    ))
    .limit(1);
  return row ?? null;
}

export async function listProjectLedgerEvents(
  ctx: TenantContext,
  projectId: number,
  input: { limit?: number; beforeSequence?: number; eventType?: LedgerEventType } = {},
): Promise<ProjectLedgerEvent[]> {
  await assertLedgerScopeWithDb(getDb(), ctx, { projectId, chatId: null, sessionId: null });
  const streamId = ledgerStreamId({ projectId, chatId: null });
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const conditions = [
    eventTenantFilter(ctx),
    eq(projectLedgerEvents.streamId, streamId),
    ...(input.beforeSequence ? [lt(projectLedgerEvents.sequence, input.beforeSequence)] : []),
    ...(input.eventType ? [eq(projectLedgerEvents.eventType, ledgerEventTypeSchema.parse(input.eventType))] : []),
  ];
  return getDb().select().from(projectLedgerEvents)
    .where(and(...conditions))
    .orderBy(desc(projectLedgerEvents.sequence))
    .limit(limit);
}

export async function listChatLedgerEvents(
  ctx: TenantContext,
  chatId: number,
  input: { limit?: number } = {},
): Promise<ProjectLedgerEvent[]> {
  await assertLedgerScopeWithDb(getDb(), ctx, { projectId: null, chatId, sessionId: null }).catch(async () => {
    const [chat] = await getDb().select({ projectId: projectChats.projectId }).from(projectChats).where(and(
      eq(projectChats.id, chatId),
      eq(projectChats.ownerUserId, ctx.userId),
      tenantOrgClause(projectChats.organizationId, ctx),
    )).limit(1);
    if (!chat?.projectId) throw new Error("Chat Ledger boundary violation.");
  });
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  return getDb().select().from(projectLedgerEvents)
    .where(and(eventTenantFilter(ctx), eq(projectLedgerEvents.chatId, chatId)))
    .orderBy(desc(projectLedgerEvents.createdAt))
    .limit(limit);
}

export async function listProjectLedgerStreamHeads(ctx: TenantContext, projectId: number): Promise<ProjectLedgerStreamHead[]> {
  await assertLedgerScopeWithDb(getDb(), ctx, { projectId, chatId: null, sessionId: null });
  return getDb().select().from(projectLedgerStreamHeads)
    .where(and(
      eq(projectLedgerStreamHeads.projectId, projectId),
      eq(projectLedgerStreamHeads.ownerUserId, ctx.userId),
      tenantOrgClause(projectLedgerStreamHeads.organizationId, ctx),
    ))
    .orderBy(asc(projectLedgerStreamHeads.streamId));
}

export async function countProjectLedgerEvents(ctx: TenantContext, projectId: number): Promise<number> {
  await assertLedgerScopeWithDb(getDb(), ctx, { projectId, chatId: null, sessionId: null });
  const [row] = await getDb().select({ value: count() }).from(projectLedgerEvents)
    .where(and(
      eventTenantFilter(ctx),
      eq(projectLedgerEvents.projectId, projectId),
    ));
  return Number(row?.value ?? 0);
}

export async function verifyLedgerIntegrity(ctx: TenantContext, streamId: string): Promise<LedgerIntegrityReport> {
  const [head] = await getDb().select().from(projectLedgerStreamHeads)
    .where(headTenantFilter(ctx, streamId))
    .limit(1);
  if (!head) throw new Error("Ledger stream not found or not owned by the requesting user.");
  const events = await getDb().select().from(projectLedgerEvents)
    .where(and(eventTenantFilter(ctx), eq(projectLedgerEvents.streamId, streamId)))
    .orderBy(asc(projectLedgerEvents.sequence));

  let previousHash: string | null = null;
  let firstInvalidSequence: number | null = null;
  let reason: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const row = events[i];
    const expectedSequence = i + 1;
    if (row.sequence !== expectedSequence) {
      firstInvalidSequence = row.sequence;
      reason = `Sequence gap: expected ${expectedSequence}, found ${row.sequence}.`;
      break;
    }
    if (row.previousHash !== previousHash) {
      firstInvalidSequence = row.sequence;
      reason = "Previous-hash link does not match the preceding event.";
      break;
    }
    const expectedHash = computeLedgerEventHash({
      id: row.id,
      streamId: row.streamId,
      sequence: row.sequence,
      projectId: row.projectId,
      chatId: row.chatId,
      sessionId: row.sessionId,
      ownerUserId: row.ownerUserId,
      organizationId: row.organizationId,
      eventType: row.eventType,
      actorType: row.actorType,
      requestId: row.requestId,
      receiptId: row.receiptId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      payload: row.payload,
      lineage: row.lineage,
      reversible: row.reversible,
      inversePayload: row.inversePayload,
      previousHash: row.previousHash,
      createdAt: row.createdAt.toISOString(),
    });
    if (row.eventHash !== expectedHash) {
      firstInvalidSequence = row.sequence;
      reason = "Event content hash does not match persisted hash.";
      break;
    }
    previousHash = row.eventHash;
  }

  if (firstInvalidSequence === null && Number(head.nextSequence) !== events.length + 1) {
    firstInvalidSequence = Math.max(1, events.length);
    reason = "Stream head sequence does not match event count.";
  }
  if (firstInvalidSequence === null && (head.headHash ?? null) !== previousHash) {
    firstInvalidSequence = Math.max(1, events.length);
    reason = "Stream head hash does not match the final event.";
  }

  return ledgerIntegrityReportSchema.parse({
    streamId,
    valid: firstInvalidSequence === null,
    checkedEvents: events.length,
    headSequence: Math.max(0, Number(head.nextSequence) - 1),
    headHash: head.headHash ?? null,
    firstInvalidSequence,
    reason,
  });
}
