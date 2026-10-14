/**
 * Offline all-ten controlled-fork source-rights gate. This protects correct
 * provenance and rights status; it does not fetch or distribute donor code.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const load=(p)=>JSON.parse(readFileSync(path.join(root,p),"utf8"));
export function loadControlledForkSourceGates(){
 return { gates:load("third_party/controlled-fork-source-gates.json"),
          mirrors:load("third_party/controlled-fork-utilization.json"),
          donorTruth:load("third_party/capability-assimilation.json") };
}
export function validateControlledForkSourceGates({gates,mirrors,donorTruth}){
 assert.equal(gates.schemaVersion,1);
 assert.equal(gates.scope,"all_ten_controlled_forks_root_license_and_source_gate_not_full_path_audit");
 assert.equal(gates.authority,"docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md");
 assert.equal(gates.audit.length,10);
 assert.equal(mirrors.mirrors.length,10);
 assert.equal(donorTruth.donors.length,92);
 const ids=new Set(),sources=new Set();
 for(const line of gates.audit){
  assert.ok(!ids.has(line.id),"Duplicate controlled fork source gate "+line.id);
  ids.add(line.id);
  assert.ok(!sources.has(line.forkRepository),"Duplicate fork source gate "+line.forkRepository);
  sources.add(line.forkRepository);
  const actual=mirrors.mirrors.find(x=>x.id===line.id);
  assert.ok(actual,"Unknown source-gate fork "+line.id);
  assert.equal(line.forkRepository,actual.forkRepository);
  assert.equal(line.upstreamRepository,actual.upstreamRepository);
  assert.equal(line.observedMirrorHead,actual.observedCommit);
  assert.match(line.observedMirrorHead,/^[a-f0-9]{40}$/);
  assert.equal(line.parentVerifiedViaRepositoryMetadata,true);
  assert.ok(line.rootMarkersObserved.length>=4);
  assert.equal(new Set(line.rootMarkersObserved).size,line.rootMarkersObserved.length);
  assert.ok(line.rightsGate?.length>90);
  assert.ok(line.selectedSubsystemCandidate?.length>=45);
  for(const gate of [
   "fullRelevantSourcePackageInspected","exactPathRightsApproved",
   "newSourceImportApproved","modelOrDatasetRightsApproved",
   "existingProductRuntimeProvenByThisGate","shippedByThisGate"
  ])assert.equal(line[gate],false,"Fork source metadata cannot approve "+gate);
  if(line.gitHubRootLicenseSpdx===null){
   assert.equal(line.licenseStatus,"block_import_missing_license");
   assert.equal(line.rootLicenseFile,null);
  }else{
   assert.ok(["MIT","Apache-2.0"].includes(line.gitHubRootLicenseSpdx));
   assert.equal(line.licenseStatus,"root_license_observed_component_rights_pending");
   assert.ok(line.rootMarkersObserved.includes(line.rootLicenseFile));
  }
 }
 assert.equal(ids.size,10);
 const dex=gates.audit.find(x=>x.id==="dexter-js");
 assert.ok(dex);
 assert.equal(dex.gitHubRootLicenseSpdx,null);
 assert.equal(dex.licenseStatus,"block_import_missing_license");
 assert.equal(dex.upstreamRepository,"rodionlim/dexter-js");
 assert.notEqual(dex.upstreamRepository,donorTruth.donors.find(x=>x.id==="dexter")?.repository);
 const cua=gates.audit.find(x=>x.id==="cua");
 assert.ok(cua.rootMarkersObserved.includes("LICENSING.md"));
 assert.ok(cua.rootMarkersObserved.includes("COMMERCIAL.md"));
 const fin=gates.audit.find(x=>x.id==="FinGPT");
 assert.match(fin.rightsGate,/model weights/);
 return Object.freeze({auditedControlledForks:ids.size,
  rootLicensesObserved:gates.audit.filter(x=>x.rootLicenseFile).length,
  licenseBlockedForks:gates.audit.filter(x=>x.licenseStatus==="block_import_missing_license").map(x=>x.id),
  sourcePackagesFullyQualified:0,
  shippedProductsQualifiedByAudit:0});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 console.log(JSON.stringify(validateControlledForkSourceGates(loadControlledForkSourceGates()),null,2));
