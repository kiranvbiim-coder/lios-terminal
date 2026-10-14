import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWaveCOrientation, evaluateWaveCTask } from "@shared/waveCBenchmark";

test("Wave C orientation benchmark passes from deterministic event evidence", () => {
  const result = evaluateWaveCOrientation([
    { id: "identify active surface", atMs: 100 },
    { id: "open search", atMs: 1_500 },
    { id: "open active object", atMs: 8_500 },
  ]);
  assert.equal(result.passed, true);
  assert.equal(result.elapsedMs, 8_400);
});

test("Wave C 60-second benchmark fails closed on missing or late actions", () => {
  const missing = evaluateWaveCTask([{ id: "find a metric", atMs: 10 }]);
  assert.equal(missing.passed, false);
  assert.match(missing.reason ?? "", /Missing actions/);
  const late = evaluateWaveCTask([
    { id: "find a metric", atMs: 0 }, { id: "open a comparison", atMs: 10_000 },
    { id: "inspect evidence", atMs: 30_000 }, { id: "save a workspace", atMs: 60_001 },
  ]);
  assert.equal(late.passed, false);
  assert.equal(late.elapsedMs, 60_001);
});

