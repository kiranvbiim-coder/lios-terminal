import test from "node:test";
import assert from "node:assert/strict";
import {validateRecordedAsOfCapture} from "./useRecordedAsOfSnapshot";

const row={
  id:"2f21c718-9c1d-4970-8394-6df33ef250a3",entityKey:"FEDFUNDS",
  datasetKey:"economic:FEDFUNDS",dataClass:"economic_series",contentHash:"f".repeat(64),
  availableAt:"2026-10-27T23:59:59.999Z",payload:{seriesId:"FEDFUNDS"},
};
const expected={entityKey:"FEDFUNDS",datasetKey:"economic:FEDFUNDS",dataClass:"economic_series" as const,day:"2026-10-27"};
test("B06 direct as-of lookup verifies saved identity, UTC availability, content hash and exact dataset",()=>{
  assert.deepEqual(validateRecordedAsOfCapture(row,expected),row);
  for(const wrong of [
    {...row,entityKey:"CPI"},{...row,datasetKey:"economic:CPI"},
    {...row,id:"fake-id"},{...row,contentHash:"not-a-hash"},
    {...row,availableAt:"2026-10-28T00:00:00.000Z"},
    {...row,payload:{seriesId:"CPI"}},{...row,dataClass:"market_series"},
  ])assert.equal(validateRecordedAsOfCapture(wrong,expected),null);
  assert.equal(validateRecordedAsOfCapture(row,{...expected,day:"2026-02-30"}),null);
});
test("B06 market and economic payloads use their distinct saved exact symbol or series identity",()=>{
  const market={...row,entityKey:"AAPL",datasetKey:"market:AAPL:1d",dataClass:"market_series",payload:{symbol:"AAPL"}};
  assert.deepEqual(validateRecordedAsOfCapture(market,{
    entityKey:"AAPL",datasetKey:"market:AAPL:1d",dataClass:"market_series",day:"2026-10-27",
  }),market);
  assert.equal(validateRecordedAsOfCapture({...market,payload:{symbol:"OTHER"}},{
    entityKey:"AAPL",datasetKey:"market:AAPL:1d",dataClass:"market_series",day:"2026-10-27",
  }),null);
});
