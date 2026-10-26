import crypto from "node:crypto";
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import { insertProjectResourceSchema, projectResources, projects, type ProjectResource } from "@shared/schema";
import type { TenantContext } from "./tenantContext";
import { getProject, touchProjectActivity } from "./projectStore";
import { deleteProjectAttachmentResourceBlob } from "./projectAttachmentStore";

export class ProjectResourceAccessDeniedError extends Error {
  constructor() {
    super("Project resource not found or not owned by the requesting user.");
    this.name = "ProjectResourceAccessDeniedError";
  }
}

function tenantFilter(ctx: TenantContext) {
  return ctx.organizationId === null
    ? and(eq(projectResources.ownerUserId, ctx.userId), isNull(projectResources.organizationId))
    : and(eq(projectResources.ownerUserId, ctx.userId), eq(projectResources.organizationId, ctx.organizationId));
}

export async function listProjectResources(ctx: TenantContext, projectId: number, includeArchived = false, includeTrash = false): Promise<ProjectResource[]> {
  await getProject(ctx, projectId);
  const statusClause = includeTrash ? eq(projectResources.status, "archived") : includeArchived ? eq(projectResources.status, "archived") : eq(projectResources.status, "active");
  const trashClause = includeTrash ? isNotNull(projectResources.trashedAt) : isNull(projectResources.trashedAt);
  return getDb().select().from(projectResources)
    .where(and(tenantFilter(ctx), eq(projectResources.projectId, projectId), statusClause, trashClause))
    .orderBy(desc(projectResources.updatedAt));
}

export async function getProjectResourceIncludingTrash(ctx: TenantContext, resourceId: string): Promise<ProjectResource> {
  const [row] = await getDb().select().from(projectResources)
    .where(and(eq(projectResources.id, resourceId), tenantFilter(ctx)))
    .limit(1);
  if (!row) throw new ProjectResourceAccessDeniedError();
  return row;
}

export async function getProjectResource(ctx: TenantContext, resourceId: string): Promise<ProjectResource> {
  const row = await getProjectResourceIncludingTrash(ctx, resourceId);
  if (row.trashedAt) throw new ProjectResourceAccessDeniedError();
  return row;
}

export async function createProjectResource(
  ctx: TenantContext,
  input: {
    projectId: number;
    kind: string;
    label: string;
    resourceRef?: string | null;
    contextMode?: "project" | "on_demand" | "excluded";
    metadata?: Record<string, unknown>;
  },
): Promise<ProjectResource> {
  await getProject(ctx, input.projectId);
  const parsed = insertProjectResourceSchema.parse({
    ...input,
    id: `prjres:${crypto.randomUUID()}`,
    contextMode: input.contextMode ?? "project",
    metadata: input.metadata ?? {},
  });
  const [row] = await getDb().insert(projectResources).values({
    id: parsed.id,
    projectId: parsed.projectId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    kind: parsed.kind,
    label: parsed.label,
    resourceRef: parsed.resourceRef ?? null,
    contextMode: parsed.contextMode,
    metadata: parsed.metadata,
  }).returning();
  await touchProjectActivity(ctx, input.projectId);
  return row;
}

/**
 * Insert a Project resource inside a caller-owned transaction. The parent
 * Project row is locked while validating it and advancing its activity time,
 * allowing callers to serialize Project-wide invariants with this write.
 */
export async function createProjectResourceInTransaction(
  tx: any,
  ctx: TenantContext,
  input: {
    projectId: number;
    kind: string;
    label: string;
    resourceRef?: string | null;
    contextMode?: "project" | "on_demand" | "excluded";
    metadata?: Record<string, unknown>;
  },
): Promise<ProjectResource> {
  const projectFilter = ctx.organizationId === null
    ? and(eq(projects.id, input.projectId), eq(projects.ownerUserId, ctx.userId), isNull(projects.organizationId))
    : and(eq(projects.id, input.projectId), eq(projects.ownerUserId, ctx.userId), eq(projects.organizationId, ctx.organizationId));
  const [project] = await tx.select({ lastActivityAt: projects.lastActivityAt, trashedAt: projects.trashedAt })
    .from(projects).where(projectFilter).limit(1).for("update");
  if (!project || project.trashedAt) throw new ProjectResourceAccessDeniedError();

  const parsed = insertProjectResourceSchema.parse({
    ...input,
    id: `prjres:${crypto.randomUUID()}`,
    contextMode: input.contextMode ?? "project",
    metadata: input.metadata ?? {},
  });
  const [row] = await tx.insert(projectResources).values({
    id: parsed.id,
    projectId: parsed.projectId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    kind: parsed.kind,
    label: parsed.label,
    resourceRef: parsed.resourceRef ?? null,
    contextMode: parsed.contextMode,
    metadata: parsed.metadata,
  }).returning();

  const nextActivityAt = new Date(Math.max(Date.now(), project.lastActivityAt.getTime() + 1));
  await tx.update(projects).set({ lastActivityAt: nextActivityAt }).where(projectFilter);
  return row;
}

