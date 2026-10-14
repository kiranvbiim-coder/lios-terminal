import {
  runtimeExecutionContextSchema,
  workspaceSessionEnvelopeSchema,
  type RuntimeExecutionContext,
  type WorkspaceSessionEnvelope,
} from "@shared/runtimeContracts";
import type { WorkspaceAdapter, WorkspacePanelRequest } from "@shared/runtimeAdapters";
import type { ProjectWorkspaceSessionState, SafeWorkspaceAction } from "@shared/projectContracts";
import { isRegisteredView, isViewVisibleToAudience, type WorkspaceAudience } from "./featureRegistry";
import { requestSafeWorkspaceAction } from "./livingWorkspaceActions";
import {
  captureProjectWorkspaceSessionState,
  restoreProjectWorkspaceSessionState,
} from "./projectWorkspaceSession";
import {
  restoreProjectSessionRecord,
  updateProjectSession,
  type ProjectSession,
} from "./useProjects";

export const LIOS_LIVING_WORKSPACE_ADAPTER_ID = "lios.workspace.living";

type CanonicalPaneId = "primary" | "secondary" | "tertiary" | "quaternary";

export interface LivingWorkspaceAdapterDependencies {
  audience: WorkspaceAudience;
  dispatchWorkspaceAction?: (action: SafeWorkspaceAction) => unknown;
  captureWorkspaceState?: () => ProjectWorkspaceSessionState | null;
  restoreWorkspaceState?: (state: unknown) => boolean;
  loadSession?: (sessionId: string) => Promise<ProjectSession>;
  updateSession?: (
    sessionId: string,
    patch: { workspaceState?: ProjectWorkspaceSessionState; name?: string; status?: ProjectSession["status"] },
  ) => Promise<ProjectSession>;
}

function canonicalPaneId(value: string): CanonicalPaneId {
  if (value === "primary" || value === "secondary" || value === "tertiary" || value === "quaternary") return value;
  throw new Error(`Living Workspace panel target "${value}" is not a canonical LiOS pane.`);
}

function requiredProjectId(context: RuntimeExecutionContext): number {
  if (typeof context.projectId !== "number" || !Number.isInteger(context.projectId) || context.projectId <= 0) {
    throw new Error("Living Workspace snapshot/restore requires a canonical numeric Project id.");
  }
  return context.projectId;
}

function requiredSessionId(context: RuntimeExecutionContext): string {
  if (typeof context.sessionId !== "string" || !context.sessionId.trim()) {
    throw new Error("Living Workspace snapshot/restore requires an existing canonical Project Session id.");
  }
  return context.sessionId.trim();
}

function sameWorkspaceState(left: ProjectWorkspaceSessionState, right: ProjectWorkspaceSessionState): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function assertSessionIdentity(
  session: ProjectSession,
  projectId: number,
  sessionId: string,
): void {
  if (session.id !== sessionId || session.projectId !== projectId) {
    throw new Error("Living Workspace Project/Session identity does not match the canonical persisted Session.");
  }
}

export function createWorkspaceRuntimeContext(input: {
  projectId?: number | null;
  sessionId?: string | null;
  conversationId?: number | string | null;
  activeObjectId?: number | string | null;
} = {}): RuntimeExecutionContext {
  return runtimeExecutionContextSchema.parse({
    requestId: crypto.randomUUID(),
    userId: null,
    organizationId: null,
    projectId: input.projectId ?? null,
    sessionId: input.sessionId ?? null,
    conversationId: input.conversationId ?? null,
    activeObjectId: input.activeObjectId ?? null,
    dataClassification: "private",
    approvedActions: [],
  });
}

export function workspaceSessionEnvelopeForProjectSession(session: ProjectSession): WorkspaceSessionEnvelope {
  const provenance = session.workspaceState.provenance;
  return workspaceSessionEnvelopeSchema.parse({
    schemaVersion: "1",
    projectId: session.projectId,
    sessionId: session.id,
    parentSessionId: session.parentSessionId,
    conversationId: session.chatId,
    workspaceAdapterId: LIOS_LIVING_WORKSPACE_ADAPTER_ID,
    layoutVersion: `project-workspace-session:v${session.workspaceState.version}`,
    activeArtifactIds: [],
    sourcePolicyRef: provenance?.sourcePolicyRef ?? null,
    strategyRef: provenance?.strategyRef ?? null,
    backtestRef: provenance?.backtestRef ?? null,
  });
}

