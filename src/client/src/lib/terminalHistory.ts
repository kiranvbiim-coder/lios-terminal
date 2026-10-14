import type { WorkspaceState } from "./terminalTypes";

export interface TerminalNavigationHistory {
  back: WorkspaceState[];
  forward: WorkspaceState[];
}

const MAX_HISTORY = 50;

function sameWorkspace(a: WorkspaceState, b: WorkspaceState): boolean {
  return a.focusedPane === b.focusedPane &&
    a.primary.view === b.primary.view && a.primary.symbol === b.primary.symbol &&
    ((a.secondary === null && b.secondary === null) || Boolean(
      a.secondary && b.secondary &&
      a.secondary.view === b.secondary.view && a.secondary.symbol === b.secondary.symbol,
    ));
}

export function createTerminalNavigationHistory(): TerminalNavigationHistory {
  return { back: [], forward: [] };
}

export function pushTerminalNavigation(
  history: TerminalNavigationHistory,
  previous: WorkspaceState,
  next: WorkspaceState,
): TerminalNavigationHistory {
  if (sameWorkspace(previous, next)) return history;
  return {
    back: [...history.back, previous].slice(-MAX_HISTORY),
    forward: [],
  };
}

export function goBackInTerminalHistory(
  history: TerminalNavigationHistory,
  current: WorkspaceState,
): { history: TerminalNavigationHistory; workspace: WorkspaceState } | null {
  const previous = history.back.at(-1);
  if (!previous) return null;
  return {
    workspace: previous,
    history: {
      back: history.back.slice(0, -1),
      forward: [current, ...history.forward].slice(0, MAX_HISTORY),
    },
  };
}

export function goForwardInTerminalHistory(
  history: TerminalNavigationHistory,
  current: WorkspaceState,
): { history: TerminalNavigationHistory; workspace: WorkspaceState } | null {
  const next = history.forward[0];
  if (!next) return null;
  return {
    workspace: next,
    history: {
      back: [...history.back, current].slice(-MAX_HISTORY),
      forward: history.forward.slice(1),
    },
  };
}
