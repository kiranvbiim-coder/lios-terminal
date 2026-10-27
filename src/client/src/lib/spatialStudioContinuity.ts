import type { SpatialLayoutMode } from "./spatialResearchModel";
import type { ResearchTrayItemKind } from "./terminalResearchTray";

/**
 * Ephemeral, presentation-only location within Analytical Studio.
 * TerminalUxOverlays owns this value for the lifetime of its authenticated
 * component. No disk storage, cross-account cache, new Artifact authority,
 * or automatic execution is involved.
 */
export type SpatialStudioTab =
  | "flow" | "compare" | "thesis" | "canvas" | "packages"
  | "composer" | "replay" | "ai-preview" | "meeting";

export interface SpatialCanvasReturnState {
  mode: SpatialLayoutMode;
  kindFilter: "all" | ResearchTrayItemKind;
  trailGroup: string;
  inspectedId: string | null;
  selectedConnectionKey: string | null;
  expanded: boolean;
}

export const INITIAL_SPATIAL_CANVAS_RETURN_STATE: SpatialCanvasReturnState = Object.freeze({
  mode: "map",
  kindFilter: "all",
  trailGroup: "",
  inspectedId: null,
  selectedConnectionKey: null,
  expanded: false,
});

export const INITIAL_SPATIAL_STUDIO_TAB: SpatialStudioTab = "flow";

/** Returning to a filtered view must not resurface a removed or hidden pin. */
export function reconcileSpatialCanvasReturnState(
  snapshot: SpatialCanvasReturnState,
  visibleItemIds: readonly string[],
  availableGroups: readonly string[],
  availableConnectionKeys: readonly string[],
): SpatialCanvasReturnState {
  return {
    ...snapshot,
    inspectedId: snapshot.inspectedId && visibleItemIds.includes(snapshot.inspectedId) ? snapshot.inspectedId : null,
    selectedConnectionKey: snapshot.selectedConnectionKey && availableConnectionKeys.includes(snapshot.selectedConnectionKey) ? snapshot.selectedConnectionKey : null,
    trailGroup: snapshot.trailGroup && availableGroups.includes(snapshot.trailGroup) ? snapshot.trailGroup : "",
  };
}

