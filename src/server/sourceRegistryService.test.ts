import test from "node:test";
import assert from "node:assert/strict";
import type {
  ConnectorDefinition,
  ConnectorRegistrySnapshot,
} from "@shared/connectorRegistry";
import { runWithRequestIdentity } from "./requestContext";
import { getUserScopedConnectorRegistrySnapshot } from "./connectorService";
import type { SourceConnection } from "@shared/schema";
import { buildSourceRegistry } from "./sourceRegistryService";

const connector = (overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition => ({
  id: "demo",
  name: "Demo Source",
  category: "market",
  sourceType: "public_api",
  authMode: "none",
  custodyMode: "public",
  adapterImplemented: true,
  capabilities: [{ contractFamily: "market_prices", fields: ["close"] }],
  setupGuide: "No setup required.",
  builtIn: true,
  ...overrides,
});

const snapshot = (connectors: ConnectorDefinition[], health: ConnectorRegistrySnapshot["health"] = []): ConnectorRegistrySnapshot => ({
  connectors,
  health,
});

const connection = (overrides: Partial<SourceConnection> = {}): SourceConnection => ({
  id: 7,
  userId: 42,
  organizationId: null,
  connectorId: "demo",
  name: "Demo account",
  sourceType: "public_api",
  config: { endpoint: "https://example.invalid", region: "us" },
  credentialRef: "vault:secret-demo",
  status: "healthy",
  lastTestedAt: new Date("2026-09-06T10:00:00.000Z"),
  lastHealthyAt: new Date("2026-09-06T10:00:00.000Z"),
  statusDetail: "Live check succeeded.",
  createdAt: new Date("2026-09-06T09:00:00.000Z"),
  updatedAt: new Date("2026-09-06T10:00:00.000Z"),
  ...overrides,
});

test("groups catalog sources and saved connections without exposing secrets", () => {
  const result = buildSourceRegistry(
    snapshot([
      connector(),
      connector({ id: "macro-demo", name: "Macro Demo", category: "macro", sourceType: "public_api" }),
      connector({ id: "cloud-demo", name: "Cloud Demo", category: "private_data", sourceType: "cloud_storage", adapterImplemented: false }),
      connector({ id: "file-demo", name: "File Demo", category: "operations", sourceType: "file" }),
      connector({ id: "private-demo", name: "Private Demo", category: "private_data", sourceType: "private_api" }),
    ], [
      { connectorId: "demo", state: "live_verified", detail: "Verified now.", checkedAt: "2026-09-06T10:30:00.000Z", adapterImplemented: true, lastVerifiedAt: "2026-09-06T10:30:00.000Z" },
    ]),
    [connection()],
    "2026-09-06T10:30:00.000Z",
  );

  assert.deepEqual(result.groups.map((group) => group.id), ["files", "finance_market", "economic_public", "custom", "cloud"]);
  assert.equal(result.groups.find((group) => group.id === "files")?.items.some((item) => item.connectorId === "file-demo"), true);
  assert.equal(result.groups.find((group) => group.id === "economic_public")?.items.some((item) => item.connectorId === "macro-demo"), true);
  assert.equal(result.groups.find((group) => group.id === "custom")?.items.some((item) => item.connectorId === "private-demo"), true);
  assert.equal(result.groups.find((group) => group.id === "cloud")?.items.some((item) => item.connectorId === "cloud-demo"), true);

  // A connected single-credential provider has exactly one card: its saved connection.
  const demoItems = result.groups.flatMap((group) => group.items).filter((item) => item.connectorId === "demo");
  assert.deepEqual(demoItems.map((item) => item.kind), ["connection"]);
  // Unconnected providers keep their catalog tile.
  assert.equal(result.groups.flatMap((group) => group.items).some((item) => item.kind === "catalog" && item.connectorId === "macro-demo"), true);

  const saved = result.groups.flatMap((group) => group.items).find((item) => item.connectionId === 7);
  assert.equal(saved?.kind, "connection");
  assert.equal(saved?.state, "healthy");
  assert.equal(saved?.connected, true);
  assert.equal(saved?.operational, true);
  assert.equal(saved?.detail, "Live check succeeded.");
  assert.equal(JSON.stringify(saved).includes("vault:secret-demo"), false);
  assert.equal(JSON.stringify(saved).includes("https://example.invalid"), false);
});

test("keeps untested and failed states distinct from live verification", () => {
  const result = buildSourceRegistry(
    snapshot([
      connector({ id: "untested", name: "Untested", sourceType: "keyed_api", authMode: "api_key", adapterImplemented: true }),
      connector({ id: "failed", name: "Failed", sourceType: "keyed_api", authMode: "api_key", adapterImplemented: true }),
      connector({ id: "catalog", name: "Catalog", adapterImplemented: false }),
    ], [
      { connectorId: "untested", state: "credential_configured", detail: "Credential configured; live check pending.", checkedAt: null, adapterImplemented: true, lastVerifiedAt: null },
      { connectorId: "failed", state: "degraded", detail: "Vendor request failed.", checkedAt: "2026-09-06T10:00:00.000Z", adapterImplemented: true, lastVerifiedAt: null },
      { connectorId: "catalog", state: "catalog_only", detail: "No adapter is implemented.", checkedAt: null, adapterImplemented: false, lastVerifiedAt: null },
    ]),
    [],
    "2026-09-06T10:30:00.000Z",
  );

  const items = result.groups.flatMap((group) => group.items);
  assert.equal(items.find((item) => item.connectorId === "untested")?.state, "credential_configured");
  assert.equal(items.find((item) => item.connectorId === "untested")?.operational, true);
  assert.equal(items.find((item) => item.connectorId === "failed")?.state, "degraded");
  assert.equal(items.find((item) => item.connectorId === "failed")?.operational, false);
  assert.equal(items.find((item) => item.connectorId === "untested")?.lastCheckedAt, null);
  assert.equal(items.find((item) => item.connectorId === "failed")?.lastCheckedAt, "2026-09-06T10:00:00.000Z");
  assert.equal(items.find((item) => item.connectorId === "catalog")?.state, "catalog_only");
  assert.equal(items.find((item) => item.connectorId === "catalog")?.connected, false);
  const catalog = items.find((item) => item.connectorId === "catalog");
  assert.equal(catalog?.lastCheckedAt, null);
  assert.equal(catalog?.lastHealthyAt, null);
});

test("uses a safe catalog fallback when runtime health is missing", () => {
  const result = buildSourceRegistry(snapshot([
    connector({ id: "available", adapterImplemented: true }),
    connector({ id: "planned", adapterImplemented: false }),
  ]), [], "2026-09-06T10:30:00.000Z");
  const items = result.groups.flatMap((group) => group.items);

  assert.equal(items.find((item) => item.connectorId === "available")?.state, "adapter_available");
  assert.equal(items.find((item) => item.connectorId === "planned")?.state, "catalog_only");
  assert.equal(result.generatedAt, "2026-09-06T10:30:00.000Z");
  assert.equal(result.summary.connectionCount, 0);
});

test("maps file and database connections into their operational groups", () => {
  const result = buildSourceRegistry(
    snapshot([
      connector({ id: "upload", name: "Upload", sourceType: "file", category: "operations" }),
      connector({ id: "warehouse", name: "Warehouse", sourceType: "database", category: "private_data" }),
    ]),
    [
      connection({ id: 10, connectorId: "upload", name: "Quarterly CSV", sourceType: "file", status: "configured", statusDetail: "Awaiting import." }),
      connection({ id: 11, connectorId: "warehouse", name: "Warehouse DB", sourceType: "database", status: "unreachable", statusDetail: "Connection refused." }),
    ],
    "2026-09-06T10:30:00.000Z",
  );
  const items = result.groups.flatMap((group) => group.items);

  assert.equal(items.find((item) => item.connectionId === 10)?.group, "files");
  assert.equal(items.find((item) => item.connectionId === 11)?.group, "custom");
  assert.equal(items.find((item) => item.connectionId === 11)?.operational, false);
  assert.equal(items.find((item) => item.connectionId === 10)?.operational, false);
  assert.equal(result.summary.attentionCount, 1);
});

test("uses hosted organization credentials for user-scoped connector health", async () => {
  const previousStore = process.env.LIMURIA_CREDENTIAL_STORE;
  process.env.LIMURIA_CREDENTIAL_STORE = "organization";
  try {
    const snapshot = await runWithRequestIdentity({
      userId: 42,
      organizationId: 7,
      credentials: { polygonApiKey: "organization-test-key" },
      selectedConnectorIds: [],
    }, () => getUserScopedConnectorRegistrySnapshot());
    const polygon = snapshot.health.find((item) => item.connectorId === "polygon");

    assert.equal(polygon?.state, "credential_configured");
    assert.equal(polygon?.lastVerifiedAt, null);
  } finally {
    if (previousStore === undefined) delete process.env.LIMURIA_CREDENTIAL_STORE;
    else process.env.LIMURIA_CREDENTIAL_STORE = previousStore;
  }
});

test("a connected keyed AI provider shows one card, while multi-instance sources keep their add tile", () => {
  const result = buildSourceRegistry(
    snapshot([
      connector({ id: "gemini", name: "Google Gemini", category: "ai", sourceType: "keyed_api" }),
      connector({ id: "openai", name: "OpenAI", category: "ai", sourceType: "keyed_api" }),
      connector({ id: "sql", name: "SQL database", category: "private_data", sourceType: "database" }),
    ]),
    [
      connection({ id: 1, connectorId: "gemini", name: "Google Gemini", sourceType: "keyed_api" }),
      connection({ id: 2, connectorId: "sql", name: "Warehouse", sourceType: "database" }),
    ],
  );
  const items = result.groups.flatMap((group) => group.items);
  assert.deepEqual(items.filter((item) => item.connectorId === "gemini").map((item) => item.kind), ["connection"]);
  assert.deepEqual(items.filter((item) => item.connectorId === "openai").map((item) => item.kind), ["catalog"]);
  assert.deepEqual(items.filter((item) => item.connectorId === "sql").map((item) => item.kind).sort(), ["catalog", "connection"]);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length, "every card id is unique");
});
