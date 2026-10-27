import type { ResearchTrayItem } from "./terminalResearchTray";
import type { ResearchCanvasPosition } from "./terminalResearchCanvas";

export type SpatialLayoutMode = "map" | "timeline" | "list";
export interface SpatialPoint { x: number; y: number }
export interface SpatialNode { item: ResearchTrayItem; point: SpatialPoint }
export interface SpatialEdge { fromId: string; toId: string; group: string }
export interface SpatialResearchModel { nodes: SpatialNode[]; edges: SpatialEdge[]; hiddenCount: number }

export const MAX_SPATIAL_NODES = 36;
export const SPATIAL_MOVE_STEP = 4;
const KIND_Y: Record<ResearchTrayItem["kind"], number> = { evidence: 16, context: 36, note: 58, output: 78 };

export function clampSpatialPoint(point: SpatialPoint): SpatialPoint {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  return {
    x: Math.max(10, Math.min(90, finite(point.x, 50))),
    y: Math.max(10, Math.min(90, finite(point.y, 50))),
  };
}

/** Only existing user-pinned items are rendered: never invent companies, evidence or links. */
export function seededSpatialPoint(item: ResearchTrayItem, index: number): SpatialPoint {
  const hash = Array.from(item.id).reduce((acc, char) => (Math.imul(acc, 31) + char.charCodeAt(0)) >>> 0, 7);
  return clampSpatialPoint({
    x: 13 + ((hash + index * 17) % 74),
    y: KIND_Y[item.kind] + ((hash >>> 4) % 15) - 7,
  });
}

function validSavedPoint(value: ResearchCanvasPosition | undefined): SpatialPoint | null {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 100 && value.y >= 0 && value.y <= 100
    ? clampSpatialPoint(value) : null;
}

/**
 * The "connections" are explicitly named by the user's group field.
 * No text similarity, correlation, inferred relationship or research permission is claimed.
 * Timeline is a read-only chronology of the local pin timestamps, not market prices.
 */
export function buildSpatialResearchModel(
  items: readonly ResearchTrayItem[],
  positions: Readonly<Record<string, ResearchCanvasPosition>>,
  mode: SpatialLayoutMode = "map",
): SpatialResearchModel {
  const retained = items.slice(0, MAX_SPATIAL_NODES);
  const timestamps = retained.map(item => item.createdAt).filter(Number.isFinite);
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const nodes = retained.map((item, index) => {
    const point = mode === "timeline" ? clampSpatialPoint({
      x: Number.isFinite(item.createdAt) && max > min ? 12 + (item.createdAt - min) / (max - min) * 76 : 50,
      y: KIND_Y[item.kind] + (index % 3) * 3,
    }) : validSavedPoint(positions[item.id]) ?? seededSpatialPoint(item, index);
    return { item, point };
  });
  const groups = new Map<string, SpatialNode[]>();
  for (const node of nodes) {
    const group = node.item.group.trim();
    if (!group) continue;
    const matches = groups.get(group) ?? [];
    matches.push(node);
    groups.set(group, matches);
  }
  const edges: SpatialEdge[] = [];
  for (const [group, members] of groups) {
    for (let i = 1; i < members.length; i++) {
      edges.push({ group, fromId: members[i - 1].item.id, toId: members[i].item.id });
    }
  }
  return { nodes, edges, hiddenCount: Math.max(0, items.length - MAX_SPATIAL_NODES) };
}

export function moveSpatialPoint(point: SpatialPoint, direction: "left" | "right" | "up" | "down"): SpatialPoint {
  return clampSpatialPoint({
    x: point.x + (direction === "left" ? -SPATIAL_MOVE_STEP : direction === "right" ? SPATIAL_MOVE_STEP : 0),
    y: point.y + (direction === "up" ? -SPATIAL_MOVE_STEP : direction === "down" ? SPATIAL_MOVE_STEP : 0),
  });
}
