export type AnalyticalSnapshotPaneId = "primary" | "secondary" | "tertiary" | "quaternary";
export type AnalyticalSnapshotLinkGroup = "A" | "B" | "C" | "D";
export type AnalyticalSnapshotLinkScope = "instrument" | "time" | "scenario" | "portfolio" | "benchmark";
export type AnalyticalSnapshotTabKind = "home" | "entity" | "workspace" | "workflow";
export type AnalyticalSnapshotZoom = "detail" | "analysis" | "thesis";
export type AnalyticalSnapshotAttention = "off" | "inputs" | "outputs" | "evidence" | "risk";

export interface AnalyticalSnapshotPane {
  view: string;
  symbol: string;
}

export interface AnalyticalSnapshotWorkspace {
  primary: AnalyticalSnapshotPane;
  secondary: AnalyticalSnapshotPane | null;
  tertiary?: AnalyticalSnapshotPane | null;
  quaternary?: AnalyticalSnapshotPane | null;
  focusedPane: AnalyticalSnapshotPaneId;
}

export interface AnalyticalSnapshotTab {
  /** Stable LiOS tab identity; optional for backward-compatible V2 checkpoints. */
  id?: string;
  title: string;
  kind: AnalyticalSnapshotTabKind;
  entity: string | null;
  groupId: string | null;
  linkGroupId: AnalyticalSnapshotLinkGroup | null;
  /** Optional for compatibility with early V2 checkpoints. Missing means instrument-only. */
  linkScopes?: AnalyticalSnapshotLinkScope[];
  /** Stable checkpoints may preserve pin intent; preview/dirty state is intentionally not persisted. */
  pinned?: boolean;
  workspace: AnalyticalSnapshotWorkspace;
}

export interface AnalyticalSnapshotPaneState {
  paneId: AnalyticalSnapshotPaneId;
  view: string;
  symbol: string;
  zoom: AnalyticalSnapshotZoom;
  attention: AnalyticalSnapshotAttention;
  compareArmed: boolean;
}

export interface AnalyticalSnapshotViewState {
  paneId: AnalyticalSnapshotPaneId;
  view: string;
  symbol: string;
  state: Record<string, unknown>;
}

export interface AnalyticalSnapshotTimeContext {
  enabled: boolean;
  asOfDate: string | null;
  mode: "latest" | "as-known-on";
}

/**
 * Portable, versioned terminal state stored beside a workspace metadata snapshot.
 * It captures analytical-shell state plus bounded, JSON-safe per-workstation UI
 * state such as selected model family/tab. Models, imports, assumptions,
 * scenarios, and portfolio records keep their own lifecycle and are referenced
 * rather than embedded in the snapshot.
 *
 * `activeTab` remains required so early V2 readers stay compatible. New V2
 * checkpoints additionally persist the whole tab strip plus the active index,
 * allowing a named analytical workspace to restore the terminal composition
 * rather than only whichever tab happened to be focused at capture time.
 */
export interface AnalyticalWorkspaceStateV2 {
  version: 2;
  capturedAt: string;
  activeTab: AnalyticalSnapshotTab;
  /** Optional for compatibility with early V2 checkpoints. */
  tabs?: AnalyticalSnapshotTab[];
  /** Required whenever `tabs` is present. */
  activeTabIndex?: number;
  paneStates: AnalyticalSnapshotPaneState[];
  /** Optional for compatibility with early V2 checkpoints. */
  viewStates?: AnalyticalSnapshotViewState[];
  timeContext: AnalyticalSnapshotTimeContext;
}

const PANE_IDS = new Set<AnalyticalSnapshotPaneId>(["primary", "secondary", "tertiary", "quaternary"]);
const TAB_KINDS = new Set<AnalyticalSnapshotTabKind>(["home", "entity", "workspace", "workflow"]);
const LINK_GROUPS = new Set<AnalyticalSnapshotLinkGroup>(["A", "B", "C", "D"]);
const LINK_SCOPES = new Set<AnalyticalSnapshotLinkScope>(["instrument", "time", "scenario", "portfolio", "benchmark"]);
const ZOOMS = new Set<AnalyticalSnapshotZoom>(["detail", "analysis", "thesis"]);
const ATTENTIONS = new Set<AnalyticalSnapshotAttention>(["off", "inputs", "outputs", "evidence", "risk"]);
const MAX_SNAPSHOT_TABS = 12;
const MAX_SNAPSHOT_PANE_STATES = MAX_SNAPSHOT_TABS * 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 120 && value.every((item) => isJsonSafe(item, depth + 1));
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 80 && entries.every(([key, item]) => key.length <= 100 && isJsonSafe(item, depth + 1));
}

function isPane(value: unknown): value is AnalyticalSnapshotPane {
  return isRecord(value) && typeof value.view === "string" && value.view.length > 0 && typeof value.symbol === "string";
}

