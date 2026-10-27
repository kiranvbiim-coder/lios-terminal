/**
 * One read-only timestamp gate for source-recorded LiOS visual evidence.
 * A date-only P4 source cell is allowed only when explicitly requested;
 * P9 run events require a complete ISO time and timezone.
 * No guessed dates, local clock interpretation, day rollover or leap seconds.
 */
const DATE_ONLY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const ZONED_INSTANT = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

export function recordedIsoTimestamp(value: unknown, allowDateOnly = false): string | null {
  if (typeof value !== "string") return null;
  const isDateOnly = DATE_ONLY.test(value);
  if (!(isDateOnly && allowDateOnly) && !ZONED_INSTANT.test(value)) return null;
  // Civil timezone offsets in use never extend beyond UTC+/-14:00.
  if (/[+-]14:(?!00$)/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
