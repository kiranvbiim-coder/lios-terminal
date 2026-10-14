import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lios-numeric-lineage-"));
process.env.LIMURIA_DATA_DIR=root;
const {initDb,closeDb,getDb}=await import("./db");
const {users}=await import("@shared/schema");
const {createProject}=await import("./projectStore");
const {indexProjectDocument}=await import("./p7ProjectIntelligenceStore");
const {getArtifactVersion,createArtifactVersion,assertArtifactContentSafe}=await import("./artifactStore");
const {artifactContentSchema}=await import("@shared/artifactContracts");
const {numericalEvidenceSchema,normalizeEvidenceDecimal}=await import("@shared/numericalEvidenceContracts");
const {numericalEvidenceTool}=await import("./numericalEvidenceTool");
const {GovernedToolRegistry}=await import("./governedTools");
const {listProjectLedgerEvents}=await import("./ledgerStore");

test("decimal normalization is exact and refuses ambiguous locale, scale and unsupported tokens",()=>{
  assert.equal(normalizeEvidenceDecimal("9,007,199,254,740,993.2500"),"9007199254740993.25");
  assert.equal(normalizeEvidenceDecimal("(1,234.50)"),"-1234.5");
  assert.equal(normalizeEvidenceDecimal("-0.000"),"0");
  assert.equal(normalizeEvidenceDecimal("+000123.450"),"123.45");
  assert.equal(normalizeEvidenceDecimal("18.00%", "%"), "18", "explicit percent units remain percent points; no hidden divide-by-100");
  for(const ambiguous of ["1,23","1.234,56","12%","$12","1e3","NaN","( -12 )","—",""]) assert.equal(normalizeEvidenceDecimal(ambiguous),null);
});

test("structured document fields become immutable output cells with checked hashes and ledger usage",async t=>{
 await initDb(); t.after(async()=>{await closeDb();fs.rmSync(root,{recursive:true,force:true});});
 const [owner]=await getDb().insert(users).values({email:crypto.randomUUID()+"@example.test",passwordHash:"test",name:"Owner",role:"internal_analyst"}).returning();
 const tenant={userId:owner.id,organizationId:null,role:owner.role};
 const project=await createProject(tenant,{name:"Numbers"});
 const indexed=await indexProjectDocument(tenant,{projectId:project.id,sourceType:"document",sourceRef:"document:financial-table",title:"Financial table",body:"Revenue 9,007,199,254,740,993.2500",metadata:{structureKind:"table",tableId:"t1",anchor:{pageNumber:2,lineRange:{start:4,end:8}},financialRows:[
  {metric:"Revenue",period:"FY2025",value:"9,007,199,254,740,993.2500",unit:"USD millions",currency:"USD",rowIndex:0,valueColumn:"FY2025"},
  {metric:"Expense",period:null,value:"(1,234.50)",unit:null,currency:null,rowIndex:1,valueColumn:"value"},
  {metric:"Unclear",period:null,value:"1,23",unit:null,currency:null,rowIndex:2,valueColumn:"value"},
 ]}});
 const registry=new GovernedToolRegistry();registry.register(numericalEvidenceTool);
 const call={source:"agent" as const,tenant,userId:owner.id,projectId:project.id,requestId:crypto.randomUUID(),sourceScope:"my_data" as const,resourceTransmissionAllowed:true};
 const signal=new AbortController().signal;
 const result=await registry.invoke(numericalEvidenceTool.id,{sourceRef:"document:financial-table",title:"Cited numerical inputs"},signal,call);
 const output=result.output as {artifactId:string;rejectedValues:number;valueCount:number;incomplete:boolean};
 assert.equal(output.valueCount,2);assert.equal(output.rejectedValues,1);assert.equal(output.incomplete,true);
 const version=await getArtifactVersion(tenant,output.artifactId);
 const content=artifactContentSchema.parse(version.content);
 assert.equal(content.kind,"table");if(content.kind!=="table") throw new Error("Table required");
 assert.equal(content.rows[0].value,"9007199254740993.25");assert.equal(content.rows[1].value,"-1234.5");
 const evidence=content.numericalEvidence!;
 assert.equal(evidence[0].source.contentHash,indexed.contentHash);
 assert.equal(evidence[0].source.period,"FY2025");assert.equal(evidence[0].source.unit,"USD millions");
 assert.equal(evidence[0].source.row,0);assert.equal(evidence[0].source.column,"FY2025");assert.equal(evidence[0].source.pageNumber,2);
 assert.deepEqual(evidence[1].unknowns,["period","unit","currency"]);
 assert.equal(evidence[0].transformations[0].inputHash,crypto.createHash("sha256").update(evidence[0].rawValue).digest("hex"));
 assert.equal(evidence[0].transformations[0].outputHash,crypto.createHash("sha256").update("9007199254740993.25").digest("hex"));
 const events=await listProjectLedgerEvents(tenant,project.id,{eventType:"artifact.created"});
 const event=events.find(e=>e.payload.artifactId===output.artifactId)!;
 const entries=event.payload.numericalEvidenceLedger as Array<{downstreamRef:string;sourceContentHash:string;period:string}>;
 assert.equal(entries[0].downstreamRef,`${output.artifactId}@v1#cell:0:value`);assert.equal(entries[0].sourceContentHash,indexed.contentHash);assert.equal(entries[0].period,"FY2025");
 const invalidCell={...content,rows:content.rows.map((row,index)=>index===0?{...row,value:"9007199254740992.25"}:row)};
 await assert.rejects(createArtifactVersion(tenant,{artifactId:output.artifactId,baseVersion:1,content:invalidCell}),/exact current output cell/);
 const tampered={...content,numericalEvidence:evidence.map((e,index)=>index?e:{...e,transformations:[{...e.transformations[0],outputHash:"0".repeat(64)}]})};
 assert.throws(()=>assertArtifactContentSafe(tampered),/hashes do not match/);
 assert.equal(numericalEvidenceSchema.safeParse({...evidence[0],normalizedValue:"9007199254740992.25",transformations:[{...evidence[0].transformations[0],outputHash:crypto.createHash("sha256").update("9007199254740992.25").digest("hex")}]}).success,false,"matching forged hashes cannot legitimize a changed source number");
 assert.equal(numericalEvidenceSchema.safeParse({...evidence[0],source:{...evidence[0].source,kind:"provider",provider:null,receiptRef:null}}).success,false);
 await assert.rejects(registry.invoke(numericalEvidenceTool.id,{sourceRef:"document:financial-table",title:"No"},signal,{...call,allowedSourceRefs:["document:other"]}),/not available/);
 await assert.rejects(registry.invoke(numericalEvidenceTool.id,{sourceRef:"document:financial-table",title:"No"},signal,{...call,resourceTransmissionAllowed:false}),/transmission is disabled/);
 await closeDb();await initDb();
 assert.deepEqual(artifactContentSchema.parse((await getArtifactVersion(tenant,output.artifactId)).content),content);
});
