import test from "node:test";
import assert from "node:assert/strict";
import { canonicalDataRequestSchema } from "@shared/universalDataFabric";
import {
  buildEcbDataUrl,
  createEcbDataProviderAdapter,
  parseEcbCsv,
  resolveEcbSeriesTarget,
} from "./ecbDataProvider";
import { createNativeProviderAdapters } from "./providerSdk";

function request(overrides: Record<string, unknown> = {}) {
  return canonicalDataRequestSchema.parse({
    schemaVersion: "1",
    requestId: "11111111-1111-4111-8111-111111111111",
    projectId: null,
    capability: "macro",
    entity: {
      ref: "ECB:EXR:M.USD.EUR.SP00.A",
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

test("ECB target resolution accepts explicit canonical provider refs", () => {
  assert.deepEqual(resolveEcbSeriesTarget(request()), {
    flowRef: "EXR",
    seriesKey: "M.USD.EUR.SP00.A",
  });
});

test("ECB target resolution accepts explicit request parameters", () => {
  const parsed = request({
    entity: { ref: "euro-area-policy-rate", symbol: null, identifiers: {} },
    parameters: { dataflow: "FM", seriesKey: "M.U2.EUR.4F.KR.MRR_FR.LEV" },
  });
  assert.deepEqual(resolveEcbSeriesTarget(parsed), {
    flowRef: "FM",
    seriesKey: "M.U2.EUR.4F.KR.MRR_FR.LEV",
  });
});

test("ECB data URL is bounded and uses the official csvdata query contract", () => {
  const url = buildEcbDataUrl(request({
    parameters: {
      startPeriod: "2026-01",
      endPeriod: "2026-08",
      lastNObservations: 12,
    },
  }));
  assert.equal(
    url,
    "https://data-api.ecb.europa.eu/service/data/EXR/M.USD.EUR.SP00.A?format=csvdata&detail=dataonly&startPeriod=2026-01&endPeriod=2026-08&lastNObservations=12",
  );
});

test("ECB CSV parser keeps dimensions and parses numeric observations", () => {
  const rows = parseEcbCsv([
    "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
    "EXR.M.USD.EUR.SP00.A,M,USD,EUR,SP00,A,2026-07,0.8621",
    "EXR.M.USD.EUR.SP00.A,M,USD,EUR,SP00,A,2026-08,0.8550",
  ].join("\n"));

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.timePeriod, "2026-07");
  assert.equal(rows[0]?.value, 0.8621);
  assert.equal(rows[0]?.dimensions.CURRENCY, "USD");
  assert.equal(rows[0]?.dimensions.CURRENCY_DENOM, "EUR");
});

test("ECB adapter returns normalized macro observations and source provenance", async () => {
  let fetchedUrl = "";
  const adapter = createEcbDataProviderAdapter(async (url) => {
    fetchedUrl = url;
    return [
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE",
      "EXR.M.USD.EUR.SP00.A,M,USD,EUR,SP00,A,2026-08,0.8550",
    ].join("\n");
  });

  const result = await adapter.fetch(request(), {} as never);
  assert.ok(result);
  assert.equal(result?.providerId, "ecb");
  assert.equal(result?.normalized, true);
  assert.deepEqual(result?.sourceRefs, [fetchedUrl]);
  assert.equal((result?.data as { observations: Array<{ value: number }> }).observations[0]?.value, 0.855);
});

test("ECB adapter fails closed when no dataflow and series key are supplied", async () => {
  const adapter = createEcbDataProviderAdapter(async () => {
    throw new Error("fetch must not be called");
  });
  const result = await adapter.fetch(request({
    entity: { ref: "generic-macro-series", symbol: null, identifiers: {} },
  }), {} as never);
  assert.equal(result, null);
});


test("canonical native provider registry exposes the ECB macro adapter", () => {
  const adapter = createNativeProviderAdapters().find((candidate) => candidate.id === "ecb");
  assert.ok(adapter);
  assert.ok(adapter?.capabilities.includes("macro"));
});
