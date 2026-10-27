import test from "node:test";
import assert from "node:assert/strict";
import { runtimeDoctorSnapshotSchema, summarizeRuntimeDoctor } from "./phase4RuntimeDoctor";

const record = (componentId: string, state: "available" | "configurable" | "unavailable" | "degraded") => ({
  componentId, state, detail: "No secrets", checkedAt: "2026-10-27T12:00:00Z",
});
test("runtime diagnostic counts only observed states, without inferring all components are live", () => {
  const result = runtimeDoctorSnapshotSchema.parse({ contractVersion: "1",
    health: [record("provider:a", "available"), record("provider:b", "configurable"), record("engine:c", "degraded")] });
  const summary = summarizeRuntimeDoctor(result);
  assert.equal(summary.status, "attention");
  assert.deepEqual([summary.checked, summary.available, summary.impaired, summary.unverified], [3, 1, 1, 1]);
  assert.deepEqual(summary.records.map(item => item.componentId), ["engine:c","provider:a","provider:b"]);
  assert.equal(summarizeRuntimeDoctor(null).status, "unverified");
});
test("doctor rejects malformed health and credential-bearing unknown objects", () => {
  assert.equal(runtimeDoctorSnapshotSchema.safeParse({
    contractVersion: "1", health: [record("provider:a","available")], token: "secret",
  }).success, false);
  assert.equal(runtimeDoctorSnapshotSchema.safeParse({
    contractVersion: "1", health: [{ ...record("provider:a","available"), state:"fictional" }],
  }).success, false);
  assert.equal(runtimeDoctorSnapshotSchema.safeParse({
    contractVersion: "1", health: [{ ...record("provider:a","available"), apiKey:"unsafe" }],
  }).success, false);
});
test("configurable means registry-only, never available", () => {
  const sample=runtimeDoctorSnapshotSchema.parse({contractVersion:"1",health:[record("source:registered", "configurable")]});
  const result=summarizeRuntimeDoctor(sample);
  assert.equal(result.available,0);
  assert.equal(result.unverified,1);
  assert.equal(result.status,"partial");
});
