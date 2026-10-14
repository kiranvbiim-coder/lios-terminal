import type { Express } from "express";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace, duplicateWorkspace } from "./uideEngine/workspaceStore";
import { deleteAllSnapshots } from "./uideEngine/workspaceSnapshotStore";

const AUTHOR = ["internal_admin", "internal_analyst"] as const;
const READ = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

export function registerWorkspaceRoutes(app: Express): void {
  app.get("/api/workspaces", requireRole(...READ), (req, res) => res.json(listWorkspaces(req.user!.id)));

  app.get("/api/workspaces/:id", requireRole(...READ), (req, res) => {
    const workspace = getWorkspace(String(req.params.id), req.user!.id);
    if (!workspace) return res.status(404).json({ error: "Workspace not found." });
    res.json(workspace);
  });

  app.post("/api/workspaces", requireRole(...AUTHOR), async (req, res) => {
    const { name, clientName, description, symbols, tags } = req.body as { name?: string; clientName?: string; description?: string; symbols?: string[]; tags?: string[] };
    if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name is required." });
    const workspace = createWorkspace({ name: name.trim(), clientName: clientName?.trim() || null, description: description?.trim() || null, symbols, tags, createdByUserId: req.user!.id });
    await recordAuditEvent(req.user!.id, "workspace_created", { workspaceId: workspace.id, name: workspace.name, ...auditActor(req.user!) });
    res.json(workspace);
  });

  app.patch("/api/workspaces/:id", requireRole(...AUTHOR), async (req, res) => {
    const { name, clientName, description, addSymbol, removeSymbol, pinned, archived, addTag, removeTag } = req.body as { name?: string; clientName?: string | null; description?: string | null; addSymbol?: string; removeSymbol?: string; pinned?: boolean; archived?: boolean; addTag?: string; removeTag?: string };
    const updated = updateWorkspace(String(req.params.id), req.user!.id, { name, clientName, description, addSymbol, removeSymbol, pinned, archived, addTag, removeTag });
    if (!updated) return res.status(404).json({ error: "Workspace not found." });
    await recordAuditEvent(req.user!.id, "workspace_updated", { workspaceId: updated.id, addSymbol, removeSymbol, pinned, archived, addTag, removeTag, ...auditActor(req.user!) });
    res.json(updated);
  });

  app.post("/api/workspaces/:id/duplicate", requireRole(...AUTHOR), async (req, res) => {
    const duplicate = duplicateWorkspace(String(req.params.id), req.user!.id);
    if (!duplicate) return res.status(404).json({ error: "Workspace not found." });
    await recordAuditEvent(req.user!.id, "workspace_duplicated", { workspaceId: duplicate.id, sourceWorkspaceId: req.params.id, ...auditActor(req.user!) });
    res.json(duplicate);
  });

  app.delete("/api/workspaces/:id", requireRole(...AUTHOR), async (req, res) => {
    const deleted = deleteWorkspace(String(req.params.id), req.user!.id);
    if (!deleted) return res.status(404).json({ error: "Workspace not found." });
    deleteAllSnapshots(String(req.params.id));
    await recordAuditEvent(req.user!.id, "workspace_deleted", { workspaceId: req.params.id, ...auditActor(req.user!) });
    res.json({ success: true });
  });
}
