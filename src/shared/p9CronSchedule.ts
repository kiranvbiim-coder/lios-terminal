import { Cron, CronDate, CronPattern } from "croner";
import { z } from "zod";

export type P9CronSchedule = { kind: "cron"; expression: string; timeZone: string };

const DAY_MS = 86_400_000;
const CACHE_LIMIT = 512;
const evaluators = new Map<string, Cron>();
const NUMERIC_FIELD = /^[\d*,/\-]+$/;
const MONTH_FIELD = /^(?:[\d*,/\-]|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)+$/i;
const WEEKDAY_FIELD = /^(?:[\d*,/\-]|SUN|MON|TUE|WED|THU|FRI|SAT)+$/i;

function evaluator(schedule: P9CronSchedule): Cron {
  const { expression, timeZone } = schedule;
  if (typeof expression !== "string" || !expression.trim() || expression.length > 200) {
    throw new Error("Cron expression must contain five fields and at most 200 characters.");
  }
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 100 || timeZone !== timeZone.trim() || /^[+-]/.test(timeZone)) {
    throw new Error("Cron requires an explicit IANA time zone (at most 100 characters).");
  }
  const key = `${timeZone}\u0000${expression}`;
  const cached = evaluators.get(key);
  if (cached) {
    evaluators.delete(key);
    evaluators.set(key, cached);
    return cached;
  }
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 || !fields.every((field, index) =>
    (index === 3 ? MONTH_FIELD : index === 4 ? WEEKDAY_FIELD : NUMERIC_FIELD).test(field))) {
    throw new Error("Use five cron fields: minute hour day-of-month month weekday; only numbers, names, lists, ranges and steps are supported.");
  }
  // Reject ambient/offset-only zones, even on Intl implementations accepting them.
  new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  const pattern = new CronPattern(expression, timeZone, { mode: "5-part" });
  const minutes = pattern.minute.flatMap((enabled, minute) => enabled ? [minute] : []);
  if (!minutes.length || minutes.some((minute, index) => {
    const next = minutes[(index + 1) % minutes.length] + (index === minutes.length - 1 ? 60 : 0);
    return next - minute < 5;
  })) {
    throw new Error("Cron minute values must be at least five minutes apart, including the hour boundary.");
  }
  // Calculation only: no task callback, timer, catch-up loop or independent scheduler.
  // Traditional cron combines restricted day-of-month and weekday with OR.
  const cron = new Cron(expression, { timezone: timeZone, mode: "5-part", domAndDow: false, paused: true, catch: false });
  if (evaluators.size >= CACHE_LIMIT) evaluators.delete(evaluators.keys().next().value!);
  evaluators.set(key, cron);
  return cron;
}

/**
 * DST normalization adapted from approved OpenClaw src/cron/schedule.ts and
 * src/infra/format-time/parse-offsetless-zoned-datetime.ts, c074824a27c96d3983043f9eeb33823cd1772d8c
 * (MIT, Copyright (c) 2026 OpenClaw Foundation). Only future cron evaluation is adopted.
 */
function wallTimeMs(instantMs: number, timeZone: string): number {
  const local = new CronDate(new Date(instantMs), timeZone);
  // Unlike Date.UTC, setters preserve years 0–99 without interpreting them as 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(local.year, local.month, local.day);
  return date.setUTCHours(local.hour, local.minute, local.second, local.ms);
}

function finiteDate(ms: number): boolean {
  return Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime());
}

function firstOccurrenceMs(instantMs: number, timeZone: string): number | undefined {
  const wallMs = wallTimeMs(instantMs, timeZone);
  let first: number | undefined;
  // Resolve offsetless wall fields against both sides of the day. A gap has no
  // matching instant; a fold uses its earliest real instant, regardless of size.
  for (const shift of [-DAY_MS, 0, DAY_MS]) {
    const probe = wallMs + shift;
    if (!finiteDate(probe)) continue;
    const candidate = wallMs - (wallTimeMs(probe, timeZone) - probe);
    if (finiteDate(candidate) && wallTimeMs(candidate, timeZone) === wallMs && (first === undefined || candidate < first)) first = candidate;
  }
  return first;
}

