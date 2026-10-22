import type { PaneState, WorkspaceState } from "@/lib/terminalTypes";

export interface WorkspaceSlot {
  objectId: string;
  pane: PaneState;
}

export const MAX_WORKSPACE_PANES = 4;

/**
 * A user must explicitly remove a pane before replacing it. The old Composer
 * evicted the oldest pane when a fifth item was added, losing the visible layout.
 */
export function appendWorkspaceSlot(current: readonly WorkspaceSlot[], candidate: WorkspaceSlot): WorkspaceSlot[] {
  if (current.length >= MAX_WORKSPACE_PANES || current.some((slot) => slot.objectId === candidate.objectId)) {
    return current as WorkspaceSlot[];
  }
  return [...current, candidate];
}

export function removeWorkspaceSlot(current: readonly WorkspaceSlot[], index: number): WorkspaceSlot[] {
  return current.filter((_slot, at) => at !== index);
}

export function workspaceFromSlots(slots: readonly WorkspaceSlot[]): WorkspaceState | null {
  if (!slots.length) return null;
  return {
    primary: slots[0].pane,
    secondary: slots[1]?.pane ?? null,
    tertiary: slots[2]?.pane ?? null,
    quaternary: slots[3]?.pane ?? null,
    focusedPane: "primary",
  };
}
