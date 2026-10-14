import assert from "node:assert/strict";
import test from "node:test";
import { DataLineageBuilder } from "./dataLineageService";

test("P5 lineage contract spans connector through export without leaking credentials", () => {
  const builder = new DataLineageBuilder({
    projectId: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    capability: "statements",
    entityRef: "lios:entity:1",
    pointInTime: { mode: "as_known_on", asKnownOn: "2026-01-01T00:00:00.000Z", revision: null, requirePublicationTime: true, allowLaterRevisions: false },
  });
  for (const stage of ["connector","normalization","mapping","engine","artifact","export"] as const) {
    builder.add({ stage, componentId: `lios.${stage}`, inputRefs: [`in:${stage}`], outputRefs: [`out:${stage}`], contentHash: null, metadata: {} });
  }
  const receipt = builder.receipt();
  assert.deepEqual(receipt.stages.map((stage) => stage.stage), ["connector","normalization","mapping","engine","artifact","export"]);
  assert.equal(receipt.pointInTime.mode, "as_known_on");
});

test("P5 lineage refuses credential-bearing references", () => {
  const builder = new DataLineageBuilder({
    projectId: null, requestId: null, capability: "prices", entityRef: "ABC",
    pointInTime: { mode: "latest", asKnownOn: null, revision: null, requirePublicationTime: false, allowLaterRevisions: false },
  });
  assert.throws(() => builder.add({
    stage: "connector", componentId: "provider", inputRefs: ["https://example.test?q=1&api_key=secret"], outputRefs: [], contentHash: null, metadata: {},
  }), /must not contain credentials/i);
});
