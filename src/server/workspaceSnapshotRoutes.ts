import type { Express } from "express";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { listSnapshots, getSnapshot, createSnapshot, deleteSnapshot } from "./uideEngine/workspaceSnapshotStore";
import { getWorkspace, updateWorkspace } from "./uideEngine/workspaceStore";
import { isAnalyticalWorkspaceStateV2 } from "@shared/analyticalWorkspaceState";

const AUTHOR = ["internal_admin", "internal_analyst"] as const;
const READ = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

export function registerWorkspaceSnapshotRoutes(app: Express): void {
  app.get("/api/workspaces/:workspaceId/snapshots", requireRole(...READ), (req, res) => {
    const workspace = getWorkspace(String(req.params.workspaceId), req.user!.id);
    if (!workspace) return res.status(404).json({ error: "Workspace not found." });
    res.json(listSnapshots(workspace.id));
  });

  app.post("/api/workspaces/:workspaceId/snapshots", requireRole(...AUTHOR), async (req, res) => {
    const workspaceId = String(req.params.workspaceId);
    const workspace = getWorkspace(workspaceId, req.user!.id);
    if (!workspace) return res.status(404).json({ error: "Workspace not found." });
    const { label, analyticalState } = req.body as { label?: string; analyticalState?: unknown };
    if (analyticalState !== undefined && analyticalState !== null && !isAnalyticalWorkspaceStateV2(analyticalState)) {
      return res.status(400).json({ error: "Invalid analytical workspace snapshot payload." });
    }
    const snapshot = createSnapshot(workspaceId, {
      label: label || "Snapshot",
      name: workspace.name,
      clientName: workspace.clientName,
      description: workspace.description,
      tags: workspace.tags,
      symbols: workspace.symbols,
      analyticalState: analyticalState ?? null,
    }, req.user!.id);
    await recordAuditEvent(req.user!.id, "workspace_snapshot_created", {
      workspaceId,
      snapshotId: snapshot.id,
      analyticalStateVersion: snapshot.analyticalState?.version ?? null,
      ...auditActor(req.user!),
    });
    res.json(snapshot);
  });

  app.post("/api/workspaces/:workspaceId/snapshots/:snapshotId/restore", requireRole(...AUTHOR), async (req, res) => {
    const workspaceId = String(req.params.workspaceId);
    const workspace = getWorkspace(workspaceId, req.user!.id);
    if (!workspace) return res.status(404).json({ error: "Workspace not found." });
    const snapshot = getSnapshot(workspaceId, String(req.params.snapshotId));
    if (!snapshot || snapshot.savedByUserId !== req.user!.id) return res.status(404).json({ error: "Snapshot not found." });
    const restored = updateWorkspace(workspaceId, req.user!.id, {
      name: snapshot.name,
      clientName: snapshot.clientName,
      description: snapshot.description,
      tags: snapshot.tags,
      symbols: snapshot.symbols,
    });
    if (!restored) return res.status(404).json({ error: "Workspace not found." });
    await recordAuditEvent(req.user!.id, "workspace_snapshot_restored", {
      workspaceId,
      snapshotId: snapshot.id,
      analyticalStateVersion: snapshot.analyticalState?.version ?? null,
      ...auditActor(req.user!),
    });
    // Keep the historical workspace response shape at the top level while
    // returning the optional shell envelope for clients that support V2 restore.
    res.json({ ...restored, analyticalState: snapshot.analyticalState });
  });

  app.delete("/api/workspaces/:workspaceId/snapshots/:snapshotId", requireRole(...AUTHOR), async (req, res) => {
    const workspaceId = String(req.params.workspaceId);
    const workspace = getWorkspace(workspaceId, req.user!.id);
    if (!workspace) return res.status(404).json({ error: "Workspace not found." });
    const snapshot = getSnapshot(workspaceId, String(req.params.snapshotId));
    if (!snapshot || snapshot.savedByUserId !== req.user!.id) return res.status(404).json({ error: "Snapshot not found." });
    const remaining = deleteSnapshot(workspaceId, snapshot.id);
    await recordAuditEvent(req.user!.id, "workspace_snapshot_deleted", { workspaceId, snapshotId: snapshot.id, ...auditActor(req.user!) });
    res.json(remaining);
  });
}
