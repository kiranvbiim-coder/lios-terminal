import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRemoteTelemetryAggregate,
  type TerminalTelemetrySnapshot,
  TERMINAL_TELEMETRY_PRIVACY_CONTRACT,
} from "./terminalTelemetry";

test("P3 remote terminal diagnostics collapse local detail into aggregate-only counters", () => {
  const snapshot: TerminalTelemetrySnapshot = {
    counters: {
      launches: { sidebar: 2, omnibox: 3 },
      capabilityLaunches: { chart: 4, news: 1 } as never,
      noResultSearches: 2,
      restoredTabs: 5,
      restoreFailures: 1,
      linkedContextChanges: 7,
      completedMissions: 3,
    },
    timings: {
      "chart:SPY:private-symbol-key": { count: 2, totalMs: 300, maxMs: 200 },
      "sensitive-operation-name": { count: 1, totalMs: 25, maxMs: 25 },
    },
    firstRecordedAt: 1,
    lastRecordedAt: 2,
  };

  const payload = buildRemoteTelemetryAggregate(snapshot);
  assert.deepEqual(payload, {
    category: "performance",
    eventName: "terminal.aggregate",
    severity: "warning",
    details: {
      screen: "terminal",
      operation: "aggregate",
      launchCount: 5,
      failureCount: 1,
      noResultCount: 2,
      linkedContextChanges: 7,
      completedMissions: 3,
      timingCount: 3,
      maxTimingMs: 200,
    },
  });

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /SPY|private-symbol-key|sensitive-operation-name|chart|news/i);
  assert.equal(TERMINAL_TELEMETRY_PRIVACY_CONTRACT.remoteAggregateOnlyWhenEnabled, true);
  assert.equal(TERMINAL_TELEMETRY_PRIVACY_CONTRACT.remoteStoresCapabilityNames, false);
  assert.equal(TERMINAL_TELEMETRY_PRIVACY_CONTRACT.remoteStoresRawStacks, false);
});
