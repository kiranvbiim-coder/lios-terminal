import assert from "node:assert/strict";
import test from "node:test";
import { formatCountdown } from "./devicesSettingsFormat";

test("formatCountdown renders m:ss and rounds partial seconds up", () => {
  assert.equal(formatCountdown(300_000), "5:00");
  assert.equal(formatCountdown(61_000), "1:01");
  assert.equal(formatCountdown(9_001), "0:10");
  assert.equal(formatCountdown(1), "0:01");
});

test("formatCountdown clamps expired values to 0:00", () => {
  assert.equal(formatCountdown(0), "0:00");
  assert.equal(formatCountdown(-5_000), "0:00");
});
