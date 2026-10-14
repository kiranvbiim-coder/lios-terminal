import assert from "node:assert/strict";
import test from "node:test";
import { P2_CONVERSATION_TELEMETRY_PRIVACY_CONTRACT } from "./p2ConversationTelemetry";

test("P2 orchestration telemetry is content-free and local-only", () => {
  assert.deepEqual(P2_CONVERSATION_TELEMETRY_PRIVACY_CONTRACT, {
    localOnly: true,
    storesPromptText: false,
    storesEntityQueries: false,
    storesSymbols: false,
    storesProjectNames: false,
    storesFileNames: false,
    storesFileContents: false,
    storesProviderNames: false,
    storesProviderCredentials: false,
    storesCapabilityIds: true,
    storesAggregateCounters: true,
  });
});
