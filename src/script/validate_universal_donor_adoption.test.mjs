import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
 loadUniversalDonorAdoptionSources,
 validateUniversalDonorAdoption,
 verifyBundledDonorDestinations,
} from "./validate_universal_donor_adoption.mjs";
const copy=()=>structuredClone(loadUniversalDonorAdoptionSources());
test("every one of 92 donors, 10 forks and 93 registered subsystems is reconciled with source registers",()=>{
 const x=validateUniversalDonorAdoption(copy());
 assert.equal(x.baseline,92);
 assert.equal(x.forks,10);
 assert.equal(x.supplementalForks,6);
 assert.equal(x.registeredSubsystems,93);
 assert.equal(x.pinnedBaseline+x.unPinnedBaseline,92);
 assert.equal(x.newProductFeaturesShippedByAudit,0);
 assert.equal(x.harvestingControlSchema,1);
 assert.equal(x.donorsFullyExhausted,0);
 assert.equal(Object.values(x.bySourceAuditStatus).reduce((a,b)=>a+b,0),92);
 assert.equal(x.status,"policy_queue_validated_with_exhaustive_harvesting_gates");
});
test("missing, duplicate, fake or promoted donor truth is rejected",()=>{
 const a=copy();a.ledger.baselineDonors.pop();
 assert.throws(()=>validateUniversalDonorAdoption(a));
 const b=copy();b.ledger.baselineDonors[1].id=b.ledger.baselineDonors[0].id;
 assert.throws(()=>validateUniversalDonorAdoption(b),/duplicate/);
 const c=copy();c.ledger.baselineDonors.find(x=>x.id==="qlib").baselineTruthStatus="runtime_integrated";
 assert.throws(()=>validateUniversalDonorAdoption(c),/diverged/);
 const d=copy();d.ledger.baselineDonors[2].donorFullyExhausted=true;
 assert.throws(()=>validateUniversalDonorAdoption(d),/exhaustion requires full useful-package audit/);
});
test("fork cannot masquerade as approved source pin or product import",()=>{
 const a=copy();a.ledger.forkWorkQueue.pop();
 assert.throws(()=>validateUniversalDonorAdoption(a));
 const b=copy();b.ledger.forkWorkQueue[0].observedCommit="0".repeat(40);
 assert.throws(()=>validateUniversalDonorAdoption(b),/fork change/);
 const c=copy();c.ledger.supplementalControlledForks[0].sourcePinApprovedForLiOS=true;
 assert.throws(()=>validateUniversalDonorAdoption(c));
 const d=copy();d.ledger.releaseClaims.allForksIntegrated=true;
 assert.throws(()=>validateUniversalDonorAdoption(d),/cannot claim shipped/);
 const e=copy();e.forks.mirrors[0].deltaReviewStatus="invented_state";
 assert.throws(()=>validateUniversalDonorAdoption(e),/invalid fork delta review state/);
 const f=copy();f.forks.mirrors[0].materialDeltaDisposition="imported";
 assert.throws(()=>validateUniversalDonorAdoption(f),/invalid fork delta disposition/);
});
test("source pin, developer path inventory and license remain canonical",()=>{
 const a=copy();a.ledger.baselineDonors.find(x=>x.id==="tradingagents").sourcePin="a".repeat(40);
 assert.throws(()=>validateUniversalDonorAdoption(a),/unapproved source re-pin/);
 const b=copy();b.ledger.baselineDonors.find(x=>x.id==="openclaw").registeredSourcePaths.pop();
 assert.throws(()=>validateUniversalDonorAdoption(b),/lineage drift/);
 const c=copy();const d=c.ledger.baselineDonors.find(x=>x.id==="openclaw");d.componentSubsystems[0].upstreamPaths=["made-up"];
 assert.throws(()=>validateUniversalDonorAdoption(c));
 const e=copy();e.ledger.baselineDonors.find(x=>x.id==="qlib").licenseAsRecorded="Public domain";
 assert.throws(()=>validateUniversalDonorAdoption(e),/diverged/);
});
test("source registry changes invalidate stale donor/component/pin snapshots while fork evidence is validated directly",()=>{
 const a=copy();a.ledger.sourceSnapshot.componentsSha="0".repeat(40);
 assert.throws(()=>validateUniversalDonorAdoption(a),/changed since donor intake audit/);
 const b=copy();b.ledger.sourceSnapshot.controlledForkSha="0".repeat(40);
 assert.doesNotThrow(()=>validateUniversalDonorAdoption(b));
});
test("rejected license decisions and unpinned discoveries are not auto-forked",()=>{
 const {ledger}=copy();
 for(const d of ledger.baselineDonors.filter(x=>x.baselineTruthStatus==="rejected")){
  assert.equal(d.forkDecision,"do_not_fork_blocked_by_recorded_decision");
 }
 const unfixed=ledger.baselineDonors.filter(x=>x.baselineTruthStatus==="discovered"&&!x.sourcePin);
 assert.ok(unfixed.length>0);
 for(const d of unfixed)assert.equal(d.forkDecision,"defer_fork_until_pin_rights_and_package_scope");
});
test("full useful-package and donor-exhaustion claims require explicit harvesting evidence",()=>{
 const a=copy();const donor=a.ledger.baselineDonors.find(x=>x.id==="assistant-ui");
 donor.fullPackageSourceAuditComplete=true;
 donor.sourceAuditStatus="full_useful_package_audit";
 assert.throws(()=>validateUniversalDonorAdoption(a),/material path identified count required/);
 const b=copy();const exhausted=b.ledger.baselineDonors.find(x=>x.id==="assistant-ui");
 exhausted.fullPackageSourceAuditComplete=true;
 exhausted.sourceAuditStatus="full_useful_package_audit";
 exhausted.materialPathCount=2;exhausted.dispositionedMaterialPathCount=2;
 exhausted.mechanismsIdentified=["composer"];exhausted.mechanismsDispositioned=["composer"];
 exhausted.upstreamTestsReviewed=1;exhausted.upstreamTestsDispositioned=1;
 exhausted.donorFullyExhausted=true;
 assert.throws(()=>validateUniversalDonorAdoption(b),/Donor Exhaustion Record required/);
});
test("invalid harvesting control vocabulary is rejected",()=>{
 const a=copy();a.controls.sourceAuditStates=a.controls.sourceAuditStates.filter(x=>x!=="full_useful_package_audit");
 assert.throws(()=>validateUniversalDonorAdoption(a),/full_useful_package_audit/);
});
test("supplemental code imports cannot be confused with full donor runtimes",()=>{
 const a=copy();a.ledger.supplementalSelectedSourceAdoptions[0].fullUpstreamRuntimeInstalled=true;
 assert.throws(()=>validateUniversalDonorAdoption(a));
 const b=copy();b.ledger.supplementalSelectedSourceAdoptions[1].sourcePin="f".repeat(40);
 assert.throws(()=>validateUniversalDonorAdoption(b));
 const c=copy();c.ledger.supplementalSelectedSourceAdoptions[0].packagedShippingPointAccepted=true;
 assert.throws(()=>validateUniversalDonorAdoption(c));
 const d=copy();d.ledger.supplementalSelectedSourceAdoptions[0].id="openclaw";
 assert.throws(()=>validateUniversalDonorAdoption(d));
});
test("browser-use source pin is a merged bounded GM14 guard, never the full browser-use runtime",()=>{
 const first=copy();
 const item=first.ledger.supplementalSelectedSourceAdoptions.find(x=>x.id==="browser-use");
 assert.ok(item);
 assert.equal(item.canonicalOwner,"GM-14");
 assert.equal(item.mergedPR,599);
 assert.equal(item.sourceMechanismImported,true);
 assert.equal(item.fullUpstreamRuntimeInstalled,false);
 assert.equal(item.packagedShippingPointAccepted,false);
 const bad=copy();
 bad.ledger.supplementalSelectedSourceAdoptions.find(x=>x.id==="browser-use").sourcePin="0".repeat(40);
 assert.throws(()=>validateUniversalDonorAdoption(bad));
 const fake=copy();
 fake.ledger.supplementalSelectedSourceAdoptions.find(x=>x.id==="browser-use").fullUpstreamRuntimeInstalled=true;
 assert.throws(()=>validateUniversalDonorAdoption(fake));
});
test("LangAlpha GM bounded parser remains a subcomponent of an existing approved donor baseline",()=>{
 const a=copy();
 const item=a.ledger.selectedBaselineSourceAdoptions.find(x=>x.id==="langalpha-gm-response");
 assert.ok(item);
 assert.equal(item.baselineDonorId,"langalpha");
 assert.equal(item.canonicalOwner,"GM-12");
 assert.equal(item.mergedPR,603);
 assert.equal(item.fullUpstreamRuntimeInstalled,false);
 assert.equal(item.packagedShippingPointAccepted,false);
 assert.equal(item.underlyingBaselinePinPreserved,a.locks.locks.find(x=>x.id==="langalpha").commitSha);
 const b=copy();
 b.ledger.selectedBaselineSourceAdoptions[0].sourcePin="0".repeat(40);
 assert.throws(()=>validateUniversalDonorAdoption(b));
 const c=copy();
 c.ledger.selectedBaselineSourceAdoptions[0].fullUpstreamRuntimeInstalled=true;
 assert.throws(()=>validateUniversalDonorAdoption(c));
 const d=copy();
 d.ledger.selectedBaselineSourceAdoptions[0].baselineDonorId="not-a-donor";
 assert.throws(()=>validateUniversalDonorAdoption(d));
});
test("bundled source admission checks actual regular files and exact package locks without following linked parents",t=>{
 const fixture=mkdtempSync(path.join(os.tmpdir(),"lios-bundled-donor-"));
 t.after(()=>rmSync(fixture,{recursive:true,force:true}));
 const checkout=path.join(fixture,"checkout");
 mkdirSync(path.join(checkout,"src/server"),{recursive:true});
 mkdirSync(path.join(fixture,"outside"),{recursive:true});
 writeFileSync(path.join(checkout,"src/server/reused.ts"),"export const owned = true;\n");
 writeFileSync(path.join(fixture,"outside/escape.ts"),"outside source root\n");
 const options={root:checkout,npmPackages:{"node_modules/example":{version:"1.0.0"}}};
 const manifest=destinationPaths=>({components:[{id:"fixture-donor",bundled:true,destinationPaths}]});
 assert.deepEqual(verifyBundledDonorDestinations(manifest(["server/reused.ts","npm:example@1.0.0"]),options),{sourcePaths:1,npmReferences:1});
 assert.throws(()=>verifyBundledDonorDestinations(manifest(["server/missing.ts"]),options),/missing, linked or not a regular file/);
 assert.throws(()=>verifyBundledDonorDestinations(manifest(["../outside/escape.ts"]),options),/unsafe bundled destination/);
 assert.throws(()=>verifyBundledDonorDestinations(manifest(["server"]),options),/not a regular file/);
 assert.throws(()=>verifyBundledDonorDestinations(manifest(["npm:example@2.0.0"]),options),/no longer matches/);
 symlinkSync(path.join(fixture,"outside"),path.join(checkout,"src/linked"),"junction");
 assert.throws(()=>verifyBundledDonorDestinations(manifest(["linked/escape.ts"]),options),/linked/);
 assert.deepEqual(verifyBundledDonorDestinations({components:[{id:"reference",bundled:false,destinationPaths:["server/missing.ts"]}]},options),{sourcePaths:0,npmReferences:0});
});
