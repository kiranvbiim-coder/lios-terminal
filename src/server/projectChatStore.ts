import { and, asc, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import {
  insertProjectChatMessageSchema,
  insertProjectChatSchema,
  projectChatMessages,
  projectChats,
  projectArtifacts,
  projectArtifactReferences,
  type ProjectChat,
  type ProjectChatMessage,
} from "@shared/schema";
import type { TenantContext } from "./tenantContext";
import { getProject, getProjectIncludingTrash, touchProjectActivity } from "./projectStore";

export class ProjectChatAccessDeniedError extends Error {
  constructor() {
    super("Chat not found or not owned by the requesting user.");
    this.name = "ProjectChatAccessDeniedError";
  }
}

function tenantFilter(ctx: TenantContext) {
  return ctx.organizationId === null
    ? and(eq(projectChats.ownerUserId, ctx.userId), isNull(projectChats.organizationId))
    : and(eq(projectChats.ownerUserId, ctx.userId), eq(projectChats.organizationId, ctx.organizationId));
}

function ownedChatFilter(ctx: TenantContext, chatId: number) {
  return and(eq(projectChats.id, chatId), tenantFilter(ctx));
}

export async function createProjectChat(
  ctx: TenantContext,
  input: { projectId?: number | null; scope: "project" | "quick"; title?: string | null },
): Promise<ProjectChat> {
  const parsed = insertProjectChatSchema.parse({
    projectId: input.scope === "project" ? input.projectId ?? null : null,
    scope: input.scope,
    title: input.title?.trim() || (input.scope === "quick" ? "Quick Chat" : "New Chat"),
  });
  if (parsed.scope === "project") await getProject(ctx, parsed.projectId!);
  const db = getDb();
  const [row] = await db.insert(projectChats).values({
    projectId: parsed.projectId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    scope: parsed.scope,
    title: parsed.title,
  }).returning();
  if (row.projectId) await touchProjectActivity(ctx, row.projectId);
  return row;
}

export async function getProjectChatIncludingTrash(ctx: TenantContext, chatId: number): Promise<ProjectChat> {
  const db = getDb();
  const [row] = await db.select().from(projectChats).where(ownedChatFilter(ctx, chatId)).limit(1);
  if (!row) throw new ProjectChatAccessDeniedError();
  return row;
}

export async function getProjectChat(ctx: TenantContext, chatId: number): Promise<ProjectChat> {
  const row = await getProjectChatIncludingTrash(ctx, chatId);
  if (row.trashedAt) throw new ProjectChatAccessDeniedError();
  return row;
}

export async function listProjectChats(
  ctx: TenantContext,
  input: { projectId?: number | null; scope?: "project" | "quick"; status?: "active" | "archived"; trash?: boolean } = {},
): Promise<ProjectChat[]> {
  const db = getDb();
  const status = input.status ?? (input.trash ? "archived" : "active");
  const trashClause = input.trash ? isNotNull(projectChats.trashedAt) : isNull(projectChats.trashedAt);
  let scopeClause;
  if (input.projectId != null) {
    await getProjectIncludingTrash(ctx, input.projectId);
    scopeClause = and(eq(projectChats.scope, "project"), eq(projectChats.projectId, input.projectId));
  } else if (input.scope === "quick") {
    scopeClause = and(eq(projectChats.scope, "quick"), isNull(projectChats.projectId));
  } else {
    scopeClause = eq(projectChats.scope, input.scope ?? "project");
  }
  return db.select().from(projectChats)
    .where(and(tenantFilter(ctx), scopeClause, eq(projectChats.status, status), trashClause))
    .orderBy(desc(projectChats.pinned), desc(projectChats.lastActivityAt));
}

export async function renameProjectChat(ctx: TenantContext, chatId: number, title: string): Promise<ProjectChat> {
  await getProjectChat(ctx, chatId);
  const clean = title.trim();
  if (!clean) throw new Error("Chat title cannot be empty.");
  if (clean.length > 200) throw new Error("Chat title cannot exceed 200 characters.");
  const [row] = await getDb().update(projectChats)
    .set({ title: clean, updatedAt: new Date() })
    .where(ownedChatFilter(ctx, chatId))
    .returning();
  return row;
}

export async function setProjectChatPinned(ctx: TenantContext, chatId: number, pinned: boolean): Promise<ProjectChat> {
  await getProjectChat(ctx, chatId);
  const [row] = await getDb().update(projectChats)
    .set({ pinned, updatedAt: new Date() })
    .where(ownedChatFilter(ctx, chatId))
    .returning();
  return row;
}
export async function archiveProjectChat(ctx: TenantContext, chatId: number): Promise<ProjectChat> {
  const chat = await getProjectChat(ctx, chatId);
  const now = new Date();
  const [row] = await getDb().update(projectChats)
    .set({ status: "archived", archivedAt: now, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now })
    .where(ownedChatFilter(ctx, chatId))
    .returning();
  if (chat.projectId) await touchProjectActivity(ctx, chat.projectId);
  return row;
}

export async function restoreProjectChat(ctx: TenantContext, chatId: number): Promise<ProjectChat> {
  const chat = await getProjectChat(ctx, chatId);
  const [row] = await getDb().update(projectChats)
    .set({ status: "active", archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: new Date() })
    .where(ownedChatFilter(ctx, chatId))
    .returning();
  if (!row) throw new ProjectChatAccessDeniedError();
  if (chat.projectId) await touchProjectActivity(ctx, chat.projectId);
  return row;
}

export async function trashProjectChat(ctx: TenantContext, chatId: number): Promise<ProjectChat> {
  const chat = await getProjectChat(ctx, chatId);
  if (chat.trashedAt) return chat;
  const now = new Date();
  const [row] = await getDb().update(projectChats)
    .set({ status: "archived", archivedAt: chat.status === "active" ? now : chat.archivedAt, trashedAt: now, trashedByProjectId: null, trashedFromStatus: chat.status, pinned: false, updatedAt: now })
    .where(ownedChatFilter(ctx, chatId))
    .returning();
  if (!row) throw new ProjectChatAccessDeniedError();
  if (chat.projectId) await touchProjectActivity(ctx, chat.projectId);
  return row;
}

export async function restoreTrashedProjectChat(ctx: TenantContext, chatId: number): Promise<ProjectChat> {
  const chat = await getProjectChatIncludingTrash(ctx, chatId);
  if (!chat.trashedAt) throw new Error("Chat is not in Trash.");
  if (chat.projectId) await getProject(ctx, chat.projectId);
  const restoredStatus = chat.trashedFromStatus === "archived" ? "archived" : "active";
  const [row] = await getDb().update(projectChats)
    .set({ status: restoredStatus, ...(restoredStatus === "active" ? { archivedAt: null } : {}), trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: new Date() })
    .where(ownedChatFilter(ctx, chatId))
    .returning();
  if (!row) throw new ProjectChatAccessDeniedError();
  if (chat.projectId) await touchProjectActivity(ctx, chat.projectId);
  return row;
}

export async function permanentlyDeleteProjectChat(ctx: TenantContext, chatId: number): Promise<void> {
  const chat = await getProjectChatIncludingTrash(ctx, chatId);
  if (!chat.trashedAt) throw new Error("Chat must be in Trash before permanent deletion.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(projectChatMessages).where(eq(projectChatMessages.chatId, chatId));
    const deleted = await tx.delete(projectChats).where(and(ownedChatFilter(ctx, chatId), isNotNull(projectChats.trashedAt))).returning();
    if (!deleted.length) throw new ProjectChatAccessDeniedError();
  });
  // Same post-commit cleanup semantics as permanent Project resource deletion:
  // the removed chat cannot authorize orphaned blobs even if storage deletion fails.
  try {
    await (await import("./projectAttachmentService")).cleanupQuickChatAttachmentBlobs(ctx, chatId, chat.attachmentManifest);
  } catch {
    console.error("[quick-chat-attachments] Private blob cleanup failed after permanent Chat deletion.");
  }
}

