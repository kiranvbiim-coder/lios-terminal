import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { durableMemories, organizations, projects, users, type DurableMemoryRow } from "@shared/schema";
import type { ProjectMemoryNote, ProjectMemoryNoteList } from "@shared/projectMemoryNotes";
import { getDb } from "./db";
import { appendDurableMemory, correctDurableMemory, deleteDurableMemory, DurableMemoryMutationError,
  type DurableMemoryAdmissionDatabase, type DurableMemoryMutationGuard } from "./aiMemory";
import { getRequestIdentity, runWithRequestIdentity } from "./requestContext";
import type { TenantContext } from "./tenantContext";

export class ProjectMemoryNoteError extends Error {
  constructor(readonly status: 404 | 409 | 503) {
    super(status === 404 ? "Project note not found." : status === 409 ? "Project note changed since review. Reload and review it again." : "Project notes are temporarily unavailable.");
  }
}

const root = alias(durableMemories, "owner_note_root");
const orgScope = (column: AnyPgColumn, ctx: TenantContext) =>
  ctx.organizationId === null ? isNull(column) : eq(column, ctx.organizationId);

async function requireCurrentOwner(ctx: TenantContext, projectId: number, db: DurableMemoryAdmissionDatabase = getDb()) {
  const [user] = await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!user || !user.active || user.mustChangePassword || user.role !== ctx.role ||
      (user.organizationId ?? null) !== ctx.organizationId || (user.lockedUntil && user.lockedUntil > new Date())) {
    throw new ProjectMemoryNoteError(404);
  }
  if (ctx.organizationId !== null) {
    const [org] = await db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
    if (org?.status !== "active") throw new ProjectMemoryNoteError(404);
  }
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(
    eq(projects.id, projectId), eq(projects.ownerUserId, ctx.userId), orgScope(projects.organizationId, ctx),
    eq(projects.status, "active"), isNull(projects.trashedAt),
  )).limit(1);
  if (!project) throw new ProjectMemoryNoteError(404);
}

