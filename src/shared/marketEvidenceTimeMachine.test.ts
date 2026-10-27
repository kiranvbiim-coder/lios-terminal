import assert from "node:assert/strict";
import test from "node:test";
import type { PointInTimeMarketSnapshot } from "./pointInTimeData";
import { eligibleMarketCaptures, latestMarketCapture, marketCaptureKnownOn,
  marketCapturePairIssue, marketEvidenceUtcDay, marketCaptureReference } from "./marketEvidenceTimeMachine";

function capture(id: string, availableAt: string, symbol = "TEST"): PointInTimeMarketSnapshot {
  return {
    id, datasetKey: `market:${symbol}:1d`, entityKey: symbol, dataClass:"market_series",
    contentHash: "a".repeat(64), availableAt, retrievedAt: availableAt, createdAt: availableAt,
    source:"fixture", provider:"fixture", frequency:"daily", schemaVersion:"1.0.0",
    currency:"USD", timezone:"UTC", observationStart:"2024-01-02", observationEnd:"2024-01-03",
    effectiveAt:"2024-01-03T23:59:59.000Z", publishedAt:null, parentSnapshotId:null,
    lineage:{}, createdByUserId:1,
    quality: { score:1, barCount:1, actionCount:0, duplicateDates:0, invalidBars:0,
      missingSessions:0, returnCoverage:0, warnings:[] },
    payload: { symbol, interval:"1d", calendar:"XNYS", timezone:"UTC", currency:"USD",
      priceBasis:"unknown", bars:[{date:"2024-01-02",open:100,high:103,low:98,close:101,
        volume:200,priceReturn:null,logReturn:null,totalReturn:null}], corporateActions:[] },
  };
}
test("B06 selects captures only by captured availability, never old bar timestamps",()=>{
  const early=capture("early","2026-10-20T08:00:00.000Z");
  const late=capture("late","2026-10-27T19:00:00.000Z");
  const other=capture("other","2026-10-01T00:00:00.000Z","OTHER");
  const input=[early,other,late];
  assert.equal(marketCaptureKnownOn(input,"TEST","2024-01-03"),null);
  assert.equal(marketCaptureKnownOn(input,"TEST","2026-10-25")?.id,"early");
  assert.equal(marketCaptureKnownOn(input,"TEST","2026-10-27")?.id,"late");
  assert.equal(latestMarketCapture(input,"TEST")?.id,"late");
  assert.deepEqual(eligibleMarketCaptures(input,"TEST").map(x=>x.id),["late","early"]);
  assert.equal(marketCaptureKnownOn(input,"OTHER","2026-10-27")?.id,"other");
});
test("B06 malformed, future-ineligible and impossible dates never silently show latest",()=>{
  const rows=[capture("only","2026-10-27T00:00:00.000Z")];
  for(const day of ["2026-02-30","2026-13-01","2026-10-2","10/27/2026","", "2026-10-26"]) {
    assert.equal(marketCaptureKnownOn(rows,"TEST",day),null);
  }
  assert.equal(marketEvidenceUtcDay("2024-02-29"),"2024-02-29");
  assert.equal(marketEvidenceUtcDay("2025-02-29"),null);
});
test("B06 comparisons refuse cross-symbol, out-of-order or changed unit/currency/basis",()=>{
  const a=capture("a","2026-10-20T00:00:00.000Z");
  const b=capture("b","2026-10-27T00:00:00.000Z");
  assert.equal(marketCapturePairIssue(a,b,"TEST"),null);
  assert.match(marketCapturePairIssue(a,a,"TEST")!,/distinct/);
  assert.match(marketCapturePairIssue(b,a,"TEST")!,/before/);
  assert.match(marketCapturePairIssue(a,capture("other","2026-10-27T00:00:00.000Z","OTHER"),"TEST")!,/exact/);
  assert.match(marketCapturePairIssue(a,{...b,currency:"EUR"},"TEST")!,/comparable/);
  assert.match(marketCapturePairIssue(a,{...b,payload:{...b.payload,priceBasis:"raw"}},"TEST")!,/comparable/);
  const ref=marketCaptureReference(a);
  assert.deepEqual(Object.keys(ref).sort(),["availableAt","contentHash","currency","datasetKey","entityKey",
    "id","observationEnd","observationStart","priceBasis","provider","retrievedAt"].sort());
  assert.equal(JSON.stringify(ref).includes("bars"),false);
});
