import type { Express, Request, Response } from "express";
import { DATABASE_FAILURE_MESSAGE, isInternalDetail } from "./safeErrorMessage";
import { z } from "zod";
import { createMemoryUpload, uploadErrorResponse } from "./uploadPolicy";
import { p6PersonalFinanceRequestSchema } from "@shared/p6FinanceContracts";
import { tenantContext, type TenantContext } from "./tenantContext";
import { requireAuth } from "./auth";
import {
  archiveProject,
  createProject,
  getProject,
  getProjectDependencySummary,
  listProjects,
  permanentlyDeleteProject,
  renameProject,
  restoreProject,
  restoreTrashedProject,
  setProjectInstructions,
  setProjectPinned,
  trashProject,
} from "./projectStore";
import {
  archiveProjectChat,
  clearProjectChatMessages,
  createProjectChat,
  getProjectChat,
  listProjectChatMessages,
  listProjectChats,
  permanentlyDeleteProjectChat,
  promoteQuickChatToProject,
  renameProjectChat,
  restoreProjectChat,
  restoreTrashedProjectChat,
  setProjectChatPinned,
  trashProjectChat,
} from "./projectChatStore";
import {
  archiveProjectResource,
  createProjectResource,
  getProjectResource,
  getProjectResourceIncludingTrash,
  listProjectResources,
  permanentlyDeleteProjectResource,
  renameProjectResource,
  restoreTrashedProjectResource,
  restoreProjectResource,
  setProjectResourceContextMode,
  trashProjectResource,
  updateProjectResourceMetadata,
} from "./projectResourceStore";
import {
  archiveProjectSession,
  compareProjectSessions,
  createProjectSession,
  forkProjectSession,
  getParentProjectSession,
  getProjectSession,
  getProjectSessionAncestry,
  explainProjectSessionChange,
  listProjectSessions,
  restoreTrashedProjectSession,
  permanentlyDeleteProjectSession,
  restoreProjectSession,
  trashProjectSession,
  updateProjectSession,
} from "./projectSessionStore";
import { migrateLegacyWorkspacesToProjects } from "./projectMigrationService";
import {
  loadProjectAttachment,
  PROJECT_ATTACHMENT_SUPPORTED_EXTENSIONS,
  uploadProjectChatAttachment,
  ProjectAttachmentLimitError,
  ProjectAttachmentNotFoundError,
} from "./projectAttachmentService";
import {
  PROJECT_ATTACHMENT_MAX_FILE_BYTES,
  ProjectAttachmentStorageUnavailableError,
} from "./projectAttachmentStore";
import { searchProjectWork } from "./workSearch";

const projectAttachmentUpload = createMemoryUpload(
  PROJECT_ATTACHMENT_SUPPORTED_EXTENSIONS,
  PROJECT_ATTACHMENT_MAX_FILE_BYTES,
  { fields: 0 },
);

function parseProjectAttachmentUpload(req: Request, res: Response, next: (error?: unknown) => void): void {
  projectAttachmentUpload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const response = uploadErrorResponse(error);
    if (response) {
      res.status(response.status).json({ error: response.message });
      return;
    }
    next(error);
  });
}

function ctx(req: Request) {
  return tenantContext(req.user!);
}
async function assertProjectResourceRoute(ctxValue: TenantContext, projectIdValue: unknown, resourceId: string) {
  const projectId = z.coerce.number().int().positive().parse(projectIdValue);
  const resource = await getProjectResourceIncludingTrash(ctxValue, resourceId);
  if (resource.projectId !== projectId) throw new Error("Project resource boundary violation.");
  return { projectId, resource };
}

function pathId(value: unknown): number {
  return z.coerce.number().int().positive().parse(value);
}

