import assert from "node:assert/strict";
import test from "node:test";
import { assertObservationAvailableAsKnownOn, assertWorkflowPointInTimePolicy } from "./workflowDataPolicy";

test("P5 backtests reject latest-only semantics", () => {
  assert.throws(() => assertWorkflowPointInTimePolicy("backtest", {
    mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false,
  }), /lookahead bias/);
});

test("P5 historical research requires availability/publication clocks", () => {
  const policy = assertWorkflowPointInTimePolicy("research", {
    mode: "as_known_on", asKnownOn: "2025-01-01T00:00:00.000Z", revision: null, requirePublicationTime: true, allowLaterRevisions: false,
  });
  assert.throws(() => assertObservationAvailableAsKnownOn(policy, {
    providerId: "fixture", capability: "statements", entityRef: "ABC", data: {},
    sourceRefs: [], clocks: { effectiveAt: "2024-12-31T00:00:00.000Z", publishedAt: "2025-01-02T00:00:00.000Z", retrievedAt: "2026-01-01T00:00:00.000Z", availableAt: "2025-01-02T00:00:00.000Z" },
    revision: null, quota: null, entitlement: { decision: "allowed", policyId: null, permittedUses: ["internal_research"], reasons: [] }, normalized: true, warnings: [],
  }), /not available/);
});
