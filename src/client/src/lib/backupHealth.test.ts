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

test("future backup timestamps cannot report an impossible healthy age", () => {
  const future = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
  assert.equal(describeBackupHealth({ lastError: null, lastSuccessAt: future(60) }, 24, NOW), "stale");
  assert.equal(describeBackupHealth({ lastError: null, lastSuccessAt: future(5) }, 24, NOW), "ok",
    "allow bounded clock skew across devices");
  assert.equal(describeBackupHealth({ lastError: null, lastSuccessAt: future(6) }, 0, NOW), "stale",
    "a disabled schedule is not proof that a future-dated backup is valid");
});

test("invalid schedule and clock facts never qualify an existing backup as healthy", () => {
  const recent = { lastError: null, lastSuccessAt: hoursAgo(1) };
  for (const intervalHours of [-1, Number.NaN, Infinity, -Infinity]) {
    assert.equal(describeBackupHealth(recent, intervalHours, NOW), "failed");
  }
  assert.equal(describeBackupHealth(recent, 24, Number.NaN), "failed");
  assert.equal(describeBackupHealth(recent, 24, Infinity), "failed");
  assert.equal(describeBackupHealth({ lastError: "disk full", lastSuccessAt: hoursAgo(1) }, Number.NaN, NOW), "failed",
    "real backup errors retain precedence");
});
