import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProvenanceTrace, traceToTimeline } from "./provenanceTrace";

describe("provenance trace", () => {
  const node = (id: string, kind: any): any => ({ id, kind, label: id, resourceId: id });
  it("builds a validated trace graph", () => {
    const trace = buildProvenanceTrace(node("v", "valuation"), [node("m", "model_input"), node("d", "dataset_version")], [
      { from: "d", to: "m", relationship: "feeds" },
      { from: "m", to: "v", relationship: "supports" },
    ]);
    assert.equal(trace.edges.length, 2);
  });
  it("rejects dangling edges", () => {
    assert.throws(() => buildProvenanceTrace(node("v", "valuation"), [], [{ from: "missing", to: "v", relationship: "supports" }]), /INVALID_TRACE_EDGE/);
  });
  it("rejects duplicate node ids", () => {
    assert.throws(() => buildProvenanceTrace(node("v", "valuation"), [node("v", "dataset_version")], []), /DUPLICATE_TRACE_NODE/);
  });
  it("orders a valid trace for timeline presentation", () => {
    const trace = buildProvenanceTrace(node("v", "valuation"), [node("m", "model_input"), node("d", "dataset_version")], [
      { from: "d", to: "m", relationship: "feeds" },
      { from: "m", to: "v", relationship: "supports" },
    ]);
    assert.deepEqual(traceToTimeline(trace).map((n) => n.id), ["v"]);
  });
});
