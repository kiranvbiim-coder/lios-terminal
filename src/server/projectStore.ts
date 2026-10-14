/**
 * Write-through persistence for Projects (LIOS-P1-01) -- the primary
 * organizational unit per LIOS_MASTER_PLAN.md §3.1.
 *
 * Every project is owned by exactly one user and optionally scoped to that
 * user's organization. RLS is not yet enabled (see
 * src/migrations/0042_rls_tenant_isolation.sql), so isolation is enforced here, at
 * the service layer: every read/write requires an explicit ownerUserId
 * (and organizationId, when the caller has one) match against the row.
 * Callers must never be able to fetch another user's project by guessing
 * an id -- getProject() throws rather than returning null/undefined so a
 * forgotten `if (!project)` check can't silently leak a "not found" into
 * a 200 response.
 */
import { eq, and, desc, isNull, isNotNull, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  projectArtifacts,
  projectChats,
  projectResources,
  projectSessions,
  projects,
  insertProjectSchema,
  type Project,
} from "@shared/schema";
import type { InsertProject } from "@shared/schema";
import type { TenantContext } from "./tenantContext";
import { deleteProjectAttachmentResourceBlob } from "./projectAttachmentStore";

export class ProjectAccessDeniedError extends Error {
  constructor() {
    super("Project not found or not owned by the requesting user.");
    this.name = "ProjectAccessDeniedError";
  }
}

// Internal users have organizationId === null (tenantContext.ts); their
// projects are stored with a null organization_id too, so the ownership
// filter must use IS NULL rather than `= null` (which would never match in
// SQL) whenever the caller has no organization.
function ownershipFilter(ctx: TenantContext, id: number) {
  return ctx.organizationId === null
    ? and(eq(projects.id, id), eq(projects.ownerUserId, ctx.userId), isNull(projects.organizationId))
    : and(eq(projects.id, id), eq(projects.ownerUserId, ctx.userId), eq(projects.organizationId, ctx.organizationId));
}

function scopeFilter(ctx: TenantContext, status: "active" | "archived", trash: boolean) {
  const trashClause = trash ? isNotNull(projects.trashedAt) : isNull(projects.trashedAt);
  return ctx.organizationId === null
    ? and(eq(projects.ownerUserId, ctx.userId), isNull(projects.organizationId), eq(projects.status, status), trashClause)
    : and(eq(projects.ownerUserId, ctx.userId), eq(projects.organizationId, ctx.organizationId), eq(projects.status, status), trashClause);
}

export async function createProject(
  ctx: TenantContext,
  input: Pick<InsertProject, "name"> & Partial<Pick<InsertProject, "instructions">> & { legacyWorkspaceId?: string | null },
): Promise<Project> {
  const parsed = insertProjectSchema.parse({
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    name: input.name,
    instructions: input.instructions ?? null,
  });
  const legacyWorkspaceId = input.legacyWorkspaceId?.trim() || null;
  const db = getDb();
  const [row] = await db.insert(projects).values({ ...parsed, legacyWorkspaceId }).returning();
  return row;
}

export async function findProjectByLegacyWorkspaceId(ctx: TenantContext, legacyWorkspaceId: string): Promise<Project | null> {
  const clean = legacyWorkspaceId.trim();
  if (!clean) return null;
  const db = getDb();
  const orgClause = ctx.organizationId === null ? isNull(projects.organizationId) : eq(projects.organizationId, ctx.organizationId);
  const [row] = await db.select().from(projects).where(and(
    eq(projects.ownerUserId, ctx.userId),
    orgClause,
    eq(projects.legacyWorkspaceId, clean),
  )).limit(1);
  return row ?? null;
}

export async function getProjectIncludingTrash(ctx: TenantContext, id: number): Promise<Project> {
  const db = getDb();
  const [row] = await db.select().from(projects).where(ownershipFilter(ctx, id)).limit(1);
  if (!row) throw new ProjectAccessDeniedError();
  return row;
}

