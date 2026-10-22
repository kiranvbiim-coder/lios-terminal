import type { ArtifactWorkbenchContext, PaneId } from "./terminalTypes";
import { activeTerminalTab, isTerminalTabsState } from "./terminalTabs";
import type { TerminalTab, TerminalTabsState } from "./terminalTabs";
import type { DockviewLayoutState } from "./dockviewWorkspaceState";
import type { WorkspaceAudience } from "./featureRegistry";
import { sanitizeWorkspaceForAudience } from "./terminalWorkspace";

export interface ArtifactWorkbenchHandoff {
  context: ArtifactWorkbenchContext;
  priorTab: TerminalTab;
  priorLayout: DockviewLayoutState | null;
  priorMaximizedPane: PaneId | null;
}

/**
 * Restore only the navigation displaced by opening an Artifact inside the
 * original Dockview tab. The Artifact, Chat and saved revision remain P4/server
 * owned; this browser record cannot authorize data access or recover unsaved
 * editor buffers.
 */
export const ARTIFACT_WORKBENCH_RECOVERY_KEY = "lios.artifact-workbench-return.v1";
const RECOVERY_MAX_CHARS = 1_000_000;
// Return geometry remains valid while the same owned Artifact pane remains in the saved tab.
// Do not expire navigation after a week: persistent work can resume much later.
const RECOVERY_PANES = ["primary", "secondary", "tertiary", "quaternary"] as const;

function validRecoveryContext(value: unknown): value is ArtifactWorkbenchContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Partial<ArtifactWorkbenchContext>;
  return (c.projectId === null || (Number.isSafeInteger(c.projectId) && (c.projectId ?? 0) > 0))
    && Number.isSafeInteger(c.chatId) && (c.chatId ?? 0) > 0
    && typeof c.artifactId === "string"
    && /^(?:artifact:)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(c.artifactId)
    && Number.isSafeInteger(c.version) && (c.version ?? 0) > 0;
}

function matchingRecoveredPane(state: TerminalTabsState, handoff: ArtifactWorkbenchHandoff): boolean {
  const actual = state.tabs.find(tab => tab.id === handoff.priorTab.id);
  if (!actual || actual.id !== handoff.priorTab.id) return false;
  // The user can focus another Dockview pane after expanding the Artifact.
  // Only the original replaced pane can prove this is still the same handoff.
  const paneId = handoff.priorTab.workspace.focusedPane;
  if (!RECOVERY_PANES.includes(paneId)) return false;
  const pane = actual.workspace[paneId];
  return pane?.view === "artifact" && !!pane.artifact
    && pane.artifact.projectId === handoff.context.projectId
    && pane.artifact.chatId === handoff.context.chatId
    && pane.artifact.artifactId === handoff.context.artifactId
    && Number.isSafeInteger(pane.artifact.version) && pane.artifact.version > 0;
}

export function clearArtifactWorkbenchRecovery(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(ARTIFACT_WORKBENCH_RECOVERY_KEY); } catch {}
}

export function saveArtifactWorkbenchRecovery(ownerEmail: string, handoff: ArtifactWorkbenchHandoff): void {
  if (typeof window === "undefined") return;
  const owner = ownerEmail.trim().toLowerCase();
  if (!owner || !validRecoveryContext(handoff.context)) return;
  try {
    const payload = JSON.stringify({ schemaVersion: 1, owner, capturedAt: Date.now(), handoff });
    if (payload.length > RECOVERY_MAX_CHARS) return;
    window.localStorage.setItem(ARTIFACT_WORKBENCH_RECOVERY_KEY, payload);
  } catch {
    // Navigation recovery may be unavailable in hardened/private storage.
  }
}

export function loadArtifactWorkbenchRecovery(
  ownerEmail: string, state: TerminalTabsState, audience: WorkspaceAudience,
): ArtifactWorkbenchHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ARTIFACT_WORKBENCH_RECOVERY_KEY);
    if (!raw) return null;
    const parsed: unknown = raw.length <= RECOVERY_MAX_CHARS ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      clearArtifactWorkbenchRecovery(); return null;
    }
    const record = parsed as Record<string, unknown>;
    // Never leak one authenticated user's previous workspace to another user.
    // A different account keeps its own normal tab state; this hint is ignored.
    if (record.owner !== ownerEmail.trim().toLowerCase()) return null;
    if (record.schemaVersion !== 1 || typeof record.capturedAt !== "number"
      || !Number.isFinite(record.capturedAt) || record.capturedAt > Date.now()) {
      clearArtifactWorkbenchRecovery(); return null;
    }
    const value = record.handoff;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      clearArtifactWorkbenchRecovery(); return null;
    }
    const candidate = value as Partial<ArtifactWorkbenchHandoff>;
    if (!validRecoveryContext(candidate.context)
      || !candidate.priorTab || !isTerminalTabsState({
        tabs: [candidate.priorTab], activeTabId: candidate.priorTab.id, closedTabs: [],
      })
      || !RECOVERY_PANES.includes(candidate.priorTab.workspace.focusedPane)
      || (candidate.priorMaximizedPane != null && !RECOVERY_PANES.includes(candidate.priorMaximizedPane as typeof RECOVERY_PANES[number]))
      || (candidate.priorLayout != null && (typeof candidate.priorLayout !== "object" || Array.isArray(candidate.priorLayout)))
      || !matchingRecoveredPane(state, candidate as ArtifactWorkbenchHandoff)) {
      clearArtifactWorkbenchRecovery(); return null;
    }
    return {
      context: { ...candidate.context },
      priorTab: {
        ...candidate.priorTab,
        workspace: sanitizeWorkspaceForAudience(candidate.priorTab.workspace, audience),
      },
      priorLayout: candidate.priorLayout ?? null,
      priorMaximizedPane: candidate.priorMaximizedPane ?? null,
    };
  } catch {
    clearArtifactWorkbenchRecovery();
    return null;
  }
}

