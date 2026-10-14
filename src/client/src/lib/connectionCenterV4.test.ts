import assert from "node:assert/strict";
import test from "node:test";
import { sourceBelongsToConnectionCategory } from "./connectionCenterV4";
import type { SourceRegistryItem } from "@shared/sourceRegistry";

function item(overrides: Partial<SourceRegistryItem>): SourceRegistryItem {
  return {
    id: "item",
    connectorId: "connector",
    name: "Example",
    kind: "catalog",
    group: "custom",
    sourceType: "private_api",
    category: "private_data",
    state: "adapter_available",
    detail: "Example",
    connected: false,
    operational: false,
    adapterImplemented: true,
    capabilities: [],
    licenseCaveat: null,
    connectionId: null,
    lastCheckedAt: null,
    lastHealthyAt: null,
    ...overrides,
  };
}

test("LV4-06-01 maps provider, database, file and AI sources into mutually appropriate V4 categories", () => {
  const provider = item({ sourceType: "keyed_api", category: "market" });
  const database = item({ sourceType: "database", category: "private_data" });
  const file = item({ sourceType: "file", category: "private_data" });
  const storage = item({ sourceType: "cloud_storage", category: "private_data" });
  const ai = item({ sourceType: "local_model", category: "ai" });

  assert.equal(sourceBelongsToConnectionCategory(provider, "data_providers"), true);
  assert.equal(sourceBelongsToConnectionCategory(provider, "databases"), false);
  assert.equal(sourceBelongsToConnectionCategory(database, "databases"), true);
  assert.equal(sourceBelongsToConnectionCategory(file, "files"), true);
  assert.equal(sourceBelongsToConnectionCategory(storage, "files"), true);
  assert.equal(sourceBelongsToConnectionCategory(ai, "ai_providers"), true);
});

test("LV4-06-01 does not fabricate communication connectors before LV4-06-09", () => {
  const arbitrary = item({ sourceType: "private_api", category: "platform" });
  assert.equal(sourceBelongsToConnectionCategory(arbitrary, "communications"), false);
});