export async function getProject(ctx: TenantContext, id: number): Promise<Project> {
  const row = await getProjectIncludingTrash(ctx, id);
  if (row.trashedAt) throw new ProjectAccessDeniedError();
  return row;
}

// Pinned projects first, then most recently active -- matches the Project
// Home / sidebar ordering implied by LIOS_EXECUTION_ROADMAP.md P1 ("project
// rename/search/pin").
export async function listProjects(ctx: TenantContext, opts: { status?: "active" | "archived"; trash?: boolean } = {}): Promise<Project[]> {
  const db = getDb();
  const status = opts.status ?? (opts.trash ? "archived" : "active");
  return db
    .select()
    .from(projects)
    .where(scopeFilter(ctx, status, opts.trash ?? false))
    .orderBy(desc(projects.pinned), desc(projects.lastActivityAt));
}

export async function renameProject(ctx: TenantContext, id: number, name: string): Promise<Project> {
  await getProject(ctx, id); // ownership check; throws ProjectAccessDeniedError if not found/owned
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name cannot be empty.");
  if (trimmed.length > 200) throw new Error("Project name cannot exceed 200 characters.");
  const db = getDb();
  const [row] = await db.update(projects).set({ name: trimmed, updatedAt: new Date() }).where(ownershipFilter(ctx, id)).returning();
  return row;
}

export async function setProjectInstructions(ctx: TenantContext, id: number, instructions: string | null): Promise<Project> {
  await getProject(ctx, id);
  const db = getDb();
  const trimmed = instructions?.trim() || null;
  if (trimmed && trimmed.length > 4000) throw new Error("Project instructions cannot exceed 4000 characters.");
  const [row] = await db.update(projects).set({ instructions: trimmed, updatedAt: new Date() }).where(ownershipFilter(ctx, id)).returning();
  return row;
}

export async function setProjectPinned(ctx: TenantContext, id: number, pinned: boolean): Promise<Project> {
  await getProject(ctx, id);
  const db = getDb();
  const [row] = await db.update(projects).set({ pinned, updatedAt: new Date() }).where(ownershipFilter(ctx, id)).returning();
  return row;
}

// Bumps lastActivityAt without touching updatedAt (activity is not an edit)
// so Project Home / sidebar recency ordering reflects real usage. Callers:
// new chat message, artifact save, connector run, etc. once those land.
export async function touchProjectActivity(ctx: TenantContext, id: number): Promise<void> {
  const project = await getProject(ctx, id);
  const db = getDb();
  const nextActivityAt = new Date(Math.max(Date.now(), project.lastActivityAt.getTime() + 1));
  await db.update(projects).set({ lastActivityAt: nextActivityAt }).where(ownershipFilter(ctx, id));
}

export async function archiveProject(ctx: TenantContext, id: number): Promise<Project> {
  await getProject(ctx, id);
  const db = getDb();
  const now = new Date();
  const [row] = await db.update(projects).set({ status: "archived", archivedAt: now, trashedAt: null, updatedAt: now }).where(ownershipFilter(ctx, id)).returning();
  if (!row) throw new ProjectAccessDeniedError();
  return row;
}

function tenantChildFilter(ownerColumn: any, organizationColumn: any, ctx: TenantContext) {
  return ctx.organizationId === null
    ? and(eq(ownerColumn, ctx.userId), isNull(organizationColumn))
    : and(eq(ownerColumn, ctx.userId), eq(organizationColumn, ctx.organizationId));
}

export interface ProjectDependencySummary {
  projectId: number;
  projectName: string;
  chats: number;
  resources: number;
  sessions: number;
  artifacts: number;
  total: number;
}

