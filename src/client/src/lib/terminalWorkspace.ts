import { isRegisteredView, isViewVisibleToAudience } from "./featureRegistry";
import type { WorkspaceAudience } from "./featureRegistry";
import type { PaneId, PaneState, ViewMode, WorkspaceState } from "./terminalTypes";

const SECURITY_VIEWS: ViewMode[] = ["entity", "quote", "chart", "news", "agent", "companyfundamentals", "financialstatements", "valuation", "peercomp", "options", "montecarlo", "filingintel", "advancedrisk", "assetpricing", "backtesting"];
export const WORKSPACE_PANE_IDS: readonly PaneId[] = ["primary", "secondary", "tertiary", "quaternary"];

function isSecurityView(view: ViewMode): boolean {
  return SECURITY_VIEWS.includes(view);
}

export function getWorkspacePane(workspace: WorkspaceState, paneId: PaneId): PaneState | null {
  if (paneId === "primary") return workspace.primary;
  if (paneId === "secondary") return workspace.secondary;
  if (paneId === "tertiary") return workspace.tertiary ?? null;
  return workspace.quaternary ?? null;
}

export function getWorkspacePanes(workspace: WorkspaceState): Array<{ id: PaneId; pane: PaneState }> {
  return WORKSPACE_PANE_IDS.flatMap((id) => {
    const pane = getWorkspacePane(workspace, id);
    return pane ? [{ id, pane }] : [];
  });
}

export function getWorkspacePaneCount(workspace: WorkspaceState): number {
  return getWorkspacePanes(workspace).length;
}

function getFocusedPaneKey(workspace: WorkspaceState): PaneId {
  return getWorkspacePane(workspace, workspace.focusedPane) ? workspace.focusedPane : "primary";
}

function withPane(workspace: WorkspaceState, paneId: PaneId, pane: PaneState | null): WorkspaceState {
  if (paneId === "primary") return pane ? { ...workspace, primary: pane } : workspace;
  if (paneId === "secondary") return { ...workspace, secondary: pane };
  if (paneId === "tertiary") return { ...workspace, tertiary: pane };
  return { ...workspace, quaternary: pane };
}

export function createInitialWorkspace(): WorkspaceState {
  return {
    primary: { view: "market", symbol: "AAPL" },
    secondary: null,
    focusedPane: "primary",
  };
}

export function focusPane(workspace: WorkspaceState, pane: PaneId): WorkspaceState {
  if (!getWorkspacePane(workspace, pane)) return workspace;
  return { ...workspace, focusedPane: pane };
}

export function navigatePane(workspace: WorkspaceState, paneId: PaneId, view: ViewMode): WorkspaceState {
  const pane = getWorkspacePane(workspace, paneId);
  if (!pane) return workspace;
  return { ...withPane(workspace, paneId, { ...pane, view }), focusedPane: paneId };
}

export function navigateFocusedPane(workspace: WorkspaceState, view: ViewMode): WorkspaceState {
  return navigatePane(workspace, getFocusedPaneKey(workspace), view);
}

export function updatePaneSymbol(workspace: WorkspaceState, paneId: PaneId, symbol: string): WorkspaceState {
  const pane = getWorkspacePane(workspace, paneId);
  const normalized = symbol.trim().toUpperCase();
  if (!pane || !normalized) return workspace;
  return { ...withPane(workspace, paneId, { ...pane, symbol: normalized }), focusedPane: paneId };
}

export function openSecurityView(workspace: WorkspaceState, symbol: string, view: ViewMode): WorkspaceState {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return workspace;
  const focusedId = getFocusedPaneKey(workspace);
  const focusedPane = getWorkspacePane(workspace, focusedId)!;

  // Preserve the original terminal behavior: a broad primary canvas opens a
  // security analysis in the secondary pane instead of destroying context.
  if (focusedId === "primary" && !isSecurityView(focusedPane.view)) {
    return {
      ...workspace,
      secondary: { view, symbol: normalizedSymbol },
      focusedPane: "secondary",
    };
  }

  return {
    ...withPane(workspace, focusedId, { view, symbol: normalizedSymbol }),
    focusedPane: focusedId,
  };
}

export function openSymbolInWorkspace(workspace: WorkspaceState, symbol: string): WorkspaceState {
  return openSecurityView(workspace, symbol, "quote");
}

