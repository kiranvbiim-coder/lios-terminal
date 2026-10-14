import test from "node:test";
import assert from "node:assert/strict";
import {loadControlledForkSourceGates,validateControlledForkSourceGates} from "./validate_controlled_fork_source_gates.mjs";
const copy=()=>structuredClone(loadControlledForkSourceGates());
test("all 10 controlled forks have independent source/root/license gates",()=>{
 const x=validateControlledForkSourceGates(copy());
 assert.equal(x.auditedControlledForks,10);
 assert.equal(x.rootLicensesObserved,9);
 assert.deepEqual(x.licenseBlockedForks,["dexter-js"]);
 assert.equal(x.sourcePackagesFullyQualified,0);
 assert.equal(x.shippedProductsQualifiedByAudit,0);
});
test("missing-source-rights fork cannot be silently marked importable",()=>{
 const a=copy();a.gates.audit.find(x=>x.id==="dexter-js").licenseStatus="root_license_observed_component_rights_pending";
 assert.throws(()=>validateControlledForkSourceGates(a));
 const b=copy();b.gates.audit.find(x=>x.id==="dexter-js").gitHubRootLicenseSpdx="MIT";
 assert.throws(()=>validateControlledForkSourceGates(b));
});
test("metadata, parent and head cannot be replaced by another fork or fake commit",()=>{
 const a=copy();a.gates.audit[0].observedMirrorHead="0".repeat(40);
 assert.throws(()=>validateControlledForkSourceGates(a));
 const b=copy();b.gates.audit[0].upstreamRepository="someoneelse/fake";
 assert.throws(()=>validateControlledForkSourceGates(b));
 const c=copy();c.gates.audit[1].id=c.gates.audit[0].id;
 assert.throws(()=>validateControlledForkSourceGates(c),/Duplicate/);
});
test("license metadata and README do not approve imports, assets or shipped runtimes",()=>{
 for(const field of ["newSourceImportApproved","exactPathRightsApproved","modelOrDatasetRightsApproved","shippedByThisGate","fullRelevantSourcePackageInspected"]){
  const x=copy();x.gates.audit[4][field]=true;
  assert.throws(()=>validateControlledForkSourceGates(x),field);
 }
});
