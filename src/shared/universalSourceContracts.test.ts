import assert from "node:assert/strict";
import test from "node:test";
import { buildCapabilityManifestV2 } from "./dataFabric";
import { buildExtendedFieldCatalog, searchExtendedFieldCatalog } from "./extendedFieldCatalog";
import { discoverProviderSchema } from "./dataMapping";
import { routeSource } from "./sourceRouter";
import { BUILT_IN_CONNECTORS } from "./connectorRegistry";

const fred = BUILT_IN_CONNECTORS.find((connector) => connector.id === "fred")!;
const fredManifest = buildCapabilityManifestV2(fred, "live_verified");

test("source router selects only operational and explicitly entitled providers", () => {
  const denied = routeSource("macro", [{ connectorId: "fred", providerName: "FRED", contractFamily: "macro", manifest: fredManifest, runtimeState: "live_verified", entitlement: "denied" }]);
  assert.equal(denied.selected, null);
  assert.match(denied.reason, /No eligible source/);

  const unknown = routeSource("macro", [{ connectorId: "fred", providerName: "FRED", contractFamily: "macro", manifest: fredManifest, runtimeState: "live_verified", entitlement: "unknown" }]);
  assert.equal(unknown.selected, null);
  assert.match(unknown.considered[0]?.reason ?? "", /entitlement is unknown/i);

  const allowed = routeSource("macro", [{ connectorId: "fred", providerName: "FRED", contractFamily: "macro", manifest: fredManifest, runtimeState: "live_verified", entitlement: "allowed", priority: 10 }]);
  assert.equal(allowed.selected?.connectorId, "fred");
  assert.equal(allowed.considered[0]?.status, "selected");
});

test("source router is deterministic and respects field-level coverage", () => {
  const candidate = { connectorId: "fred", providerName: "FRED", contractFamily: "macro", manifest: fredManifest, runtimeState: "credential_configured" as const, entitlement: "allowed" as const };
  assert.equal(routeSource("macro", [candidate], { field: "gdp" }).selected?.connectorId, "fred");
  assert.equal(routeSource("macro", [candidate], { field: "unknown_field" }).selected, null);
  assert.equal(routeSource("market_data", [candidate]).selected, null);
});

test("extended field catalog preserves provider namespace and supports search", () => {
  const first = discoverProviderSchema({ providerId: "provider_a", datasetKey: "prices", contractFamily: "market_data", fields: [{ providerField: "vendor_signal_42", inferredType: "number" }] });
  const second = discoverProviderSchema({ providerId: "provider_a", datasetKey: "prices", contractFamily: "market_data", fields: [{ providerField: "vendor_signal_42", inferredType: "number" }, { providerField: "vendor_spread", inferredType: "number" }] });
  const catalog = buildExtendedFieldCatalog([first, second], "2026-09-17T00:00:00.000Z");
  assert.deepEqual(catalog.map((entry) => entry.id), ["provider_a:vendor_signal_42", "provider_a:vendor_spread"]);
  assert.equal(searchExtendedFieldCatalog(catalog, "spread")[0]?.providerField, "vendor_spread");
  assert.equal(searchExtendedFieldCatalog(catalog, "signal", "other").length, 0);
});
