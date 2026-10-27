import type { PaneState, WorkspaceState } from "./terminalTypes";

export interface WorkspaceSlot { objectId: string; pane: PaneState }
export const MAX_WORKSPACE_PANES = 4;

/** PR #107: capacity never implicitly replaces the user's existing work. */
export function appendWorkspaceSlot(current: WorkspaceSlot[], candidate: WorkspaceSlot): WorkspaceSlot[] {
  if (current.length >= MAX_WORKSPACE_PANES || current.some(slot => slot.objectId === candidate.objectId)) return current;
  return [...current, candidate];
}
export function removeWorkspaceSlot(current: readonly WorkspaceSlot[], index: number): WorkspaceSlot[] {
  return current.filter((_slot, at) => at !== index);
}

/**
 * Explicit positional reordering within the existing four-pane Workbench.
 * Each exact PaneState reference, including its canonical P4 Artifact version,
 * is preserved. This only changes presentation order, never saved work.
 */
export function moveWorkspaceSlot(
  current: readonly WorkspaceSlot[],
  fromIndex: number,
  direction: -1 | 1,
): WorkspaceSlot[] {
  const target = fromIndex + direction;
  if (!Number.isSafeInteger(fromIndex) || fromIndex < 0 || fromIndex >= current.length ||
      target < 0 || target >= current.length) return [...current];
  const next = [...current];
  [next[fromIndex], next[target]] = [next[target], next[fromIndex]];
  return next;
}

export function workspaceFromSlots(slots: readonly WorkspaceSlot[]): WorkspaceState | null {
  if (!slots.length) return null;
  return { primary: slots[0].pane, secondary: slots[1]?.pane ?? null, tertiary: slots[2]?.pane ?? null, quaternary: slots[3]?.pane ?? null, focusedPane: "primary" };
}
