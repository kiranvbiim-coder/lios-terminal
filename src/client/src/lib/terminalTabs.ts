import type { WorkspaceAudience } from "./featureRegistry";
import type { PaneState, WorkspaceState } from "./terminalTypes";
import { createInitialWorkspace, isWorkspaceState, loadActiveWorkspace, sanitizeWorkspaceForAudience } from "./terminalWorkspace";
import { getExperienceViewLabel } from "./terminalExperience";
import { getTerminalCapability } from "./terminalCatalog";

export type TerminalTabKind = "home" | "entity" | "workspace" | "workflow";
export type TerminalLinkGroup = "A" | "B" | "C" | "D";
export type TerminalLinkScope = "instrument" | "time" | "scenario" | "portfolio" | "benchmark";

export interface TerminalTab {
  id: string;
  title: string;
  kind: TerminalTabKind;
  workspace: WorkspaceState;
  entity: string | null;
  groupId: string | null;
  linkGroupId?: TerminalLinkGroup | null;
  /** Missing on legacy state means instrument-only linking. */
  linkScopes?: TerminalLinkScope[];
  /** False/missing marks the historical pre-scope-picker semantics. */
  linkScopesExplicit?: boolean;
  pinned: boolean;
  preview: boolean;
  dirty: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ClosedTerminalTab {
  tab: TerminalTab;
  closedAt: number;
}

export interface TerminalTabsState {
  tabs: TerminalTab[];
  activeTabId: string;
  closedTabs: ClosedTerminalTab[];
}

const TABS_STORAGE_KEY = "limuria-terminal-tabs-v1";
const LAST_ANALYTICAL_TABS_KEY = "lios-last-analytical-tabs-v2";
const MAX_CLOSED_TABS = 20;
const LINK_SCOPES = new Set<TerminalLinkScope>(["instrument", "time", "scenario", "portfolio", "benchmark"]);
const DEFAULT_LINK_SCOPES: TerminalLinkScope[] = ["instrument"];

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now(): number { return Date.now(); }

function normalizeLinkScopes(value: unknown): TerminalLinkScope[] {
  if (!Array.isArray(value)) return [...DEFAULT_LINK_SCOPES];
  const scopes = Array.from(new Set(value.filter((scope): scope is TerminalLinkScope => typeof scope === "string" && LINK_SCOPES.has(scope as TerminalLinkScope))));
  return scopes.length ? scopes : [...DEFAULT_LINK_SCOPES];
}

function validLinkScopes(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length > 0 && value.length <= LINK_SCOPES.size &&
    value.every((scope) => typeof scope === "string" && LINK_SCOPES.has(scope as TerminalLinkScope)) &&
    new Set(value).size === value.length;
}

export function getTerminalTabLinkScopes(tab: TerminalTab): TerminalLinkScope[] {
  return normalizeLinkScopes(tab.linkScopes);
}

function legacyTitleFor(workspace: WorkspaceState, kind: TerminalTabKind, entity: string | null): string {
  if (kind === "entity" && entity) return `${entity} · ${workspace.primary.view === "entity" ? "OVERVIEW" : workspace.primary.view.toUpperCase()}`;
  if (kind === "workflow") return "Investigation";
  if (kind === "workspace") return "Workspace";
  return workspace.primary.view === "market" ? "Market Monitor" : workspace.primary.view.toUpperCase();
}

export function getTerminalTabAutoTitle(workspace: WorkspaceState, kind: TerminalTabKind, entity: string | null): string {
  if (kind === "entity" && entity) return `${entity} · ${getExperienceViewLabel(workspace.primary.view)}`;
  if (kind === "workflow") return "Investigation";
  if (kind === "workspace") return getExperienceViewLabel(workspace.primary.view);
  return workspace.primary.view === "market" ? "Market Monitor" : getExperienceViewLabel(workspace.primary.view);
}

function createTab(input: Partial<Pick<TerminalTab, "title" | "kind" | "entity" | "groupId" | "linkGroupId" | "linkScopes" | "linkScopesExplicit" | "pinned" | "preview" | "dirty">> & { workspace?: WorkspaceState } = {}): TerminalTab {
  const workspace = input.workspace ?? createInitialWorkspace();
  const kind = input.kind ?? "home";
  const entity = input.entity ?? null;
  const timestamp = now();
  return {
    id: createTabId(), title: input.title ?? getTerminalTabAutoTitle(workspace, kind, entity), kind, workspace, entity,
    groupId: input.groupId ?? null, linkGroupId: input.linkGroupId ?? null, linkScopes: normalizeLinkScopes(input.linkScopes),
    linkScopesExplicit: input.linkScopesExplicit ?? input.linkScopes !== undefined, pinned: input.pinned ?? false,
    preview: input.preview ?? false, dirty: input.dirty ?? false, createdAt: timestamp, updatedAt: timestamp,
  };
}

export function createInitialTabsState(): TerminalTabsState {
  const tab = createTab({ title: "Market Monitor" });
  return { tabs: [tab], activeTabId: tab.id, closedTabs: [] };
}

function isPane(value: unknown): value is PaneState {
  return Boolean(value && typeof value === "object" && typeof (value as PaneState).view === "string" && typeof (value as PaneState).symbol === "string");
}

function isLinkGroup(value: unknown): value is TerminalLinkGroup | null | undefined {
  return value === undefined || value === null || value === "A" || value === "B" || value === "C" || value === "D";
}

function isTab(value: unknown): value is TerminalTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Partial<TerminalTab>;
  return typeof tab.id === "string" && typeof tab.title === "string" &&
    (tab.kind === "home" || tab.kind === "entity" || tab.kind === "workspace" || tab.kind === "workflow") &&
    isWorkspaceState(tab.workspace) && (tab.entity === null || typeof tab.entity === "string") &&
    (tab.groupId === null || typeof tab.groupId === "string") && isLinkGroup(tab.linkGroupId) && validLinkScopes(tab.linkScopes) &&
    (tab.linkScopesExplicit === undefined || typeof tab.linkScopesExplicit === "boolean") &&
    typeof tab.pinned === "boolean" && typeof tab.preview === "boolean" && typeof tab.dirty === "boolean" &&
    typeof tab.createdAt === "number" && typeof tab.updatedAt === "number";
}

