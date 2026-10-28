import test from "node:test";
import assert from "node:assert/strict";
import type { PointInTimeScalarSeriesSnapshot } from "./pointInTimeData";
import { eligibleEconomicCaptures,economicCaptureKnownOn,economicCapturePairIssue } from "./economicEvidenceTimeMachine";

const make = (id:string,when:string,seriesId="FEDFUNDS"):PointInTimeScalarSeriesSnapshot => ({
  id,entityKey:seriesId,datasetKey:`economic:${seriesId}`,dataClass:"economic_series",
  contentHash:"b".repeat(64),availableAt:when,retrievedAt:when,createdAt:when,
  schemaVersion:"1.0.0",source:"fred",provider:"fred",frequency:"monthly",
  currency:null,timezone:"UTC",observationStart:"2024-01-01",observationEnd:"2024-01-01",
  effectiveAt:"2024-01-01T00:00:00.000Z",publishedAt:null,parentSnapshotId:null,entitlementPolicyId:null,
  createdByUserId:1,lineage:{},quality:{score:1,observationCount:1,validObservationCount:1,
    missingValues:0,vintageCoverage:1,warnings:[]},
  payload:{seriesId,name:seriesId,unit:"percent",category:"rates",provider:"fred",frequency:"monthly",
    observations:[{date:"2024-01-01",value:5,realtimeStart:null,realtimeEnd:null,
      availableAt:"2024-01-01T00:00:00.000Z"}]},
});
test("B06 economic date selection uses actual retained capture availability rather than backfilled observation dates",()=>{
  const early=make("early","2026-10-10T11:00:00.000Z");
  const late=make("late","2026-10-27T13:00:00.000Z");
  const rows=[late,early,make("other","2026-10-01T10:00:00.000Z","CPI")];
  assert.equal(economicCaptureKnownOn(rows,"FEDFUNDS","2024-01-01"),null);
  assert.equal(economicCaptureKnownOn(rows,"FEDFUNDS","2026-10-20")?.id,"early");
  assert.equal(economicCaptureKnownOn(rows,"FEDFUNDS","2026-10-27")?.id,"late");
  assert.deepEqual(eligibleEconomicCaptures(rows,"FEDFUNDS").map(x=>x.id),["late","early"]);
  assert.equal(economicCaptureKnownOn(rows,"FEDFUNDS","2026-02-30"),null);
});
test("B06 economic comparison refuses unrelated series, mismatched units and reversed capture clocks",()=>{
  const early=make("early","2026-10-10T11:00:00.000Z");
  const late=make("late","2026-10-27T11:00:00.000Z");
  assert.equal(economicCapturePairIssue(early,late,"FEDFUNDS"),null);
  assert.match(economicCapturePairIssue(early,early,"FEDFUNDS")!,/distinct/);
  assert.match(economicCapturePairIssue(late,early,"FEDFUNDS")!,/before/);
  assert.match(economicCapturePairIssue(early,make("cpi","2026-10-27T11:00:00.000Z","CPI"),"FEDFUNDS")!,/same recorded/);
  assert.match(economicCapturePairIssue(early,{...late,payload:{...late.payload,unit:"basis points"}},"FEDFUNDS")!,/withheld/);
});
