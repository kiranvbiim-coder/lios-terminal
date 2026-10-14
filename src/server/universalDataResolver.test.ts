import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorRegistrySnapshot } from "@shared/connectorRegistry";
import { planUniversalDataFromSnapshot } from "./universalDataResolver";

const snapshot: ConnectorRegistrySnapshot = {
  connectors: [
    {
      id: "yahoo_finance",
      name: "Yahoo Finance",
      category: "market",
      sourceType: "public_api",
      authMode: "none",
      custodyMode: "public",
      adapterImplemented: true,
      capabilities: [
        { contractFamily: "market_data", fields: ["quote", "ohlcv"], coverage: "global" },
        { contractFamily: "price_history", fields: ["ohlcv"], coverage: "global" },
      ],
      setupGuide: "No key required.",
      builtIn: true,
    },
    {
      id: "twelve_data",
      name: "Twelve Data",
      category: "market",
      sourceType: "keyed_api",
      authMode: "api_key",
      custodyMode: "public",
      adapterImplemented: true,
      envKey: "TWELVE_DATA_API_KEY",
      vaultKey: "twelveDataApiKey",
      capabilities: [
        { contractFamily: "market_data", fields: ["quote"], coverage: "global" },
        { contractFamily: "price_history", fields: ["ohlcv"], coverage: "global" },
      ],
      setupGuide: "Add key.",
      builtIn: true,
    },
    {
      id: "fmp",
      name: "Financial Modeling Prep",
      category: "fundamentals",
      sourceType: "keyed_api",
      authMode: "api_key",
      custodyMode: "public",
      adapterImplemented: true,
      envKey: "FMP_API_KEY",
      vaultKey: "fmpApiKey",
      capabilities: [
        { contractFamily: "market_data", fields: ["quote"], coverage: "global" },
        { contractFamily: "financial_statements", fields: ["income_statement"], coverage: "global" },
      ],
      setupGuide: "Add key.",
      builtIn: true,
    },
    {
      id: "client_file",
      name: "Client File",
      category: "private_data",
      sourceType: "file",
      authMode: "local",
      custodyMode: "local_only",
      adapterImplemented: true,
      capabilities: [{ contractFamily: "private_data", fields: ["table"], coverage: "user file" }],
      setupGuide: "Import a file.",
      builtIn: true,
    },
  ],
  health: [
    {
      connectorId: "yahoo_finance",
      state: "live_verified",
      detail: "Live request succeeded.",
      checkedAt: "2026-09-26T00:00:00.000Z",
      adapterImplemented: true,
      lastVerifiedAt: "2026-09-26T00:00:00.000Z",
    },
    {
      connectorId: "twelve_data",
      state: "adapter_available",
      detail: "Credential missing.",
      checkedAt: "2026-09-26T00:00:00.000Z",
      adapterImplemented: true,
      lastVerifiedAt: null,
    },
    {
      connectorId: "fmp",
      state: "live_verified",
      detail: "FMP is live for its wired paths.",
      checkedAt: "2026-09-26T00:00:00.000Z",
      adapterImplemented: true,
      lastVerifiedAt: "2026-09-26T00:00:00.000Z",
    },
    {
      connectorId: "client_file",
      state: "adapter_available",
      detail: "Import a file.",
      checkedAt: "2026-09-26T00:00:00.000Z",
      adapterImplemented: true,
      lastVerifiedAt: null,
    },
  ],
};

function pricesRequest(input: {
  requestId: string;
  symbol: string;
  fields: string[];
  sourceScope: "auto" | "my_data" | "web" | "files";
  allowPartial: boolean;
}) {
  return {
    schemaVersion: "1" as const,
    requestId: input.requestId,
    projectId: null,
    capability: "prices" as const,
    entity: { ref: input.symbol, symbol: input.symbol, identifiers: {} },
    fields: input.fields,
    parameters: {},
    pointInTime: {
      mode: "latest" as const,
      asKnownOn: null,
      revision: null,
      requirePublicationTime: false,
      allowLaterRevisions: false,
    },
    providerAllow: [],
    providerDeny: [],
    sourceScope: input.sourceScope,
    allowPartial: input.allowPartial,
    maxAgeMs: null,
  };
}

test("P3 universal data plan resolves operational providers and missing fields honestly", () => {
  const plan = planUniversalDataFromSnapshot(pricesRequest({
    requestId: "f1ef0375-acde-4ff0-8979-09f9bad64386",
    symbol: "AAPL",
    fields: ["quote", "ohlcv", "fundamentals"],
    sourceScope: "web",
    allowPartial: true,
  }), snapshot);

  assert.equal(plan.availability, "partial");
  assert.deepEqual(plan.selectedCandidateIds, ["yahoo_finance"]);
  assert.deepEqual(plan.missingFields, ["fundamentals"]);
  assert.equal(plan.candidates.find((item) => item.connectorId === "yahoo_finance")?.operational, true);
  assert.equal(plan.candidates.find((item) => item.connectorId === "twelve_data")?.requiresConnection, true);
});

test("P3 source scope blocks external providers instead of silently broadening", () => {
  const plan = planUniversalDataFromSnapshot(pricesRequest({
    requestId: "6b18fc91-c113-454c-afeb-f190c13eadc4",
    symbol: "AAPL",
    fields: ["quote"],
    sourceScope: "my_data",
    allowPartial: false,
  }), snapshot);

  assert.equal(plan.availability, "source_scope_blocked");
  assert.equal(plan.selectedCandidateIds.length, 0);
  assert.equal(plan.recoveryActions.includes("Switch source scope to Auto"), true);
});

test("P3 connector recovery is contextual when a compatible provider is not connected", () => {
  const disconnected: ConnectorRegistrySnapshot = {
    connectors: snapshot.connectors.filter((item) => item.id === "twelve_data"),
    health: snapshot.health.filter((item) => item.connectorId === "twelve_data"),
  };
  const plan = planUniversalDataFromSnapshot(pricesRequest({
    requestId: "54fbe0f5-4786-41ef-a026-8c51168aac8b",
    symbol: "MSFT",
    fields: ["quote"],
    sourceScope: "web",
    allowPartial: false,
  }), disconnected);

  assert.equal(plan.availability, "not_connected");
  assert.equal(plan.recoveryActions.includes("Connect twelve_data"), true);
  assert.equal(plan.recoveryActions.includes("Open Connection Center"), true);
});

test("P3 provider allow/deny rules from canonical data fabric are honored", () => {
  const request = {
    ...pricesRequest({
      requestId: "0c87298d-a6fa-4d96-a530-071f2c25ee59",
      symbol: "AAPL",
      fields: ["quote"],
      sourceScope: "web",
      allowPartial: false,
    }),
    providerAllow: ["twelve_data"],
  };
  const plan = planUniversalDataFromSnapshot(request, snapshot);

  assert.equal(plan.candidates.some((item) => item.connectorId === "yahoo_finance"), false);
  assert.equal(plan.candidates.some((item) => item.connectorId === "twelve_data"), true);
  assert.equal(plan.availability, "not_connected");
});


test("P3 price planning does not advertise connectors outside the active LiOS price router", () => {
  const plan = planUniversalDataFromSnapshot(pricesRequest({
    requestId: "be15a556-4d6f-4266-a8ef-7b93dbeef8e7",
    symbol: "AAPL",
    fields: ["quote"],
    sourceScope: "web",
    allowPartial: false,
  }), snapshot);

  assert.equal(plan.candidates.some((item) => item.connectorId === "fmp"), false);
  assert.equal(plan.candidates.some((item) => item.connectorId === "yahoo_finance"), true);
});
