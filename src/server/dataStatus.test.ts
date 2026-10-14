import test from "node:test";
import assert from "node:assert/strict";

import { buildDataStatus } from "./dataStatus";

test("buildDataStatus applies default labels for current and reference data", () => {
  assert.deepEqual(
    buildDataStatus({ provider: "Yahoo Finance", freshness: "current", asOf: "2026-03-17T15:30:00.000Z" }),
    {
      provider: "Limuria Intelligence",
      freshness: "current",
      asOf: "2026-03-17T15:30:00.000Z",
      delayLabel: "Current session",
      isFallback: false,
    },
  );

  assert.deepEqual(
    buildDataStatus({ provider: "Reference fallback", freshness: "reference", isFallback: true }),
    {
      provider: "Limuria Intelligence",
      freshness: "reference",
      asOf: null,
      delayLabel: "Reference only",
      isFallback: true,
    },
  );
});

test("buildDataStatus lets callers override the default delay label", () => {
  assert.deepEqual(
    buildDataStatus({
      provider: "FRED",
      freshness: "schedule",
      asOf: null,
      delayLabel: "Scheduled release calendar",
    }),
    {
      provider: "Limuria Intelligence",
      freshness: "schedule",
      asOf: null,
      delayLabel: "Scheduled release calendar",
      isFallback: false,
    },
  );
});