function isWorkspace(value: unknown): value is AnalyticalSnapshotWorkspace {
  if (!isRecord(value) || !isPane(value.primary) || !(value.secondary === null || isPane(value.secondary))) return false;
  if (value.tertiary !== undefined && value.tertiary !== null && !isPane(value.tertiary)) return false;
  if (value.quaternary !== undefined && value.quaternary !== null && !isPane(value.quaternary)) return false;
  return typeof value.focusedPane === "string" && PANE_IDS.has(value.focusedPane as AnalyticalSnapshotPaneId);
}

function isLinkScopes(value: unknown): value is AnalyticalSnapshotLinkScope[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length === 0 || value.length > LINK_SCOPES.size) return false;
  if (!value.every((scope) => typeof scope === "string" && LINK_SCOPES.has(scope as AnalyticalSnapshotLinkScope))) return false;
  return new Set(value).size === value.length;
}

function isTab(value: unknown): value is AnalyticalSnapshotTab {
  if (!isRecord(value) || typeof value.title !== "string" || value.title.length > 120) return false;
  if (value.id !== undefined && (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 200)) return false;
  if (typeof value.kind !== "string" || !TAB_KINDS.has(value.kind as AnalyticalSnapshotTabKind)) return false;
  if (!nullableString(value.entity) || !nullableString(value.groupId)) return false;
  if (!(value.linkGroupId === null || (typeof value.linkGroupId === "string" && LINK_GROUPS.has(value.linkGroupId as AnalyticalSnapshotLinkGroup)))) return false;
  if (!isLinkScopes(value.linkScopes)) return false;
  if (value.pinned !== undefined && typeof value.pinned !== "boolean") return false;
  return isWorkspace(value.workspace);
}

function isPaneState(value: unknown): value is AnalyticalSnapshotPaneState {
  if (!isRecord(value) || typeof value.paneId !== "string" || !PANE_IDS.has(value.paneId as AnalyticalSnapshotPaneId)) return false;
  if (typeof value.view !== "string" || typeof value.symbol !== "string") return false;
  if (typeof value.zoom !== "string" || !ZOOMS.has(value.zoom as AnalyticalSnapshotZoom)) return false;
  if (typeof value.attention !== "string" || !ATTENTIONS.has(value.attention as AnalyticalSnapshotAttention)) return false;
  return typeof value.compareArmed === "boolean";
}

function isViewState(value: unknown): value is AnalyticalSnapshotViewState {
  if (!isRecord(value) || typeof value.paneId !== "string" || !PANE_IDS.has(value.paneId as AnalyticalSnapshotPaneId)) return false;
  if (typeof value.view !== "string" || typeof value.symbol !== "string" || !isRecord(value.state) || !isJsonSafe(value.state)) return false;
  try {
    return JSON.stringify(value.state).length <= 12_000;
  } catch {
    return false;
  }
}

function isTimeContext(value: unknown): value is AnalyticalSnapshotTimeContext {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return false;
  if (!nullableString(value.asOfDate) || (typeof value.asOfDate === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(value.asOfDate))) return false;
  return value.mode === "latest" || value.mode === "as-known-on";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function tabsMatchActiveTab(
  tabs: AnalyticalSnapshotTab[],
  activeTabIndex: number,
  activeTab: AnalyticalSnapshotTab,
): boolean {
  try {
    return canonicalJson(tabs[activeTabIndex]) === canonicalJson(activeTab);
  } catch {
    return false;
  }
}

export function isAnalyticalWorkspaceStateV2(value: unknown): value is AnalyticalWorkspaceStateV2 {
  if (!isRecord(value) || value.version !== 2 || typeof value.capturedAt !== "string") return false;
  if (!isTab(value.activeTab) || !Array.isArray(value.paneStates) || !value.paneStates.every(isPaneState) || value.paneStates.length > MAX_SNAPSHOT_PANE_STATES) return false;
  if (value.viewStates !== undefined && (!Array.isArray(value.viewStates) || !value.viewStates.every(isViewState) || value.viewStates.length > MAX_SNAPSHOT_PANE_STATES)) return false;
  if (!isTimeContext(value.timeContext)) return false;

  if (value.tabs !== undefined) {
    if (!Array.isArray(value.tabs) || value.tabs.length === 0 || value.tabs.length > MAX_SNAPSHOT_TABS || !value.tabs.every(isTab)) return false;
    if (!Number.isInteger(value.activeTabIndex) || (value.activeTabIndex as number) < 0 || (value.activeTabIndex as number) >= value.tabs.length) return false;
    if (!tabsMatchActiveTab(value.tabs, value.activeTabIndex as number, value.activeTab)) return false;
  } else if (value.activeTabIndex !== undefined) {
    return false;
  }

  try {
    return JSON.stringify(value).length <= 96_000;
  } catch {
    return false;
  }
}
