export interface TerminalUndoEntry<T> {
  label: string;
  before: T;
  after: T;
  createdAt: number;
}

export interface TerminalUndoState<T> {
  past: TerminalUndoEntry<T>[];
  future: TerminalUndoEntry<T>[];
  limit: number;
}

export function createTerminalUndoState<T>(limit = 50): TerminalUndoState<T> {
  return { past: [], future: [], limit: Math.max(1, Math.min(200, limit)) };
}

export function pushTerminalUndo<T>(
  state: TerminalUndoState<T>,
  label: string,
  before: T,
  after: T,
  equals: (left: T, right: T) => boolean = (left, right) => Object.is(left, right),
): TerminalUndoState<T> {
  if (equals(before, after)) return state;
  const entry: TerminalUndoEntry<T> = { label: label.trim().slice(0, 100) || "Terminal action", before, after, createdAt: Date.now() };
  return {
    ...state,
    past: [...state.past, entry].slice(-state.limit),
    future: [],
  };
}

export function undoTerminalAction<T>(state: TerminalUndoState<T>): { state: TerminalUndoState<T>; value: T; label: string } | null {
  const entry = state.past.at(-1);
  if (!entry) return null;
  return {
    state: {
      ...state,
      past: state.past.slice(0, -1),
      future: [entry, ...state.future].slice(0, state.limit),
    },
    value: entry.before,
    label: entry.label,
  };
}

export function redoTerminalAction<T>(state: TerminalUndoState<T>): { state: TerminalUndoState<T>; value: T; label: string } | null {
  const entry = state.future[0];
  if (!entry) return null;
  return {
    state: {
      ...state,
      past: [...state.past, entry].slice(-state.limit),
      future: state.future.slice(1),
    },
    value: entry.after,
    label: entry.label,
  };
}

export function canUndoTerminalAction<T>(state: TerminalUndoState<T>): boolean {
  return state.past.length > 0;
}

export function canRedoTerminalAction<T>(state: TerminalUndoState<T>): boolean {
  return state.future.length > 0;
}