export function createLivingWorkspaceAdapter(
  dependencies: LivingWorkspaceAdapterDependencies,
): WorkspaceAdapter {
  const dispatchWorkspaceAction = dependencies.dispatchWorkspaceAction
    ?? ((action: SafeWorkspaceAction) => requestSafeWorkspaceAction(action, "system"));
  const captureWorkspaceState = dependencies.captureWorkspaceState
    ?? (() => captureProjectWorkspaceSessionState(dependencies.audience, "dockview"));
  const restoreWorkspaceState = dependencies.restoreWorkspaceState
    ?? ((state: unknown) => restoreProjectWorkspaceSessionState(state, dependencies.audience));
  const loadSession = dependencies.loadSession ?? restoreProjectSessionRecord;
  const updateSession = dependencies.updateSession ?? updateProjectSession;

  const dispatch = (action: SafeWorkspaceAction): void => {
    const result = dispatchWorkspaceAction(action);
    if (result === null || result === false) {
      throw new Error("Living Workspace safe-action dispatch is unavailable in the current renderer.");
    }
  };

  return {
    descriptor: {
      contractVersion: "1",
      id: LIOS_LIVING_WORKSPACE_ADAPTER_ID,
      kind: "workspace_adapter",
      name: "LiOS Living Workspace",
      version: "1.0.0",
      lifecycle: "builtin",
      executionScopes: ["renderer"],
      capabilities: [
        "workspace.open-panel",
        "workspace.close-panel",
        "workspace.focus-panel",
        "workspace.snapshot",
        "workspace.restore",
      ],
      permissions: [],
      runtimePackId: null,
      replaceable: true,
      source: {
        origin: "lios",
        importedPaths: ["src/client/src/lib/livingWorkspaceAdapter.ts"],
        modified: false,
      },
    },

    openPanel(request: WorkspacePanelRequest): void {
      const view = request.panelId.trim();
      if (!/^[a-z][a-z0-9_-]{0,119}$/.test(view) || !isRegisteredView(view) || !isViewVisibleToAudience(view, dependencies.audience)) {
        throw new Error(`Living Workspace view "${view || request.panelId}" is not available to the active LiOS audience.`);
      }
      if (request.artifactId !== undefined && request.artifactId !== null) {
        throw new Error("Living Workspace artifact-specific panel opens are not supported by this adapter.");
      }
      if (request.focus === false) {
        throw new Error("Living Workspace cannot open a panel without focusing canonical LiOS workspace state.");
      }
      const symbol = request.symbol?.trim().toUpperCase() || undefined;
      dispatch({
        type: "open-panel",
        view,
        ...(symbol ? { symbol } : {}),
        placement: request.placement ?? "secondary",
        reason: "Requested through the LiOS Living Workspace adapter.",
      });
    },

    closePanel(panelId: string): void {
      const paneId = canonicalPaneId(panelId);
      if (paneId === "primary") {
        throw new Error("The canonical primary LiOS pane cannot be closed.");
      }
      dispatch({
        type: "close-panel",
        paneId,
        reason: "Requested through the LiOS Living Workspace adapter.",
      });
    },

    focusPanel(panelId: string): void {
      const paneId = canonicalPaneId(panelId);
      dispatch({
        type: "focus-panel",
        paneId,
        reason: "Requested through the LiOS Living Workspace adapter.",
      });
    },

    async snapshot(context: RuntimeExecutionContext): Promise<WorkspaceSessionEnvelope> {
      const projectId = requiredProjectId(context);
      const sessionId = requiredSessionId(context);
      const existing = await loadSession(sessionId);
      assertSessionIdentity(existing, projectId, sessionId);

      const currentState = captureWorkspaceState();
      if (!currentState) {
        throw new Error("Living Workspace could not capture the current canonical LiOS workspace.");
      }

      const persisted = sameWorkspaceState(existing.workspaceState, currentState)
        ? existing
        : await updateSession(sessionId, { workspaceState: currentState });
      assertSessionIdentity(persisted, projectId, sessionId);
      return workspaceSessionEnvelopeForProjectSession(persisted);
    },

    async restore(stateInput: WorkspaceSessionEnvelope, context: RuntimeExecutionContext): Promise<void> {
      const state = workspaceSessionEnvelopeSchema.parse(stateInput);
      const projectId = requiredProjectId(context);
      const sessionId = requiredSessionId(context);

      if (String(state.projectId) !== String(projectId) || String(state.sessionId) !== sessionId) {
        throw new Error("Living Workspace restore context does not match the requested Project Session.");
      }
      if (state.workspaceAdapterId && state.workspaceAdapterId !== LIOS_LIVING_WORKSPACE_ADAPTER_ID) {
        throw new Error(`Workspace Session requires adapter "${state.workspaceAdapterId}", not the active LiOS Living Workspace adapter.`);
      }

      const persisted = await loadSession(sessionId);
      assertSessionIdentity(persisted, projectId, sessionId);
      if ((persisted.parentSessionId ?? null) !== (state.parentSessionId ?? null)) {
        throw new Error("Living Workspace Session ancestry does not match the persisted Project Session.");
      }

      if (!restoreWorkspaceState(persisted.workspaceState)) {
        throw new Error("Living Workspace could not restore the canonical Project Session workspace state.");
      }
    },
  };
}
