import test from "node:test";
import assert from "node:assert/strict";
import { canonicalDataRequestSchema } from "@shared/universalDataFabric";
import {
  buildImfDataMapperUrl,
  createImfDataProviderAdapter,
  parseImfDataMapperJson,
  resolveImfDataMapperTarget,
} from "./imfDataProvider";
import { createNativeProviderAdapters } from "./providerSdk";

function request(overrides: Record<string, unknown> = {}) {
  return canonicalDataRequestSchema.parse({
    schemaVersion: "1",
    requestId: "22222222-2222-4222-8222-222222222222",
    projectId: null,
    capability: "macro",
    entity: {
      ref: "IMF:NGDP_RPCH:USA,IND",
      symbol: null,
      identifiers: {},
    },
    fields: [],
    parameters: {},
    pointInTime: {
      mode: "latest",
      asKnownOn: null,
      revision: null,
      requirePublicationTime: false,
      allowLaterRevisions: false,
    },
    providerAllow: [],
    providerDeny: [],
    ...overrides,
  });
}

test("IMF target resolution accepts an explicit bounded DataMapper reference", () => {
  assert.deepEqual(resolveImfDataMapperTarget(request()), {
    indicator: "NGDP_RPCH",
    entities: ["USA", "IND"],
  });
});

test("IMF target resolution accepts explicit request parameters", () => {
  const parsed = request({
    entity: { ref: "global-growth", symbol: null, identifiers: {} },
    parameters: { indicator: "PCPIPCH", countries: ["USA", "GBR"] },
  });
  assert.deepEqual(resolveImfDataMapperTarget(parsed), {
    indicator: "PCPIPCH",
    entities: ["USA", "GBR"],
  });
});

test("IMF DataMapper URL uses current v2 base and bounds requested periods", () => {
  const url = buildImfDataMapperUrl(request({
    parameters: { periods: ["2024", "2025", "2026"] },
  }));
  assert.equal(
    url,
    "https://www.imf.org/external/datamapper/api/v2/NGDP_RPCH/USA/IND?periods=2024%2C2025%2C2026",
  );
});

test("IMF parser flattens requested entity/year values and ignores invalid observations", () => {
  const target = { indicator: "NGDP_RPCH", entities: ["USA", "IND"] };
  const observations = parseImfDataMapperJson(JSON.stringify({
    values: {
      NGDP_RPCH: {
        USA: { "2024": 2.8, "2025": "2.1", note: "ignore" },
        IND: { "2024": 6.5, "2025": null },
      },
    },
    api: { version: "2" },
  }), target);

  assert.deepEqual(observations, [
    { entityCode: "IND", year: "2024", value: 6.5 },
    { entityCode: "USA", year: "2024", value: 2.8 },
    { entityCode: "USA", year: "2025", value: 2.1 },
  ]);
});

test("IMF adapter returns normalized macro observations with source provenance", async () => {
  let fetchedUrl = "";
  const adapter = createImfDataProviderAdapter(async (url) => {
    fetchedUrl = url;
    return JSON.stringify({ values: { NGDP_RPCH: { USA: { "2026": 2.3 }, IND: { "2026": 6.4 } } } });
  });

  const result = await adapter.fetch(request(), {} as never);
  assert.ok(result);
  assert.equal(result?.providerId, "imf");
  assert.equal(result?.normalized, true);
  assert.deepEqual(result?.sourceRefs, [fetchedUrl]);
  assert.equal((result?.data as { apiVersion: string }).apiVersion, "v2");
  assert.equal((result?.data as { observations: unknown[] }).observations.length, 2);
});

test("IMF adapter fails closed when indicator or entity codes are not explicit", async () => {
  const adapter = createImfDataProviderAdapter(async () => {
    throw new Error("fetch must not be called");
  });
  const result = await adapter.fetch(request({
    entity: { ref: "generic-macro-series", symbol: null, identifiers: {} },
  }), {} as never);
  assert.equal(result, null);
});

test("canonical native provider registry exposes the IMF macro adapter", () => {
  const adapter = createNativeProviderAdapters().find((candidate) => candidate.id === "imf");
  assert.ok(adapter);
  assert.ok(adapter?.capabilities.includes("macro"));
});
