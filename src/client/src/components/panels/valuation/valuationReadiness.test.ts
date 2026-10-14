import { test } from "node:test";
import assert from "node:assert/strict";
import { reverseDcfInputStatus } from "./ReverseDcfTab";
import { compsInputStatus } from "./CompsTab";
import { modelAgreementInputStatus } from "./ModelAgreementTab";

test("reverse DCF blocks when market value and revenue dependencies are absent", () => {
  const status = reverseDcfInputStatus({ currentMarketEV: null, marketEquityValue: null, netDebt: null, baseRevenueStartingPoint: null, fcfForecast: [], computedWACC: 9, termGrowth: 3 });
  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ["market EV", "market equity value", "net debt", "base revenue", "FCF forecast"]);
});

test("reverse DCF is ready only with valid deterministic dependencies", () => {
  const status = reverseDcfInputStatus({ currentMarketEV: 120e9, marketEquityValue: 100e9, netDebt: 20e9, baseRevenueStartingPoint: 50e9, fcfForecast: [5e9], computedWACC: 9, termGrowth: 3 });
  assert.equal(status.ready, true);
  assert.deepEqual(status.missing, []);
});

test("comps blocks missing market and per-share bridge inputs", () => {
  const status = compsInputStatus({ price: null, marketCap: null, revenue: null, sharesOut: null, netDebt: null });
  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ["market price", "market capitalization", "revenue", "shares outstanding", "net debt"]);
});

test("model agreement blocks without a market anchor or computed methods", () => {
  const status = modelAgreementInputStatus({ price: null, sharesOut: null, methodCount: 0 });
  assert.equal(status.ready, false);
  assert.deepEqual(status.missing, ["market price", "shares outstanding", "computed valuation methods"]);
});
