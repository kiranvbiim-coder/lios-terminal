import assert from "node:assert/strict";
import test from "node:test";
import { Cron } from "croner";
import { nextP9CronRun, p9CronScheduleSchema, type P9CronSchedule } from "./p9CronSchedule";

const fixtures = [
  ["weekday names", "0 9 * * MON-FRI", "UTC", "2026-10-30T09:00:00Z", "2026-11-02T09:00:00.000Z"],
  ["explicit zoned weekday", "15 9 * * MON-FRI", "America/New_York", "2026-10-30T12:00:00Z", "2026-10-30T13:15:00.000Z"],
  ["cross UTC day", "0 9 * * *", "Asia/Tokyo", "2026-10-30T01:00:00Z", "2026-10-31T00:00:00.000Z"],
  ["Shanghai year rollback", "0 8 * * *", "Asia/Shanghai", "2026-03-01T00:00:00Z", "2026-03-02T00:00:00.000Z"],
  ["leap February", "0 9 29 FEB *", "UTC", "2026-01-01T00:00:00Z", "2028-02-29T09:00:00.000Z"],
  ["DOM weekday OR", "0 9 1 * MON", "UTC", "2026-10-30T00:00:00Z", "2026-11-01T09:00:00.000Z"],
  ["ranges lists and steps", "0-20/5,40,55 9-17 * JAN,NOV MON-FRI", "UTC", "2026-11-02T09:20:00Z", "2026-11-02T09:40:00.000Z"],
  ["strictly future minute", "*/5 * * * *", "UTC", "2026-10-30T09:00:00Z", "2026-10-30T09:05:00.000Z"],
  ["strictly future fractional instant", "*/5 * * * *", "UTC", "2026-10-30T09:00:00.001Z", "2026-10-30T09:05:00.000Z"],
  ["New York first fold", "30 1 * * *", "America/New_York", "2026-11-01T05:15:00Z", "2026-11-01T05:30:00.000Z"],
  ["New York no duplicate at first occurrence", "30 1 * * *", "America/New_York", "2026-11-01T05:30:00Z", "2026-11-02T06:30:00.000Z"],
  ["New York retains later same-day slot", "30 1,3 * * *", "America/New_York", "2026-11-01T06:15:00Z", "2026-11-01T08:30:00.000Z"],
  ["New York suppresses repeated interval", "*/5 * * * *", "America/New_York", "2026-11-01T06:15:00Z", "2026-11-01T07:00:00.000Z"],
  ["New York skips nonexistent time", "30 2 * * *", "America/New_York", "2027-03-14T06:45:00Z", "2027-03-15T06:30:00.000Z"],
  ["New York gap retains valid later minute", "45 1,2,3 * * *", "America/New_York", "2027-03-14T07:05:00Z", "2027-03-14T07:45:00.000Z"],
  ["Oslo spring gap", "30 2 * * *", "Europe/Oslo", "2026-03-29T00:45:00Z", "2026-03-30T00:30:00.000Z"],
  ["Lord Howe first half-hour fold", "45 1 * * *", "Australia/Lord_Howe", "2026-04-04T14:40:00Z", "2026-04-04T14:45:00.000Z"],
  ["Lord Howe no duplicate half-hour fold", "45 1 * * *", "Australia/Lord_Howe", "2026-04-04T14:45:00Z", "2026-04-05T15:15:00.000Z"],
  ["Lord Howe retains later reminder", "45 1,2 * * *", "Australia/Lord_Howe", "2026-04-04T15:10:00Z", "2026-04-04T16:15:00.000Z"],
  ["Lord Howe skips repeated half hour", "*/5 * * * *", "Australia/Lord_Howe", "2026-04-04T15:10:00Z", "2026-04-04T15:30:00.000Z"],
  ["Lord Howe gap boundary", "15,30 2 * * *", "Australia/Lord_Howe", "2026-10-03T15:20:00Z", "2026-10-03T15:30:00.000Z"],
  ["Lord Howe gap later minute", "15,35 2 * * *", "Australia/Lord_Howe", "2026-10-03T15:20:00Z", "2026-10-03T15:35:00.000Z"],
  ["Troll first two-hour fold", "0 2 * * *", "Antarctica/Troll", "2026-10-24T23:30:00Z", "2026-10-25T00:00:00.000Z"],
  ["Troll no duplicate two-hour fold", "0 2 * * *", "Antarctica/Troll", "2026-10-25T00:00:00Z", "2026-10-26T02:00:00.000Z"],
  ["Troll retains later reminder", "0 1,2,4 * * *", "Antarctica/Troll", "2026-10-25T01:30:00Z", "2026-10-25T04:00:00.000Z"],
  ["Troll skips entire repeated interval", "*/5 * * * *", "Antarctica/Troll", "2026-10-25T01:30:00.250Z", "2026-10-25T03:00:00.000Z"],
  ["Troll spring gap retains later hour", "30 2,3 * * *", "Antarctica/Troll", "2026-03-29T00:30:00Z", "2026-03-29T01:30:00.000Z"],
  ["annual gap after intervening transitions", "30 2 14 3 *", "America/New_York", "2026-07-01T00:00:00Z", "2028-03-14T06:30:00.000Z"],
  ["Apia skipped entire calendar day", "0 9 30 12 *", "Pacific/Apia", "2011-12-29T00:00:00Z", "2012-12-29T19:00:00.000Z"],
  ["Apia daily after skipped day", "0 9 * * *", "Pacific/Apia", "2011-12-29T20:00:00Z", "2011-12-30T19:00:00.000Z"],
] as const;