export async function getProjectDependencySummary(ctx: TenantContext, id: number): Promise<ProjectDependencySummary> {
  const project = await getProjectIncludingTrash(ctx, id);
  const db = getDb();
  const [chats, resources, sessions, artifacts] = await Promise.all([
    db.select({ id: projectChats.id }).from(projectChats).where(and(tenantChildFilter(projectChats.ownerUserId, projectChats.organizationId, ctx), eq(projectChats.projectId, id))),
    db.select({ id: projectResources.id }).from(projectResources).where(and(tenantChildFilter(projectResources.ownerUserId, projectResources.organizationId, ctx), eq(projectResources.projectId, id))),
    db.select({ id: projectSessions.id }).from(projectSessions).where(and(tenantChildFilter(projectSessions.ownerUserId, projectSessions.organizationId, ctx), eq(projectSessions.projectId, id))),
    db.select({ id: projectArtifacts.id }).from(projectArtifacts).where(and(tenantChildFilter(projectArtifacts.ownerUserId, projectArtifacts.organizationId, ctx), eq(projectArtifacts.projectId, id))),
  ]);
  const counts = { chats: chats.length, resources: resources.length, sessions: sessions.length, artifacts: artifacts.length };
  return { projectId: id, projectName: project.name, ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
}

export async function trashProject(ctx: TenantContext, id: number): Promise<Project> {
  const project = await getProjectIncludingTrash(ctx, id);
  if (project.trashedAt) return project;
  const now = new Date();
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    const [activeChats, archivedChats, activeResources, archivedResources, activeSessions, archivedSessions, activeArtifacts, archivedArtifacts] = await Promise.all([
      tx.select({ id: projectChats.id }).from(projectChats).where(and(tenantChildFilter(projectChats.ownerUserId, projectChats.organizationId, ctx), eq(projectChats.projectId, id), eq(projectChats.status, "active"), isNull(projectChats.trashedAt))),
      tx.select({ id: projectChats.id }).from(projectChats).where(and(tenantChildFilter(projectChats.ownerUserId, projectChats.organizationId, ctx), eq(projectChats.projectId, id), eq(projectChats.status, "archived"), isNull(projectChats.trashedAt))),
      tx.select({ id: projectResources.id }).from(projectResources).where(and(tenantChildFilter(projectResources.ownerUserId, projectResources.organizationId, ctx), eq(projectResources.projectId, id), eq(projectResources.status, "active"), isNull(projectResources.trashedAt))),
      tx.select({ id: projectResources.id }).from(projectResources).where(and(tenantChildFilter(projectResources.ownerUserId, projectResources.organizationId, ctx), eq(projectResources.projectId, id), eq(projectResources.status, "archived"), isNull(projectResources.trashedAt))),
      tx.select({ id: projectSessions.id }).from(projectSessions).where(and(tenantChildFilter(projectSessions.ownerUserId, projectSessions.organizationId, ctx), eq(projectSessions.projectId, id), eq(projectSessions.status, "active"), isNull(projectSessions.trashedAt))),
      tx.select({ id: projectSessions.id }).from(projectSessions).where(and(tenantChildFilter(projectSessions.ownerUserId, projectSessions.organizationId, ctx), eq(projectSessions.projectId, id), eq(projectSessions.status, "archived"), isNull(projectSessions.trashedAt))),
      tx.select({ id: projectArtifacts.id }).from(projectArtifacts).where(and(tenantChildFilter(projectArtifacts.ownerUserId, projectArtifacts.organizationId, ctx), eq(projectArtifacts.projectId, id), eq(projectArtifacts.status, "active"), isNull(projectArtifacts.trashedAt))),
      tx.select({ id: projectArtifacts.id }).from(projectArtifacts).where(and(tenantChildFilter(projectArtifacts.ownerUserId, projectArtifacts.organizationId, ctx), eq(projectArtifacts.projectId, id), eq(projectArtifacts.status, "archived"), isNull(projectArtifacts.trashedAt))),
    ]);
    if (activeChats.length) await tx.update(projectChats).set({ status: "archived", archivedAt: now, trashedAt: now, trashedByProjectId: id, trashedFromStatus: "active", updatedAt: now }).where(and(inArray(projectChats.id, activeChats.map((row: any) => row.id)), isNull(projectChats.trashedAt)));
    if (archivedChats.length) await tx.update(projectChats).set({ trashedAt: now, trashedByProjectId: id, trashedFromStatus: "archived", updatedAt: now }).where(and(inArray(projectChats.id, archivedChats.map((row: any) => row.id)), isNull(projectChats.trashedAt)));
    if (activeResources.length) await tx.update(projectResources).set({ status: "archived", trashedAt: now, trashedByProjectId: id, trashedFromStatus: "active", updatedAt: now }).where(and(inArray(projectResources.id, activeResources.map((row: any) => row.id)), isNull(projectResources.trashedAt)));
    if (archivedResources.length) await tx.update(projectResources).set({ trashedAt: now, trashedByProjectId: id, trashedFromStatus: "archived", updatedAt: now }).where(and(inArray(projectResources.id, archivedResources.map((row: any) => row.id)), isNull(projectResources.trashedAt)));
    if (activeSessions.length) await tx.update(projectSessions).set({ status: "archived", archivedAt: now, trashedAt: now, trashedByProjectId: id, trashedFromStatus: "active", updatedAt: now }).where(and(inArray(projectSessions.id, activeSessions.map((row: any) => row.id)), isNull(projectSessions.trashedAt)));
    if (archivedSessions.length) await tx.update(projectSessions).set({ trashedAt: now, trashedByProjectId: id, trashedFromStatus: "archived", updatedAt: now }).where(and(inArray(projectSessions.id, archivedSessions.map((row: any) => row.id)), isNull(projectSessions.trashedAt)));
    if (activeArtifacts.length) await tx.update(projectArtifacts).set({ status: "archived", archivedAt: now, trashedAt: now, trashedByProjectId: id, trashedFromStatus: "active", updatedAt: now }).where(and(inArray(projectArtifacts.id, activeArtifacts.map((row: any) => row.id)), isNull(projectArtifacts.trashedAt)));
    if (archivedArtifacts.length) await tx.update(projectArtifacts).set({ trashedAt: now, trashedByProjectId: id, trashedFromStatus: "archived", updatedAt: now }).where(and(inArray(projectArtifacts.id, archivedArtifacts.map((row: any) => row.id)), isNull(projectArtifacts.trashedAt)));
    const [row] = await tx.update(projects).set({ status: "archived", archivedAt: now, trashedAt: now, pinned: false, updatedAt: now }).where(ownershipFilter(ctx, id)).returning();
    if (!row) throw new ProjectAccessDeniedError();
    return row as Project;
  });
}

