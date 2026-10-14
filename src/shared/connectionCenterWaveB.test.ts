import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_CONNECTORS, type ConnectorRegistrySnapshot } from "./connectorRegistry";
import {
  COMMUNICATION_CONNECTOR_PLACEHOLDERS,
  buildConnectionHealthSummary,
  resolveOnboardingConnectionReadiness,
  validateLocalSourceMonitor,
} from "./connectionCenterWaveB";

test("local source monitor validation rejects relative and traversal paths", () => {
  assert.equal(validateLocalSourceMonitor({ sourceId: "reports", folderPath: "reports" }).valid, false);
  assert.equal(validateLocalSourceMonitor({ sourceId: "reports", folderPath: "/Users/kiran/../shared" }).valid, false);
  const valid = validateLocalSourceMonitor({ sourceId: "reports", folderPath: "/Users/kiran/reports", includeExtensions: [".csv"], pollIntervalSeconds: 60 });
  assert.equal(valid.valid, true);
  assert.equal(valid.value?.recursive, true);
});

test("communications remain placeholders with explicit side-effect gates", () => {
  assert.deepEqual(COMMUNICATION_CONNECTOR_PLACEHOLDERS.map((entry) => entry.id), ["gmail", "microsoft_365", "imap", "smtp", "slack", "teams", "webhook"]);
  assert.ok(COMMUNICATION_CONNECTOR_PLACEHOLDERS.every((entry) => entry.state === "placeholder" && entry.sideEffectsRequireConfirmation));
  assert.ok(COMMUNICATION_CONNECTOR_PLACEHOLDERS.find((entry) => entry.id === "smtp")?.operations.includes("send"));
});

test("connection health summary exposes capability coverage without claiming catalog-only sources are operational", () => {
  const snapshot: ConnectorRegistrySnapshot = {
    connectors: BUILT_IN_CONNECTORS.slice(0, 3),
    health: [
      { connectorId: "fred", state: "live_verified", detail: "ok", checkedAt: "2026-09-17T00:00:00.000Z", adapterImplemented: true, lastVerifiedAt: "2026-09-17T00:00:00.000Z" },
      { connectorId: "finnhub", state: "adapter_available", detail: "missing key", checkedAt: "2026-09-17T00:00:00.000Z", adapterImplemented: true, lastVerifiedAt: null },
      { connectorId: "lse", state: "degraded", detail: "failed", checkedAt: "2026-09-17T00:00:00.000Z", adapterImplemented: true, lastVerifiedAt: null },
    ],
  };
  const summary = buildConnectionHealthSummary(snapshot, "2026-09-17T00:00:00.000Z");
  assert.equal(summary.totalConnectors, 3);
  assert.equal(summary.byState.live_verified, 1);
  assert.deepEqual(summary.operationalConnectorIds, ["fred"]);
  assert.deepEqual(summary.attentionConnectorIds, ["lse"]);
  assert.ok(summary.coverageByCapability.macro.connectorIds.includes("fred"));
  assert.deepEqual(summary.coverageByCapability.macro.operationalConnectorIds, ["fred"]);
});

test("onboarding readiness points first-run users to the next truthful action", () => {
  assert.equal(resolveOnboardingConnectionReadiness({ connectedCount: 0, health: [] }).nextAction, "open_connection_center");
  assert.equal(resolveOnboardingConnectionReadiness({ connectedCount: 2, health: [{ state: "live_verified" }] }).state, "ready");
  assert.equal(resolveOnboardingConnectionReadiness({ connectedCount: 2, health: [{ state: "live_verified" }, { state: "degraded" }] }).nextAction, "review_connection_health");
});
