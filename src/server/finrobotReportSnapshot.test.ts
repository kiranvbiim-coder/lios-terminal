import test from "node:test";
import assert from "node:assert/strict";
import { inspectFinRobotReportSnapshot, FINROBOT_SOURCE_LINEAGE } from "./finrobotReportSnapshot";

const hash="a".repeat(64);
const report=(blocks: Array<{id:string;type:"paragraph";text:string;attrs:Record<string,unknown>}>)=>({
 contentHash:hash,sourceRefs:["source:filing","source:filing"],executionReceiptIds:["receipt:1"],
 content:{kind:"report" as const,blocks},
});
test("FinRobot pin/rights and P4 immutable snapshot authority",()=>{
 assert.equal(FINROBOT_SOURCE_LINEAGE.commit,"2717499b8e30f242640af08c4ad9afd1113c2d45");
 assert.equal(FINROBOT_SOURCE_LINEAGE.license,"Apache-2.0");
 assert.equal(FINROBOT_SOURCE_LINEAGE.installedDonorRuntime,false);
});
test("semantic as-of is independent from actual provider fetched-at",()=>{
 const x=inspectFinRobotReportSnapshot(report([
  {id:"a",type:"paragraph",text:"Revenue for FY2024",attrs:{
   numericValue:120,sourceRef:"source:filing",as_of:"2024-12-31T00:00:00Z",
   fetched_at:"2026-10-11T10:00:00Z",formula_warning:"Approximate",
  }},
 ]));
 assert.equal(x.observedAsOfLabels,1);
 assert.equal(x.fetchTimestampLabels,1);
 assert.equal(x.blocksWithExplicitRefs,1);
 assert.equal(x.sourceCount,1);
 assert.equal(x.receiptCount,1);
 assert.equal(x.liveDataRefreshed,false);
 assert.equal(x.formulaRecalculated,false);
 assert.equal(x.approvalOrInvestmentAdvice,false);
 assert.deepEqual(x.warnings,["One or more recorded formulas carry an explicit warning."]);
});
test("missing source and missing semantic vintage never become verified data",()=>{
 const x=inspectFinRobotReportSnapshot({
  contentHash:hash,sourceRefs:[],executionReceiptIds:[],
  content:{kind:"report",blocks:[
   {id:"missing",type:"paragraph",text:"Unsourced price",attrs:{numericValue:null,fetched_at:"2026-10-11T00:00:00Z"}},
  ]},
 });
 assert.equal(x.blocksWithoutExplicitRefs,1);
 assert.equal(x.observedAsOfLabels,0);
 assert.equal(x.fetchTimestampLabels,1);
 assert.match(x.warnings.join(" "),/source references/);
 assert.match(x.warnings.join(" "),/as-of/);
 assert.equal(x.validation,"recorded_provenance_not_provider_verified");
});
test("invalid numbers/dates retain warnings, never substitute a zero",()=>{
 const x=inspectFinRobotReportSnapshot(report([
  {id:"n",type:"paragraph",text:"Invalid metric",attrs:{
   sourceRef:"source:filing",numericValue:Infinity,
   as_of:"not-a-date", fetched_at:"2026-99-99",
  }}
 ]));
 assert.match(x.warnings.join(" "),/malformed/);
 assert.match(x.warnings.join(" "),/non-finite/);
 assert.equal(x.observedAsOfLabels,0);
 assert.equal(x.fetchTimestampLabels,0);
});
test("reject forged source hashes and unbounded source arrays",()=>{
 assert.throws(()=>inspectFinRobotReportSnapshot({...report([]),contentHash:"faked"}));
 assert.throws(()=>inspectFinRobotReportSnapshot({...report([]),sourceRefs:[""]}));
 assert.throws(()=>inspectFinRobotReportSnapshot({...report([]),sourceRefs:Array(5001).fill("source:one")}));
});