export function isTerminalTabsState(value: unknown): value is TerminalTabsState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<TerminalTabsState>;
  return Array.isArray(state.tabs) && state.tabs.length > 0 && state.tabs.every(isTab) &&
    typeof state.activeTabId === "string" && state.tabs.some((tab) => tab.id === state.activeTabId) &&
    Array.isArray(state.closedTabs) && state.closedTabs.every((item) => Boolean(item && typeof item === "object" && isTab((item as ClosedTerminalTab).tab)));
}

function normalizeLoadedState(state: TerminalTabsState): TerminalTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab, linkGroupId: tab.linkGroupId ?? null, linkScopes: normalizeLinkScopes(tab.linkScopes), linkScopesExplicit: tab.linkScopesExplicit === true })),
    closedTabs: state.closedTabs.map((item) => ({ tab: { ...item.tab, linkGroupId: item.tab.linkGroupId ?? null, linkScopes: normalizeLinkScopes(item.tab.linkScopes), linkScopesExplicit: item.tab.linkScopesExplicit === true }, closedAt: item.closedAt })),
  };
}

function sanitizeLoadedState(state: TerminalTabsState, audience: WorkspaceAudience): TerminalTabsState {
  const normalized = normalizeLoadedState(state);
  return {
    ...normalized,
    tabs: normalized.tabs.map((tab) => ({ ...tab, workspace: sanitizeWorkspaceForAudience(tab.workspace, audience) })),
    closedTabs: normalized.closedTabs.map((item) => ({
      ...item,
      tab: { ...item.tab, workspace: sanitizeWorkspaceForAudience(item.tab.workspace, audience) },
    })),
  };
}

function focusedPane(state: WorkspaceState): PaneState {
  if (state.focusedPane === "secondary") return state.secondary ?? state.primary;
  if (state.focusedPane === "tertiary") return state.tertiary ?? state.primary;
  if (state.focusedPane === "quaternary") return state.quaternary ?? state.primary;
  return state.primary;
}

function rememberAnalyticalTabs(state: TerminalTabsState): void {
  if (typeof window === "undefined") return;
  const active = activeTerminalTab(state);
  const view = focusedPane(active.workspace).view;
  if (view === "workspaces" || view === "environment") return;
  try {
    sessionStorage.setItem(LAST_ANALYTICAL_TABS_KEY, JSON.stringify(state));
  } catch {
    // Session storage can be unavailable in privacy-restricted contexts.
  }
}

export function loadTerminalTabs(audience: WorkspaceAudience = "internal"): TerminalTabsState {
  if (typeof window === "undefined") return createInitialTabsState();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || "null");
    if (isTerminalTabsState(parsed)) return sanitizeLoadedState(parsed, audience);
  } catch { /* migrate below */ }
  const migrated = createTab({ workspace: loadActiveWorkspace(audience), title: "Market Monitor" });
  return { tabs: [migrated], activeTabId: migrated.id, closedTabs: [] };
}