export function addWorkspacePane(
  workspace: WorkspaceState,
  pane: PaneState,
  preferredPane?: Exclude<PaneId, "primary">,
): WorkspaceState {
  const normalizedPane: PaneState = { ...pane, symbol: pane.symbol.trim().toUpperCase() || workspace.primary.symbol };
  const candidates: Array<Exclude<PaneId, "primary">> = preferredPane
    ? [preferredPane, ...(["secondary", "tertiary", "quaternary"] as const).filter((id) => id !== preferredPane)]
    : ["secondary", "tertiary", "quaternary"];
  const target = candidates.find((id) => !getWorkspacePane(workspace, id)) ?? preferredPane ?? "quaternary";
  return { ...withPane(workspace, target, normalizedPane), focusedPane: target };
}

export function openViewInNewPane(
  workspace: WorkspaceState,
  view: ViewMode,
  symbol = workspace.primary.symbol,
  preferredPane?: Exclude<PaneId, "primary">,
): WorkspaceState {
  return addWorkspacePane(workspace, { view, symbol }, preferredPane);
}

export function closeWorkspacePane(workspace: WorkspaceState, paneId: PaneId): WorkspaceState {
  if (paneId === "primary" || !getWorkspacePane(workspace, paneId)) return workspace;
  const next = withPane(workspace, paneId, null);
  if (workspace.focusedPane !== paneId) return next;
  const fallback = [...WORKSPACE_PANE_IDS].reverse().find((id) => id !== paneId && getWorkspacePane(next, id)) ?? "primary";
  return { ...next, focusedPane: fallback };
}

export function closeSecondaryPane(workspace: WorkspaceState): WorkspaceState {
  return closeWorkspacePane(workspace, "secondary");
}

export function collapseToPrimaryPane(workspace: WorkspaceState): WorkspaceState {
  return { ...workspace, secondary: null, tertiary: null, quaternary: null, focusedPane: "primary" };
}

// ── Workspace Layout Persistence ─────────────────────────────────────────────

const LAYOUTS_KEY = "limuria-saved-layouts";
const ACTIVE_WORKSPACE_KEY = "limuria-active-workspace";


function isPaneShape(value: unknown): value is WorkspaceState["primary"] {
  if (!value || typeof value !== "object") return false;
  const pane = value as Partial<WorkspaceState["primary"]>;
  const artifact = pane.artifact;
  return (pane.view !== "artifact" || Boolean(artifact
    && (artifact.projectId === null || (Number.isSafeInteger(artifact.projectId) && artifact.projectId > 0))
    && Number.isSafeInteger(artifact.chatId) && artifact.chatId > 0
    && typeof artifact.artifactId === "string" && /^(?:artifact:)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(artifact.artifactId)
    && Number.isSafeInteger(artifact.version) && artifact.version > 0))
    && typeof pane.view === "string"
    && typeof pane.symbol === "string" && pane.symbol.trim() === pane.symbol
    && (pane.symbol === "" || /^[^\s\x00-\x1F]{1,32}$/.test(pane.symbol));
}

function isPaneState(value: unknown): value is WorkspaceState["primary"] {
  return isPaneShape(value) && isRegisteredView(value.view);
}

function optionalPaneValid(value: unknown, paneValidator: (candidate: unknown) => boolean): boolean {
  return value === undefined || value === null || paneValidator(value);
}

function isWorkspaceShape(
  value: unknown,
  paneValidator: (candidate: unknown) => boolean,
): value is WorkspaceState {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Partial<WorkspaceState>;
  if (!paneValidator(workspace.primary)) return false;
  if (!optionalPaneValid(workspace.secondary, paneValidator) || workspace.secondary === undefined) return false;
  if (!optionalPaneValid(workspace.tertiary, paneValidator) || !optionalPaneValid(workspace.quaternary, paneValidator)) return false;
  if (!WORKSPACE_PANE_IDS.includes(workspace.focusedPane as PaneId)) return false;
  return Boolean(getWorkspacePane(workspace as WorkspaceState, workspace.focusedPane as PaneId));
}

function isAudienceWorkspaceState(value: unknown): value is WorkspaceState {
  return isWorkspaceShape(value, isPaneShape);
}

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  return isWorkspaceShape(value, isPaneState);
}

