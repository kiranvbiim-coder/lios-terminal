import { assertLegacyWorkClaim, type TenantContext } from "./tenantContext";
import { createProject, findProjectByLegacyWorkspaceId } from "./projectStore";
import { createProjectResource } from "./projectResourceStore";
import { createProjectSession } from "./projectSessionStore";
import { listWorkspaces } from "./uideEngine/workspaceStore";
import { listSnapshots } from "./uideEngine/workspaceSnapshotStore";
import type { ProjectWorkspaceSessionState } from "@shared/projectContracts";

function sessionStateFromLegacy(analyticalState: any): ProjectWorkspaceSessionState {
  const focusedPaneId = analyticalState.activeTab.workspace.focusedPane;
  const pane = analyticalState.activeTab.workspace[focusedPaneId] ?? analyticalState.activeTab.workspace.primary;
  return {
    version: 1,
    workspaceEngine: "legacy-resizable",
    analyticalState,
    dockviewLayout: null,
    linkedContext: { contexts: {}, channels: {} },
    focusedObject: {
      kind: "panel",
      id: focusedPaneId,
      label: analyticalState.activeTab.title || "Migrated workspace",
      view: pane?.view ?? null,
      symbol: pane?.symbol ?? null,
      paneId: focusedPaneId,
    },
    savedViewName: null,
  };
}

export interface LegacyWorkspaceMigrationResult {
  scanned: number;
  createdProjects: number;
  migratedSessions: number;
  skippedExisting: number;
}

export async function migrateLegacyWorkspacesToProjects(ctx: TenantContext): Promise<LegacyWorkspaceMigrationResult> {
  const workspaces = listWorkspaces(ctx.userId);
  let createdProjects = 0;
  let migratedSessions = 0;
  let skippedExisting = 0;

  for (const workspace of workspaces) {
    assertLegacyWorkClaim(ctx, workspace.createdByUserId);
    const existing = await findProjectByLegacyWorkspaceId(ctx, workspace.id);
    if (existing) {
      skippedExisting += 1;
      continue;
    }

    const project = await createProject(ctx, {
      name: workspace.name,
      instructions: workspace.description,
      legacyWorkspaceId: workspace.id,
    });
    createdProjects += 1;

    await createProjectResource(ctx, {
      projectId: project.id,
      kind: "legacy-workspace",
      label: workspace.name,
      resourceRef: workspace.id,
      contextMode: "on_demand",
      metadata: {
        clientName: workspace.clientName,
        claimedByUserId: ctx.userId,
        claimedByOrganizationId: ctx.organizationId,
        symbols: workspace.symbols,
        tags: workspace.tags,
        migratedFrom: "uide-workspace",
      },
    });

    for (const symbol of workspace.symbols) {
      await createProjectResource(ctx, {
        projectId: project.id,
        kind: "entity",
        label: symbol,
        resourceRef: symbol,
        contextMode: "project",
        metadata: { migratedFrom: "legacy-workspace-symbol" },
      });
    }

    const snapshots = listSnapshots(workspace.id).filter((snapshot) => snapshot.savedByUserId === ctx.userId && snapshot.analyticalState);
    for (const snapshot of snapshots.reverse()) {
      await createProjectSession(ctx, {
        projectId: project.id,
        name: snapshot.label || "Migrated Session",
        workspaceState: sessionStateFromLegacy(snapshot.analyticalState),
      });
      migratedSessions += 1;
    }
  }

  return {
    scanned: workspaces.length,
    createdProjects,
    migratedSessions,
    skippedExisting,
  };
}
