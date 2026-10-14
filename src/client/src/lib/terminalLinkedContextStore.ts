import {
  broadcastTerminalLinkedContext,
  contextForTab,
  createTerminalLinkedContextState,
  hydrateTerminalLinkedContext,
  normalizeLinkedContext,
  type TerminalLinkedContext,
  type TerminalLinkedContextState,
} from "./terminalLinkedContext";
import {
  activeTerminalTab,
  getTerminalTabLinkScopes,
  loadTerminalTabs,
  type TerminalLinkScope,
  type TerminalTab,
  type TerminalTabsState,
} from "./terminalTabs";
import {
  DEFAULT_TERMINAL_TIME_CONTEXT,
  normalizeTimeContext,
  type TerminalTimeContext,
} from "./terminalTimeTravel";

const STORAGE_KEY = "lios-terminal-linked-context-v1";
const LINKED_CONTEXT_EVENT = "lios:terminal-linked-context";
const ACTIVE_TAB_EVENT = "lios:terminal-active-tab";

export const TERMINAL_ANALYTICAL_LINK_SCOPES = ["instrument", "time", "portfolio", "scenario", "benchmark"] as const satisfies readonly TerminalLinkScope[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseLinkedContext(value: unknown): TerminalLinkedContext {
  if (!isRecord(value)) return {};
  return normalizeLinkedContext({
    ...(typeof value.instrument === "string" ? { instrument: value.instrument } : {}),
    ...(isRecord(value.time) ? { time: normalizeTimeContext(value.time) } : {}),
    ...(value.scenarioId === null || typeof value.scenarioId === "string" ? { scenarioId: value.scenarioId } : {}),
    ...(value.portfolioId === null || typeof value.portfolioId === "string" ? { portfolioId: value.portfolioId } : {}),
    ...(value.benchmarkId === null || typeof value.benchmarkId === "string" ? { benchmarkId: value.benchmarkId } : {}),
  });
}

export function normalizeStoredLinkedContextState(value: unknown): TerminalLinkedContextState {
  if (!isRecord(value)) return createTerminalLinkedContextState();
  const contexts = isRecord(value.contexts)
    ? Object.fromEntries(Object.entries(value.contexts).map(([tabId, context]) => [tabId, parseLinkedContext(context)]))
    : {};
  const channels = isRecord(value.channels)
    ? Object.fromEntries(Object.entries(value.channels).flatMap(([group, context]) =>
      group === "A" || group === "B" || group === "C" || group === "D"
        ? [[group, parseLinkedContext(context)]]
        : []))
    : {};
  return { contexts, channels };
}

/**
 * The pre-V4 tab UI exposed link groups but no scope picker, so linked tabs
 * normally persisted only `[instrument]` with no explicit-selection marker.
 * Preserve that historical meaning as full context while allowing a new user
 * to intentionally select instrument-only and have it remain instrument-only.
 */
export function getEffectiveTerminalTabLinkScopes(tab: TerminalTab): TerminalLinkScope[] {
  const scopes = getTerminalTabLinkScopes(tab);
  if (tab.linkScopesExplicit === true || !tab.linkGroupId || scopes.length !== 1 || scopes[0] !== "instrument") return scopes;
  return [...TERMINAL_ANALYTICAL_LINK_SCOPES];
}

export function withLegacyFullLinkScopes(state: TerminalTabsState): TerminalTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab, linkScopes: getEffectiveTerminalTabLinkScopes(tab) })),
  };
}

export function resolveTabLinkedContext(linkedState: TerminalLinkedContextState, tabId: string): TerminalLinkedContext {
  return normalizeLinkedContext(contextForTab(linkedState.contexts, tabId));
}

export function resolveTabTimeContext(
  linkedState: TerminalLinkedContextState,
  tabId: string,
  fallback: TerminalTimeContext = DEFAULT_TERMINAL_TIME_CONTEXT,
): TerminalTimeContext {
  const linked = resolveTabLinkedContext(linkedState, tabId).time;
  return normalizeTimeContext(linked ?? fallback);
}

export function broadcastTabLinkedContext(
  linkedState: TerminalLinkedContextState,
  tabsState: TerminalTabsState,
  sourceTabId: string,
  update: TerminalLinkedContext,
): TerminalLinkedContextState {
  return broadcastTerminalLinkedContext(
    linkedState,
    withLegacyFullLinkScopes(tabsState),
    sourceTabId,
    normalizeLinkedContext(update),
  );
}

