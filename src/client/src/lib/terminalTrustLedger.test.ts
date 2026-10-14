import test from "node:test";
import assert from "node:assert/strict";
import { buildTrustLedger } from "./terminalTrustLedger";
import type { EvidenceSnapshot } from "./terminalEvidence";

function snapshot(overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return { provenance: [], receipts: [], ...overrides };
}

test("trust ledger is insufficient when no provenance or receipts are published", () => {
  const ledger = buildTrustLedger(snapshot());
  assert.equal(ledger.coverageScore, 0);
  assert.equal(ledger.grade, "insufficient");
  assert.ok(ledger.gaps.some((gap) => gap.includes("provenance")));
});

test("trust ledger rewards explicit provenance and reproducible receipts without claiming correctness", () => {
  const ledger = buildTrustLedger(snapshot({
    provenance: [{ id: "src", label: "Quote", source: "Provider", provider: "Test", freshness: "live", transformations: [], assumptions: [], quality: "verified", conflicts: [] }],
    receipts: [{ id: "r", label: "DCF", engine: "DCF", createdAt: new Date(0).toISOString(), inputs: {}, parameters: {}, outputs: { fairValue: 100 }, diagnostics: [], warnings: [], reproducibilityId: "lios-test" }],
  }));
  assert.equal(ledger.coverageScore, 100);
  assert.equal(ledger.grade, "strong");
});

test("warnings, conflicts and unavailable sources reduce coverage score", () => {
  const ledger = buildTrustLedger(snapshot({
    provenance: [{ id: "src", label: "Data", source: "Provider", freshness: "unavailable", transformations: [], assumptions: [], quality: "unavailable", conflicts: ["provider conflict"] }],
    receipts: [{ id: "r", label: "Model", engine: "Model", createdAt: new Date(0).toISOString(), inputs: {}, parameters: {}, outputs: {}, diagnostics: [], warnings: ["warning"], reproducibilityId: "lios-test" }],
  }));
  assert.ok(ledger.coverageScore < 60);
  assert.equal(ledger.unavailableCount, 1);
  assert.equal(ledger.warningCount, 1);
  assert.equal(ledger.conflictCount, 1);
});
