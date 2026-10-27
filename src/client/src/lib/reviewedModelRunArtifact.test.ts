import test from "node:test";
import assert from "node:assert/strict";
import type { ArtifactDetail } from "./useArtifacts";
import {
  modelRunReviewKey, verifiedReopenedModelRun, savedModelArtifactMatchesReceipt,
  type ModelRunSnapshotIdentity, type ReviewedModelDestination,
} from "./reviewedModelRunArtifact";

const run="00000000-0000-4000-8000-000000000121",snap="00000000-0000-4000-8000-000000000122";
const model:ModelRunSnapshotIdentity={
  receipt:{runId:run,resultHash:"a".repeat(64),datasetSnapshotId:snap,datasetContentHash:"b".repeat(64),inputHash:"c".repeat(64),deterministic:true},
  result:{datasetSnapshotId:snap,checks:{passed:true,circularConverged:true}},
};
const project:ReviewedModelDestination={projectId:17,destinationLabel:"Research Project"};
const chat:ReviewedModelDestination={projectId:null,owningChatId:34,destinationLabel:"this Chat"};

function detail(destination=project): ArtifactDetail {
  return {
    artifact:{id:"artifact:saved",projectId:destination.projectId,
      owningChatId:destination.owningChatId??null,ownerUserId:4,organizationId:null,kind:"spreadsheet",
      title:"Exact P11 workbook",status:"active",origin:"conversation",headVersion:1,
      forkedFromArtifactId:null,forkedFromVersion:null,createdAt:"2026-10-27T10:00:00Z",updatedAt:"2026-10-27T10:00:00Z",
      archivedAt:null,trashedAt:null,trashedByProjectId:null,trashedFromStatus:null},
    version:{id:"version:saved",artifactId:"artifact:saved",version:1,parentVersionId:null,
      adapterId:"lios.spreadsheet",content:{kind:"spreadsheet",sheets:[{id:"model",name:"Model",cells:{},names:{},rowCount:1,columnCount:1}],
        activeSheetId:"model",rendererPreference:"builtin",calculationMode:"automatic"},
      contentHash:"d".repeat(64),sourceRefs:[
        `financial-model-run:${run}`,`financial-model-result-sha256:${model.receipt.resultHash}`,
        `dataset-snapshot:${snap}`,`dataset-content-sha256:${model.receipt.datasetContentHash}`,
      ],executionReceiptIds:[],assumptionRefs:[],trustManifest:null,dependencyRefs:[],
      refreshSpec:{kind:"engine",sourceScope:"my_data",executionMode:"deterministic_first",capabilityIds:[],
        message:null,selection:null,engineRef:`integrated_financial_model:v1:run:${run}`},
      note:null,createdByUserId:4,createdAt:"2026-10-27T10:00:00Z"},
  };
}
test("explicit review identity binds run hash, input, snapshot and exactly one destination",()=>{
  const key=modelRunReviewKey(model,project);
  assert.ok(key);
  assert.notEqual(key,modelRunReviewKey(model,chat));
  assert.notEqual(key,modelRunReviewKey({...model,receipt:{...model.receipt,resultHash:"e".repeat(64)}},project));
  assert.notEqual(key,modelRunReviewKey({...model,receipt:{...model.receipt,inputHash:"e".repeat(64)}},project));
  assert.notEqual(key,modelRunReviewKey({...model,receipt:{...model.receipt,datasetContentHash:"e".repeat(64)}},project));
  assert.notEqual(key,modelRunReviewKey(model,{...project,projectId:19}));
});

test("never confirm a failed, non-deterministic, unscoped, malformed or nonconverged receipt",()=>{
  const bad=[
    {...model,receipt:{...model.receipt,deterministic:false}},
    {...model,receipt:{...model.receipt,resultHash:"not-a-hash"}},
    {...model,receipt:{...model.receipt,runId:"fake"}},
    {...model,result:{...model.result,datasetSnapshotId:"other"}},
    {...model,result:{...model.result,checks:{passed:false,circularConverged:true}}},
    {...model,result:{...model.result,checks:{passed:true,circularConverged:false}}},
  ];
  for(const x of bad)assert.equal(modelRunReviewKey(x,project),null);
  assert.equal(modelRunReviewKey(null,project),null);
  assert.equal(modelRunReviewKey(model,null),null);
  assert.equal(modelRunReviewKey(model,{projectId:null,destinationLabel:"not owned"}),null);
  assert.equal(modelRunReviewKey(model,{...project,owningChatId:7}),null);
  assert.ok(modelRunReviewKey(model,chat));
});

test("fresh P11 read requires identical receipt and model checks before P4 submission",()=>{
  assert.equal(verifiedReopenedModelRun(model,structuredClone(model)),true);
  assert.equal(verifiedReopenedModelRun(model,{...model,receipt:{...model.receipt,resultHash:"e".repeat(64)}}),false);
  assert.equal(verifiedReopenedModelRun(model,{...model,receipt:{...model.receipt,inputHash:"f".repeat(64)}}),false);
  assert.equal(verifiedReopenedModelRun(model,{...model,result:{...model.result,checks:{passed:false,circularConverged:true}}}),false);
  assert.equal(verifiedReopenedModelRun(model,{...model,result:{...model.result,datasetSnapshotId:"different-snapshot"}}),false);
  assert.equal(verifiedReopenedModelRun(model,{...model,receipt:{...model.receipt,deterministic:false}}),false);
});

test("P4 workbook success must reference exact run, dataset, content hashes and saved scope",()=>{
  assert.equal(savedModelArtifactMatchesReceipt(detail(),model.receipt,project),true);
  assert.equal(savedModelArtifactMatchesReceipt(detail(chat),model.receipt,chat),true);
  assert.equal(savedModelArtifactMatchesReceipt(detail(),model.receipt,chat),false);
  const original=detail();
  assert.equal(savedModelArtifactMatchesReceipt({
    ...original,version:{...original.version,sourceRefs:original.version.sourceRefs.filter(x=>!x.startsWith("financial-model-result-sha256:"))},
  },model.receipt,project),false);
  assert.equal(savedModelArtifactMatchesReceipt({
    ...original,version:{...original.version,refreshSpec:{...original.version.refreshSpec!,engineRef:"integrated_financial_model:v1:run:someone-else"}},
  },model.receipt,project),false);
  assert.equal(savedModelArtifactMatchesReceipt({
    ...original,artifact:{...original.artifact,origin:"engine"},
  },model.receipt,project),false);
  assert.equal(savedModelArtifactMatchesReceipt({
    ...original,artifact:{...original.artifact,projectId:18},
  },model.receipt,project),false);
  assert.equal(savedModelArtifactMatchesReceipt({
    ...original,version:{...original.version,content:{kind:"table",columns:[],rows:[]}},
  },model.receipt,project),false);
});
