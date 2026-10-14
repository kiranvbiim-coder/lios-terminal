import test from "node:test";
import assert from "node:assert/strict";
import {loadTradingAgentsDonorInputs,validateTradingAgentsDonorAdoption} from "./validate_tradingagents_adoption.mjs";
const original=loadTradingAgentsDonorInputs();
const copy=()=>structuredClone(original);
test("complete source-path audit remains pinned, reconciled and unshipped",()=>{
 const result=validateTradingAgentsDonorAdoption(copy());
 assert.equal(result.sourcePaths,75);
 assert.equal(result.adaptedMechanismPaths,9);
 assert.equal(result.upstreamTests,20);
 assert.equal(result.status,"audit_only_no_automatic_package_approval");
});
test("fork HEAD cannot replace upstream pin, and merged bounded code cannot claim packaging",()=>{
 const a=copy();a.snapshot.approvedPin="0".repeat(40);
 assert.throws(()=>validateTradingAgentsDonorAdoption(a),/Expected values to be strictly equal/);
 const b=copy();b.snapshot.selectedIntegration.shipped=true;
 assert.throws(()=>validateTradingAgentsDonorAdoption(b));
 const c=copy();c.snapshot.forkHeadIsApprovedPin=true;
 assert.throws(()=>validateTradingAgentsDonorAdoption(c));
});
test("each exact donor path needs singular blob-level provenance and explicit disposition",()=>{
 const a=copy();a.snapshot.sourceFiles[0].upstreamBlobSha="HEAD";
 assert.throws(()=>validateTradingAgentsDonorAdoption(a));
 const b=copy();b.snapshot.sourceFiles[1].path=b.snapshot.sourceFiles[0].path;
 assert.throws(()=>validateTradingAgentsDonorAdoption(b),/appears twice/);
 const c=copy();c.snapshot.sourceFiles[2].reason="later";
 assert.throws(()=>validateTradingAgentsDonorAdoption(c),/concrete source-specific rationale/);
});
test("unreviewed provider path cannot claim adaptation and source tests need provenance",()=>{
 const a=copy();const vendor=a.snapshot.sourceFiles.find(x=>x.path.includes("llm_clients/factory.py"));
 vendor.destination="src/server/tradingAgentsResearchGate.mjs";
 assert.throws(()=>validateTradingAgentsDonorAdoption(a),/unadopted donor file/);
 const b=copy();b.snapshot.upstreamTests[0].upstreamBlobSha="nohash";
 assert.throws(()=>validateTradingAgentsDonorAdoption(b));
});

test("merged bounded risk-review source cannot falsely grow or shrink",()=>{
 const a=copy();
 assert.equal(a.registry.donors.find(x=>x.id==="tradingagents").currentTruthStatus,"partially_integrated");
 assert.equal(a.snapshot.selectedIntegration.pr,633);
 assert.equal(a.snapshot.selectedIntegration.packaged,false);
 const b=copy();b.components.components.find(x=>x.id==="tradingagents").importedPaths.pop();
 assert.throws(()=>validateTradingAgentsDonorAdoption(b));
 const c=copy();c.snapshot.selectedIntegration.mergeCommit="0".repeat(40);
 assert.throws(()=>validateTradingAgentsDonorAdoption(c));
 const d=copy();d.registry.donors.find(x=>x.id==="tradingagents").currentTruthStatus="runtime_integrated";
 assert.throws(()=>validateTradingAgentsDonorAdoption(d));
});