export async function promoteQuickChatToProject(ctx: TenantContext, chatId: number, projectId: number): Promise<ProjectChat> {
  const chat = await getProjectChat(ctx, chatId);
  if (chat.scope !== "quick" || chat.projectId !== null) throw new Error("Only Quick Chats can be moved into a Project.");
  await getProject(ctx, projectId);
  const now = new Date();
  const row = await getDb().transaction(async tx => {
    const [updated] = await tx.update(projectChats)
      .set({ scope: "project", projectId, updatedAt: now, lastActivityAt: now })
      .where(and(ownedChatFilter(ctx, chatId), eq(projectChats.scope, "quick"), isNull(projectChats.projectId)))
      .returning();
    if (!updated) throw new ProjectChatAccessDeniedError();
    const retained = await tx.update(projectArtifacts).set({ projectId, owningChatId: null, updatedAt: now })
      .where(and(eq(projectArtifacts.owningChatId, chatId), eq(projectArtifacts.ownerUserId, ctx.userId), isNull(projectArtifacts.projectId)))
      .returning();
    for (const artifact of retained) {
      await tx.update(projectArtifactReferences).set({ projectId }).where(eq(projectArtifactReferences.artifactId, artifact.id));
    }
    return updated;
  });
  await touchProjectActivity(ctx, projectId);
  return row;
}

