import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveProvenanceStatus,
  selectSnapshotsForEntities,
  sourceBindingForSnapshot,
  withSourceBoundProvenance,
  type SourceSnapshot,
} from "./SourceBoundValuationPortfolio";

const snapshot = (entityKey: string, id: string): SourceSnapshot => ({
  id,
  entityKey,
  provider: "FMP",
  contentHash: "a".repeat(64),
  availableAt: "2026-08-31T12:00:00.000Z",
  effectiveAt: "2026-08-30T00:00:00.000Z",
  retrievedAt: "2026-08-31T12:00:00.000Z",
  source: "fmp:market_series",
});

test("source snapshot selection requires every requested entity and reports mismatches", () => {
  const result = selectSnapshotsForEntities(["AAPL", "MSFT"], [snapshot("AAPL", "a1"), snapshot("NVDA", "n1")]);
  assert.deepEqual(result.selected.map((item) => item.id), ["a1"]);
  assert.deepEqual(result.missing, ["MSFT"]);
  assert.deepEqual(result.mismatched, ["NVDA"]);
});

test("source snapshot selection prefers the newest immutable version", () => {
  const older = snapshot("AAPL", "old");
  const newer = { ...snapshot("AAPL", "new"), availableAt: "2026-08-31T13:00:00.000Z" };
  const result = selectSnapshotsForEntities(["AAPL"], [newer, older]);
  assert.deepEqual(result.selected.map((item) => item.id), ["new"]);
});

test("provenance status cannot claim source-bound when a manual override is active", () => {
  const status = resolveProvenanceStatus({ entities: ["AAPL"], snapshots: [snapshot("AAPL", "a1")], manualOverride: true });
  assert.equal(status.mode, "manual-override");
  assert.equal(status.label, "MANUAL OVERRIDE");
});

test("source-bound provenance records immutable snapshot metadata without mutating parameters", () => {
  const parameters = { assets: ["AAPL"], returns: [0.1] };
  const bound = withSourceBoundProvenance(parameters, [snapshot("AAPL", "a1")], "market_series", "returns");
  assert.deepEqual(parameters, { assets: ["AAPL"], returns: [0.1] });
  assert.equal(bound.inputProvenance.dataClassification, "historical");
  const bindings = bound.inputProvenance.sourceBindings as Array<Record<string, unknown>>;
  assert.equal(bindings.length, 1);
  assert.deepEqual(bindings[0].snapshot, { id: "a1", contentHash: "a".repeat(64) });
  assert.equal(bindings[0].asOf, "2026-08-30T00:00:00.000Z");
});

test("source binding uses a deterministic provider connector and exact snapshot hash", () => {
  const binding = sourceBindingForSnapshot(snapshot("AAPL", "a1"), "close", "market_series");
  assert.equal(binding.connectorId, "fmp-snapshot");
  assert.equal(binding.snapshot.contentHash, "a".repeat(64));
  assert.equal(binding.sourceReference, "fmp:market_series");
});
