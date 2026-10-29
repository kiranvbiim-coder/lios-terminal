/**
 * GM-19 / SI-03.01 canonical durable memory service.
 *
 * The previous aiMemory implementation wrote a per-user JSON transcript capped
 * at 100 entries. This module keeps the existing append/get compatibility API
 * while moving authority into the canonical LiOS database. TC Working Context
 * remains live/bounded state; P7 remains a derived/rebuildable index.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  durableMemories,
  projects,
  type DurableMemoryEpistemicStatus,
  type DurableMemoryOriginClass,
  type DurableMemoryRow,
} from "@shared/schema";
import { getRequestIdentity, type RequestIdentity } from "./requestContext";
import { getDb } from "./db";
import { stateDir } from "./dataRoot";

const MAX_CONTENT_CHARS = 200_000;
const DEFAULT_CONTEXT_LIMIT = 10;
const MAX_LIST_LIMIT = 200;
const LEGACY_MIGRATED_SUFFIX = ".migrated-v1";

const completedLegacyMigrations = new Set<string>();
const legacyMigrationInFlight = new Map<string, Promise<void>>();

export interface MemoryEntry {
  ts: string;
  role: string;
  content: string;
}

export interface DurableMemoryInput {
  content: string;
  kind?: string;
  role?: string | null;
  projectId?: number | null;
  originClass?: DurableMemoryOriginClass;
  originKind?: string;
  originRef?: string | null;
  epistemicStatus?: DurableMemoryEpistemicStatus;
  sourceRefs?: string[];
  metadata?: Record<string, unknown>;
  observedAt?: Date | string | null;
  /** Optional idempotency key for one logical derived-memory write. */
  dedupeKey?: string;
}

function currentIdentity(): RequestIdentity | null {
  const identity = getRequestIdentity();
  if (!identity?.userId || !Number.isInteger(identity.userId) || identity.userId <= 0) return null;
  if (identity.organizationId !== null && (!Number.isInteger(identity.organizationId) || identity.organizationId <= 0)) {
    throw new Error("Invalid organization identity for durable memory.");
  }
  return identity;
}

function orgFilter(column: any, identity: RequestIdentity) {
  return identity.organizationId === null ? isNull(column) : eq(column, identity.organizationId);
}

function ownerFilter(identity: RequestIdentity) {
  return and(eq(durableMemories.ownerUserId, identity.userId!), orgFilter(durableMemories.organizationId, identity));
}

function memoryScopeFilter(projectId: number | null) {
  return projectId === null
    ? and(eq(durableMemories.scope, "user"), isNull(durableMemories.projectId))
    : or(
        and(eq(durableMemories.scope, "user"), isNull(durableMemories.projectId)),
        and(eq(durableMemories.scope, "project"), eq(durableMemories.projectId, projectId)),
      );
}

function cleanMemoryKey(memoryKey: string): string {
  return cleanShort(memoryKey, "Durable memory key", 2_000) ?? (() => { throw new Error("Durable memory key is required."); })();
}

function memoryRevisionRef(memoryKey: string, revision: number): string {
  return `${memoryKey}@r${revision}`;
}

function legacyMemoryFile(identity: RequestIdentity): string {
  const org = identity.organizationId === null ? "internal" : `org-${identity.organizationId}`;
  return path.join(stateDir(), "ai-memory", org, `user-${identity.userId}.json`);
}

function cleanContent(content: string): string {
  if (typeof content !== "string" || !content.trim()) throw new Error("Durable memory content cannot be empty.");
  if (content.includes("\u0000")) throw new Error("Durable memory content cannot contain NUL bytes.");
  if (content.length > MAX_CONTENT_CHARS) throw new Error(`Durable memory content exceeds ${MAX_CONTENT_CHARS} characters.`);
  return content;
}

function cleanShort(value: string | null | undefined, label: string, max: number): string | null {
  if (value == null) return null;
  const clean = value.trim();
  if (!clean) return null;
  if (clean.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  if (clean.includes("\u0000")) throw new Error(`${label} cannot contain NUL bytes.`);
  return clean;
}

function parseObservedAt(value: Date | string | null | undefined, strict = true): Date | null {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    if (strict) throw new Error("Durable memory observedAt must be a valid timestamp.");
    return null;
  }
  return parsed;
}