function transitionMs(first: number, last: number, timeZone: string): number | undefined {
  let before = Math.floor(Math.min(first, last) / 1_000);
  let after = Math.floor(Math.max(first, last) / 1_000);
  const offset = (seconds: number) => wallTimeMs(seconds * 1_000, timeZone) - seconds * 1_000;
  const previousOffset = offset(before);
  if (previousOffset === offset(after)) return undefined;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (offset(middle) === previousOffset) before = middle;
    else after = middle;
  }
  return after * 1_000;
}

function runAtTransitionMs(cron: Cron, start: number, timeZone: string): number | undefined {
  let cursor = new Date(start);
  // Each iteration advances to another timezone transition, not another minute.
  // Croner's finite year horizon bounds annual occurrences lost to historical gaps.
  for (;;) {
    const candidate = cron.match(cursor) ? cursor : cron.nextRun(cursor);
    if (!candidate || !finiteDate(candidate.getTime())) return undefined;
    if (cron.match(candidate)) return firstOccurrenceMs(candidate.getTime(), timeZone);
    const nextTransition = transitionMs(candidate.getTime() - DAY_MS, candidate.getTime(), timeZone);
    if (nextTransition === undefined || nextTransition <= cursor.getTime()) return undefined;
    cursor = new Date(nextTransition);
  }
}

function normalizeNextMs(cron: Cron, fromMs: number, candidateMs: number, timeZone: string): number | undefined {
  if (!cron.match(new Date(candidateMs))) {
    // Croner can invent an instant for a missing wall time. Bracket that gap,
    // not fromMs: annual expressions may cross several intervening transitions.
    const transition = transitionMs(candidateMs - DAY_MS, candidateMs, timeZone);
    return transition === undefined ? undefined : runAtTransitionMs(cron, transition, timeZone);
  }
  const first = firstOccurrenceMs(candidateMs, timeZone);
  if (first === undefined || first > fromMs) return first;
  const firstCurrent = firstOccurrenceMs(fromMs, timeZone);
  const inFold = firstCurrent !== undefined && firstCurrent < fromMs;
  const transition = transitionMs(inFold ? firstCurrent : fromMs, inFold ? fromMs : candidateMs, timeZone);
  if (transition === undefined) return undefined;
  // Croner assumes a one-hour fold. Skip the actual repeated interval, including
  // Lord Howe's half hour and Troll's two hours, without dropping later slots.
  return runAtTransitionMs(cron, transition + (inFold ? fromMs - firstCurrent : candidateMs - first), timeZone);
}

function validatedNext(cron: Cron, fromMs: number, candidate: Date | null, timeZone: string): Date | null {
  if (!candidate || !finiteDate(candidate.getTime())) return null;
  const normalized = normalizeNextMs(cron, fromMs, candidate.getTime(), timeZone);
  if (normalized === undefined || normalized <= fromMs || !finiteDate(normalized)) return null;
  const result = new Date(normalized);
  // Never trust a Croner DST candidate without checking its actual wall fields.
  return cron.match(result) && firstOccurrenceMs(normalized, timeZone) === normalized ? result : null;
}

/** Pure preview/calculation; P9's existing persisted due-claim machinery owns execution. */
export function nextP9CronRun(schedule: P9CronSchedule, from: Date): Date | null {
  if (!(from instanceof Date) || !finiteDate(from.getTime())) return null;
  try {
    const cron = evaluator(schedule);
    const fromMs = from.getTime();
    const candidate = cron.nextRun(from);
    const next = validatedNext(cron, fromMs, candidate, schedule.timeZone);
    if (next || !candidate || candidate.getTime() > fromMs) return next;
    // Approved donor workaround for Croner's year rollback (e.g. Shanghai).
    const retry = validatedNext(cron, fromMs, cron.nextRun(new Date(Math.floor(fromMs / 1_000) * 1_000 + 1_000)), schedule.timeZone);
    if (retry) return retry;
    const tomorrow = new Date(fromMs);
    tomorrow.setUTCHours(24, 0, 0, 0);
    return validatedNext(cron, fromMs, cron.nextRun(tomorrow), schedule.timeZone);
  } catch {
    return null;
  }
}

export const p9CronScheduleSchema = z.object({
  kind: z.literal("cron"),
  expression: z.string().trim().min(1).max(200),
  timeZone: z.string().min(1).max(100),
}).strict().superRefine((schedule, ctx) => {
  try {
    evaluator(schedule);
    if (!nextP9CronRun(schedule, new Date())) throw new Error("Cron schedule has no finite future occurrence.");
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Invalid cron schedule." });
  }
});