function fail(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request.", issues: error.issues });
    return;
  }
  if (error instanceof ProjectAttachmentStorageUnavailableError) {
    res.status(503).json({ error: error.message });
    return;
  }
  if (error instanceof ProjectAttachmentLimitError) {
    res.status(413).json({ error: error.message });
    return;
  }
  if (error instanceof ProjectAttachmentNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Request failed.";
  if (isInternalDetail(message) || (error instanceof Error && error.cause && isInternalDetail(String((error.cause as Error).message ?? "")))) {
    console.error("Project route database failure", error);
    res.status(500).json({ error: DATABASE_FAILURE_MESSAGE });
    return;
  }
  if (/not found|not owned|boundary/i.test(message)) {
    res.status(404).json({ error: message });
    return;
  }
  if (/cannot|must|invalid|unsupported|only|empty|exceed|signature|file content|Trash|Project|Chat|Resource|Session|dependencies/i.test(message)) {
    res.status(400).json({ error: message });
    return;
  }
  console.error("Project route failure", error);
  res.status(500).json({ error: "Request failed." });
}
export function registerProjectRoutes(app: Express): void {
  for (const prefix of ["/api/projects", "/api/project-chats", "/api/quick-chats", "/api/project-sessions", "/api/work-search"]) {
    app.use(prefix, requireAuth);
  }

  app.get("/api/work-search", async (req, res) => {
    try {
      const query = z.string().trim().max(200).catch("").parse(req.query.q);
      const limit = z.coerce.number().int().min(1).max(50).catch(24).parse(req.query.limit);
      res.json(await searchProjectWork(ctx(req), query, limit));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects", async (req, res) => {
    try {
      const statusParam = String(req.query.status ?? "");
      const trash = statusParam === "trash" || req.query.trash === "true";
      const status = statusParam === "archived" || trash ? "archived" : "active";
      res.json(await listProjects(ctx(req), { status, trash }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const body = z.object({
        name: z.string().trim().min(1).max(200),
        instructions: z.string().trim().max(4000).nullable().optional(),
      }).parse(req.body);
      res.json(await createProject(ctx(req), body));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/chats/:chatId/attachments", parseProjectAttachmentUpload, async (req, res) => {
    try {
      const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
      if (!file) return res.status(400).json({ error: "Choose a file to attach." });
      const attachment = await uploadProjectChatAttachment(
        ctx(req),
        pathId(req.params.projectId),
        pathId(req.params.chatId),
        { bytes: file.buffer, originalName: file.originalname },
      );
      res.status(201).json({ attachment });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/attachments/:attachmentId/download", async (req, res) => {
    try {
      const projectId = pathId(req.params.projectId);
      const attachmentId = z.string().uuid().parse(req.params.attachmentId);
      const { reference, bytes } = await loadProjectAttachment(ctx(req), projectId, attachmentId);
      const asciiName = reference.fileName.replace(/[^\x20-\x7E]|["\\\\;]/g, "_").slice(0, 160) || "attachment";
      const encodedName = encodeURIComponent(reference.fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).send(bytes);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/migrate-legacy-workspaces", async (req, res) => {
    try { res.json(await migrateLegacyWorkspacesToProjects(ctx(req))); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/dependencies", async (req, res) => {
    try { res.json(await getProjectDependencySummary(ctx(req), pathId(req.params.projectId))); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId", async (req, res) => {
    try { res.json(await getProject(ctx(req), pathId(req.params.projectId))); }
    catch (error) { fail(res, error); }
  });

  app.patch("/api/projects/:projectId", async (req, res) => {
    try {
      const projectId = pathId(req.params.projectId);
      const body = z.object({
        name: z.string().trim().min(1).max(200).optional(),
        instructions: z.string().trim().max(4000).nullable().optional(),
        pinned: z.boolean().optional(),
        status: z.enum(["active", "archived"]).optional(),
      }).strict().parse(req.body);
      let project = await getProject(ctx(req), projectId);
      if (body.name !== undefined) project = await renameProject(ctx(req), projectId, body.name);
      if (body.instructions !== undefined) project = await setProjectInstructions(ctx(req), projectId, body.instructions);
      if (body.pinned !== undefined) project = await setProjectPinned(ctx(req), projectId, body.pinned);
      if (body.status === "archived") project = await archiveProject(ctx(req), projectId);
      if (body.status === "active" && project.status === "archived") {
        project = project.trashedAt ? await restoreTrashedProject(ctx(req), projectId) : await restoreProject(ctx(req), projectId);
      }
      res.json(project);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/trash", async (req, res) => {
    try { res.json(await trashProject(ctx(req), pathId(req.params.projectId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/restore-trash", async (req, res) => {
    try { res.json(await restoreTrashedProject(ctx(req), pathId(req.params.projectId))); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/projects/:projectId", async (req, res) => {
    try { res.json(await trashProject(ctx(req), pathId(req.params.projectId))); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/projects/:projectId/permanent", async (req, res) => {
    try {
      await permanentlyDeleteProject(ctx(req), pathId(req.params.projectId));
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/home", async (req, res) => {
    try {
      const projectId = pathId(req.params.projectId);
      const project = await getProject(ctx(req), projectId);
      const [chats, resources, sessions] = await Promise.all([
        listProjectChats(ctx(req), { projectId }),
        listProjectResources(ctx(req), projectId),
        listProjectSessions(ctx(req), projectId),
      ]);
      res.json({
        project,
        chats: chats.slice(0, 12),
        resources: resources.slice(0, 12),
        sessions: sessions.slice(0, 12),
      });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/chats", async (req, res) => {
    try {
      const statusParam = String(req.query.status ?? "");
      res.json(await listProjectChats(ctx(req), {
        projectId: pathId(req.params.projectId),
        status: statusParam === "archived" || statusParam === "trash" ? "archived" : "active",
        trash: statusParam === "trash" || req.query.trash === "true",
      }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/chats", async (req, res) => {
    try {
      const title = z.object({ title: z.string().trim().min(1).max(200).optional() }).parse(req.body).title;
      res.json(await createProjectChat(ctx(req), {
        projectId: pathId(req.params.projectId),
        scope: "project",
        title,
      }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/quick-chats", async (req, res) => {
    try {
      const statusParam = String(req.query.status ?? "");
      res.json(await listProjectChats(ctx(req), {
        scope: "quick",
        status: statusParam === "archived" || statusParam === "trash" ? "archived" : "active",
        trash: statusParam === "trash" || req.query.trash === "true",
      }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/quick-chats", async (req, res) => {
    try {
      const title = z.object({ title: z.string().trim().min(1).max(200).optional() }).parse(req.body).title;
      res.json(await createProjectChat(ctx(req), { scope: "quick", title }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/project-chats", async (req, res) => {
    try {
      const statusParam = String(req.query.status ?? "");
      res.json(await listProjectChats(ctx(req), {
        scope: "project",
        status: statusParam === "archived" || statusParam === "trash" ? "archived" : "active",
        trash: statusParam === "trash" || req.query.trash === "true",
      }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/project-chats/:chatId", async (req, res) => {
    try { res.json(await getProjectChat(ctx(req), pathId(req.params.chatId))); }
    catch (error) { fail(res, error); }
  });

  app.patch("/api/project-chats/:chatId", async (req, res) => {
    try {
      const chatId = pathId(req.params.chatId);
      const body = z.object({
        title: z.string().trim().min(1).max(200).optional(),
        pinned: z.boolean().optional(),
        status: z.enum(["active", "archived"]).optional(),
      }).strict().parse(req.body);
      let chat = await getProjectChat(ctx(req), chatId);
      if (body.title !== undefined) chat = await renameProjectChat(ctx(req), chatId, body.title);
      if (body.pinned !== undefined) chat = await setProjectChatPinned(ctx(req), chatId, body.pinned);
      if (body.status === "archived") chat = await archiveProjectChat(ctx(req), chatId);
      if (body.status === "active" && chat.status === "archived") chat = await restoreProjectChat(ctx(req), chatId);
      res.json(chat);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/project-chats/:chatId/trash", async (req, res) => {
    try { res.json(await trashProjectChat(ctx(req), pathId(req.params.chatId))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/project-chats/:chatId/restore-trash", async (req, res) => {
    try { res.json(await restoreTrashedProjectChat(ctx(req), pathId(req.params.chatId))); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/project-chats/:chatId", async (req, res) => {
    try { res.json(await trashProjectChat(ctx(req), pathId(req.params.chatId))); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/project-chats/:chatId/permanent", async (req, res) => {
    try {
      await permanentlyDeleteProjectChat(ctx(req), pathId(req.params.chatId));
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/project-chats/:chatId/promote", async (req, res) => {
    try {
      const body = z.object({ projectId: z.number().int().positive() }).parse(req.body);
      res.json(await promoteQuickChatToProject(ctx(req), pathId(req.params.chatId), body.projectId));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/project-chats/:chatId/messages", async (req, res) => {
    try { res.json(await listProjectChatMessages(ctx(req), pathId(req.params.chatId))); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/project-chats/:chatId/messages", async (req, res) => {
    try {
      await clearProjectChatMessages(ctx(req), pathId(req.params.chatId));
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });
  app.get("/api/projects/:projectId/resources", async (req, res) => {
    try {
      const archived = req.query.archived === "true";
      const trash = req.query.trash === "true";
      res.json(await listProjectResources(ctx(req), pathId(req.params.projectId), archived || trash, trash));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/resources", async (req, res) => {
    try {
      const body = z.object({
        kind: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(240),
        resourceRef: z.string().trim().max(1000).nullable().optional(),
        contextMode: z.enum(["project", "on_demand", "excluded"]).optional(),
        metadata: z.record(z.unknown()).optional(),
      }).strict().parse(req.body);
      res.json(await createProjectResource(ctx(req), { projectId: pathId(req.params.projectId), ...body }));
    } catch (error) { fail(res, error); }
  });

  app.patch("/api/projects/:projectId/resources/:resourceId", async (req, res) => {
    try {
      const body = z.object({
        label: z.string().trim().min(1).max(240).optional(),
        contextMode: z.enum(["project", "on_demand", "excluded"]).optional(),
        archived: z.boolean().optional(),
      }).strict().parse(req.body);
      const { projectId } = await assertProjectResourceRoute(ctx(req), req.params.projectId, req.params.resourceId);
      let resource = body.label !== undefined
        ? await renameProjectResource(ctx(req), req.params.resourceId, body.label)
        : null;
      if (body.contextMode !== undefined) resource = await setProjectResourceContextMode(ctx(req), req.params.resourceId, body.contextMode);
      if (body.archived === true) resource = await archiveProjectResource(ctx(req), req.params.resourceId);
      if (body.archived === false) resource = await restoreProjectResource(ctx(req), req.params.resourceId);
      if (!resource) throw new Error("No resource update supplied.");
      if (resource.projectId !== projectId) throw new Error("Project resource boundary violation.");
      res.json(resource);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/resources/:resourceId/trash", async (req, res) => {
    try {
      await assertProjectResourceRoute(ctx(req), req.params.projectId, req.params.resourceId);
      res.json(await trashProjectResource(ctx(req), req.params.resourceId));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/resources/:resourceId/restore-trash", async (req, res) => {
    try {
      await assertProjectResourceRoute(ctx(req), req.params.projectId, req.params.resourceId);
      res.json(await restoreTrashedProjectResource(ctx(req), req.params.resourceId));
    } catch (error) { fail(res, error); }
  });

  app.delete("/api/projects/:projectId/resources/:resourceId", async (req, res) => {
    try {
      await assertProjectResourceRoute(ctx(req), req.params.projectId, req.params.resourceId);
      res.json(await trashProjectResource(ctx(req), req.params.resourceId));
    } catch (error) { fail(res, error); }
  });

  app.delete("/api/projects/:projectId/resources/:resourceId/permanent", async (req, res) => {
    try {
      await assertProjectResourceRoute(ctx(req), req.params.projectId, req.params.resourceId);
      await permanentlyDeleteProjectResource(ctx(req), req.params.resourceId);
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });
  app.get("/api/projects/:projectId/personal-finance-profile", async (req, res) => {
    try {
      const projectId = pathId(req.params.projectId);
      const resources = await listProjectResources(ctx(req), projectId);
      const resource = resources.find((item) => item.kind === "personal_finance_profile") ?? null;
      if (!resource) {
        res.json({ resourceId: null, profile: null });
        return;
      }
      const parsed = p6PersonalFinanceRequestSchema.safeParse(resource.metadata?.profile);
      if (!parsed.success) {
        res.status(422).json({ error: "Saved Personal Finance profile is invalid and must be reviewed before use." });
        return;
      }
      res.json({ resourceId: resource.id, profile: parsed.data });
    } catch (error) { fail(res, error); }
  });

  app.put("/api/projects/:projectId/personal-finance-profile", async (req, res) => {
    try {
      const projectId = pathId(req.params.projectId);
      const profile = p6PersonalFinanceRequestSchema.parse(req.body);
      const resources = await listProjectResources(ctx(req), projectId);
      const existing = resources.find((item) => item.kind === "personal_finance_profile") ?? null;
      const resource = existing
        ? await updateProjectResourceMetadata(ctx(req), existing.id, { profile })
        : await createProjectResource(ctx(req), {
            projectId,
            kind: "personal_finance_profile",
            label: "Personal Finance & Wealth",
            resourceRef: "lios:personal-finance-profile",
            contextMode: "excluded",
            metadata: { profile },
          });
      const protectedResource = resource.contextMode === "excluded"
        ? resource
        : await setProjectResourceContextMode(ctx(req), resource.id, "excluded");
      res.json({ resourceId: protectedResource.id, profile });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/sessions", async (req, res) => {
    try {
      const statusParam = String(req.query.status ?? "");
      res.json(await listProjectSessions(
        ctx(req),
        pathId(req.params.projectId),
        statusParam === "archived" || statusParam === "trash" ? "archived" : "active",
        statusParam === "trash" || req.query.trash === "true",
      ));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/sessions", async (req, res) => {
    try {
      const body = z.object({
        chatId: z.number().int().positive().nullable().optional(),
        parentSessionId: z.string().trim().min(1).max(200).nullable().optional(),
        name: z.string().trim().min(1).max(200),
        workspaceState: z.unknown(),
      }).strict().parse(req.body);
      res.json(await createProjectSession(ctx(req), {
        projectId: pathId(req.params.projectId),
        ...body,
        workspaceState: body.workspaceState as any,
      }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/project-sessions/:sessionId", async (req, res) => {
    try { res.json(await getProjectSession(ctx(req), req.params.sessionId)); }
    catch (error) { fail(res, error); }
  });

  app.patch("/api/project-sessions/:sessionId", async (req, res) => {
    try {
      const body = z.object({
        name: z.string().trim().min(1).max(200).optional(),
        workspaceState: z.unknown().optional(),
        status: z.enum(["active", "archived"]).optional(),
      }).strict().parse(req.body);
      let session = await getProjectSession(ctx(req), req.params.sessionId);
      if (body.name !== undefined || body.workspaceState !== undefined) {
        session = await updateProjectSession(ctx(req), req.params.sessionId, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.workspaceState !== undefined ? { workspaceState: body.workspaceState as any } : {}),
        });
      }
      if (body.status === "archived") session = await archiveProjectSession(ctx(req), req.params.sessionId);
      if (body.status === "active" && session.status === "archived") session = await restoreProjectSession(ctx(req), req.params.sessionId);
      res.json(session);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/project-sessions/:sessionId/trash", async (req, res) => {
    try { res.json(await trashProjectSession(ctx(req), req.params.sessionId)); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/project-sessions/:sessionId/restore-trash", async (req, res) => {
    try { res.json(await restoreTrashedProjectSession(ctx(req), req.params.sessionId)); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/project-sessions/:sessionId", async (req, res) => {
    try { res.json(await trashProjectSession(ctx(req), req.params.sessionId)); }
    catch (error) { fail(res, error); }
  });

  app.delete("/api/project-sessions/:sessionId/permanent", async (req, res) => {
    try {
      await permanentlyDeleteProjectSession(ctx(req), req.params.sessionId);
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });
  app.post("/api/project-sessions/:sessionId/fork", async (req, res) => {
    try {
      const body = z.object({ name: z.string().trim().min(1).max(200).optional() }).parse(req.body);
      res.json(await forkProjectSession(ctx(req), req.params.sessionId, body.name));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/project-sessions/:sessionId/parent", async (req, res) => {
    try { res.json({ parent: await getParentProjectSession(ctx(req), req.params.sessionId) }); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/project-sessions/:sessionId/ancestry", async (req, res) => {
    try { res.json(await getProjectSessionAncestry(ctx(req), req.params.sessionId)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/project-sessions/:sessionId/compare/:otherSessionId", async (req, res) => {
    try { res.json(await compareProjectSessions(ctx(req), req.params.sessionId, req.params.otherSessionId)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/project-sessions/:sessionId/explain-change/:otherSessionId", async (req, res) => {
    try { res.json(await explainProjectSessionChange(ctx(req), req.params.sessionId, req.params.otherSessionId)); }
    catch (error) { fail(res, error); }
  });
}