for (const [label, expression, timeZone, from, expected] of fixtures) {
  test(`cron ${label}`, () => {
    const schedule: P9CronSchedule = { kind: "cron", expression, timeZone };
    const next = nextP9CronRun(schedule, new Date(from));
    assert.equal(next?.toISOString(), expected);
    assert.ok(next!.getTime() > Date.parse(from));
    const following = nextP9CronRun(schedule, next!);
    assert.ok(following && following.getTime() > next!.getTime(), "the same scheduled instant is never returned twice");
  });
}

test("cron validation accepts exact five-minute circular boundaries and single-minute hours", () => {
  for (const expression of ["*/5 * * * *", "0,55 * * * *", "4,59 * * * *", "59 * * * *", "0 9 * JAN-DEC SUN-SAT", "0 9 31 FEB MON"]) {
    assert.equal(p9CronScheduleSchema.safeParse({ kind: "cron", expression, timeZone: "UTC" }).success, true, expression);
  }
});

test("cron validation rejects seconds, years, macros, random fields, extensions and unsafe minute spacing", () => {
  for (const expression of [
    "", "0 9 * *", "0 0 9 * * *", "0 0 9 * * * 2027", "@daily", "@hourly",
    "? 9 * * *", "H/5 * * * *", "0 9 ? * MON", "0 9 L * *", "0 9 * * MON#2",
    "* * * * *", "*/4 * * * *", "0,56 * * * *", "0,59 * * * *", "1,5 * * * *",
    "60 9 * * *", "0 24 * * *", "0 9 31 FEB *", "0 9 31 APR *", "x".repeat(201),
  ]) {
    const schedule: P9CronSchedule = { kind: "cron", expression, timeZone: "UTC" };
    assert.equal(p9CronScheduleSchema.safeParse(schedule).success, false, expression);
    assert.equal(nextP9CronRun(schedule, new Date("2026-10-30T00:00:00Z")), null, expression);
  }
});

test("cron requires a valid explicit named zone and refuses invalid dates", () => {
  for (const timeZone of ["", " ", "Not/AZone", " UTC ", "+01:00", "x".repeat(101)]) {
    const schedule: P9CronSchedule = { kind: "cron", expression: "0 9 * * *", timeZone };
    assert.equal(p9CronScheduleSchema.safeParse(schedule).success, false, timeZone);
    assert.equal(nextP9CronRun(schedule, new Date()), null, timeZone);
  }
  assert.equal(p9CronScheduleSchema.safeParse({ kind: "cron", expression: "0 9 * * *", timeZone: "UTC", extra: true }).success, false);
  assert.equal(nextP9CronRun({ kind: "cron", expression: "0 9 * * *", timeZone: "UTC" }, new Date(NaN)), null);
  assert.equal(nextP9CronRun({ kind: "cron", expression: "0 9 * * *", timeZone: "UTC" }, new Date(8_640_000_000_000_000)), null);
});

test("cron calculation never schedules a callback or starts a Croner timer", t => {
  const schedule: P9CronSchedule = { kind: "cron", expression: "17 9 * * *", timeZone: "UTC" };
  const scheduleTimer = t.mock.method(Cron.prototype, "schedule", () => { throw new Error("must not schedule a task"); });
  assert.equal(nextP9CronRun(schedule, new Date("2026-10-30T00:00:00Z"))?.toISOString(), "2026-10-30T09:17:00.000Z");
  assert.equal(scheduleTimer.mock.callCount(), 0);
});