function originClassForRole(role: string | null | undefined): DurableMemoryOriginClass {
  if (role === "user") return "owner";
  if (role === "assistant") return "agent";
  if (role === "system") return "system";
  return "untrusted";
}

async function assertProjectOwned(identity: RequestIdentity, projectId: number): Promise<void> {
  if (!Number.isInteger(projectId) || projectId <= 0) throw new Error("Durable memory projectId must be a positive integer.");
  const [project] = await getDb().select({ id: projects.id }).from(projects).where(and(
    eq(projects.id, projectId),
    eq(projects.ownerUserId, identity.userId!),
    orgFilter(projects.organizationId, identity),
    isNull(projects.trashedAt),
  )).limit(1);
  if (!project) throw new Error("Project not found or not owned by the requesting user.");
}

function legacyRowId(identity: RequestIdentity, entry: MemoryEntry, index: number): string {
  const digest = crypto.createHash("sha256")
    .update(String(identity.userId)).update("\0")
    .update(String(identity.organizationId ?? "null")).update("\0")
    .update(String(index)).update("\0")
    .update(entry.ts).update("\0")
    .update(entry.role).update("\0")
    .update(entry.content)
    .digest("hex");
  return `legacy:${digest}`;
}

function parseLegacyEntries(raw: unknown): MemoryEntry[] {
  if (!Array.isArray(raw)) throw new Error("Legacy AI memory file is not an array.");
  return raw.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`Legacy AI memory entry ${index} is not an object.`);
    const entry = value as Partial<MemoryEntry>;
    if (typeof entry.ts !== "string" || typeof entry.role !== "string" || typeof entry.content !== "string" || !entry.content.trim()) {
      throw new Error(`Legacy AI memory entry ${index} is malformed.`);
    }
    cleanContent(entry.content);
    return { ts: entry.ts, role: entry.role, content: entry.content };
  });
}

async function migrateLegacyMemoryFile(identity: RequestIdentity, file: string): Promise<void> {
  if (!fs.existsSync(file)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error("Legacy AI memory file cannot be parsed; migration was not performed.", { cause: error });
  }
  const entries = parseLegacyEntries(parsed);
  const db: any = getDb();
  await db.transaction(async (tx: any) => {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const legacyKey = legacyRowId(identity, entry, index);
      const observedAt = parseObservedAt(entry.ts, false);
      await tx.insert(durableMemories).values({
        id: `memrow:${legacyKey}`,
        memoryKey: `memory:${legacyKey}`,
        revision: 1,
        ownerUserId: identity.userId!,
        organizationId: identity.organizationId,
        projectId: null,
        scope: "user",
        kind: "conversation_turn",
        role: cleanShort(entry.role, "Legacy memory role", 80),
        content: entry.content,
        originClass: originClassForRole(entry.role),
        originKind: "legacy_ai_memory_json",
        originRef: "aiMemory.json",
        epistemicStatus: "observed",
        sourceRefs: [],
        metadata: { legacyIndex: index, legacyTimestamp: entry.ts },
        observedAt,
        createdAt: observedAt ?? new Date(),
        updatedAt: observedAt ?? new Date(),
      }).onConflictDoNothing({ target: durableMemories.id });
    }
  });

  const migrated = file + LEGACY_MIGRATED_SUFFIX;
  if (fs.existsSync(migrated)) fs.rmSync(file, { force: true });
  else fs.renameSync(file, migrated);
}

async function ensureLegacyMemoryMigrated(identity: RequestIdentity): Promise<void> {
  const file = legacyMemoryFile(identity);
  if (completedLegacyMigrations.has(file)) return;
  const existing = legacyMigrationInFlight.get(file);
  if (existing) return existing;
  const task = migrateLegacyMemoryFile(identity, file);
  legacyMigrationInFlight.set(file, task);
  try {
    await task;
    completedLegacyMigrations.add(file);
  } finally {
    if (legacyMigrationInFlight.get(file) === task) legacyMigrationInFlight.delete(file);
  }
}

