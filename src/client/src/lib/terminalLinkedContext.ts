import { patchLiOSContext, type LiOSContext } from "@shared/context";
import { normalizeTimeContext, type TerminalTimeContext } from "./terminalTimeTravel";
import {
  getTerminalTabLinkScopes,
  type TerminalLinkGroup,
  type TerminalLinkScope,
  type TerminalTab,
  type TerminalTabsState,
} from "./terminalTabs";

export interface TerminalLinkedContext {
  instrument?: string;
  time?: TerminalTimeContext;
  scenarioId?: string | null;
  portfolioId?: string | null;
  benchmarkId?: string | null;
}

export type TerminalTabContextMap = Record<string, TerminalLinkedContext>;
export type TerminalLinkChannelMap = Partial<Record<TerminalLinkGroup, TerminalLinkedContext>>;

export interface LinkedContextBroadcastResult {
  contexts: TerminalTabContextMap;
  channels: TerminalLinkChannelMap;
}

export interface TerminalLinkedContextState {
  contexts: TerminalTabContextMap;
  channels: TerminalLinkChannelMap;
}

function normalizeInstrument(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}

function normalizeId(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeLinkedContext(context: TerminalLinkedContext): TerminalLinkedContext {
  const instrument = normalizeInstrument(context.instrument);
  return {
    ...(instrument ? { instrument } : {}),
    ...(context.time ? { time: normalizeTimeContext(context.time) } : {}),
    ...(context.scenarioId !== undefined ? { scenarioId: normalizeId(context.scenarioId) ?? null } : {}),
    ...(context.portfolioId !== undefined ? { portfolioId: normalizeId(context.portfolioId) ?? null } : {}),
    ...(context.benchmarkId !== undefined ? { benchmarkId: normalizeId(context.benchmarkId) ?? null } : {}),
  };
}

function patchForScopes(context: TerminalLinkedContext, scopes: TerminalLinkScope[]): TerminalLinkedContext {
  const next: TerminalLinkedContext = {};
  if (scopes.includes("instrument") && context.instrument !== undefined) next.instrument = normalizeInstrument(context.instrument);
  if (scopes.includes("time") && context.time !== undefined) next.time = normalizeTimeContext(context.time);
  if (scopes.includes("scenario") && context.scenarioId !== undefined) next.scenarioId = normalizeId(context.scenarioId) ?? null;
  if (scopes.includes("portfolio") && context.portfolioId !== undefined) next.portfolioId = normalizeId(context.portfolioId) ?? null;
  if (scopes.includes("benchmark") && context.benchmarkId !== undefined) next.benchmarkId = normalizeId(context.benchmarkId) ?? null;
  return next;
}

export function linkedTabsForScope(state: TerminalTabsState, sourceTabId: string, scope: TerminalLinkScope): TerminalTab[] {
  const source = state.tabs.find((tab) => tab.id === sourceTabId);
  const group = source?.linkGroupId ?? null;
  if (!source || !group || !getTerminalTabLinkScopes(source).includes(scope)) return [];
  return state.tabs.filter((tab) => tab.linkGroupId === group && getTerminalTabLinkScopes(tab).includes(scope));
}

/**
 * Propagate only explicitly linked dimensions of analytical context. Pane
 * navigation stays independent: changing time must not overwrite portfolio,
 * scenario, benchmark or instrument unless the receiving tab opted into that
 * exact scope.
 */
export function propagateLinkedContext(
  state: TerminalTabsState,
  contexts: TerminalTabContextMap,
  sourceTabId: string,
  update: TerminalLinkedContext,
): TerminalTabContextMap {
  const source = state.tabs.find((tab) => tab.id === sourceTabId);
  if (!source) return contexts;

  const sourceScopes = getTerminalTabLinkScopes(source);
  const normalizedUpdate = normalizeLinkedContext(update);
  const next: TerminalTabContextMap = {
    ...contexts,
    [sourceTabId]: { ...(contexts[sourceTabId] ?? {}), ...normalizedUpdate },
  };
  const group = source.linkGroupId ?? null;
  if (!group) return next;

  for (const tab of state.tabs) {
    if (tab.id === sourceTabId || tab.linkGroupId !== group) continue;
    const sharedScopes = getTerminalTabLinkScopes(tab).filter((scope) => sourceScopes.includes(scope));
    const patch = patchForScopes(normalizedUpdate, sharedScopes);
    if (!Object.keys(patch).length) continue;
    next[tab.id] = { ...(contexts[tab.id] ?? {}), ...patch };
  }
  return next;
}

/**
 * Broadcast an analytical context change and retain the latest value for each
 * linked dimension on the A/B/C/D channel. A tab joining a channel after a
 * change can therefore hydrate immediately instead of waiting for the next
 * interaction.
 */
export function broadcastLinkedContext(
  state: TerminalTabsState,
  contexts: TerminalTabContextMap,
  channels: TerminalLinkChannelMap,
  sourceTabId: string,
  update: TerminalLinkedContext,
): LinkedContextBroadcastResult {
  const source = state.tabs.find((tab) => tab.id === sourceTabId);
  const nextContexts = propagateLinkedContext(state, contexts, sourceTabId, update);
  if (!source?.linkGroupId) return { contexts: nextContexts, channels };

  const normalizedUpdate = normalizeLinkedContext(update);
  const broadcastPatch = patchForScopes(normalizedUpdate, getTerminalTabLinkScopes(source));
  if (!Object.keys(broadcastPatch).length) return { contexts: nextContexts, channels };

  return {
    contexts: nextContexts,
    channels: {
      ...channels,
      [source.linkGroupId]: {
        ...(channels[source.linkGroupId] ?? {}),
        ...broadcastPatch,
      },
    },
  };
}

/** Apply retained channel state to a tab that has just joined or changed scopes. */
export function hydrateLinkedTabContext(
  state: TerminalTabsState,
  contexts: TerminalTabContextMap,
  channels: TerminalLinkChannelMap,
  tabId: string,
): TerminalTabContextMap {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  const group = tab?.linkGroupId ?? null;
  if (!tab || !group) return contexts;
  const channel = channels[group];
  if (!channel) return contexts;

  const patch = patchForScopes(channel, getTerminalTabLinkScopes(tab));
  if (!Object.keys(patch).length) return contexts;
  return {
    ...contexts,
    [tabId]: { ...(contexts[tabId] ?? {}), ...patch },
  };
}

export function contextForTab(contexts: TerminalTabContextMap, tabId: string): TerminalLinkedContext {
  return contexts[tabId] ?? {};
}

export function createTerminalLinkedContextState(): TerminalLinkedContextState {
  return { contexts: {}, channels: {} };
}

export function broadcastTerminalLinkedContext(
  linkedState: TerminalLinkedContextState,
  tabsState: TerminalTabsState,
  sourceTabId: string,
  update: TerminalLinkedContext,
): TerminalLinkedContextState {
  return broadcastLinkedContext(tabsState, linkedState.contexts, linkedState.channels, sourceTabId, update);
}

export function hydrateTerminalLinkedContext(
  linkedState: TerminalLinkedContextState,
  tabsState: TerminalTabsState,
  tabId: string,
): TerminalLinkedContextState {
  const contexts = hydrateLinkedTabContext(tabsState, linkedState.contexts, linkedState.channels, tabId);
  return contexts === linkedState.contexts ? linkedState : { ...linkedState, contexts };
}

/**
 * Merge a tab's linked payload into the product-wide context contract. Entity
 * context remains symbol-aware and authoritative in the workspace projection;
 * this bridge only fills the linkable dimensions.
 */
export function applyLinkedContextToLiOSContext(base: LiOSContext, linked: TerminalLinkedContext): LiOSContext {
  const normalized = normalizeLinkedContext(linked);
  const time = normalized.time
    ? (normalized.time.enabled && normalized.time.asOfDate
      ? { mode: "as-known-on" as const, asOfDate: normalized.time.asOfDate }
      : { mode: "latest" as const, asOfDate: null })
    : undefined;
  return patchLiOSContext(base, {
    ...(normalized.portfolioId !== undefined ? { portfolioId: normalized.portfolioId } : {}),
    ...(normalized.scenarioId !== undefined ? { scenarioId: normalized.scenarioId } : {}),
    ...(normalized.benchmarkId !== undefined ? { benchmarkId: normalized.benchmarkId } : {}),
    ...(time ? { time } : {}),
  });
}