function isViewAvailableToAudience(view: string, audience: WorkspaceAudience): boolean {
  return isRegisteredView(view) && isViewVisibleToAudience(view, audience);
}



export function sanitizeWorkspaceForAudience(workspace: WorkspaceState, audience: WorkspaceAudience): WorkspaceState {
  const fallbackView: ViewMode = "market";
  const sanitizePane = (pane: PaneState | null | undefined): PaneState | null | undefined => {
    if (!pane) return pane;
    return isViewAvailableToAudience(pane.view, audience) ? pane : { ...pane, view: fallbackView };
  };
  const sanitizedWorkspace: WorkspaceState = {
    ...workspace,
    primary: sanitizePane(workspace.primary)!,
    secondary: sanitizePane(workspace.secondary) ?? null,
  };
  if ("tertiary" in workspace) sanitizedWorkspace.tertiary = sanitizePane(workspace.tertiary);
  if ("quaternary" in workspace) sanitizedWorkspace.quaternary = sanitizePane(workspace.quaternary);
  return sanitizedWorkspace;
}

export function deserializeWorkspace(value: string | null, audience: WorkspaceAudience = "internal"): WorkspaceState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (audience === "internal") return isWorkspaceState(parsed) ? sanitizeWorkspaceForAudience(parsed, audience) : null;
    return isAudienceWorkspaceState(parsed) ? sanitizeWorkspaceForAudience(parsed, audience) : null;
  } catch {
    return null;
  }
}

export function loadWorkspaceFromUrl(search?: string, audience: WorkspaceAudience = "internal"): WorkspaceState | null {
  if (typeof window === "undefined" && search === undefined) return null;
  const params = new URLSearchParams(search ?? window.location.search);
  return deserializeWorkspace(params.get("ws"), audience);
}

export function serializeWorkspace(workspace: WorkspaceState): string {
  return encodeURIComponent(JSON.stringify(workspace));
}


export function buildWorkspaceShareUrl(workspace: WorkspaceState, currentUrl?: string): string {
  const base = currentUrl ?? (typeof window !== "undefined" ? window.location.href : "http://localhost/");
  const url = new URL(base);
  url.searchParams.set("ws", serializeWorkspace(workspace));
  return url.toString();
}

export function saveActiveWorkspace(workspace: WorkspaceState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify(workspace));
}

export function clearActiveWorkspace(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  localStorage.removeItem(LAYOUTS_KEY);
}

export function loadActiveWorkspace(audience: WorkspaceAudience = "internal"): WorkspaceState {
  if (typeof window === "undefined") return createInitialWorkspace();
  const sharedWorkspace = loadWorkspaceFromUrl(undefined, audience);
  if (sharedWorkspace) return sharedWorkspace;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ACTIVE_WORKSPACE_KEY) || "null");
    const restored = audience === "internal"
      ? (isWorkspaceState(parsed) ? parsed : null)
      : (isAudienceWorkspaceState(parsed) ? parsed : null);
    return restored ? sanitizeWorkspaceForAudience(restored, audience) : createInitialWorkspace();
  } catch {
    return createInitialWorkspace();
  }
}

export function saveLayout(name: string, workspace: WorkspaceState): void {
  if (typeof window === "undefined" || !isWorkspaceState(workspace)) return;
  const cleanName = name.trim().slice(0, 40);
  if (!cleanName) return;
  const layouts = getSavedLayouts();
  localStorage.setItem(LAYOUTS_KEY, JSON.stringify({ ...layouts, [cleanName]: workspace }));
}

export function getSavedLayouts(audience: WorkspaceAudience = "internal"): Record<string, WorkspaceState> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAYOUTS_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([name, value]) => {
      const restored = audience === "internal"
        ? (isWorkspaceState(value) ? value : null)
        : (isAudienceWorkspaceState(value) ? value : null);
      return restored ? [[name, sanitizeWorkspaceForAudience(restored, audience)]] : [];
    }));
  } catch {
    return {};
  }
}

export function loadLayout(name: string, audience: WorkspaceAudience = "internal"): WorkspaceState | null {
  return getSavedLayouts(audience)[name] ?? null;
}

export function deleteLayout(name: string): void {
  if (typeof window === "undefined") return;
  const layouts = getSavedLayouts();
  delete layouts[name];
  localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
}

