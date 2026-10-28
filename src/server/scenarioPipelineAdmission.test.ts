import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
import type { FactorRiskSnapshot } from "./factorRiskModel";
import type { QuantInputSourceBinding } from "@shared/quantModelRegistry";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-scenario-admission-"));
process.env.LIOS_DATA_ROOT=root;process.env.LIMURIA_DATA_DIR=root;delete process.env.DATABASE_URL;
const {initDb,getDb,closeDb}=await import("./db");
const {users,datasetSnapshots,dataEntitlementPolicies}=await import("@shared/schema");
const {runScenarioPipeline}=await import("./scenarioPipeline");
const {createEntitlementPolicy}=await import("./dataEntitlementStore");
const {hashLedgerValue}=await import("./ledgerStore");
const {factorRiskSnapshotContentHash}=await import("./factorRiskModel");
const {registerBuiltInCalculationJobRunners}=await import("./calculationJobRunners");
const jobs=await import("./calculationJobService");

const payload=financialDatasetPayloadSchema.parse({symbol:"TEST",periods:[{
 period:"FY",fiscalYear:"2023",periodEnd:"2023-12-31",filingDate:"2024-02-15",availableAt:"2024-02-15T00:00:00.000Z",currency:"USD",sources:[{statementType:"income",provider:"user_supplied"}],
 income:{revenue:1000,costOfRevenue:600,sellingGeneralAndAdministrativeExpenses:200,incomeBeforeTax:140,incomeTaxExpense:28,netIncome:112,weightedAverageShsOutDil:100},
 balance:{cashAndCashEquivalents:100,netReceivables:100,inventory:100,propertyPlantEquipmentNet:500,accountPayables:100,shortTermDebt:50,longTermDebt:150,totalAssets:800,totalLiabilities:300,totalStockholdersEquity:500},
 cashflow:{depreciationAndAmortization:50,investmentsInPropertyPlantAndEquipment:-60},
}]});