export async function setProjectResourceContextMode(
  ctx: TenantContext,
  resourceId: string,
  contextMode: "project" | "on_demand" | "excluded",
  expectedUpdatedAt?: string,
): Promise<ProjectResource> {
  const resource = await getProjectResource(ctx, resourceId);
  const [row] = await getDb().update(projectResources)
    .set({ contextMode, updatedAt: new Date() })
    .where(and(eq(projectResources.id, resourceId), tenantFilter(ctx),
      expectedUpdatedAt ? eq(projectResources.updatedAt, new Date(expectedUpdatedAt)) : undefined,
      expectedUpdatedAt ? eq(projectResources.status, "active") : undefined))
    .returning();
  if (!row) throw new Error("Resource changed since review. Refresh this Project before changing context inclusion.");
  await touchProjectActivity(ctx, resource.projectId);
  return row;
}

export async function updateProjectResourceMetadata(
  ctx: TenantContext,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<ProjectResource> {
  const resource = await getProjectResource(ctx, resourceId);
  const [row] = await getDb().update(projectResources)
    .set({ metadata, updatedAt: new Date() })
    .where(and(eq(projectResources.id, resourceId), tenantFilter(ctx)))
    .returning();
  if (!row) throw new ProjectResourceAccessDeniedError();
  await touchProjectActivity(ctx, resource.projectId);
  return row;
}

export async function renameProjectResource(ctx: TenantContext, resourceId: string, label: string): Promise<ProjectResource> {
  const resource = await getProjectResource(ctx, resourceId);
  const clean = label.trim();
  if (!clean) throw new Error("Resource label cannot be empty.");
  if (clean.length > 240) throw new Error("Resource label cannot exceed 240 characters.");
  const [row] = await getDb().update(projectResources)
    .set({ label: clean, updatedAt: new Date() })
    .where(and(eq(projectResources.id, resourceId), tenantFilter(ctx)))
    .returning();
  await touchProjectActivity(ctx, resource.projectId);
  return row;
}

export async function archiveProjectResource(ctx: TenantContext, resourceId: string): Promise<ProjectResource> {
  const resource = await getProjectResource(ctx, resourceId);
  const [row] = await getDb().update(projectResources)
    .set({ status: "archived", trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: new Date() })
    .where(and(eq(projectResources.id, resourceId), tenantFilter(ctx)))
    .returning();
  if (!row) throw new ProjectResourceAccessDeniedError();
  await touchProjectActivity(ctx, resource.projectId);
  return row;
}

export async function restoreProjectResource(ctx: TenantContext, resourceId: string): Promise<ProjectResource> {
  const resource = await getProjectResource(ctx, resourceId);
  const [row] = await getDb().update(projectResources)
    .set({ status: "active", trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: new Date() })
    .where(and(eq(projectResources.id, resourceId), tenantFilter(ctx)))
    .returning();
  if (!row) throw new ProjectResourceAccessDeniedError();
  await touchProjectActivity(ctx, resource.projectId);
  return row;
}

export async function trashProjectResource(ctx: TenantContext, resourceId: string): Promise<ProjectResource> {
  const resource = await getProjectResource(ctx, resourceId);
  if (resource.trashedAt) return resource;
  const now = new Date();
  const [row] = await getDb().update(projectResources)
    .set({ status: "archived", trashedAt: now, trashedByProjectId: null, trashedFromStatus: resource.status, updatedAt: now })
    .where(and(eq(projectResources.id, resourceId), tenantFilter(ctx)))
    .returning();
  if (!row) throw new ProjectResourceAccessDeniedError();
  await touchProjectActivity(ctx, resource.projectId);
  return row;
}

export async function restoreTrashedProjectResource(ctx: TenantContext, resourceId: string): Promise<ProjectResource> {
  const resource = await getProjectResourceIncludingTrash(ctx, resourceId);
  if (!resource.trashedAt) throw new Error("Resource is not in Trash.");
  await getProject(ctx, resource.projectId);
  const [row] = await getDb().update(projectResources)
    .set({ status: resource.trashedFromStatus === "archived" ? "archived" : "active", trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: new Date() })
    .where(and(eq(projectResources.id, resourceId), tenantFilter(ctx)))
    .returning();
  if (!row) throw new ProjectResourceAccessDeniedError();
  await touchProjectActivity(ctx, resource.projectId);
  return row;
}

export async function permanentlyDeleteProjectResource(ctx: TenantContext, resourceId: string): Promise<void> {
  const resource = await getProjectResourceIncludingTrash(ctx, resourceId);
  if (!resource.trashedAt) throw new Error("Resource must be in Trash before permanent deletion.");
  const deleted = await getDb().delete(projectResources).where(and(eq(projectResources.id, resourceId), tenantFilter(ctx), isNotNull(projectResources.trashedAt))).returning();
  if (!deleted.length) throw new ProjectResourceAccessDeniedError();
  try {
    await deleteProjectAttachmentResourceBlob(resource);
  } catch {
    // The DB row is already gone, so do not report a retryable failure that
    // would imply the resource still exists. The route cannot serve an
    // orphaned blob without an owned Project Resource reference.
    console.error("[project-attachments] Blob cleanup failed after permanent resource removal.");
  }
}
