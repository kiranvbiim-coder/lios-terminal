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
export function workspaceFromSlots(slots: readonly WorkspaceSlot[]): WorkspaceState | null {
  if (!slots.length) return null;
  return { primary: slots[0].pane, secondary: slots[1]?.pane ?? null, tertiary: slots[2]?.pane ?? null, quaternary: slots[3]?.pane ?? null, focusedPane: "primary" };
}