export function loadRememberedAnalyticalTabs(audience: WorkspaceAudience = "internal"): TerminalTabsState | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(LAST_ANALYTICAL_TABS_KEY) || "null");
    return isTerminalTabsState(parsed) ? sanitizeLoadedState(parsed, audience) : null;
  } catch {
    return null;
  }
}

export function saveTerminalTabs(state: TerminalTabsState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
  rememberAnalyticalTabs(state);
}

export function clearTerminalTabs(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TABS_STORAGE_KEY);
  try { sessionStorage.removeItem(LAST_ANALYTICAL_TABS_KEY); } catch { /* ignore */ }
}

export function activeTerminalTab(state: TerminalTabsState): TerminalTab {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
}

export function updateActiveTerminalWorkspace(state: TerminalTabsState, workspace: WorkspaceState, dirty = false): TerminalTabsState {
  const active = activeTerminalTab(state);
  const previousAutoTitle = getTerminalTabAutoTitle(active.workspace, active.kind, active.entity);
  const previousLegacyTitle = legacyTitleFor(active.workspace, active.kind, active.entity);
  const hasCustomTitle = active.title !== previousAutoTitle && active.title !== previousLegacyTitle;
  return updateTerminalTab(state, active.id, { workspace, title: hasCustomTitle ? active.title : getTerminalTabAutoTitle(workspace, active.kind, active.entity), dirty: dirty || active.dirty });
}

export function updateTerminalTab(state: TerminalTabsState, tabId: string, patch: Partial<Pick<TerminalTab, "title" | "workspace" | "groupId" | "linkGroupId" | "linkScopes" | "linkScopesExplicit" | "pinned" | "preview" | "dirty">>): TerminalTabsState {
  const timestamp = now();
  const normalizedPatch = patch.linkScopes === undefined ? patch : { ...patch, linkScopes: normalizeLinkScopes(patch.linkScopes) };
  return { ...state, tabs: state.tabs.map((tab) => tab.id === tabId ? { ...tab, ...normalizedPatch, updatedAt: timestamp } : tab) };
}

export function activateTerminalTab(state: TerminalTabsState, tabId: string): TerminalTabsState {
  return state.tabs.some((tab) => tab.id === tabId) ? { ...state, activeTabId: tabId, tabs: state.tabs.map((tab) => tab.id === tabId && tab.preview ? { ...tab, preview: false, updatedAt: now() } : tab) } : state;
}

export function openTerminalTab(state: TerminalTabsState, input: Partial<Pick<TerminalTab, "title" | "kind" | "entity" | "groupId" | "linkGroupId" | "linkScopes" | "linkScopesExplicit" | "pinned" | "preview" | "dirty">> & { workspace?: WorkspaceState } = {}): TerminalTabsState {
  const kind = input.kind ?? "home";
  const entity = input.entity ?? null;
  const requestedView = input.workspace?.primary.view;
  const existing = !input.preview && entity ? state.tabs.find((tab) => tab.kind === kind && tab.entity === entity && !tab.preview && (!requestedView || tab.workspace.primary.view === requestedView)) : undefined;
  if (existing) return activateTerminalTab(state, existing.id);
  const tab = createTab(input);
  const previewToReplace = tab.preview ? state.tabs.find((candidate) => candidate.preview && !candidate.pinned) : undefined;
  const tabs = previewToReplace ? state.tabs.map((candidate) => candidate.id === previewToReplace.id ? tab : candidate) : [...state.tabs, tab];
  return { ...state, tabs, activeTabId: tab.id };
}

export function openEntityTab(state: TerminalTabsState, symbol: string, preview = false): TerminalTabsState {
  const entity = symbol.trim().toUpperCase();
  if (!entity) return state;
  return openTerminalTab(state, { kind: "entity", entity, preview, workspace: { primary: { view: "entity", symbol: entity }, secondary: null, focusedPane: "primary" } });
}

export function closeTerminalTab(state: TerminalTabsState, tabId = state.activeTabId): TerminalTabsState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.pinned || state.tabs.length === 1) return state;
  const remaining = state.tabs.filter((candidate) => candidate.id !== tabId);
  const nextActive = state.activeTabId === tabId ? remaining[Math.max(0, state.tabs.findIndex((candidate) => candidate.id === tabId) - 1)] : activeTerminalTab(state);
  return { tabs: remaining, activeTabId: nextActive.id, closedTabs: [{ tab, closedAt: now() }, ...state.closedTabs].slice(0, MAX_CLOSED_TABS) };
}

