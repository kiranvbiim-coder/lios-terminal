/**
 * CA/GM universal donor policy integrity gate (no network, no donor execution).
 *
 * 92 baseline donor truth entries and 10 controlled mirrors are reconciled with
 * their canonical source registries before any new fork or runtime adoption.
 * Harvesting promotion claims are separately validated against the canonical
 * harvesting control vocabulary; fork identity is checked directly rather than
 * freezing the evolving fork-delta evidence file behind a whole-file snapshot.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
 validateHarvestingControls,
 validateDonorHarvestingClaim,
 validateForkHarvestingClaim,
 deriveSourceAuditStatus,
} from "./donor_harvesting_gate.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const loadJson=(p)=>JSON.parse(readFileSync(path.join(root,p),"utf8"));
const shaGitBlob=(bytes)=>createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
export function loadUniversalDonorAdoptionSources(){
 return {
  ledger:loadJson("third_party/universal-donor-adoption.json"),
  baseline:loadJson("third_party/capability-assimilation.json"),
  forks:loadJson("third_party/controlled-fork-utilization.json"),
  components:loadJson("third_party/components.json"),
  locks:loadJson("third_party/upstream-lock.json"),
  controls:loadJson("third_party/donor-harvesting-controls.json"),
 };
}
/** Source/lock presence only; neither runtime, licensing nor shipping evidence. */
export function verifyBundledDonorDestinations(components, options = {}) {
 const checkoutRoot = path.resolve(options.root ?? root);
 const npmPackages = options.npmPackages ?? JSON.parse(readFileSync(path.join(checkoutRoot,"src/package-lock.json"),"utf8")).packages;
 let sourcePaths = 0, npmReferences = 0;
 for (const component of components.components) {
  if (!component.bundled) continue;
  for (const destination of component.destinationPaths ?? []) {
   assert.equal(typeof destination,"string",component.id+" has invalid bundled path");
   if (destination.startsWith("npm:")) {
    const spec = destination.slice(4), at = spec.lastIndexOf("@");
    assert.ok(at > 0,component.id+" has invalid npm destination reference");
    const name = spec.slice(0,at), version = spec.slice(at+1);
    assert.match(name,/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i);
    assert.ok(!name.includes("..") && version.length > 0 && !version.includes("/"));
    assert.equal(npmPackages["node_modules/"+name]?.version,version,component.id+" npm dependency no longer matches the locked bundled reference "+destination);
    npmReferences++;
    continue;
   }
   const base = component.destinationPathBase ?? "src/";
   const relative = destination.startsWith("src/") ? destination : base+destination;
   const segments = relative.split("/");
   assert.ok(relative.startsWith("src/") && !relative.includes("\\") && !segments.some(part => part === ".." || part === "." || part === ""),
    component.id+" has unsafe bundled destination "+destination);
   let current = checkoutRoot;
   for (let index = 0; index < segments.length; index++) {
    current = path.join(current,segments[index]);
    let stat;
    try { stat = lstatSync(current); } catch {}
    assert.ok(stat && !stat.isSymbolicLink() && (index === segments.length-1 ? stat.isFile() : stat.isDirectory()),
     component.id+" bundled source destination is missing, linked or not a regular file: "+relative);
   }
   sourcePaths++;
  }
 }
 return { sourcePaths, npmReferences };
}
function assertUniqueIds(rows,field,label){
 const ids=rows.map(x=>x[field]);
 assert.equal(new Set(ids).size,ids.length,label+" has duplicate "+field);
}
export function validateUniversalDonorAdoption({ledger,baseline,forks,components,locks,controls}){
 validateHarvestingControls(controls);
 assert.equal(ledger.schemaVersion,1);
 assert.equal(ledger.program,"CA+GM universal donor and controlled fork adoption");
 assert.equal(ledger.policyAuthority,"docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md");
 assert.equal(ledger.truthAuthority,"third_party/capability-assimilation.json");
 assert.equal(ledger.scope,"92_baseline_plus_10_controlled_forks_policy_execution_not_runtime_installation");
 assert.equal(ledger.baselineDonorCount,92);
 assert.equal(ledger.controlledForkCount,10);
 assert.equal(baseline.donors.length,92);
 assert.equal(forks.mirrors.length,10);
 assert.equal(forks.harvestingControls,"third_party/donor-harvesting-controls.json");
 assert.equal(ledger.baselineDonors.length,92);
 assert.equal(ledger.forkWorkQueue.length,10);
 assert.equal(ledger.supplementalControlledForks.length,6);
 assertUniqueIds(ledger.baselineDonors,"id","baseline ledger");
 assertUniqueIds(ledger.forkWorkQueue,"id","controlled fork ledger");
 assertUniqueIds(ledger.supplementalControlledForks,"id","supplemental fork queue");
 for(const [key,file] of [
  ["baselineSha","third_party/capability-assimilation.json"],
  ["componentsSha","third_party/components.json"],
  ["upstreamPinsSha","third_party/upstream-lock.json"],
 ]) {
  const bytes=readFileSync(path.join(root,file));
  assert.equal(ledger.sourceSnapshot[key],shaGitBlob(bytes),file+" changed since donor intake audit; refresh source evidence");
 }
 for(const [key,value] of Object.entries(ledger.releaseClaims)) {
  assert.equal(value,false,"Universal donor ledger cannot claim shipped/full integration: "+key);
 }
 const bundledDestinations=verifyBundledDonorDestinations(components);
 const cmp=new Map(components.components.map(x=>[x.id,x]));
 const pins=new Map(locks.locks.map(x=>[x.id,x]));
 const realForks=new Map(forks.mirrors.map(x=>[x.id,x]));
 const realBaseline=new Map(baseline.donors.map(x=>[x.id,x]));
 const baselineForks=new Map(forks.mirrors.filter(x=>x.baselineDonorId).map(x=>[x.baselineDonorId,x]));
 assert.equal(realBaseline.size,92);
 assert.equal(realForks.size,10);
 const statuses=new Map();
 const auditStatuses=new Map();
 let sourcePinned=0,notPinned=0,subsystemCount=0,materialPaths=0;
 let exhaustedDonors=0;
 for(const row of ledger.baselineDonors){
  const truth=realBaseline.get(row.id);
  assert.ok(truth,"unknown baseline donor "+row.id);
  for(const [field,actual] of [
   ["upstreamRepository",truth.repository],
   ["licenseAsRecorded",truth.license],
   ["canonicalOwner",truth.canonicalOwner],
   ["baselineTruthStatus",truth.currentTruthStatus],
   ["declaredDecision",truth.declaredDecision],
   ["declaredPosture",truth.declaredPosture],
   ["evidenceAsRecorded",truth.evidence],
  ])assert.equal(row[field],actual,row.id+" diverged on "+field);
  assert.deepEqual(row.sourceRegistries,truth.sourceRegistries);
  const comp=cmp.get(row.id),pin=pins.get(row.id);
  assert.equal(row.componentRegistered,Boolean(comp),row.id+" component identity drift");
  if(comp) {
   assert.equal(comp.repository,row.upstreamRepository);
   assert.deepEqual(row.registeredSourcePaths,comp.importedPaths??[],row.id+" copied-source lineage drift");
   assert.deepEqual(row.registeredDestinationPaths,comp.destinationPaths??[],row.id+" import target drift");
   assert.equal(row.componentSubsystems.length,comp.subsystems?.length??0);
   for(let i=0;i<row.componentSubsystems.length;i++){
    const s=row.componentSubsystems[i],orig=comp.subsystems[i];
    assert.equal(s.name,orig.name);
    assert.equal(s.classification,orig.classification);
    assert.deepEqual(s.upstreamPaths,orig.paths??[]);
    assert.deepEqual(s.integrationRequirements,orig.requirements??[]);
    assert.equal(s.status,"requires_path_level_implementation_evidence");
   }
  }else{
   assert.deepEqual(row.registeredSourcePaths,[]);
   assert.deepEqual(row.registeredDestinationPaths,[]);
   assert.deepEqual(row.componentSubsystems,[]);
  }
  subsystemCount+=row.componentSubsystems.length;
  materialPaths+=row.registeredSourcePaths.length;
  if(comp&&pin){
   assert.equal(comp.repository,pin.repository,row.id+" source repo lock mismatch");
   assert.equal(comp.commitSha,pin.commitSha,row.id+" exact source pin mismatch");
  }
  const expectedPin=pin?.commitSha??comp?.commitSha??null;
  assert.equal(row.sourcePin,expectedPin,row.id+" unapproved source re-pin");
  assert.equal(row.sourcePinState,expectedPin?"registered_pin_not_automatically_approved_for_new_paths":"pin_required_before_source_import");
  if(expectedPin){assert.match(expectedPin,/^[a-f0-9]{40}$/);sourcePinned++}else notPinned++;
  const fork=baselineForks.get(row.id);
  assert.equal(row.linkedControlledFork,fork?.forkRepository??null);
  if(fork)assert.match(row.forkDecision,/^controlled_fork_exists/);
  if(row.baselineTruthStatus==="rejected")assert.equal(row.forkDecision,"do_not_fork_blocked_by_recorded_decision");
  assert.equal(row.packagedShippingPointAccepted,false);
  assert.ok(row.ownerReviewGate?.length>40);
  assert.ok(row.priorityBand?.startsWith("P"));
  const harvest=validateDonorHarvestingClaim(row,controls);
  const auditStatus=deriveSourceAuditStatus(row,controls);
  assert.equal(harvest.auditStatus,auditStatus);
  auditStatuses.set(auditStatus,(auditStatuses.get(auditStatus)||0)+1);
  if(harvest.exhausted) exhaustedDonors++;
  statuses.set(row.baselineTruthStatus,(statuses.get(row.baselineTruthStatus)||0)+1);
 }
 for(const mirror of ledger.forkWorkQueue){
  const original=realForks.get(mirror.id);
  assert.ok(original,"unregistered mirror "+mirror.id);
  for(const [name,key] of [
   ["forkRepository","forkRepository"],["upstreamRepository","upstreamRepository"],
   ["observedCommit","observedCommit"],["baselineDonorId","baselineDonorId"],
   ["truthStatus","status"],["nextAction","nextAction"]
  ])assert.equal(mirror[name],original[key],mirror.id+" fork change "+name);
  assert.deepEqual(mirror.si05Workstreams,original.si05Workstreams??[]);
  assert.equal(mirror.adoptionStatus,"source_or_mirror_observed_not_a_new_integration_claim");
  assert.match(mirror.observedCommit,/^[a-f0-9]{40}$/);
  if(mirror.baselineDonorId)assert.ok(realBaseline.has(mirror.baselineDonorId));
  validateForkHarvestingClaim(original,controls);
 }
 const supplemental=new Set(forks.mirrors.filter(x=>!x.baselineDonorId).map(x=>x.id));
 assert.deepEqual(new Set(ledger.supplementalControlledForks.map(x=>x.id)),supplemental);
 for(const x of ledger.supplementalControlledForks){
  const f=realForks.get(x.id);
  assert.equal(x.forkRepository,f.forkRepository);
  assert.equal(x.upstreamRepository,f.upstreamRepository);
  assert.equal(x.mirrorObservedCommit,f.observedCommit);
  assert.equal(x.baselineMember,false);
  assert.equal(x.sourcePinApprovedForLiOS,false);
  assert.equal(x.donorCodeIntegratedByForkAlone,false);
  assert.equal(x.forkDecision,"already_forked_no_duplicate");
  assert.ok(x.legalGate.length>30);
 }

 const selected=ledger.supplementalSelectedSourceAdoptions??[];
 assert.equal(selected.length,3,"Source adoption evidence must be refreshed when supplemental imports change");
 assert.equal(new Set(selected.map(x=>x.id)).size,selected.length);
 for(const item of selected){
   assert.ok(supplemental.has(item.id),"Cannot promote a baseline donor through supplemental import records");
   assert.equal(item.componentId,item.id);
   const component=cmp.get(item.componentId),lock=pins.get(item.id);
   assert.ok(component&&lock,"Imported supplemental source needs a component and exact upstream lock");
   assert.equal(component.repository,lock.repository);
   assert.equal(component.commitSha,lock.commitSha);
   assert.equal(item.sourcePin,lock.commitSha);
   assert.ok(component.importedPaths.length>=2&&component.destinationPaths.length>=1);
   assert.equal(component.bundled,true,"Selected adapted source must actually be bundled in LiOS");
   assert.equal(item.sourceMechanismImported,true);
   assert.equal(item.fullUpstreamRuntimeInstalled,false);
   assert.equal(item.packagedShippingPointAccepted,false);
   assert.match(item.mergeCommit,/^[a-f0-9]{40}$/);
   assert.ok(Number.isSafeInteger(item.mergedPR)&&item.mergedPR>0);
 }

 const selectedBaseline=ledger.selectedBaselineSourceAdoptions??[];
 assert.equal(selectedBaseline.length,1,"One source-pinned LangAlpha subcomponent was adopted; baseline donor remains singular");
 for(const item of selectedBaseline){
   assert.ok(realBaseline.has(item.baselineDonorId),"Baseline source adoption cannot invent a new donor");
   assert.ok(!supplemental.has(item.id),"Baseline adoption cannot impersonate supplemental fork");
   assert.equal(item.id,"langalpha-gm-response");
   assert.equal(item.componentId,item.id);
   const baselineLock=pins.get(item.baselineDonorId),base=realBaseline.get(item.baselineDonorId);
   const component=cmp.get(item.id),lock=pins.get(item.id);
   assert.ok(base&&baselineLock&&component&&lock);
   assert.equal(component.baselineDonorId,item.baselineDonorId);
   assert.equal(lock.baselineDonorId,item.baselineDonorId);
   assert.equal(base.repository,component.repository);
   assert.equal(component.repository,lock.repository);
   assert.equal(component.commitSha,lock.commitSha);
   assert.equal(item.sourcePin,lock.commitSha);
   assert.equal(item.underlyingBaselinePinPreserved,baselineLock.commitSha);
   assert.ok(component.importedPaths.length>=2&&component.destinationPaths.length>=1);
   assert.equal(component.bundled,true);
   assert.equal(item.sourceMechanismImported,true);
   assert.equal(item.fullUpstreamRuntimeInstalled,false);
   assert.equal(item.packagedShippingPointAccepted,false);
   assert.match(item.mergeCommit,/^[a-f0-9]{40}$/);
   assert.ok(Number.isSafeInteger(item.mergedPR));
 }
 assert.ok(Array.isArray(ledger.universalGate)&&ledger.universalGate.length>=10);
 // The 92-donor register remains legal/history evidence, not an import-all backlog.
 // Only source-adopted, named user journeys are eligible for active work.
 assert.ok(Array.isArray(ledger.executionPriorities)&&ledger.executionPriorities.length>=1&&ledger.executionPriorities.length<=2,
  "Active donor work must be a small, named queue, not four open-ended harvesting waves");
 assert.equal(ledger.activeQueuePolicy?.automaticPromotionFromDocumentedOrReference,false);
 assert.equal(ledger.activeQueuePolicy?.forkExistenceIsAdoption,false);
 assert.ok(ledger.activeQueuePolicy.maxActiveDonors>0&&ledger.activeQueuePolicy.maxActiveDonors<=12);
 const selectedBaselineDonors=new Set((ledger.selectedBaselineSourceAdoptions??[]).map(x=>x.baselineDonorId));
 const selectedSupplementalDonors=new Set((ledger.supplementalSelectedSourceAdoptions??[]).map(x=>x.id));
 const supplementalById=new Map(ledger.supplementalControlledForks.map(x=>[x.id,x]));
 const activeDonorIds=new Set();
 for(const [index,wave] of ledger.executionPriorities.entries()){
  assert.equal(wave.wave,index+1,"Active donor waves must be sequential");
  assert.ok(Array.isArray(wave.donors)&&wave.donors.length>0);
  assert.ok(typeof wave.userJourney==="string"&&wave.userJourney.length>=35,"An active donor needs a named LiOS user journey");
  assert.ok(typeof wave.gate==="string"&&wave.gate.length>=35,"An active donor needs concrete verification gates");
  for(const id of wave.donors){
   assert.equal(typeof id,"string");
   assert.ok(!activeDonorIds.has(id),"Duplicate active donor: "+id);
   activeDonorIds.add(id);
   const candidate=realBaseline.get(id);
   if(candidate){
    const historical=candidate.currentTruthStatus;
    const activeTruth=/^(?:runtime_integrated|runtime_integrated_optional|runtime_integrated_connector|partially_integrated|provider_integrated_external_runtime)$/.test(historical);
    assert.ok(activeTruth||selectedBaselineDonors.has(id),
     "Donor has no accepted source adoption or active user journey: "+id);
   }else{
    assert.ok(supplementalById.has(id)&&selectedSupplementalDonors.has(id),
     "Unknown or unapproved supplemental donor in active queue: "+id);
   }
  }
 }
 assert.ok(activeDonorIds.size<=ledger.activeQueuePolicy.maxActiveDonors,"Donor active queue exceeds approved small-workstream cap");
 assert.equal(ledger.blockers.length>=6,true);
 return {
  status:"policy_queue_validated_with_exhaustive_harvesting_gates",
  baseline:ledger.baselineDonors.length,forks:ledger.forkWorkQueue.length,
  supplementalForks:ledger.supplementalControlledForks.length,
  pinnedBaseline:sourcePinned,unPinnedBaseline:notPinned,
  registeredSubsystems:subsystemCount,previouslyRecordedImportedSourcePaths:materialPaths,
  byTruthStatus:Object.fromEntries([...statuses].sort((a,b)=>a[0].localeCompare(b[0]))),
  bySourceAuditStatus:Object.fromEntries([...auditStatuses].sort((a,b)=>a[0].localeCompare(b[0]))),
  donorsFullyExhausted:exhaustedDonors,
  harvestingControlSchema:controls.schemaVersion,
  bundledDestinations,
  newProductFeaturesShippedByAudit:0,
 };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 console.log(JSON.stringify(validateUniversalDonorAdoption(loadUniversalDonorAdoptionSources()),null,2));
}