export async function listProjectChatMessages(ctx: TenantContext, chatId: number): Promise<ProjectChatMessage[]> {
  await getProjectChat(ctx, chatId);
  return getDb().select().from(projectChatMessages)
    .where(eq(projectChatMessages.chatId, chatId))
    .orderBy(asc(projectChatMessages.createdAt), asc(projectChatMessages.id));
}

export async function addProjectChatMessage(
  ctx: TenantContext,
  chatId: number,
  input: { role: "user" | "assistant" | "system"; content: string; metadata?: Record<string, unknown> },
): Promise<ProjectChatMessage> {
  const chat = await getProjectChat(ctx, chatId);
  const parsed = insertProjectChatMessageSchema.parse(input);
  const db = getDb();
  const [row] = await db.insert(projectChatMessages).values({
    chatId,
    role: parsed.role,
    content: parsed.content,
    metadata: parsed.metadata ?? {},
  }).returning();
  const now = new Date();
  await db.update(projectChats).set({ lastActivityAt: now, updatedAt: now }).where(ownedChatFilter(ctx, chatId));
  if (chat.projectId) await touchProjectActivity(ctx, chat.projectId);
  return row;
}

export async function clearProjectChatMessages(ctx: TenantContext, chatId: number): Promise<void> {
  const chat = await getProjectChat(ctx, chatId);
  await getDb().transaction(async (tx) => {
    await tx.delete(projectChatMessages).where(eq(projectChatMessages.chatId, chatId));
    await tx.update(projectChats).set({ attachmentManifest: [] }).where(ownedChatFilter(ctx, chatId));
  });
  try {
    await (await import("./projectAttachmentService")).cleanupQuickChatAttachmentBlobs(ctx, chatId, chat.attachmentManifest);
  } catch {
    console.error("[quick-chat-attachments] Private blob cleanup failed after clearing Chat.");
  }
}

export async function autoTitleProjectChat(ctx: TenantContext, chatId: number, firstUserMessage: string): Promise<void> {
  const chat = await getProjectChat(ctx, chatId);
  if (chat.title !== "New Chat" && chat.title !== "Quick Chat") return;
  const clean = firstUserMessage.replace(/\s+/g, " ").trim().slice(0, 72);
  if (!clean) return;
  await renameProjectChat(ctx, chatId, clean);
}
