import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { expandP10RuntimePacks, validateP10RuntimePackCatalog } from "./p10RuntimePacks";
import { sanitizeP10ObservabilityAttributes, p10RecordToOtlp } from "./p10Observability";
import { dataLineageReceiptToOpenLineage } from "./p10OpenLineage";
import type { DataLineageReceipt } from "@shared/universalDataFabric";

const receipt:DataLineageReceipt={
  schemaVersion:"1",
  id:"11111111-1111-4111-8111-111111111111",
  projectId:1,
  requestId:null,
  capability:"prices",
  entityRef:"security:BENCHMARK",
  pointInTime:{mode:"latest",asKnownOn:null,revision:null,requirePublicationTime:false,allowLaterRevisions:false},
  stages:[
    {stage:"connector",componentId:"provider:benchmark",inputRefs:["request:benchmark"],outputRefs:["raw:benchmark"],contentHash:"a".repeat(64),at:"2026-09-23T00:00:00.000Z",metadata:{}},
    {stage:"artifact",componentId:"artifact-store",inputRefs:["raw:benchmark"],outputRefs:["artifact:benchmark"],contentHash:"b".repeat(64),at:"2026-09-23T00:00:01.000Z",metadata:{}},
  ],
  createdAt:"2026-09-23T00:00:01.000Z",
};

test("P10 runtime-pack expansion and catalog validation stay within startup-scale budget",()=>{
  const started=performance.now();
  for(let i=0;i<25_000;i++){
    assert.ok(expandP10RuntimePacks(["research","quant","data-lab"]).includes("core"));
    if(i%1000===0) assert.deepEqual(validateP10RuntimePackCatalog(),[]);
  }
  const elapsed=performance.now()-started;
  assert.ok(elapsed<5_000,`P10 runtime-pack catalog benchmark took ${elapsed.toFixed(1)}ms`);
});

test("P10 redaction and OTLP envelope generation remain bounded under diagnostic load",()=>{
  const started=performance.now();
  let bytes=0;
  for(let i=0;i<10_000;i++){
    const attributes=sanitizeP10ObservabilityAttributes({
      operation:"benchmark",
      index:i,
      apiKey:"must-not-survive",
      detail:"safe",
    });
    const payload=p10RecordToOtlp({
      schemaVersion:"1",signal:"metric",service:"lios-terminal",name:"benchmark.metric",
      at:"2026-09-23T00:00:00.000Z",value:i,attributes
    });
    const text=JSON.stringify(payload);
    bytes+=text.length;
    assert.doesNotMatch(text,/must-not-survive/);
  }
  const elapsed=performance.now()-started;
  assert.ok(elapsed<5_000,`P10 observability benchmark took ${elapsed.toFixed(1)}ms`);
  assert.ok(bytes<50_000_000,"P10 OTLP benchmark emitted unexpectedly large envelopes.");
});

test("P10 OpenLineage projection is bounded and never expands raw references",()=>{
  const started=performance.now();
  for(let i=0;i<5_000;i++){
    const event=dataLineageReceiptToOpenLineage(receipt);
    const serialized=JSON.stringify(event);
    assert.ok(serialized.length<10_000);
    assert.doesNotMatch(serialized,/security:BENCHMARK|request:benchmark|artifact:benchmark/);
  }
  const elapsed=performance.now()-started;
  assert.ok(elapsed<5_000,`P10 lineage projection benchmark took ${elapsed.toFixed(1)}ms`);
});