// Professional presets use actual 1/2/3/4-pane state, not simulated tabs.
export const PRESET_LAYOUTS: Record<string, WorkspaceState> = {
  MORNING: {
    primary: { view: "market", symbol: "AAPL" },
    secondary: { view: "news", symbol: "AAPL" },
    focusedPane: "primary",
  },
  ANALYSIS: {
    primary: { view: "chart", symbol: "AAPL" },
    secondary: { view: "quote", symbol: "AAPL" },
    focusedPane: "primary",
  },
  VALUATION: {
    primary: { view: "financialstatements", symbol: "AAPL" },
    secondary: { view: "valuation", symbol: "AAPL" },
    tertiary: { view: "peercomp", symbol: "AAPL" },
    quaternary: { view: "advancedrisk", symbol: "AAPL" },
    focusedPane: "primary",
  },
  "EQUITY RESEARCH": {
    primary: { view: "chart", symbol: "AAPL" },
    secondary: { view: "financialstatements", symbol: "AAPL" },
    tertiary: { view: "valuation", symbol: "AAPL" },
    quaternary: { view: "news", symbol: "AAPL" },
    focusedPane: "primary",
  },
  "PORTFOLIO PM": {
    primary: { view: "portfolio", symbol: "AAPL" },
    secondary: { view: "portfoliostress", symbol: "AAPL" },
    tertiary: { view: "correlation", symbol: "AAPL" },
    quaternary: { view: "market", symbol: "AAPL" },
    focusedPane: "primary",
  },
  "PERSONAL FINANCE": {
    primary: { view: "personalfinance", symbol: "" },
    secondary: { view: "portfolio", symbol: "AAPL" },
    tertiary: { view: "montecarlo", symbol: "AAPL" },
    quaternary: { view: "economics", symbol: "" },
    focusedPane: "primary",
  },
  MACRO: {
    primary: { view: "macrodashboard", symbol: "AAPL" },
    secondary: { view: "indicatorexplorer", symbol: "AAPL" },
    tertiary: { view: "ecalendar", symbol: "AAPL" },
    quaternary: { view: "economics", symbol: "AAPL" },
    focusedPane: "primary",
  },
  POLICY: {
    primary: { view: "macrodashboard", symbol: "AAPL" },
    secondary: { view: "indicatorworkbench", symbol: "AAPL" },
    tertiary: { view: "econsignals", symbol: "AAPL" },
    quaternary: { view: "econpolicyquant", symbol: "AAPL" },
    focusedPane: "primary",
  },
  "SUPPLY CHAIN": {
    primary: { view: "supplychaindashboard", symbol: "AAPL" },
    secondary: { view: "supplychainindicators", symbol: "AAPL" },
    tertiary: { view: "supplychainquant", symbol: "AAPL" },
    quaternary: { view: "spreadsheet", symbol: "AAPL" },
    focusedPane: "primary",
  },
  SUSTAINABILITY: {
    primary: { view: "environmentdashboard", symbol: "AAPL" },
    secondary: { view: "globalclimate", symbol: "AAPL" },
    tertiary: { view: "environmentindicators", symbol: "AAPL" },
    quaternary: { view: "environmentquant", symbol: "AAPL" },
    focusedPane: "primary",
  },
  DATA: {
    primary: { view: "coveragemap", symbol: "AAPL" },
    secondary: { view: "connectors", symbol: "AAPL" },
    tertiary: { view: "enginereadiness", symbol: "AAPL" },
    focusedPane: "primary",
  },
  RISK: {
    primary: { view: "macrostress", symbol: "AAPL" },
    secondary: { view: "sentiment", symbol: "AAPL" },
    focusedPane: "primary",
  },
};


export const PERSONAL_FINANCE_CLIENT_LAYOUT: WorkspaceState = {
  primary: { view: "personalfinance", symbol: "" },
  secondary: { view: "portfolio", symbol: "AAPL" },
  tertiary: { view: "montecarlo", symbol: "AAPL" },
  quaternary: { view: "clientdata", symbol: "" },
  focusedPane: "primary",
};

export function getPersonalFinanceWorkspace(audience: WorkspaceAudience): WorkspaceState {
  return audience === "client" ? PERSONAL_FINANCE_CLIENT_LAYOUT : PRESET_LAYOUTS["PERSONAL FINANCE"];
}
