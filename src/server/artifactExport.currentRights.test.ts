import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { runIntegratedFinancialModel } from "@shared/integratedFinancialModel";
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-report-rights-"));
process.env.LIOS_DATA_ROOT=root;process.env.LIMURIA_DATA_DIR=root;delete process.env.DATABASE_URL;
const {initDb,getDb,closeDb}=await import("./db");
const {users,dataEntitlementPolicies,datasetSnapshots}=await import("@shared/schema");
const {createProject}=await import("./projectStore");
const {createArtifact,getArtifactVersion}=await import("./artifactStore");
const {createProfessionalWorkPackage}=await import("./professionalWorkPackage");
const {getArtifactExportPlan}=await import("./artifactExport");
const {prepareReportDocxDownload}=await import("./reportDocxDownload");
const {prepareReportPdfDownload}=await import("./reportPdfDownload");
const {saveFinancialModelRun}=await import("./financialModelRunStore");
const {retainIntegratedModelArtifact}=await import("./integratedModelArtifact");
const {stableSnapshotHash}=await import("./pointInTimeDatasetStore");
const {buildP5ReportFromArtifact}=await import("./p5ProfessionalExecution");

test("retained professional reports recheck live export rights without rewriting historical versions",async t=>{
 await initDb();t.after(async()=>{await closeDb();fs.rmSync(root,{recursive:true,force:true});});
 const [user]=await getDb().insert(users).values({email:crypto.randomUUID()+"@example.test",name:"Report owner",passwordHash:"unused",role:"internal_analyst"}).returning();
 const ctx={userId:user.id,organizationId:null,role:user.role};const project=await createProject(ctx,{name:"Owned professional reports"});
 const [policy]=await getDb().insert(dataEntitlementPolicies).values({id:crypto.randomUUID(),provider:"fixture",dataClass:"manual",licenseType:"user_supplied",accessScope:"internal_only",redistribution:"restricted",permittedUses:["display","derived_output","export"],effectiveFrom:new Date("2020-01-01"),contentHash:crypto.randomBytes(32).toString("hex")}).returning();
 const source=await createArtifact(ctx,{projectId:project.id,kind:"report",title:"Recorded source",origin:"direct",content:{kind:"report",blocks:[{id:"known",type:"paragraph",text:"Retained authorized report text",attrs:{}}],sections:[]},sourceRefs:["manual:input"],dependencyRefs:[`entitlement-policy:${policy.id}`]});
 const report=await createProfessionalWorkPackage(ctx,{projectId:project.id,workflow:"ic_memo",title:"Retained package",audience:"Owner",reportingPeriod:"2026",sources:[{artifactId:source.artifact.id,version:source.version.version,contentHash:source.version.contentHash,role:"evidence"}],authoredSections:[{title:"Scope",text:"Explicit review"}]});
 const exact=await getArtifactVersion(ctx,report.artifact.id,1);assert.equal((await getArtifactExportPlan(ctx,report.artifact.id,1)).contentHash,exact.contentHash);
 const p5=buildP5ReportFromArtifact({projectId:project.id,scope:"project",sourceArtifactId:`${source.artifact.id}@v1`,sourceTitle:source.artifact.title,sourceContent:source.version.content as never,sourceRefs:[`entitlement-policy:${policy.id}`],receiptId:"fixture:p5-report"});
 const legacy=await createArtifact(ctx,{projectId:project.id,kind:"report",title:p5.title,origin:"direct",content:p5.data as never,sourceRefs:p5.sourceRefs,executionReceiptIds:p5.executionReceiptIds});
 assert.equal((await getArtifactExportPlan(ctx,legacy.artifact.id,1)).contentHash,legacy.version.contentHash);
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display","derived_output"]}).where(eq(dataEntitlementPolicies.id,policy.id));
 await assert.rejects(getArtifactExportPlan(ctx,report.artifact.id,1),error=>error instanceof Error&&"status" in error&&error.status===403);
 await assert.rejects(getArtifactExportPlan(ctx,legacy.artifact.id,1),error=>error instanceof Error&&"status" in error&&error.status===403);
 assert.equal((await getArtifactVersion(ctx,report.artifact.id,1)).contentHash,exact.contentHash);
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display","derived_output","export"],effectiveTo:new Date("2020-01-02")}).where(eq(dataEntitlementPolicies.id,policy.id));
 await assert.rejects(getArtifactExportPlan(ctx,report.artifact.id,1));
 await getDb().delete(dataEntitlementPolicies).where(eq(dataEntitlementPolicies.id,policy.id));
 await assert.rejects(getArtifactExportPlan(ctx,report.artifact.id,1));
 const [currentPolicy]=await getDb().insert(dataEntitlementPolicies).values({...policy,id:crypto.randomUUID(),provider:"user_supplied",dataClass:"financial_statements",permittedUses:["display","model_input","derived_output","export"],contentHash:crypto.randomBytes(32).toString("hex")}).returning();
 const payload=financialDatasetPayloadSchema.parse({symbol:"TEST",periods:[{
  period:"FY",fiscalYear:"2023",periodEnd:"2023-12-31",filingDate:"2024-02-15",availableAt:"2024-02-15T00:00:00.000Z",currency:"USD",sources:[{statementType:"income",provider:"user_supplied"}],
  income:{revenue:1000,costOfRevenue:600,sellingGeneralAndAdministrativeExpenses:200,incomeBeforeTax:140,incomeTaxExpense:28,netIncome:112,weightedAverageShsOutDil:100},
  balance:{cashAndCashEquivalents:100,netReceivables:100,inventory:100,propertyPlantEquipmentNet:500,accountPayables:100,shortTermDebt:50,longTermDebt:150,totalAssets:800,totalLiabilities:300,totalStockholdersEquity:500},
  cashflow:{depreciationAndAmortization:50,investmentsInPropertyPlantAndEquipment:-60},
 }]});
 const snapshotId=crypto.randomUUID(),lineage={sourceRefs:["fixture:export-replacement"]};
 const contentHash=stableSnapshotHash({payload,provider:"user_supplied",lineage});
 await getDb().insert(datasetSnapshots).values({id:snapshotId,datasetKey:"report-current-rights",entityKey:"TEST",dataClass:"financial_statements",schemaVersion:"1",source:"synthetic_fixture",provider:"user_supplied",frequency:"annual",retrievedAt:new Date("2024-02-15"),availableAt:new Date("2024-02-15"),contentHash,quality:{score:1,statementCoverage:{income:1,balance:1,cashflow:1},criticalFieldsPresent:1,criticalFieldsExpected:1,missingCriticalFields:[],warnings:[]},lineage,payload,createdByUserId:user.id,entitlementPolicyId:currentPolicy.id});
 const result=runIntegratedFinancialModel({datasetSnapshotId:snapshotId,payload,assumptions:{projectionYears:2,revenueGrowth:0.1}});
 const run=await saveFinancialModelRun({result,resultHash:stableSnapshotHash({modelVersion:result.modelVersion,datasetContentHash:contentHash,assumptions:result.assumptions,specializedSchedules:result.specializedSchedules,forecast:result.forecast}),createdByUserId:user.id});
 assert.ok(run);
 const workbook=await retainIntegratedModelArtifact(ctx,run.id,project.id);
 const selection={artifactId:workbook.artifact.id,version:1,contentHash:workbook.version.contentHash,role:"evidence"};
 const packageInput={projectId:project.id,workflow:"ic_memo",title:"Source-bound native model report",audience:"Owner",reportingPeriod:"2026",sources:[selection],authoredSections:[{title:"Scope",text:"Synthetic model export review"}]};
 const bound=await createProfessionalWorkPackage(ctx,packageInput);
 const [standalonePolicy]=await getDb().insert(dataEntitlementPolicies).values({...currentPolicy,id:crypto.randomUUID(),contentHash:crypto.randomBytes(32).toString("hex")}).returning();
 const independent=await createArtifact(ctx,{projectId:project.id,kind:"report",title:"Independent same-provider source",origin:"direct",content:{kind:"report",blocks:[{id:"independent",type:"paragraph",text:"Separate permission-bound source",attrs:{}}],sections:[]},sourceRefs:["manual:independent"],dependencyRefs:[`entitlement-policy:${standalonePolicy.id}`]});
 const mixed=await createProfessionalWorkPackage(ctx,{...packageInput,title:"Mixed-source rights",sources:[selection,{artifactId:independent.artifact.id,version:1,contentHash:independent.version.contentHash,role:"evidence"}]});
 const [replacement]=await getDb().insert(dataEntitlementPolicies).values({...currentPolicy,id:crypto.randomUUID(),contentHash:crypto.randomBytes(32).toString("hex")}).returning();
 await getDb().update(dataEntitlementPolicies).set({effectiveTo:new Date("2020-01-02")}).where(eq(dataEntitlementPolicies.id,currentPolicy.id));
 await getDb().update(datasetSnapshots).set({entitlementPolicyId:replacement.id}).where(eq(datasetSnapshots.id,snapshotId));
 assert.equal((await getArtifactExportPlan(ctx,bound.artifact.id,1)).contentHash,bound.version.contentHash,"Exact retained model lineage allows current replacement rights without rewriting history");
 assert.equal((await getArtifactExportPlan(ctx,mixed.artifact.id,1)).contentHash,mixed.version.contentHash);
 const word=await prepareReportDocxDownload(ctx,bound.artifact.id,1);
 assert.equal(word.version,1);assert.equal(Buffer.from(word.bytes).subarray(0,2).toString(),"PK");
 const pdf=await prepareReportPdfDownload(ctx,bound.artifact.id,1);
 assert.equal(Buffer.from(pdf.bytes).subarray(0,5).toString(),"%PDF-");
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display"]}).where(eq(dataEntitlementPolicies.id,standalonePolicy.id));
 await assert.rejects(getArtifactExportPlan(ctx,mixed.artifact.id,1),error=>error instanceof Error&&"status" in error&&error.status===403,"A model source's replacement grant cannot discharge an independent source with the same provider/data class");
 await getDb().update(dataEntitlementPolicies).set({permittedUses:["display"]}).where(eq(dataEntitlementPolicies.id,replacement.id));
 await assert.rejects(prepareReportDocxDownload(ctx,bound.artifact.id,1),error=>error instanceof Error&&"status" in error&&error.status===403);
 await assert.rejects(prepareReportPdfDownload(ctx,bound.artifact.id,1),error=>error instanceof Error&&"status" in error&&error.status===403);
});