export async function restoreTrashedProject(ctx: TenantContext, id: number): Promise<Project> {
  const project = await getProjectIncludingTrash(ctx, id);
  if (!project.trashedAt) throw new Error("Project is not in Trash.");
  const now = new Date();
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    await tx.update(projectChats).set({ status: "active", archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now }).where(and(tenantChildFilter(projectChats.ownerUserId, projectChats.organizationId, ctx), eq(projectChats.projectId, id), eq(projectChats.trashedByProjectId, id), eq(projectChats.trashedFromStatus, "active")));
    await tx.update(projectChats).set({ status: "archived", trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now }).where(and(tenantChildFilter(projectChats.ownerUserId, projectChats.organizationId, ctx), eq(projectChats.projectId, id), eq(projectChats.trashedByProjectId, id), eq(projectChats.trashedFromStatus, "archived")));
    await tx.update(projectResources).set({ status: "active", trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now }).where(and(tenantChildFilter(projectResources.ownerUserId, projectResources.organizationId, ctx), eq(projectResources.projectId, id), eq(projectResources.trashedByProjectId, id), eq(projectResources.trashedFromStatus, "active")));
    await tx.update(projectResources).set({ status: "archived", trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now }).where(and(tenantChildFilter(projectResources.ownerUserId, projectResources.organizationId, ctx), eq(projectResources.projectId, id), eq(projectResources.trashedByProjectId, id), eq(projectResources.trashedFromStatus, "archived")));
    await tx.update(projectSessions).set({ status: "active", archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now }).where(and(tenantChildFilter(projectSessions.ownerUserId, projectSessions.organizationId, ctx), eq(projectSessions.projectId, id), eq(projectSessions.trashedByProjectId, id), eq(projectSessions.trashedFromStatus, "active")));
    await tx.update(projectSessions).set({ status: "archived", trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now }).where(and(tenantChildFilter(projectSessions.ownerUserId, projectSessions.organizationId, ctx), eq(projectSessions.projectId, id), eq(projectSessions.trashedByProjectId, id), eq(projectSessions.trashedFromStatus, "archived")));
    await tx.update(projectArtifacts).set({ status: "active", archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now }).where(and(tenantChildFilter(projectArtifacts.ownerUserId, projectArtifacts.organizationId, ctx), eq(projectArtifacts.projectId, id), eq(projectArtifacts.trashedByProjectId, id), eq(projectArtifacts.trashedFromStatus, "active")));
    await tx.update(projectArtifacts).set({ status: "archived", trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now }).where(and(tenantChildFilter(projectArtifacts.ownerUserId, projectArtifacts.organizationId, ctx), eq(projectArtifacts.projectId, id), eq(projectArtifacts.trashedByProjectId, id), eq(projectArtifacts.trashedFromStatus, "archived")));
    const [row] = await tx.update(projects).set({ status: "active", archivedAt: null, trashedAt: null, updatedAt: now }).where(ownershipFilter(ctx, id)).returning();
    if (!row) throw new ProjectAccessDeniedError();
    return row as Project;
  });
}

