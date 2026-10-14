import test from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_CATALOG } from "./providerCatalog";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";

test("RBI stays catalog-only until a stable documented public machine API is implemented", () => {
  const connector = BUILT_IN_CONNECTORS.find((item) => item.id === "rbi");
  assert.ok(connector);
  assert.equal(connector?.adapterImplemented, false);
  assert.equal(connector?.websiteUrl, "https://data.rbi.org.in");
  assert.doesNotMatch(connector?.setupGuide ?? "", /uses the RBI DBIE.*API/i);

  const catalog = PROVIDER_CATALOG.find((item) => item.id === "rbi");
  assert.ok(catalog);
  assert.equal(catalog?.defaultEndpoint, "https://data.rbi.org.in");
  assert.doesNotMatch(catalog?.defaultEndpoint ?? "", /api\.rbi\.org\.in/i);
});