function noteFilter(ctx: TenantContext, projectId: number) {
  return and(
    eq(durableMemories.ownerUserId, ctx.userId), orgScope(durableMemories.organizationId, ctx),
    eq(durableMemories.scope, "project"), eq(durableMemories.projectId, projectId),
    eq(durableMemories.state, "active"), eq(durableMemories.originClass, "owner"),
    eq(durableMemories.kind, "owner_note"), eq(durableMemories.role, "user"),
    eq(root.ownerUserId, ctx.userId), orgScope(root.organizationId, ctx),
    eq(root.scope, "project"), eq(root.projectId, projectId), eq(root.revision, 1),
    eq(root.kind, "owner_note"), eq(root.role, "user"), eq(root.originClass, "owner"),
    eq(root.originKind, "explicit_owner_note"), eq(root.epistemicStatus, "confirmed"),
    sql`${root.sourceRefs} = '[]'::jsonb`,
  );
}
function note(row: DurableMemoryRow, createdAt: Date): ProjectMemoryNote {
  return { memoryKey: row.memoryKey, revision: row.revision, content: row.content,
    createdAt: createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function withIdentity<T>(ctx: TenantContext, work: () => T): T {
  // Keep provider credentials/selection intact, but never inherit caller tenant identity.
  return runWithRequestIdentity({ ...getRequestIdentity(), userId: ctx.userId, organizationId: ctx.organizationId }, work);
}

export async function listProjectMemoryNotes(ctx: TenantContext, projectId: number, input: { after?: string; limit?: number } = {}): Promise<ProjectMemoryNoteList> {
  await requireCurrentOwner(ctx, projectId);
  const limit = input.limit ?? 20;
  const rows = await getDb().select({ head: durableMemories, createdAt: root.createdAt }).from(durableMemories)
    .innerJoin(root, eq(root.memoryKey, durableMemories.memoryKey)).where(and(noteFilter(ctx, projectId),
      input.after === undefined ? undefined : gt(durableMemories.memoryKey, input.after)))
    .orderBy(asc(durableMemories.memoryKey)).limit(limit + 1);
  const visible = rows.slice(0, limit);
  return { notes: visible.map(row => note(row.head, row.createdAt)),
    nextCursor: rows.length > limit ? visible.at(-1)!.head.memoryKey : null };
}

async function selectedNote(ctx: TenantContext, projectId: number, memoryKey: string) {
  await requireCurrentOwner(ctx, projectId);
  const [selected] = await getDb().select({ head: durableMemories, createdAt: root.createdAt }).from(durableMemories)
    .innerJoin(root, eq(root.memoryKey, durableMemories.memoryKey))
    .where(and(noteFilter(ctx, projectId), eq(durableMemories.memoryKey, memoryKey))).limit(1);
  if (!selected) throw new ProjectMemoryNoteError(404);
  return selected;
}
function guard(ctx: TenantContext, projectId: number): DurableMemoryMutationGuard {
  return {
    admit: tx => requireCurrentOwner(ctx, projectId, tx),
    assertLineage(rows) {
      const lineage = [...rows].sort((a, b) => a.revision - b.revision);
      const first = lineage[0];
      if (!first || first.originKind !== "explicit_owner_note" || first.sourceRefs.length !== 0 ||
          lineage.some((row, index) => row.revision !== index + 1 || row.ownerUserId !== ctx.userId ||
            (row.organizationId ?? null) !== ctx.organizationId || row.projectId !== projectId || row.scope !== "project" ||
            row.kind !== "owner_note" || row.role !== "user" || row.originClass !== "owner" || row.epistemicStatus !== "confirmed" ||
            row.state !== (index === lineage.length - 1 ? "active" : "superseded") ||
            (index > 0 && (row.originKind !== "memory_correction" || !row.sourceRefs.includes(`${row.memoryKey}@r${index}`))) ||
            row.sourceRefs.some(ref => !lineage.slice(0, index).some(prior => ref === `${prior.memoryKey}@r${prior.revision}`)))) {
        throw new ProjectMemoryNoteError(404);
      }
    },
  };
}

export async function createProjectMemoryNote(ctx: TenantContext, projectId: number, content: string): Promise<ProjectMemoryNote> {
  await requireCurrentOwner(ctx, projectId);
  const row = await withIdentity(ctx, () => appendDurableMemory({ projectId, content, kind: "owner_note", role: "user",
    originClass: "owner", originKind: "explicit_owner_note", epistemicStatus: "confirmed", sourceRefs: [] }, db => requireCurrentOwner(ctx, projectId, db)));
  if (!row) throw new ProjectMemoryNoteError(503);
  return note(row, row.createdAt);
}
export async function updateProjectMemoryNote(ctx: TenantContext, projectId: number, memoryKey: string, expectedRevision: number, content: string): Promise<ProjectMemoryNote> {
  const selected = await selectedNote(ctx, projectId, memoryKey);
  try {
    const row = await withIdentity(ctx, () => correctDurableMemory({ projectId, memoryKey, expectedRevision, content }, guard(ctx, projectId)));
    return note(row, selected.createdAt);
  } catch (error) {
    if (error instanceof DurableMemoryMutationError) throw new ProjectMemoryNoteError(error.code === "conflict" ? 409 : 404);
    throw error;
  }
}
export async function deleteProjectMemoryNote(ctx: TenantContext, projectId: number, memoryKey: string, expectedRevision: number): Promise<void> {
  await selectedNote(ctx, projectId, memoryKey);
  try {
    await withIdentity(ctx, () => deleteDurableMemory({ projectId, memoryKey, expectedRevision }, guard(ctx, projectId)));
  } catch (error) {
    if (error instanceof DurableMemoryMutationError) throw new ProjectMemoryNoteError(error.code === "conflict" ? 409 : 404);
    throw error;
  }
}
