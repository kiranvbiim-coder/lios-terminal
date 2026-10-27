import type { recordedGeographicPoints } from "./phase3InvestigationPresentation";

export type RecordedGeographicPoint = ReturnType<typeof recordedGeographicPoints>[number];
export type WorldPoint = RecordedGeographicPoint & { x: number; y: number; hasSourceId: boolean };
const MAX_POINTS = 60;

export function projectOfflineWorldPoints(
  points: readonly RecordedGeographicPoint[],
  options: { sourceOnly?: boolean; withEventDate?: boolean } = {},
) {
  const knownIds = new Set<string>();
  const eligible = points.flatMap(point => {
    if (typeof point.id !== "string" || !point.id.trim() || knownIds.has(point.id)) return [];
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) return [];
    const hasSourceId = typeof point.sourceRef === "string" && point.sourceRef.trim().length > 0;
    if (options.sourceOnly && !hasSourceId) return [];
    if (options.withEventDate && (!point.occurredAt || !Number.isFinite(Date.parse(point.occurredAt)))) return [];
    knownIds.add(point.id);
    return [{
      ...point,
      x: (point.longitude + 180) / 360 * 100,
      y: (90 - point.latitude) / 180 * 100,
      hasSourceId,
    } satisfies WorldPoint];
  });
  return {
    points: eligible.slice(0, MAX_POINTS),
    eligibleCount: eligible.length,
    omittedCount: Math.max(0, eligible.length - MAX_POINTS),
  };
}

/** Accurate equirectangular projection; drawing position is not a geocode or a physical distance. */
export function worldPointCoordinates(longitude: number, latitude: number) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
    longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return { x: (longitude + 180) / 360 * 100, y: (90 - latitude) / 180 * 100 };
}
