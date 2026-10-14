import test from "node:test";
import assert from "node:assert/strict";

import { FRED_DEFAULT_POINTS, FRED_MAX_POINTS, normalizeFredHistoryOptions } from "./fredData";
import { BLS_UNREGISTERED_WINDOW_YEARS, buildBlsRequestBody, buildBlsWindows, mergeBlsObservations, getBlsSeries } from "./blsData";
import { WB_DEFAULT_YEARS_BACK, WB_MAX_YEARS_BACK, normalizeWbOptions } from "./worldBankData";

test("FRED history options use a bounded default and accept the provider maximum", () => {
  assert.equal(normalizeFredHistoryOptions({}).points, FRED_DEFAULT_POINTS);
  assert.equal(normalizeFredHistoryOptions(FRED_MAX_POINTS).points, 100_000);
  assert.deepEqual(normalizeFredHistoryOptions({ points: 12, startDate: "2010-01-01", endDate: "2012-12-31" }), {
    points: 12, startDate: "2010-01-01", endDate: "2012-12-31",
  });
  assert.throws(() => normalizeFredHistoryOptions({ startDate: "2021-02-29" }), /ISO date/);
  assert.throws(() => normalizeFredHistoryOptions({ startDate: "2012-01-01", endDate: "2010-01-01" }), /on or before/);
});

test("World Bank windows default to useful history and reject unsafe ranges", () => {
  const currentYear = new Date().getFullYear();
  assert.deepEqual(normalizeWbOptions({}), {
    startYear: currentYear - WB_DEFAULT_YEARS_BACK, endYear: currentYear, page: 1, limit: WB_DEFAULT_YEARS_BACK + 1,
  });
  assert.deepEqual(normalizeWbOptions({ startYear: 2000, endYear: 2010, page: 2, limit: 5 }), {
    startYear: 2000, endYear: 2010, page: 2, limit: 5,
  });
  assert.throws(() => normalizeWbOptions({ yearsBack: WB_MAX_YEARS_BACK + 1 }), /between 1 and 100/);
  assert.throws(() => normalizeWbOptions({ startYear: 2010, endYear: 2000 }), /on or before/);
});

test("BLS observations merge overlapping legal windows with deterministic ordering", () => {
  assert.equal(BLS_UNREGISTERED_WINDOW_YEARS, 10);
  assert.deepEqual(mergeBlsObservations([
    [{ date: "2020-01-01", value: 1 }, { date: "2021-01-01", value: 2 }],
    [{ date: "2021-01-01", value: 2.5 }, { date: "2019-01-01", value: 0 }],
  ]), [
    { date: "2019-01-01", value: 0 }, { date: "2020-01-01", value: 1 }, { date: "2021-01-01", value: 2.5 },
  ]);
});


test("BLS legal windows overlap only at boundaries so merged history can dedupe safely", () => {
  assert.deepEqual(buildBlsWindows(2000, 2025, BLS_UNREGISTERED_WINDOW_YEARS), [
    { startYear: 2015, endYear: 2025 }, { startYear: 2005, endYear: 2015 }, { startYear: 2000, endYear: 2005 },
  ]);
});

test("BLS requests omit registration credentials on the public tier", () => {
  assert.deepEqual(buildBlsRequestBody("TEST", 2020, 2025, null), { seriesid: ["TEST"], startyear: "2020", endyear: "2025" });
  assert.equal(buildBlsRequestBody("TEST", 2020, 2025, "registered").registrationkey, "registered");
});

test("BLS rejects invalid history windows before making a provider request", async () => {
  await assert.rejects(getBlsSeries("TEST", { startYear: 2025, endYear: 2020 }), /on or before/);
});