export async function appendDurableMemory(input: DurableMemoryInput): Promise<DurableMemoryRow | null> {
  const identity = currentIdentity();
  if (!identity) return null;
  await ensureLegacyMemoryMigrated(identity);

  const projectId = input.projectId ?? null;
  if (projectId !== null) await assertProjectOwned(identity, projectId);

  const content = cleanContent(input.content);
  const kind = cleanShort(input.kind ?? "memory", "Durable memory kind", 120) ?? "memory";
  const role = cleanShort(input.role, "Durable memory role", 80);
  const originKind = cleanShort(input.originKind ?? "direct", "Durable memory originKind", 120) ?? "direct";
  const originRef = cleanShort(input.originRef, "Durable memory originRef", 2_000);
  const sourceRefs = [...new Set(input.sourceRefs ?? [])].map((value) => cleanShort(value, "Durable memory sourceRef", 2_000)).filter((value): value is string => Boolean(value)).slice(0, 500);
  const observedAt = parseObservedAt(input.observedAt);
  const dedupeKey = cleanShort(input.dedupeKey, "Durable memory dedupeKey", 2_000);
  const stableDigest = dedupeKey
    ? crypto.createHash("sha256")
        .update(String(identity.userId)).update("\0")
        .update(String(identity.organizationId ?? "null")).update("\0")
        .update(String(projectId ?? "null")).update("\0")
        .update(dedupeKey)
        .digest("hex")
    : null;
  const uuid = stableDigest ?? crypto.randomUUID();
  const rowId = stableDigest ? `memrow:dedupe:${stableDigest}` : `memrow:${uuid}`;
  const memoryKey = stableDigest ? `memory:dedupe:${stableDigest}` : `memory:${uuid}`;
  const now = new Date();

  if (stableDigest) {
    const existingLogical = await getDb().select().from(durableMemories).where(and(
      ownerFilter(identity),
      eq(durableMemories.memoryKey, memoryKey),
      memoryScopeFilter(projectId),
    )).orderBy(sql`${durableMemories.revision} DESC`).limit(1);
    const latest = existingLogical[0];
    if (latest?.state === "active") return latest;
    if (latest?.state === "deleted") {
      throw new Error("Derived durable memory was deleted and will not be silently recreated from the same dedupe key.");
    }
  }

  const insert = getDb().insert(durableMemories).values({
    id: rowId,
    memoryKey,
    revision: 1,
    ownerUserId: identity.userId!,
    organizationId: identity.organizationId,
    projectId,
    scope: projectId === null ? "user" : "project",
    kind,
    role,
    content,
    originClass: input.originClass ?? originClassForRole(role),
    originKind,
    originRef,
    epistemicStatus: input.epistemicStatus ?? "observed",
    sourceRefs,
    metadata: input.metadata ?? {},
    observedAt,
    state: "active",
    createdAt: now,
    updatedAt: now,
  });
  const rows = stableDigest
    ? await insert.onConflictDoNothing({ target: durableMemories.id }).returning()
    : await insert.returning();
  if (rows[0]) return rows[0];
  if (!stableDigest) throw new Error("Durable memory insert did not return a row.");

  const [existing] = await getDb().select().from(durableMemories).where(and(
    ownerFilter(identity),
    eq(durableMemories.memoryKey, memoryKey),
    memoryScopeFilter(projectId),
  )).orderBy(sql`${durableMemories.revision} DESC`).limit(1);
  if (!existing) throw new Error("Durable memory dedupe write could not resolve the existing logical memory.");
  if (existing.state === "deleted") {
    throw new Error("Derived durable memory was deleted and will not be silently recreated from the same dedupe key.");
  }
  return existing;
}

