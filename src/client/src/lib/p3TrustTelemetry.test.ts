import assert from "node:assert/strict";
import test from "node:test";
import { P3_TRUST_TELEMETRY_PRIVACY_CONTRACT } from "./p3TrustTelemetry";

test("P3 trust telemetry is aggregate-only and content-free", () => {
  assert.deepEqual(P3_TRUST_TELEMETRY_PRIVACY_CONTRACT, {
    localOnly: true,
    storesPromptText: false,
    storesSourceRefs: false,
    storesProviderNames: false,
    storesSymbols: false,
    storesProjectNames: false,
    storesFileNames: false,
    storesFileContents: false,
    storesAssumptionValues: false,
    storesCredentials: false,
    storesOnlyAggregateCounters: true,
  });
});
