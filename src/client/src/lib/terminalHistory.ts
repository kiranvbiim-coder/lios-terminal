import type { PaneState, WorkspaceState } from "./terminalTypes";

export interface TerminalNavigationHistory {
  back: WorkspaceState[];
  forward: WorkspaceState[];
}

const MAX_HISTORY = 50;

function samePane(a: PaneState | null | undefined, b: PaneState | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.view === b.view && a.symbol === b.symbol
    && a.artifact?.artifactId === b.artifact?.artifactId && a.artifact?.version === b.artifact?.version
    && a.artifact?.projectId === b.artifact?.projectId && a.artifact?.chatId === b.artifact?.chatId;
}

function sameWorkspace(a: WorkspaceState, b: WorkspaceState): boolean {
  return a.focusedPane === b.focusedPane && samePane(a.primary, b.primary) && samePane(a.secondary, b.secondary)
    && samePane(a.tertiary, b.tertiary) && samePane(a.quaternary, b.quaternary);
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
