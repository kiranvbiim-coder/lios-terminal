import test from "node:test";
import assert from "node:assert/strict";
import { recordedIsoTimestamp } from "./recordedIsoTimestamp";

test("source-recorded timestamps reject guessed dates, rollover, local times and invalid offsets", () => {
  const invalid = ["1", "03/04/2026", "2026-02-30", "2026-02-30T09:00:00Z",
    "2026-10-27T09:00:00", "2026-10-27T24:00:00Z",
    "2026-10-27T25:00:00Z", "2026-10-27T23:60:00Z",
    "2026-10-27T23:59:60Z", "2026-13-01", "2026-10-27T15:30:00+14:30",
    "2026-10-27T15:30:00+15:00", "2026-10-27T15:30:00+23:59",
    "2026-10-27T15:30:00+05:99", "2026-10-27T09:00Z", "2026-10-27T00:00:00.0000Z"];
  for (const value of invalid) {
    assert.equal(recordedIsoTimestamp(value), null, value);
    assert.equal(recordedIsoTimestamp(value, true), null, value);
  }
  assert.equal(recordedIsoTimestamp("2026-10-27"), null);
  assert.equal(recordedIsoTimestamp("2026-10-27", true), "2026-10-27T00:00:00.000Z");
});

test("timezone-qualified run instants and valid calendar source dates preserve their recorded time", () => {
  assert.equal(recordedIsoTimestamp("2026-10-27T15:30:00+05:30"), "2026-10-27T10:00:00.000Z");
  assert.equal(recordedIsoTimestamp("2026-10-27T10:00:00.123Z"), "2026-10-27T10:00:00.123Z");
  assert.equal(recordedIsoTimestamp("2024-02-29", true), "2024-02-29T00:00:00.000Z");
  assert.equal(recordedIsoTimestamp("2026-10-27T10:00:00-14:00"), "2026-10-28T00:00:00.000Z");
  assert.equal(recordedIsoTimestamp("2023-02-29", true), null);
  assert.equal(recordedIsoTimestamp(null, true), null);
});
