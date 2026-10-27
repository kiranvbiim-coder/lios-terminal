/**
 * Read-only geographic projection of an ALREADY AUTHORIZED exact-version P4
 * table. No geocoding, inference, external lookup, saved writes or hidden
 * joining. A plotted row must contain numeric coordinates AND an exact source
 * ref present in the authorization granted to the Chat visual answer.
 */
import type { AuthorizedVisualAnswer } from "../../../shared/governedVisualAnswer";
import type { RecordedGeographicPoint } from "./offlineWorldMapPresentation";

type SavedTable = Extract<AuthorizedVisualAnswer, { kind: "table" }>;
const MAX_ROWS_SCANNED = 1_000;
const MAX_POINTS = 60;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

function exactColumn(table: SavedTable["content"], names: readonly string[]): string | null {
  const matched = table.columns.find(column => names.includes(normalizedKey(column.key)) ||
    names.includes(normalizedKey(column.label)));
  return matched?.key ?? null;
}

/**
 * Only unambiguous ISO calendar dates/times may be labeled as recorded events.
 * Date.parse alone guesses years for inputs such as "1" and rolls invalid
 * days forward; those would silently invent a misleading evidence timestamp.
 */
function recordedIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(0, 0, 0, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month ||
    calendar.getUTCDate() !== day) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export interface SavedTableMapProjection {
  points: RecordedGeographicPoint[];
  scannedRows: number;
  eligibleCount: number;
  omittedCount: number;
}

/**
 * Strict conversion from saved TABLE cell values. The canonical P4 GET already
 * authenticated project, version and source lineage in resolveGovernedVisualAnswer.
 * Each individual row needs its own recorded exact source reference too.
 */
export function projectSavedTableGeography(
  decision: AuthorizedVisualAnswer,
): SavedTableMapProjection {
  const empty = { points: [] as RecordedGeographicPoint[], scannedRows: 0, eligibleCount: 0, omittedCount: 0 };
  if (decision.kind !== "table") return empty;
  const content = decision.content;
  const latitudeColumn = exactColumn(content, ["latitude", "lat"]);
  const longitudeColumn = exactColumn(content, ["longitude", "lon", "lng"]);
  const sourceColumn = exactColumn(content, ["sourceref", "sourceid", "evidenceid"]);
  if (!latitudeColumn || !longitudeColumn || !sourceColumn ||
    new Set([latitudeColumn, longitudeColumn, sourceColumn]).size !== 3) return empty;
  const labelColumn = exactColumn(content, ["location", "place", "name", "label"]);
  const whenColumn = exactColumn(content, ["occurredat", "eventdate"]);
  const allowedSources = new Set(decision.sourceRefs);
  const scannedRows = Math.min(MAX_ROWS_SCANNED, content.rows.length);
  const all: RecordedGeographicPoint[] = [];
  for (let index = 0; index < scannedRows; index++) {
    const row = content.rows[index];
    const lat = row[latitudeColumn];
    const lon = row[longitudeColumn];
    const source = row[sourceColumn];
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      typeof source !== "string" || !allowedSources.has(source)) continue;
    const rawLabel = labelColumn ? row[labelColumn] : null;
    const label = typeof rawLabel === "string" && rawLabel.trim()
      ? rawLabel.trim().slice(0, 160) : "Saved table row " + (index + 1);
    const date = whenColumn ? row[whenColumn] : null;
    const occurredAt = recordedIsoTimestamp(date);
    all.push({
      id: "p4-table-row-" + index, label, latitude: lat, longitude: lon,
      sourceRef: source, occurredAt,
    });
  }
  return {
    points: all.slice(0, MAX_POINTS),
    scannedRows,
    eligibleCount: all.length,
    omittedCount: Math.max(0, all.length - MAX_POINTS),
  };
}
