import test from "node:test";
import assert from "node:assert/strict";
import {
  clearEvidence,
  createReproducibilityId,
  getEvidenceSnapshot,
  publishCalculationReceipt,
  publishProvenance,
} from "./terminalEvidence";

test("provenance records are replaced by id rather than duplicated", () => {
  clearEvidence();
  publishProvenance({
    id: "quote",
    label: "Quote",
    source: "Provider A",
    freshness: "live",
    transformations: [],
    assumptions: [],
    quality: "normal",
    conflicts: [],
  });
  publishProvenance({
    id: "quote",
    label: "Quote",
    source: "Provider B",
    freshness: "delayed",
    transformations: [],
    assumptions: [],
    quality: "warning",
    conflicts: ["Primary source unavailable"],
  });
  const snapshot = getEvidenceSnapshot();
  assert.equal(snapshot.provenance.length, 1);
  assert.equal(snapshot.provenance[0].source, "Provider B");
});

test("calculation receipts remain inspectable and reproducible", () => {
  clearEvidence();
  const reproducibilityId = createReproducibilityId(["DCF", "AAPL", 0.08, 0.025]);
  publishCalculationReceipt({
    id: "dcf-1",
    label: "DCF Base Case",
    engine: "LIOS DCF",
    createdAt: "2026-08-27T00:00:00Z",
    inputs: { symbol: "AAPL" },
    parameters: { wacc: 0.08, terminalGrowth: 0.025 },
    outputs: { value: 220 },
    diagnostics: [],
    warnings: [],
    reproducibilityId,
  });
  const snapshot = getEvidenceSnapshot();
  assert.equal(snapshot.receipts[0].reproducibilityId, reproducibilityId);
  assert.equal(createReproducibilityId(["DCF", "AAPL", 0.08, 0.025]), reproducibilityId);
});