export async function listDurableMemories(input: { projectId?: number | null; limit?: number; query?: string } = {}): Promise<DurableMemoryRow[]> {
  const identity = currentIdentity();
  if (!identity) return [];
  await ensureLegacyMemoryMigrated(identity);

  const projectId = input.projectId ?? null;
  if (projectId !== null) await assertProjectOwned(identity, projectId);
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(input.limit ?? DEFAULT_CONTEXT_LIMIT)));
  const query = input.query === undefined ? null : cleanShort(input.query, "Durable memory query", 2_000);
  if (input.query !== undefined && !query) throw new Error("Durable memory query cannot be empty.");
  // Query current canonical rows directly; do not create another memory/index store or invoke an embedding provider.
  const vector = sql`to_tsvector('simple', ${durableMemories.content})`;
  const parsedQuery = query ? sql`plainto_tsquery('simple', ${query})` : null;

  return getDb().select().from(durableMemories)
    .where(and(ownerFilter(identity), eq(durableMemories.state, "active"), memoryScopeFilter(projectId),
      parsedQuery ? sql`${vector} @@ ${parsedQuery}` : undefined))
    .orderBy(
      ...(parsedQuery ? [sql`ts_rank_cd(${vector}, ${parsedQuery}) DESC`] : []),
      sql`${durableMemories.observedAt} DESC NULLS LAST`, sql`${durableMemories.createdAt} DESC`,
    )
    .limit(limit);
}

export async function getDurableMemoryHistory(input: {
  memoryKey: string;
  projectId?: number | null;
}): Promise<DurableMemoryRow[]> {
  const identity = currentIdentity();
  if (!identity) return [];
  await ensureLegacyMemoryMigrated(identity);
  const projectId = input.projectId ?? null;
  if (projectId !== null) await assertProjectOwned(identity, projectId);
  const memoryKey = cleanMemoryKey(input.memoryKey);
  return getDb().select().from(durableMemories).where(and(
    ownerFilter(identity),
    eq(durableMemories.memoryKey, memoryKey),
    memoryScopeFilter(projectId),
  )).orderBy(sql`${durableMemories.revision} DESC`);
}

export async function correctDurableMemory(input: {
  memoryKey: string;
  expectedRevision: number;
  content: string;
  projectId?: number | null;
  reason?: string | null;
}): Promise<DurableMemoryRow> {
  const identity = currentIdentity();
  if (!identity) throw new Error("Authenticated owner scope is required to correct durable memory.");
  await ensureLegacyMemoryMigrated(identity);
  const projectId = input.projectId ?? null;
  if (projectId !== null) await assertProjectOwned(identity, projectId);
  const memoryKey = cleanMemoryKey(input.memoryKey);
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    throw new Error("Durable memory expectedRevision must be a positive integer.");
  }
  const content = cleanContent(input.content);
  const reason = cleanShort(input.reason, "Durable memory correction reason", 1_000);
  const db: any = getDb();

  return db.transaction(async (tx: any) => {
    const rows: DurableMemoryRow[] = await tx.select().from(durableMemories).where(and(
      ownerFilter(identity),
      eq(durableMemories.memoryKey, memoryKey),
      memoryScopeFilter(projectId),
    )).orderBy(sql`${durableMemories.revision} DESC`);
    const current = rows.find((row) => row.state === "active");
    if (!current) throw new Error("Durable memory is not active or does not exist in this scope.");
    if (current.revision !== input.expectedRevision) {
      throw new Error(`Durable memory revision is stale: expected r${input.expectedRevision}, current r${current.revision}.`);
    }

    const now = new Date();
    const priorRef = memoryRevisionRef(memoryKey, current.revision);
    const nextRevision = current.revision + 1;
    await tx.update(durableMemories).set({ state: "superseded", updatedAt: now }).where(and(
      eq(durableMemories.id, current.id),
      eq(durableMemories.state, "active"),
      eq(durableMemories.revision, input.expectedRevision),
    ));

    const [next] = await tx.insert(durableMemories).values({
      id: `memrow:${crypto.randomUUID()}`,
      memoryKey,
      revision: nextRevision,
      ownerUserId: current.ownerUserId,
      organizationId: current.organizationId,
      projectId: current.projectId,
      scope: current.scope,
      kind: current.kind,
      role: current.role,
      content,
      originClass: "owner",
      originKind: "memory_correction",
      originRef: priorRef,
      epistemicStatus: "confirmed",
      sourceRefs: [...new Set([...current.sourceRefs, priorRef])].slice(0, 500),
      metadata: {
        correctedFrom: {
          revisionRef: priorRef,
          originClass: current.originClass,
          originKind: current.originKind,
          epistemicStatus: current.epistemicStatus,
        },
        ...(reason ? { correctionReason: reason } : {}),
      },
      observedAt: now,
      state: "active",
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!next) throw new Error("Durable memory correction did not create a new revision.");
    return next;
  });
}

