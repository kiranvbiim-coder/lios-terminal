import assert from "node:assert/strict";
import test from "node:test";
import type { SourceRegistryItem } from "@shared/sourceRegistry";
import { sourceCatalogueCoverage, sourceCatalogueStatus } from "./sourceCatalogueStatus";

function item(override: Partial<SourceRegistryItem> = {}): SourceRegistryItem {
  return {
    id: "catalog:test", connectorId: "test", name: "Example",
    kind: "catalog", group: "finance_market", sourceType: "keyed_api",
    category: "market", state: "adapter_available", detail: "Listed source",
    connected: false, operational: false, adapterImplemented: true,
    capabilities: [], connectionId: null, licenseCaveat: null,
    lastCheckedAt: null, lastHealthyAt: null,
    ...override,
  };
}

test("WS-28 distinguishes catalog, adapter health and actual saved connection", () => {
  const catalog = sourceCatalogueStatus(item());
  assert.match(catalog.connection, /not saved/);
  assert.match(catalog.runtime, /not verified/);
  const verifiedCatalog = sourceCatalogueStatus(item({ state: "live_verified", operational: true }));
  assert.match(verifiedCatalog.runtime, /recently verified/);
  assert.match(verifiedCatalog.connection, /not saved/);

  const connected = sourceCatalogueStatus(item({
    kind: "connection", connected: true, operational: true,
    id: "connection:7", connectionId: 7, state: "healthy",
  }));
  assert.match(connected.connection, /Saved connection/);
  assert.match(connected.runtime, /Last connection test healthy/);
  assert.equal(connected.requiresAttention, false);
});

test("WS-28 impossible readiness claims fail closed when no runnable adapter exists", () => {
  const missingAdapter = sourceCatalogueStatus(item({
    kind: "connection", connected: true, operational: true,
    state: "healthy", adapterImplemented: false,
  }));
  assert.match(missingAdapter.runtime, /No runtime adapter/);
  assert.equal(missingAdapter.requiresAttention, true);
  const unverified = sourceCatalogueStatus(item({
    kind: "connection", connected: true, operational: false, state: "configured",
  }));
  assert.match(unverified.runtime, /not verified/);
  assert.equal(unverified.requiresAttention, true);
  for (const state of ["unreachable", "invalid", "degraded"] as const) {
    assert.equal(sourceCatalogueStatus(item({ kind: "connection", state, connected: true })).requiresAttention, true);
  }
});

test("WS-28 displays only canonical capabilities and does not infer entitlement", () => {
  const coverage = sourceCatalogueCoverage(item({
    capabilities: [
      { contractFamily: "market", fields: ["quote"], coverage: "US" },
      { contractFamily: "market", fields: ["trade"] },
      { contractFamily: "filings", fields: ["annual"] },
      { contractFamily: "research" },
      { contractFamily: "macro" },
    ],
  }));
  assert.equal(coverage, "market · filings · research · +1 more");
  assert.equal(sourceCatalogueCoverage(item()), null);
});
