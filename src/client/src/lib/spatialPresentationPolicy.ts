import type { SpatialLayoutMode } from "./spatialResearchModel";

/** Matches the CSS container breakpoint of the one canonical spatial surface. */
export const SPATIAL_STACKED_MAX_WIDTH = 760;

/** Re-render only when crossing the pane behavior breakpoint, not every pixel. */
export function bucketSpatialPaneWidth(width: number): number | null {
  if (!Number.isFinite(width) || width < 0) return null;
  return width <= SPATIAL_STACKED_MAX_WIDTH
    ? SPATIAL_STACKED_MAX_WIDTH
    : SPATIAL_STACKED_MAX_WIDTH + 1;
}

export interface SpatialPresentationPolicy {
  stacked: boolean;
  canMoveNodes: boolean;
  canMoveCompanion: boolean;
  showDecorativeEdges: boolean;
  layoutHint: string;
}

/**
 * A reading-mode decision, never a data/permission decision. Unknown measurements
 * default to safe stacked behavior until the actual Studio pane can be measured.
 */
export function resolveSpatialPresentation(
  mode: SpatialLayoutMode,
  contentWidth: number | null,
): SpatialPresentationPolicy {
  const stacked = mode === "list"
    || contentWidth === null
    || !Number.isFinite(contentWidth)
    || contentWidth <= SPATIAL_STACKED_MAX_WIDTH;
  return {
    stacked,
    canMoveNodes: mode === "map" && !stacked,
    canMoveCompanion: !stacked,
    showDecorativeEdges: !stacked,
    layoutHint: stacked
      ? "Reading layout: inspect or open pins in their saved order. Spatial dragging is disabled in this pane."
      : mode === "timeline"
        ? "Timeline shows saved-pin dates, not market price history. Pin movement is read-only; the companion can be moved."
        : "Drag pin handles or use arrow keys to arrange. Inspect opens a movable companion.",
  };
}
