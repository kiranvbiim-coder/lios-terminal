/**
 * Offline SI-05 donor-policy evidence gate for the full pinned TradingAgents
 * Python source tree. This is a disposition audit, not an upstream install,
 * a license grant, or a declaration that every donor capability is packaged.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(readFileSync(path.join(root,p),"utf8"));
export function loadTradingAgentsDonorInputs() {
  return {
    snapshot: read("third_party/tradingagents-path-dispositions.json"),
    components: read("third_party/components.json"),
    pins: read("third_party/upstream-lock.json"),
    registry: read("third_party/capability-assimilation.json"),
    notice: readFileSync(path.join(root,"THIRD_PARTY_NOTICES.md"),"utf8"),
  };
}
export function validateTradingAgentsDonorAdoption({snapshot,components,pins,registry,notice}) {
  assert.equal(snapshot.schemaVersion,1);
  assert.equal(snapshot.scope,"source_path_and_rights_audit_not_wholesale_fork_import_or_sp05_acceptance");
  assert.equal(snapshot.authority,"docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md");
  const donor=components.components.find(c=>c.id==="tradingagents");
  const lock=pins.locks.find(c=>c.id==="tradingagents");
  const baseline=registry.donors.find(c=>c.id==="tradingagents");
  assert.ok(donor&&lock&&baseline,"TradingAgents requires its canonical 92-donor baseline entry and source pin");
  assert.equal(registry.donors.length,92);
  for (const record of [donor,lock,baseline]) {
    assert.equal(record.repository,snapshot.upstreamRepository);
    assert.equal(record.license,snapshot.license);
  }
  assert.equal(snapshot.approvedPin,lock.commitSha);
  assert.equal(snapshot.approvedPin,donor.commitSha);
  assert.match(snapshot.approvedPin,/^[0-9a-f]{40}$/);
  assert.match(snapshot.observedUpstreamTreeSha,/^[0-9a-f]{40}$/);
  assert.equal(snapshot.forkHeadIsApprovedPin,false,"A fork observation cannot silently replace an approved upstream pin");
  assert.equal(snapshot.selectedIntegration.packaged,false);
  assert.equal(snapshot.selectedIntegration.shipped,false);
  assert.equal(snapshot.selectedIntegration.upstreamRuntimeInstalled,false);
  assert.equal(baseline.currentTruthStatus,"partially_integrated",
    "Only the bounded merged donor source mechanics are adopted, not full TradingAgents runtime");
  assert.equal(donor.bundled,true,"Merged bounded source adaptation must be recorded as bundled");
  assert.deepEqual([...donor.importedPaths].sort(),
    snapshot.sourceFiles.filter(x=>x.disposition==="adapted_mechanisms").map(x=>x.path).sort());
  assert.ok(donor.destinationPaths.includes("server/tradingAgentsResearchGate.mjs"));
  assert.equal(snapshot.selectedIntegration.pr,633);
  assert.equal(snapshot.selectedIntegration.mergeCommit,"5aa2f455b1e7f4cf85285e85ee868d7c6112732c");
  assert.equal(snapshot.selectedIntegration.nativeV1Run,"38150791824");
  assert.ok(readFileSync(path.join(root,"src/server/tradingAgentsResearchGate.mjs")).length>100);
  assert.match(notice,/TradingAgents.*Apache-2\.0/);
  assert.equal(snapshot.licenseFile,"third_party/licenses/tradingagents-Apache-2.0.txt");
  assert.equal(snapshot.licenseUpstreamBlobSha,"261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64");
  const licenseBytes=readFileSync(path.join(root,snapshot.licenseFile));
  const licenseHash=createHash("sha1")
    .update("blob "+licenseBytes.length+String.fromCharCode(0)).update(licenseBytes).digest("hex");
  assert.equal(licenseHash,snapshot.licenseUpstreamBlobSha,
    "Full Apache donor license must match exact upstream Git blob");
  assert.match(notice,/tradingAgentsResearchGate\.mjs/);
  assert.equal(snapshot.sourceFiles.length,75,"Full pinned source-path inventory unexpectedly changed; audit tree diffs");
  assert.ok(snapshot.upstreamTests.length>=20);
  assert.ok(snapshot.essentialDependencySubstitutions.length>=7);
  const seen=new Set();
  const sourceBlobs=new Set();
  let adapted=0, substituted=0, deferred=0;
  for(const entry of snapshot.sourceFiles){
    assert.match(entry.path,/^tradingagents\/[a-zA-Z0-9_./-]+\.py$/);
    assert.ok(!seen.has(entry.path),"Source path appears twice");
    seen.add(entry.path);
    assert.match(entry.upstreamBlobSha,/^[0-9a-f]{40}$/);
    sourceBlobs.add(entry.upstreamBlobSha);
    assert.ok(entry.liOSOwner&&entry.liOSOwner.length>=2);
    assert.ok(entry.reason&&entry.reason.length>=70,"Material exclusion/adoption needs concrete source-specific rationale");
    if(entry.disposition==="adapted_mechanisms") {
      assert.equal(entry.destination,"src/server/tradingAgentsResearchGate.mjs");
      adapted++;
    }else{
      assert.ok(!entry.destination||entry.disposition==="adapt_review",
        "An unadopted donor file cannot silently claim a LiOS destination");
      if(entry.disposition.startsWith("replace_")) substituted++;
      else deferred++;
    }
  }
  assert.ok(adapted>=9,"Risk roles/rating/openings/graph should be accounted for as adapted");
  assert.ok(substituted>=30,"Duplicate provider/AI/graph authorities require dispositions");
  assert.ok(deferred>=20,"Unqualified whole packages must remain explicitly held");
  assert.ok(sourceBlobs.size>=60);
  const testPaths=new Set();
  for(const entry of snapshot.upstreamTests){
    assert.match(entry.path,/^tests\/test_[a-z0-9_]+\.py$/);
    assert.match(entry.upstreamBlobSha,/^[0-9a-f]{40}$/);
    assert.ok(!testPaths.has(entry.path),"Duplicate upstream test disposition");
    testPaths.add(entry.path);
    assert.ok(entry.reason.length>=45);
  }
  for(const name of ["test_rating_integrity.py","test_debate_opening.py","test_risk_router_path_map.py"]){
    assert.ok(testPaths.has("tests/"+name),"Required upstream regression not dispositioned: "+name);
  }
  const original=new Set(snapshot.essentialDependencySubstitutions.map(x=>x.upstream));
  assert.equal(original.size,snapshot.essentialDependencySubstitutions.length);
  for(const dep of snapshot.essentialDependencySubstitutions){
    assert.ok(["substitute","adapt","defer"].includes(dep.decision));
    assert.ok(dep.reason.length>=40&&dep.liOSOwner);
  }
  return Object.freeze({sourcePaths:seen.size,adaptedMechanismPaths:adapted,
    authoritySubstitutions:substituted,deferredOrReviewedPaths:deferred,upstreamTests: testPaths.size,
    approvedPin:snapshot.approvedPin,status:"audit_only_no_automatic_package_approval"});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  console.log(JSON.stringify(validateTradingAgentsDonorAdoption(loadTradingAgentsDonorInputs()),null,2));
