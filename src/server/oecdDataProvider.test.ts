import test from "node:test";
import assert from "node:assert/strict";
import { canonicalDataRequestSchema } from "@shared/universalDataFabric";
import {
  buildOecdDataUrl,
  createOecdDataProviderAdapter,
  parseOecdCsv,
  resolveOecdDataTarget,
} from "./oecdDataProvider";
import { createNativeProviderAdapters } from "./providerSdk";

function request(overrides: Record<string, unknown> = {}) {
  return canonicalDataRequestSchema.parse({
    schemaVersion: "1",
    requestId: "33333333-3333-4333-8333-333333333333",
    projectId: null,
    capability: "macro",
    entity: {
      ref: "OECD:OECD.SDD.STES:DSD_STES@DF_CLI:.M.LI...AA...H",
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

test("OECD target resolution accepts an explicit Data Explorer developer selection", () => {
  assert.deepEqual(resolveOecdDataTarget(request()), {
    agency: "OECD.SDD.STES",
    dataset: "DSD_STES@DF_CLI",
    version: null,
    selection: ".M.LI...AA...H",
  });
});

test("OECD target resolution accepts explicit request parameters and version", () => {
  const parsed = request({
    entity: { ref: "oecd-series", symbol: null, identifiers: {} },
    parameters: {
      agency: "OECD.SDD.NAD",
      dataset: "DSD_NAMAIN10@DF_TABLE5",
      version: "1.0",
      selection: "A.AUT.S14......XDC.V..",
    },
  });
  assert.deepEqual(resolveOecdDataTarget(parsed), {
    agency: "OECD.SDD.NAD",
    dataset: "DSD_NAMAIN10@DF_TABLE5",
    version: "1.0",
    selection: "A.AUT.S14......XDC.V..",
  });
});

test("OECD URL uses the current public SDMX REST contract and explicit bounds", () => {
  const url = buildOecdDataUrl(request({
    parameters: { startPeriod: "2023-02", endPeriod: "2026-08" },
  }));
  assert.equal(
    url,
    "https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,/.M.LI...AA...H?dimensionAtObservation=AllDimensions&format=csvfilewithlabels&startPeriod=2023-02&endPeriod=2026-08",
  );
});

test("OECD target rejects unbounded all-dataset selections", () => {
  assert.equal(resolveOecdDataTarget(request({
    entity: { ref: "oecd-all", symbol: null, identifiers: {} },
    parameters: { agency: "OECD.SDD.NAD", dataset: "DSD_NAAG@DF_NAAG_I", selection: "all" },
  })), null);
});

test("OECD CSV parser preserves dimensions and omits missing observations", () => {
  const rows = parseOecdCsv([
    "REF_AREA,Reference area,FREQ,Frequency of observation,MEASURE,Measure,TIME_PERIOD,OBS_VALUE",
    "USA,United States,M,Monthly,LI,Leading indicator,2026-07,99.8",
    "USA,United States,M,Monthly,LI,Leading indicator,2026-08,",
    "CAN,Canada,M,Monthly,LI,Leading indicator,2026-08,100.2",
  ].join("\n"));

  assert.deepEqual(rows, [
    {
      timePeriod: "2026-07",
      value: 99.8,
      dimensions: { REF_AREA: "USA", "Reference area": "United States", FREQ: "M", "Frequency of observation": "Monthly", MEASURE: "LI", Measure: "Leading indicator" },
    },
    {
      timePeriod: "2026-08",
      value: 100.2,
      dimensions: { REF_AREA: "CAN", "Reference area": "Canada", FREQ: "M", "Frequency of observation": "Monthly", MEASURE: "LI", Measure: "Leading indicator" },
    },
  ]);
});

test("OECD adapter returns normalized macro observations with exact source provenance", async () => {
  let fetchedUrl = "";
  const adapter = createOecdDataProviderAdapter(async (url) => {
    fetchedUrl = url;
    return [
      "REF_AREA,FREQ,MEASURE,TIME_PERIOD,OBS_VALUE",
      "USA,M,LI,2026-08,99.8",
    ].join("\n");
  });

  const result = await adapter.fetch(request(), {} as never);
  assert.ok(result);
  assert.equal(result?.providerId, "oecd");
  assert.equal(result?.normalized, true);
  assert.deepEqual(result?.sourceRefs, [fetchedUrl]);
  assert.equal((result?.data as { observations: unknown[] }).observations.length, 1);
});

test("canonical native provider registry exposes the OECD macro adapter", () => {
  const adapter = createNativeProviderAdapters().find((candidate) => candidate.id === "oecd");
  assert.ok(adapter);
  assert.ok(adapter?.capabilities.includes("macro"));
});