test("scenario computation and durable result reads require current exact source authority",async t=>{
 await initDb();
 t.after(async()=>{await jobs.shutdownCalculationJobServiceForTests();jobs.resetCalculationJobRunnersForTests();await closeDb();fs.rmSync(root,{recursive:true,force:true});});
 const [actor,foreign]=await getDb().insert(users).values(["actor","foreign"].map(name=>({email:crypto.randomUUID()+"@example.test",name,passwordHash:"unused",role:"internal_analyst" as const}))).returning();
 const ctx={userId:actor.id,organizationId:null,role:actor.role};
 const request={scenarioId:"downside",scenarioName:"Recorded shock",financialDatasetSnapshotId:crypto.randomUUID(),baseAssumptions:{projectionYears:2,revenueGrowth:0},scenarioAssumptions:{projectionYears:2,revenueGrowth:-0.1},valuation:{discountRate:0.1,terminalGrowth:0.02,netDebt:1,sharesOutstanding:10},factorRiskSnapshotId:"factor-risk-unavailable",portfolioWeights:{AAA:1},factorShocks:{value:-0.1}};
 const manualRequest={...request,source:{status:"manual" as const,source:"Decision Engine terminal scenario pipeline input"}};
 await t.test("foreign and unlicensed financial metadata is refused before parsing private values",async()=>{
  for(const owner of [foreign,actor]){
   const id=crypto.randomUUID();await getDb().insert(datasetSnapshots).values({id,datasetKey:"financial:TEST",entityKey:"TEST",dataClass:"financial_statements",schemaVersion:"1",source:"fixture",provider:"fixture",frequency:"annual",availableAt:new Date("2020-01-01"),retrievedAt:new Date("2020-01-01"),contentHash:crypto.randomBytes(32).toString("hex"),quality:{},lineage:{},payload:{privateMarker:"must-not-be-parsed"},createdByUserId:owner.id});
   await assert.rejects(runScenarioPipeline({...request,financialDatasetSnapshotId:id},ctx),error=>error instanceof Error&&"status" in error&&error.status===(owner.id===actor.id?403:404));
  }
 });
 async function policy(provider:string,dataClass:string){return (await createEntitlementPolicy({provider,dataClass,licenseType:"user_supplied",accessScope:"internal_only",redistribution:"restricted",permittedUses:["display","model_input","derived_output"],attribution:"Synthetic regression values only",termsUrl:null,effectiveFrom:"1970-01-01T00:00:00.000Z",effectiveTo:null,reviewedAt:null,notes:null},actor.id)).policy;}
 async function source(id:string,provider:string,dataClass:string,values:Record<string,unknown>,policyId:string){
  const lineage={sourceRefs:["fixture:scenario-admission:"+id]};const contentHash=hashLedgerValue({payload:values,provider,lineage});
  await getDb().insert(datasetSnapshots).values({id,datasetKey:"scenario:"+id,entityKey:"TEST",dataClass,schemaVersion:"1",source:"synthetic_fixture",provider,frequency:"annual",availableAt:new Date("2024-02-15"),retrievedAt:new Date(dataClass==="factor_inputs"?"2026-01-01":"2024-02-15"),contentHash,quality:{},lineage,payload:values,createdByUserId:actor.id,entitlementPolicyId:policyId});
  return {id,contentHash};
 }
 const financialPolicy=await policy("user_supplied","financial_statements");
 const financial=await source(request.financialDatasetSnapshotId,"user_supplied","financial_statements",payload,financialPolicy.id);
 const inputPolicy=await policy("scenario-fixture","factor_inputs");
 const upstream=await source(crypto.randomUUID(),"scenario-fixture","factor_inputs",{ohlcv:[{date:"2026-01-01",close:100}],fundamentals:{sector:"Fixture",marketCap:1000}},inputPolicy.id);
 const binding=(field:string):QuantInputSourceBinding=>({field,contractFamily:"factor-risk-model",connectorId:"unit-fixture",provider:"scenario-fixture",priority:"primary",sourceReference:`dataset-snapshot:${upstream.id}`,asOf:"2026-01-01T00:00:00.000Z",retrievedAt:"2026-01-01T00:00:00.000Z",freshness:"historical",snapshot:upstream,transformations:[]});
 const metadata={symbol:"AAA",provider:"scenario-fixture",status:"available",source:"synthetic fixture",asOf:"2026-01-01",retrievedAt:"2026-01-01T00:00:00.000Z"};
 const estimation:FactorRiskSnapshot["estimation"]={factorReturnSeries:[{periodEnd:"2025-12-31",returns:{value:0.01}},{periodEnd:"2026-01-31",returns:{value:0.1}}],factorCovariance:[[0.04]],specificVariances:{AAA:0.01},factorCovarianceAnnualizationPeriodsPerYear:12,excludedFromSpecificVariance:[],periodsUsed:2,excludedPeriods:[],regressionRSquaredByPeriod:{}};
 const sources={benchmark:{...metadata,symbol:"BENCH",sourceBindings:[binding("ohlcv")]},securities:{AAA:{...metadata,sourceBindings:[binding("ohlcv"),binding("fundamentals")]}}};
 const snapshot:FactorRiskSnapshot={snapshotId:"",contentHash:"",request:{symbols:["AAA"],benchmarkSymbol:"BENCH",range:"1Y",asOf:"2026-01-01",scope:"local"},capturedAt:metadata.retrievedAt,retrievalStartedAt:metadata.retrievedAt,retrievalCompletedAt:metadata.retrievedAt,cache:"miss",sources,provenance:sources,factors:[{id:"value",label:"Value",source:"fixture",asOf:"2026-01-01",units:"z-score",status:"derived"}],securities:[{securityId:"AAA",exposures:{value:0.2},source:"fixture",asOf:"2026-01-01",units:"z-score"}],estimation,estimator:estimation,excluded:[],limitations:["Synthetic fixture, not live-provider acceptance"]};
 snapshot.contentHash=factorRiskSnapshotContentHash(snapshot);snapshot.snapshotId=`factor-risk-${snapshot.contentHash.slice(0,24)}`;request.factorRiskSnapshotId=snapshot.snapshotId;
 manualRequest.factorRiskSnapshotId=snapshot.snapshotId;
 const modelPolicy=await policy("factor_risk_model","factor_risk");
 await getDb().insert(datasetSnapshots).values({id:snapshot.snapshotId,datasetKey:"scenario-factor",entityKey:"AAA",dataClass:"factor_risk",schemaVersion:"factor-risk-v1",source:"factor_risk_model",provider:"factor_risk_model",frequency:"on_demand",availableAt:new Date("2026-01-01"),retrievedAt:new Date("2026-01-01"),contentHash:snapshot.contentHash,quality:{},lineage:{},payload:snapshot as unknown as Record<string,unknown>,createdByUserId:actor.id,entitlementPolicyId:modelPolicy.id,expiresAt:new Date(Date.now()+300000)});
 const result=await runScenarioPipeline(manualRequest,ctx);
 assert.equal(result.trace.financialDataset.contentHash,financial.contentHash);
 assert.equal(result.trace.models.baseline.forecast[0].income.revenue,1000);
 assert.equal(result.trace.models.scenario.forecast[0].income.revenue,900);
 assert.ok(Math.abs(result.trace.factorRisk.derivedAssetImpacts[0].scenarioImpact+0.02)<1e-12);
 registerBuiltInCalculationJobRunners();
 const queued=await jobs.enqueueCalculationJob("scenario-pipeline-preview",manualRequest,{userId:actor.id,organizationId:null});
 const scope={userId:actor.id};const deadline=Date.now()+10000;
 let finished=await jobs.getCalculationJob(queued.id,scope);
 // The production worker exposes durable status, not a completion promise; yield only while the real DB row is unsettled.
 while(finished?.status==="queued"||finished?.status==="running"){
  assert.ok(Date.now()<deadline,"Queued scenario did not settle");await new Promise(resolve=>setTimeout(resolve,10));finished=await jobs.getCalculationJob(queued.id,scope);
 }
 assert.equal(finished?.status,"succeeded",finished?.error??undefined);
 assert.equal((finished?.result as typeof result).trace.traceHash,result.trace.traceHash);
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display"]}).where(eq(dataEntitlementPolicies.id,financialPolicy.id));
 const denied=(error:unknown)=>error instanceof Error&&"status" in error&&error.status===403;
 await assert.rejects(runScenarioPipeline(request,ctx),denied);
 await assert.rejects(jobs.getCalculationJob(queued.id,scope),denied);
 await assert.rejects(jobs.listCalculationJobs(scope),denied);
 await assert.rejects(jobs.requestCalculationJobCancellation(queued.id,scope),denied);
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display","model_input","derived_output"]}).where(eq(dataEntitlementPolicies.id,financialPolicy.id));
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display"]}).where(eq(dataEntitlementPolicies.id,inputPolicy.id));
 await assert.rejects(runScenarioPipeline(manualRequest,ctx),denied);
 await assert.rejects(jobs.getCalculationJob(queued.id,scope),denied);
});
