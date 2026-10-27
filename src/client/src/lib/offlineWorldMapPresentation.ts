import type { recordedGeographicPoints } from "./phase3InvestigationPresentation";
import { recordedIsoTimestamp } from "./recordedIsoTimestamp";

export type RecordedGeographicPoint = ReturnType<typeof recordedGeographicPoints>[number];
export type WorldPoint = RecordedGeographicPoint & { x: number; y: number; hasSourceId: boolean };
const MAX_POINTS = 60;

export function projectOfflineWorldPoints(
  points: readonly RecordedGeographicPoint[],
  options: { sourceOnly?: boolean; withEventDate?: boolean; query?: string } = {},
) {
  const knownIds = new Set<string>();
  // Search is a local, exact-record text projection over already authorized
  // point labels/source IDs. No geocoding, location history or network calls.
  const query = (options.query ?? "").trim().toLocaleLowerCase().slice(0, 120);
  const sourceEligible = points.flatMap(point => {
    if (typeof point.id !== "string" || !point.id.trim() || knownIds.has(point.id)) return [];
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) return [];
    const hasSourceId = typeof point.sourceRef === "string" && point.sourceRef.trim().length > 0;
    if (options.sourceOnly && !hasSourceId) return [];
    // Date.parse alone accepts ambiguous local dates, rollovers and strings
    // such as "1". Use the existing canonical zoned event gate.
    if (options.withEventDate && !recordedIsoTimestamp(point.occurredAt)) return [];
    knownIds.add(point.id);
    return [{
      ...point,
      x: (point.longitude + 180) / 360 * 100,
      y: (90 - point.latitude) / 180 * 100,
      hasSourceId,
    } satisfies WorldPoint];
  });
  const matched = query
    ? sourceEligible.filter(point =>
      point.label.toLocaleLowerCase().includes(query) ||
      point.id.toLocaleLowerCase().includes(query) ||
      (point.sourceRef ?? "").toLocaleLowerCase().includes(query))
    : sourceEligible;
  return {
    points: matched.slice(0, MAX_POINTS),
    eligibleCount: matched.length,
    omittedCount: Math.max(0, matched.length - MAX_POINTS),
    filteredOutCount: sourceEligible.length - matched.length,
  };
}

/** Accurate equirectangular projection; drawing position is not a geocode or a physical distance. */
export function worldPointCoordinates(longitude: number, latitude: number) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
    longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
  return { x: (longitude + 180) / 360 * 100, y: (90 - latitude) / 180 * 100 };
}
