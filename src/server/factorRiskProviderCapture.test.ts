import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-factor-provider-"));
process.env.LIOS_DATA_ROOT=root;process.env.LIMURIA_DATA_DIR=root;delete process.env.DATABASE_URL;
const {initDb,getDb,closeDb}=await import("./db");
const {users,datasetSnapshots,dataEntitlementPolicies}=await import("@shared/schema");
const {createEntitlementPolicy}=await import("./dataEntitlementStore");
const {captureFactorRiskSnapshot,getFactorRiskSnapshot}=await import("./factorRiskModel");
const {runWithRequestIdentity}=await import("./requestContext");
const {resolveMarketDataScope}=await import("./marketDataScope");
const {saveHistory}=await import("./marketHistoryStore");
const {saveFundamentals}=await import("./fundamentalsStore");
const {hashLedgerValue}=await import("./ledgerStore");
const {executeOriginalFactorDecomposition}=await import("./advancedQuantExecution");

test("actual factor capture binds consumed cached provider values, isolates authors and rechecks rights on cache hits",async t=>{
 await initDb();t.after(async()=>{await closeDb();fs.rmSync(root,{recursive:true,force:true});});
 const [owner,other]=await getDb().insert(users).values(["owner","other"].map(name=>({email:crypto.randomUUID()+"@example.test",name,passwordHash:"fixture",role:"internal_analyst" as const}))).returning();
 const identity={userId:owner.id,organizationId:null,selectedConnectorIds:["yahoo_finance"],communityYahooConsent:true};
 const policy=async(provider:string,dataClass:string)=>(await createEntitlementPolicy({provider,dataClass,licenseType:"user_supplied",accessScope:"internal_only",redistribution:"restricted",permittedUses:["display","model_input","derived_output"],attribution:"Controlled synthetic cached values only; no real Yahoo licence grant",termsUrl:null,effectiveFrom:"1970-01-01T00:00:00.000Z",effectiveTo:null,reviewedAt:null,notes:null},owner.id)).policy;
 const inputPolicy=await policy("yahoo_finance","factor_inputs");await policy("factor_risk_model","factor_risk");
 const symbols=Array.from({length:18},(_,i)=>`FIX${String.fromCharCode(65+i)}`);const benchmarkSymbol="FIXBENCH";
 const asOf=new Date().toISOString().slice(0,10);const scope=resolveMarketDataScope({},identity).key;
 for(const [i,symbol] of [benchmarkSymbol,...symbols].entries()){
  const bars=Array.from({length:850},(_,d)=>{
   const date=new Date(Date.now()-(849-d)*86400000).toISOString().slice(0,10);const close=100*Math.exp(d*0.0002)*(1+0.03*Math.sin(d/(17+i))+0.01*Math.cos(d/(7+i)));
   return {date,open:close,high:close,low:close,close,volume:1000};
  });
  saveHistory(symbol,bars,"raw",{sourceRefs:[`fixture:yahoo-history:${symbol}`],providerIds:["yahoo_finance"],providerLabels:["Synthetic cached Yahoo contract"],observedAt:new Date().toISOString(),asOf,isFallback:false},scope);
  if(symbol!==benchmarkSymbol)saveFundamentals(symbol,{symbol,marketCap:1e8*(i+1),trailingPE:10,forwardPE:null,trailingEps:i+1,forwardEps:null,priceToBook:2,dividendYield:null,beta:null,totalRevenue:1e7,profitMargins:0.1+i*.003,revenueGrowth:0.1,fiftyTwoWeekHigh:null,fiftyTwoWeekLow:null,sharesOutstanding:1e6,bookValue:20+i,returnOnEquity:0.1+i*.01,debtToEquity:null,sector:i%2?"Technology":"Financials",industry:null,longName:symbol,currency:"USD"});
 }
 const request={symbols,benchmarkSymbol,range:"2Y",asOf};
 const captured=await runWithRequestIdentity(identity,()=>captureFactorRiskSnapshot(request));
 assert.deepEqual(captured.snapshot.securities.map(item=>item.securityId).sort(),[...symbols].sort());
 const binding=captured.snapshot.sources.securities[symbols[0]].sourceBindings!.find(item=>item.field==="fundamentals")!;
 const [upstream]=await getDb().select().from(datasetSnapshots).where(eq(datasetSnapshots.id,binding.snapshot.id));
 assert.equal(upstream.createdByUserId,owner.id);assert.equal(upstream.entitlementPolicyId,inputPolicy.id);
 assert.equal(upstream.contentHash,hashLedgerValue({payload:upstream.payload,provider:upstream.provider,lineage:upstream.lineage}));
 assert.equal((upstream.payload as {fundamentals:{marketCap:number}}).fundamentals.marketCap,2e8);
 assert.equal((await runWithRequestIdentity(identity,()=>captureFactorRiskSnapshot(request))).cache,"hit");
 assert.equal(await runWithRequestIdentity({...identity,userId:other.id},()=>getFactorRiskSnapshot(captured.snapshot.snapshotId)),null);
 const weights=Object.fromEntries(symbols.map(symbol=>[symbol,1/symbols.length]));
 const execution=await executeOriginalFactorDecomposition(captured.snapshot,{snapshotId:captured.snapshot.snapshotId,expectedSnapshotHash:captured.snapshot.contentHash,portfolioWeights:weights},{userId:owner.id,organizationId:null,role:owner.role});
 assert.equal(execution.receipt.modelId,"factor-risk-model");
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display"]}).where(eq(dataEntitlementPolicies.id,inputPolicy.id));
 await assert.rejects(runWithRequestIdentity(identity,()=>captureFactorRiskSnapshot(request)),/source rights/);
 await assert.rejects(runWithRequestIdentity(identity,()=>getFactorRiskSnapshot(captured.snapshot.snapshotId)),/source rights/);
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display","model_input","derived_output"]}).where(eq(dataEntitlementPolicies.id,inputPolicy.id));
 await getDb().update(users).set({active:false}).where(eq(users.id,owner.id));
 await assert.rejects(runWithRequestIdentity(identity,()=>getFactorRiskSnapshot(captured.snapshot.snapshotId)),/authority/);
});