export async function deleteDurableMemory(input: {
  memoryKey: string;
  expectedRevision: number;
  projectId?: number | null;
  reason?: string | null;
}): Promise<DurableMemoryRow> {
  const identity = currentIdentity();
  if (!identity) throw new Error("Authenticated owner scope is required to delete durable memory.");
  await ensureLegacyMemoryMigrated(identity);
  const projectId = input.projectId ?? null;
  if (projectId !== null) await assertProjectOwned(identity, projectId);
  const memoryKey = cleanMemoryKey(input.memoryKey);
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    throw new Error("Durable memory expectedRevision must be a positive integer.");
  }
  const reason = cleanShort(input.reason, "Durable memory deletion reason", 1_000);
  const db: any = getDb();

  return db.transaction(async (tx: any) => {
    const rows: DurableMemoryRow[] = await tx.select().from(durableMemories).where(and(
      ownerFilter(identity),
      eq(durableMemories.memoryKey, memoryKey),
      memoryScopeFilter(projectId),
    )).orderBy(sql`${durableMemories.revision} DESC`);
    const current = rows.find((row) => row.state === "active");
    if (!current) throw new Error("Durable memory is not active or does not exist in this scope.");
    if (current.revision !== input.expectedRevision) {
      throw new Error(`Durable memory revision is stale: expected r${input.expectedRevision}, current r${current.revision}.`);
    }

    const deletedDigest = crypto.createHash("sha256")
      .update(rows.map((row) => `${row.revision}\0${row.state}\0${row.content}`).join("\n"))
      .digest("hex");
    const nextRevision = Math.max(...rows.map((row) => row.revision)) + 1;
    const priorRef = memoryRevisionRef(memoryKey, current.revision);
    const now = new Date();

    await tx.delete(durableMemories).where(and(
      ownerFilter(identity),
      eq(durableMemories.memoryKey, memoryKey),
      memoryScopeFilter(projectId),
    ));
    const [tombstone] = await tx.insert(durableMemories).values({
      id: `memrow:${crypto.randomUUID()}`,
      memoryKey,
      revision: nextRevision,
      ownerUserId: current.ownerUserId,
      organizationId: current.organizationId,
      projectId: current.projectId,
      scope: current.scope,
      kind: current.kind,
      role: null,
      content: "[deleted]",
      originClass: "owner",
      originKind: "memory_deletion",
      originRef: priorRef,
      epistemicStatus: "confirmed",
      sourceRefs: [],
      metadata: {
        deletion: {
          priorRevisionRef: priorRef,
          erasedRevisionCount: rows.length,
          erasedContentSha256: deletedDigest,
          ...(reason ? { reason } : {}),
        },
      },
      observedAt: now,
      state: "deleted",
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!tombstone) throw new Error("Durable memory deletion did not create a tombstone.");
    return tombstone;
  });
}

export async function getMemoryContext(input: { projectId?: number | null; limit?: number } = {}): Promise<string> {
  const recent = await listDurableMemories({ ...input, limit: input.limit ?? DEFAULT_CONTEXT_LIMIT });
  if (!recent.length) return "";
  const chronological = [...recent].reverse();
  const lines = chronological.map((entry) => {
    const at = entry.observedAt?.toISOString() ?? "time unknown";
    const role = (entry.role || entry.originClass).toUpperCase();
    const text = entry.content.slice(0, 200) + (entry.content.length > 200 ? "..." : "");
    return `[${at}] ${role}: ${text}`;
  });
  return `\n\n[DURABLE MEMORY — contextual, non-authoritative; last ${chronological.length} entries]\n${lines.join("\n")}`;
}