export interface ArtifactWorkbenchRevisionSelection {
  requestedVersion: number | null;
  displayedVersion: number;
  loading: boolean;
}
type RevisionSelectionEvent =
  | { type: "select"; version: number | null }
  | { type: "loaded"; version: number; requestedVersion?: number | null }
  | { type: "context"; version: number; dirty: boolean };

/**
 * The canonical ArtifactPane selection is explicitly user-directed, not a
 * monotonically increasing write version. Reading historical v1 from a
 * Workbench currently displaying v3 must work. The outer controlled prop
 * change clears this local selection before another Artifact is shown.
 */
export function resolveArtifactPaneRequestedVersion(
  artifactId: string,
  controlledVersion: number | null | undefined,
  selected: { artifactId: string; version: number } | null,
): number | null | undefined {
  return selected?.artifactId === artifactId ? selected.version : controlledVersion;
}

/** Context is a navigation projection, never permission for a stale observation to undo a local selection. */
export function advanceArtifactWorkbenchRevision(
  current: ArtifactWorkbenchRevisionSelection, event: RevisionSelectionEvent,
): ArtifactWorkbenchRevisionSelection {
  if (event.type === "loaded") {
    // Bound callbacks identify the query selection that actually loaded the
    // version. Ignore callbacks from a previous query even if they report the
    // same number as the last displayed revision.
    if ("requestedVersion" in event && event.requestedVersion !== current.requestedVersion) return current;
    if (current.requestedVersion !== null && event.version !== current.requestedVersion) return current;
    // null means "latest head", never "any cached historical version".
    // A late v1 response after selecting latest from v3 must not roll back
    // the displayed revision or permit a stale return-to-Chat.
    if (current.requestedVersion === null && event.version < current.displayedVersion) return current;
    return !current.loading && current.displayedVersion === event.version ? current
      : { ...current, displayedVersion: event.version, loading: false };
  }
  if (event.type === "context" && (event.dirty || event.version === current.displayedVersion)) return current;
  return event.version === current.requestedVersion ? current
    : { ...current, requestedVersion: event.version, loading: true };
}

/** The existing navigation owner temporarily projects a P4 reference into its focused pane. */
export function openArtifactWorkbench(
  state: TerminalTabsState,
  context: ArtifactWorkbenchContext,
  priorLayout: DockviewLayoutState | null,
  priorMaximizedPane: PaneId | null,
  dirty: boolean,
): { state: TerminalTabsState; handoff: ArtifactWorkbenchHandoff } | null {
  if (dirty) return null;
  const priorTab = activeTerminalTab(state);
  const paneId = priorTab.workspace.focusedPane;
  const workspace = {
    ...priorTab.workspace,
    [paneId]: { view: "artifact" as const, symbol: "", artifact: { ...context } },
  };
  return {
    state: { ...state, tabs: state.tabs.map(tab => tab.id === priorTab.id ? { ...tab, workspace } : tab) },
    handoff: { context: { ...context }, priorTab, priorLayout, priorMaximizedPane },
  };
}

/** Return never allocates a Chat or rolls back P4 edits; only prior Terminal navigation is restored. */
export function returnFromArtifactWorkbench(
  state: TerminalTabsState,
  handoff: ArtifactWorkbenchHandoff,
  context: ArtifactWorkbenchContext,
  dirty: boolean,
): { state: TerminalTabsState; context: ArtifactWorkbenchContext } | null {
  if (dirty || context.projectId !== handoff.context.projectId || context.chatId !== handoff.context.chatId
    || context.artifactId !== handoff.context.artifactId) return null;
  const exists = state.tabs.some(tab => tab.id === handoff.priorTab.id);
  return {
    state: {
      ...state,
      tabs: exists ? state.tabs.map(tab => tab.id === handoff.priorTab.id ? { ...tab, workspace: handoff.priorTab.workspace } : tab) : [...state.tabs, handoff.priorTab],
      activeTabId: handoff.priorTab.id,
    },
    context: { ...context },
  };
}
