import test from "node:test";
import assert from "node:assert/strict";
import { describeBackupHealth, stripIpcErrorPrefix } from "./backupHealth";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

test("an error always wins, even with a recent success", () => {
  assert.equal(describeBackupHealth({ lastError: "disk full", lastSuccessAt: hoursAgo(1) }, 24, NOW), "failed");
});

test("no success yet is reported as never", () => {
  assert.equal(describeBackupHealth({ lastError: null, lastSuccessAt: null }, 24, NOW), "never");
});

test("stale means the last success is older than twice the interval", () => {
  assert.equal(describeBackupHealth({ lastError: null, lastSuccessAt: hoursAgo(47) }, 24, NOW), "ok");
  assert.equal(describeBackupHealth({ lastError: null, lastSuccessAt: hoursAgo(49) }, 24, NOW), "stale");
});

test("with the schedule off an old success is not stale", () => {
  assert.equal(describeBackupHealth({ lastError: null, lastSuccessAt: hoursAgo(5000) }, 0, NOW), "ok");
});

test("IPC prefix is stripped, other messages are untouched", () => {
  assert.equal(
    stripIpcErrorPrefix("Error invoking remote method 'limuria:move-data-folder': Error: Target is not empty."),
    "Target is not empty.",
  );
  assert.equal(stripIpcErrorPrefix("Target is not empty."), "Target is not empty.");
});
