import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_CONNECTORS, getConnectorLicenseCaveat, isConnectorRuntimeOperational, type ConnectorRuntimeReport } from "@shared/connectorRegistry";
import { getConnectorById, getConnectorRuntimeState, getConnectorsByCapability, getConnectorRegistrySnapshot, getOperationalConnectorIds } from "./connectorService";
import { recordConnectorVerification, resetConnectorVerificationsForTests } from "./connectorVerification";

function withoutEnv(keys: string[], fn: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  return fn().finally(() => {
    for (const key of keys) {
      if (previous[key] !== undefined) process.env[key] = previous[key];
    }
  });
}

function withEnv(vars: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test("built-in connector ids are unique", () => {
  const ids = BUILT_IN_CONNECTORS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate connector id");
});

test("every keyed connector has envKey and vaultKey", () => {
  for (const c of BUILT_IN_CONNECTORS) {
    if (c.sourceType === "keyed_api") {
      assert.ok(c.envKey, `${c.id} missing envKey`);
      assert.ok(c.vaultKey, `${c.id} missing vaultKey`);
    }
  }
});

test("every connector has at least one capability", () => {
  for (const c of BUILT_IN_CONNECTORS) {
    assert.ok(c.capabilities.length > 0, `${c.id} has no capabilities`);
  }
});

test("adapterImplemented is declared for every connector, matching the audited real-call-site ground truth", () => {
  const expectedImplemented = new Set([
    "fred", "finnhub", "lse", "simfin", "fmp", "openfigi", "sec_edgar", "world_bank", "bls",
    "yahoo_finance", "bse_india", "stooq", "alpha_vantage", "polygon", "twelve_data", "tiingo", "eodhd",
    "coinmarketcap", "coingecko", "ecb", "oecd", "imf", "anthropic", "gemini", "openai",
    "mistral", "groq", "together",
    "file_upload", "database", "private_api", "cloud_storage", "mcp_source",
  ]);
  const expectedPlaceholder = new Set(["intrinio", "nasdaq_data_link", "rbi"]);
  for (const c of BUILT_IN_CONNECTORS) {
    if (expectedImplemented.has(c.id)) assert.equal(c.adapterImplemented, true, `${c.id} should be adapterImplemented=true`);
    else if (expectedPlaceholder.has(c.id)) assert.equal(c.adapterImplemented, false, `${c.id} should be adapterImplemented=false`);
    else assert.fail(`${c.id} is not covered by the expected implemented/placeholder sets -- update this test`);
  }
  assert.equal(expectedImplemented.size + expectedPlaceholder.size, BUILT_IN_CONNECTORS.length);
});

test("getConnectorById returns correct connector", () => {
  const fred = getConnectorById("fred");
  assert.equal(fred?.name, "FRED (Federal Reserve Economic Data)");
  assert.equal(getConnectorById("nonexistent"), undefined);
});

test("OpenFIGI is a keyed implemented identity connector", () => {
  const openfigi = getConnectorById("openfigi");
  assert.equal(openfigi?.adapterImplemented, true);
  assert.equal(openfigi?.vaultKey, "openFigiApiKey");
  assert.ok(openfigi?.capabilities.some((c) => c.contractFamily === "instrument_identity"));
});

test("getConnectorsByCapability returns matching connectors", () => {
  const macro = getConnectorsByCapability("macro");
  assert.ok(macro.some((c) => c.id === "fred"));
  assert.ok(macro.some((c) => c.id === "world_bank"));
  assert.ok(macro.some((c) => c.id === "bls"));
  assert.ok(!macro.some((c) => c.id === "anthropic"));
});

test("getConnectorsByCapability for financial_statements includes multiple providers", () => {
  const fs = getConnectorsByCapability("financial_statements");
  const ids = fs.map((c) => c.id);
  assert.ok(ids.includes("finnhub"));
  assert.ok(ids.includes("lse"));
  assert.ok(ids.includes("simfin"));
  assert.ok(ids.includes("fmp"));
  assert.ok(ids.includes("sec_edgar"));
  assert.ok(ids.includes("file_upload"));
});

test("getOperationalConnectorIds only counts live_verified and credential_configured", () => {
  const health: ConnectorRuntimeReport[] = [
    { connectorId: "fred", state: "live_verified", detail: "", checkedAt: "", adapterImplemented: true, lastVerifiedAt: "2026-01-01T00:00:00.000Z" },
    { connectorId: "finnhub", state: "adapter_available", detail: "", checkedAt: "", adapterImplemented: true, lastVerifiedAt: null },
    { connectorId: "sec_edgar", state: "credential_configured", detail: "", checkedAt: "", adapterImplemented: true, lastVerifiedAt: null },
    { connectorId: "imf", state: "catalog_only", detail: "", checkedAt: "", adapterImplemented: false, lastVerifiedAt: null },
    { connectorId: "polygon", state: "degraded", detail: "", checkedAt: "", adapterImplemented: true, lastVerifiedAt: null },
    { connectorId: "twelve_data", state: "rate_limited", detail: "", checkedAt: "", adapterImplemented: true, lastVerifiedAt: null },
  ];
  assert.deepEqual(getOperationalConnectorIds(health), ["fred", "sec_edgar"]);
  assert.equal(getConnectorRuntimeState(health, "fred"), "live_verified");
  assert.equal(getConnectorRuntimeState(health, "not_present"), "catalog_only");
});

test("isConnectorRuntimeOperational matches getOperationalConnectorIds's definition", () => {
  assert.equal(isConnectorRuntimeOperational("live_verified"), true);
  assert.equal(isConnectorRuntimeOperational("credential_configured"), true);
  assert.equal(isConnectorRuntimeOperational("adapter_available"), false);
  assert.equal(isConnectorRuntimeOperational("catalog_only"), false);
  assert.equal(isConnectorRuntimeOperational("degraded"), false);
  assert.equal(isConnectorRuntimeOperational("rate_limited"), false);
  assert.equal(isConnectorRuntimeOperational("disabled"), false);
});

test("getConnectorLicenseCaveat prefers explicit licenseNotes, then custody/free-tier framing, else null", () => {
  const withNotes = getConnectorById("fred")!;
  assert.equal(getConnectorLicenseCaveat({ ...withNotes, licenseNotes: "Explicit vendor terms." }), "Explicit vendor terms.");
  const userLicensed = { ...getConnectorById("lse")!, licenseNotes: undefined };
  assert.match(getConnectorLicenseCaveat(userLicensed) ?? "", /own account with the vendor/);
  const publicFreeTier = getConnectorById("world_bank")!;
  assert.match(getConnectorLicenseCaveat(publicFreeTier) ?? "", /Free\/public-tier data source/);
  const noFreeTier = { ...getConnectorById("intrinio")!, custodyMode: "public" as const, freeTier: false };
  assert.equal(getConnectorLicenseCaveat(noFreeTier), null);
});

test("credential secrets never appear in connector definitions", () => {
  const json = JSON.stringify(BUILT_IN_CONNECTORS);
  // Verify no actual secret values leak — only key names like envKey/vaultKey
  assert.ok(!json.includes("password"), "password found in connector definitions");
  assert.ok(!json.includes("secret"), "secret found in connector definitions");
});

test("catalog-only connectors report catalog_only regardless of credential presence", async () => {
  resetConnectorVerificationsForTests();
  const snapshot = await getConnectorRegistrySnapshot();
  for (const id of ["intrinio", "nasdaq_data_link", "rbi"]) {
    const report = snapshot.health.find((h) => h.connectorId === id);
    assert.equal(report?.state, "catalog_only", `${id} should be catalog_only`);
    assert.equal(report?.adapterImplemented, false);
  }
});

test("BYOAI keyed connectors with real adapters but no credential report adapter_available, never a fabricated healthy state", async () => {
  resetConnectorVerificationsForTests();
  await withoutEnv(["MISTRAL_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY"], async () => {
    const snapshot = await getConnectorRegistrySnapshot();
    for (const id of ["mistral", "groq", "together"]) {
      const report = snapshot.health.find((h) => h.connectorId === id);
      assert.equal(report?.state, "adapter_available", `${id} should be adapter_available`);
      assert.equal(report?.adapterImplemented, true);
    }
  });
});

test("IMF is an implemented public no-key connector, same as ECB/OECD", async () => {
  resetConnectorVerificationsForTests();
  const snapshot = await getConnectorRegistrySnapshot();
  const report = snapshot.health.find((h) => h.connectorId === "imf");
  assert.equal(report?.state, "credential_configured");
  assert.equal(report?.adapterImplemented, true);
  assert.equal(report?.lastVerifiedAt, null);
});

test("an implemented public no-key connector is ready but not live-verified before a real call", async () => {
  resetConnectorVerificationsForTests();
  const snapshot = await getConnectorRegistrySnapshot();
  const report = snapshot.health.find((h) => h.connectorId === "ecb");
  assert.equal(report?.state, "credential_configured");
  assert.equal(report?.adapterImplemented, true);
  assert.equal(report?.lastVerifiedAt, null);
});

test("a keyed connector with a real adapter but no credential reports adapter_available, never a fabricated healthy state", async () => {
  resetConnectorVerificationsForTests();
  await withoutEnv(["POLYGON_API_KEY"], async () => {
    const snapshot = await getConnectorRegistrySnapshot();
    const report = snapshot.health.find((h) => h.connectorId === "polygon");
    assert.equal(report?.state, "adapter_available");
    assert.equal(report?.adapterImplemented, true);
  });
});

test("a keyed connector with a credential but no observed real call reports credential_configured, not live_verified", async () => {
  resetConnectorVerificationsForTests();
  await withEnv({ POLYGON_API_KEY: "test-key" }, async () => {
    const snapshot = await getConnectorRegistrySnapshot();
    const report = snapshot.health.find((h) => h.connectorId === "polygon");
    assert.equal(report?.state, "credential_configured");
    assert.equal(report?.lastVerifiedAt, null);
  });
});

test("recording a successful real call promotes state to live_verified with a timestamp", async () => {
  resetConnectorVerificationsForTests();
  await withEnv({ POLYGON_API_KEY: "test-key" }, async () => {
    recordConnectorVerification("polygon", true, "Polygon responded to a live request.");
    const snapshot = await getConnectorRegistrySnapshot();
    const report = snapshot.health.find((h) => h.connectorId === "polygon");
    assert.equal(report?.state, "live_verified");
    assert.ok(report?.lastVerifiedAt);
  });
});

test("recording a failed real call reports degraded, not silently falling back to configured", async () => {
  resetConnectorVerificationsForTests();
  await withEnv({ POLYGON_API_KEY: "test-key" }, async () => {
    recordConnectorVerification("polygon", false, "Polygon returned HTTP 500.");
    const snapshot = await getConnectorRegistrySnapshot();
    const report = snapshot.health.find((h) => h.connectorId === "polygon");
    assert.equal(report?.state, "degraded");
    assert.equal(report?.lastVerifiedAt, null);
    assert.equal(report?.detail, "Polygon returned HTTP 500.");
  });
});