export function reopenTerminalTab(state: TerminalTabsState): TerminalTabsState {
  const [closed, ...rest] = state.closedTabs;
  if (!closed) return state;
  const restored = { ...closed.tab, id: createTabId(), pinned: false, preview: false, updatedAt: now() };
  return { tabs: [...state.tabs, restored], activeTabId: restored.id, closedTabs: rest };
}

export function toggleTerminalTabPin(state: TerminalTabsState, tabId = state.activeTabId): TerminalTabsState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  return tab ? updateTerminalTab(state, tabId, { pinned: !tab.pinned, preview: false }) : state;
}

export function setTerminalTabGroup(state: TerminalTabsState, tabId: string, groupId: string | null): TerminalTabsState {
  return updateTerminalTab(state, tabId, { groupId });
}

export function setTerminalTabLinkGroup(state: TerminalTabsState, tabId: string, linkGroupId: TerminalLinkGroup | null): TerminalTabsState {
  return updateTerminalTab(state, tabId, { linkGroupId });
}

export function setTerminalTabLinkScopes(state: TerminalTabsState, tabId: string, linkScopes: TerminalLinkScope[]): TerminalTabsState {
  return updateTerminalTab(state, tabId, { linkScopes, linkScopesExplicit: true });
}

export function moveTerminalTab(state: TerminalTabsState, sourceTabId: string, targetTabId: string): TerminalTabsState {
  if (sourceTabId === targetTabId) return state;
  const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceTabId);
  const targetIndex = state.tabs.findIndex((tab) => tab.id === targetTabId);
  if (sourceIndex < 0 || targetIndex < 0) return state;
  const tabs = [...state.tabs];
  const [source] = tabs.splice(sourceIndex, 1);
  tabs.splice(targetIndex, 0, source);
  return { ...state, tabs };
}

function workspaceWithSymbol(workspace: WorkspaceState, symbol: string): WorkspaceState {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return workspace;
  const withInstrument = (pane: PaneState | null | undefined): PaneState | null | undefined => {
    if (!pane || !getTerminalCapability(pane.view).symbolAware) return pane;
    return { ...pane, symbol: normalized };
  };
  return {
    ...workspace,
    primary: withInstrument(workspace.primary)!,
    secondary: withInstrument(workspace.secondary) ?? null,
    tertiary: withInstrument(workspace.tertiary),
    quaternary: withInstrument(workspace.quaternary),
  };
}

/**
 * Broadcast an instrument context to tabs in the same link group. Only tabs
 * that opt into the instrument scope participate, and only symbol-aware panes
 * consume the context. Macro, workspace, data-management, and other unrelated
 * panes therefore retain their own state instead of receiving meaningless
 * ticker substitutions.
 */
export function syncLinkedTerminalTabsSymbol(state: TerminalTabsState, sourceTabId: string, symbol: string): TerminalTabsState {
  const source = state.tabs.find((tab) => tab.id === sourceTabId);
  if (!source) return state;
  const linkGroupId = source.linkGroupId ?? null;
  if (!linkGroupId || !getTerminalTabLinkScopes(source).includes("instrument")) return state;
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return state;
  const timestamp = now();
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.linkGroupId !== linkGroupId || !getTerminalTabLinkScopes(tab).includes("instrument")) return tab;
      const nextWorkspace = workspaceWithSymbol(tab.workspace, normalizedSymbol);
      const nextEntity = tab.kind === "entity" ? normalizedSymbol : tab.entity;
      const previousAutoTitle = getTerminalTabAutoTitle(tab.workspace, tab.kind, tab.entity);
      const previousLegacyTitle = legacyTitleFor(tab.workspace, tab.kind, tab.entity);
      const customTitle = tab.title !== previousAutoTitle && tab.title !== previousLegacyTitle;
      return { ...tab, workspace: nextWorkspace, entity: nextEntity, title: customTitle ? tab.title : getTerminalTabAutoTitle(nextWorkspace, tab.kind, nextEntity), updatedAt: timestamp };
    }),
  };
}

export function renameTerminalTab(state: TerminalTabsState, tabId: string, title: string): TerminalTabsState {
  const normalized = title.trim().slice(0, 80);
  return normalized ? updateTerminalTab(state, tabId, { title: normalized }) : state;
}
