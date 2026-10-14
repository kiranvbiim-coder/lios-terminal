import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAssetCount, effectiveAssetCountAtRecordedDate } from "./skfolioEffectiveDiversification";

test("skfolio effective assets known-answer inverse-Herfindahl concentration", () => {
  assert.equal(effectiveAssetCount([25,25,25,25]),4);
  assert.equal(effectiveAssetCount([100,0,0,0]),1);
  assert.equal(effectiveAssetCount([75,25]),1.6);
  assert.equal(effectiveAssetCount([100,100]),2);
  assert.equal(effectiveAssetCount([1e308,1e308]),2);
  assert.equal(effectiveAssetCount([1e-300,1e-300]),2);
});
test("reject shorts, leverage from signed positions, nonfinite, empty and zero exposure", () => {
  for(const x of [[],[0,0],[-1,1],[Infinity,1],[NaN,1],[1,-0.1]]) {
    assert.equal(effectiveAssetCount(x),null);
  }
});
test("duplicate named holdings consolidate before inverse-Herfindahl math", () => {
  const result=effectiveAssetCountAtRecordedDate({
    positions:[{symbol:"ABC",shares:2},{symbol:"ABC",shares:2},{symbol:"XYZ",shares:2}],
    histories:{ABC:[{date:"2026-10-10",close:25}],XYZ:[{date:"2026-10-10",close:50}]},
    asOfDate:"2026-10-10",
  });
  assert.equal(result,2);
});
test("skip stale-missing, ambiguous and malformed prices instead of inventing weights", () => {
  const base={positions:[{symbol:"ABC",shares:1},{symbol:"XYZ",shares:1}],histories:{
    ABC:[{date:"2026-10-09",close:10},{date:"2026-10-10",close:11}],
    XYZ:[{date:"2026-10-09",close:12},{date:"2026-10-10",close:13}],
  },asOfDate:"2026-10-10"};
  assert.ok(effectiveAssetCountAtRecordedDate(base)!>1);
  assert.equal(effectiveAssetCountAtRecordedDate({...base,asOfDate:"2026-10-11"}),null);
  assert.equal(effectiveAssetCountAtRecordedDate({...base,histories:{...base.histories,XYZ:base.histories.XYZ.slice(0,1)}}),null);
  assert.equal(effectiveAssetCountAtRecordedDate({...base,histories:{...base.histories,XYZ:[...base.histories.XYZ,base.histories.XYZ[1]]}}),null);
  assert.equal(effectiveAssetCountAtRecordedDate({...base,positions:[{symbol:"ABC",shares:-1}]}),null);
  assert.equal(effectiveAssetCountAtRecordedDate({...base,histories:{...base.histories,XYZ:[{date:"2026-10-10",close:Infinity}]}}),null);
  assert.equal(effectiveAssetCountAtRecordedDate({...base,positions:[{symbol:"ABC",shares:0}]}),null);
});