export async function restoreProject(ctx: TenantContext, id: number): Promise<Project> {
  await getProject(ctx, id);
  const db = getDb();
  const [row] = await db.update(projects).set({ status: "active", archivedAt: null, trashedAt: null, updatedAt: new Date() }).where(ownershipFilter(ctx, id)).returning();
  if (!row) throw new ProjectAccessDeniedError();
  return row;
}

export async function permanentlyDeleteProject(ctx: TenantContext, id: number): Promise<void> {
  const project = await getProjectIncludingTrash(ctx, id);
  if (!project.trashedAt) throw new Error("Project must be in Trash before permanent deletion.");
  const db: any = getDb();
  let attachmentResources: Array<{
    ownerUserId: number;
    projectId: number;
    kind: string;
    metadata: Record<string, unknown>;
  }> = [];
  await db.transaction(async (tx: any) => {
    const [chats, resources, sessions, artifacts] = await Promise.all([
      tx.select({ id: projectChats.id }).from(projectChats).where(and(eq(projectChats.projectId, id), isNull(projectChats.trashedAt))),
      tx.select({ id: projectResources.id }).from(projectResources).where(and(eq(projectResources.projectId, id), isNull(projectResources.trashedAt))),
      tx.select({ id: projectSessions.id }).from(projectSessions).where(and(eq(projectSessions.projectId, id), isNull(projectSessions.trashedAt))),
      tx.select({ id: projectArtifacts.id }).from(projectArtifacts).where(and(eq(projectArtifacts.projectId, id), isNull(projectArtifacts.trashedAt))),
    ]);
    const activeDependencies = chats.length + resources.length + sessions.length + artifacts.length;
    if (activeDependencies) throw new Error("Project dependencies must be in Trash before permanent deletion.");
    attachmentResources = await tx.select({
      ownerUserId: projectResources.ownerUserId,
      projectId: projectResources.projectId,
      kind: projectResources.kind,
      metadata: projectResources.metadata,
    }).from(projectResources).where(eq(projectResources.projectId, id));
    const deleted = await tx.delete(projects).where(and(ownershipFilter(ctx, id), isNotNull(projects.trashedAt))).returning();
    if (!deleted.length) throw new ProjectAccessDeniedError();
  });
  for (const resource of attachmentResources) {
    try {
      await deleteProjectAttachmentResourceBlob(resource);
    } catch {
      console.error("[project-attachments] Blob cleanup failed after permanent Project removal.");
    }
  }
}
