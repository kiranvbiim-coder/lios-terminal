import type { recordedGeographicPoints } from "./phase3InvestigationPresentation";
import { recordedIsoTimestamp } from "./recordedIsoTimestamp";

export type RecordedGeographicPoint = ReturnType<typeof recordedGeographicPoints>[number];
export type WorldPoint = RecordedGeographicPoint & { x: number; y: number; hasSourceId: boolean };
const MAX_POINTS = 60;

export function projectOfflineWorldPoints(
  points: readonly RecordedGeographicPoint[],
  options: { sourceOnly?: boolean; withEventDate?: boolean; fromDate?: string; throughDate?: string } = {},
) {
  // A date window is always UTC-calendar-day based. Malformed bounds must not
  // silently widen the map and reveal outside-window records.
  const from = options.fromDate === undefined ? null : recordedIsoTimestamp(options.fromDate, true);
  const through = options.throughDate === undefined ? null : recordedIsoTimestamp(options.throughDate, true);
  const invalidWindow = (options.fromDate !== undefined && !from) ||
    (options.throughDate !== undefined && !through) ||
    (from !== null && through !== null && from > through);
  const knownIds = new Set<string>();
  const eligible = points.flatMap(point => {
    if (typeof point.id !== "string" || !point.id.trim() || knownIds.has(point.id)) return [];
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) return [];
    const hasSourceId = typeof point.sourceRef === "string" && point.sourceRef.trim().length > 0;
    if (options.sourceOnly && !hasSourceId) return [];
    const occurred = recordedIsoTimestamp(point.occurredAt, true);
    if (options.withEventDate && !occurred) return [];
    if (invalidWindow) return [];
    // Boundaries are inclusive on UTC calendar dates, not locally guessed event
    // dates or publication dates. Undated pins are unknown, never "current".
    const day = occurred?.slice(0, 10) ?? null;
    if ((from || through) && (!day || (from && day < from.slice(0, 10)) ||
      (through && day > through.slice(0, 10)))) return [];
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

/** Available time controls arise only from recorded and parseable P7 event dates.
 * They do not infer when an undated place was visited or when news was published.
 */
export function recordedWorldMapDays(points: readonly RecordedGeographicPoint[]): string[] {
  return [...new Set(points.flatMap(point => {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) return [];
    const at = recordedIsoTimestamp(point.occurredAt, true);
    return at ? [at.slice(0, 10)] : [];
  }))].sort();
}