export function broadcastTabTimeContext(
  linkedState: TerminalLinkedContextState,
  tabsState: TerminalTabsState,
  sourceTabId: string,
  time: TerminalTimeContext,
): TerminalLinkedContextState {
  return broadcastTabLinkedContext(linkedState, tabsState, sourceTabId, { time: normalizeTimeContext(time) });
}

export function hydrateTabLinkedContext(
  linkedState: TerminalLinkedContextState,
  tabsState: TerminalTabsState,
  tabId: string,
): TerminalLinkedContextState {
  return hydrateTerminalLinkedContext(linkedState, withLegacyFullLinkScopes(tabsState), tabId);
}

export function loadTerminalLinkedContextState(): TerminalLinkedContextState {
  if (typeof window === "undefined") return createTerminalLinkedContextState();
  try {
    return normalizeStoredLinkedContextState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return createTerminalLinkedContextState();
  }
}

function persistTerminalLinkedContextState(state: TerminalLinkedContextState, emit = true): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (emit) window.dispatchEvent(new CustomEvent(LINKED_CONTEXT_EVENT));
}

export function saveTerminalLinkedContextState(state: TerminalLinkedContextState): void {
  persistTerminalLinkedContextState(state, true);
}

export function getActiveTerminalTabId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return activeTerminalTab(loadTerminalTabs()).id;
  } catch {
    return null;
  }
}

export function resolveActiveTabLinkedContext(): TerminalLinkedContext {
  const activeTabId = getActiveTerminalTabId();
  if (!activeTabId) return {};
  return resolveTabLinkedContext(loadTerminalLinkedContextState(), activeTabId);
}

export function resolveActiveTabTimeContext(fallback: TerminalTimeContext = DEFAULT_TERMINAL_TIME_CONTEXT): TerminalTimeContext {
  const activeTabId = getActiveTerminalTabId();
  if (!activeTabId) return normalizeTimeContext(fallback);
  return resolveTabTimeContext(loadTerminalLinkedContextState(), activeTabId, fallback);
}

export function broadcastActiveTabLinkedContext(update: TerminalLinkedContext): TerminalLinkedContext {
  if (typeof window === "undefined") return normalizeLinkedContext(update);
  const tabs = loadTerminalTabs();
  const activeTabId = activeTerminalTab(tabs).id;
  let linked = loadTerminalLinkedContextState();
  linked = hydrateTabLinkedContext(linked, tabs, activeTabId);
  linked = broadcastTabLinkedContext(linked, tabs, activeTabId, update);
  saveTerminalLinkedContextState(linked);
  return resolveTabLinkedContext(linked, activeTabId);
}

export function broadcastActiveTabTimeContext(time: TerminalTimeContext): TerminalTimeContext {
  const linked = broadcastActiveTabLinkedContext({ time: normalizeTimeContext(time) });
  return normalizeTimeContext(linked.time ?? time);
}

/**
 * Publish one authoritative tab-activation signal for every activation path.
 * The caller may provide the current in-memory tab state so newly-created,
 * reopened or scope-edited tabs hydrate before the parent's persistence effect
 * reaches localStorage. This removes activation ordering races.
 */
export function notifyTerminalTabActivated(tabId: string, tabsState?: TerminalTabsState): void {
  if (typeof window === "undefined") return;
  try {
    const tabs = tabsState ?? loadTerminalTabs();
    const linked = loadTerminalLinkedContextState();
    const hydrated = hydrateTabLinkedContext(linked, tabs, tabId);
    if (hydrated !== linked) persistTerminalLinkedContextState(hydrated, false);
  } catch {
    // Activation must remain usable even if local persistence is unavailable.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_TAB_EVENT, { detail: { tabId } }));
}

export function subscribeTerminalTabActivation(listener: (tabId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent) || !isRecord(event.detail) || typeof event.detail.tabId !== "string") return;
    listener(event.detail.tabId);
  };
  window.addEventListener(ACTIVE_TAB_EVENT, handler);
  return () => window.removeEventListener(ACTIVE_TAB_EVENT, handler);
}

export function subscribeTerminalLinkedContext(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LINKED_CONTEXT_EVENT, listener);
  return () => window.removeEventListener(LINKED_CONTEXT_EVENT, listener);
}

export function clearTerminalLinkedContextState(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
