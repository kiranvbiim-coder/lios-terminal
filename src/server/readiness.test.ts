import test from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import { ENGINE_CONTRACT_DECLARATIONS, CONTRACT_FAMILIES, resolveAllEngineReadiness } from "@shared/dataContracts";

test("every engine required contract has at least one built-in connector", () => {
  const connectorFamilies = new Set(
    BUILT_IN_CONNECTORS.flatMap((c) => c.capabilities.map((cap) => cap.contractFamily)),
  );
  for (const engine of ENGINE_CONTRACT_DECLARATIONS) {
    for (const req of engine.required) {
      assert.ok(
        connectorFamilies.has(req),
        `Engine ${engine.engineId} requires contract ${req} but no built-in connector provides it`,
      );
    }
  }
});

test("readiness with all contract families available makes most engines ready or manual_input_required", () => {
  const allFamilies = new Set(CONTRACT_FAMILIES.map((f) => f.id));
  const readiness = resolveAllEngineReadiness(allFamilies);
  for (const r of readiness) {
    assert.ok(
      r.state === "ready" || r.state === "partial" || r.state === "manual_input_required",
      `Engine ${r.engineId} should not be blocked when all families available, got: ${r.state}`,
    );
    assert.equal(r.missingRequired.length, 0, `Engine ${r.engineId} has missing required with all families`);
  }
});

test("readiness with no capabilities makes all engines blocked", () => {
  const readiness = resolveAllEngineReadiness(new Set());
  for (const r of readiness) {
    assert.equal(r.state, "blocked", `Engine ${r.engineId} should be blocked with no capabilities`);
    assert.ok(r.missingRequired.length > 0);
  }
});

test("connector-to-contract linkage covers all major contract families", () => {
  const connectorFamilies = new Set(
    BUILT_IN_CONNECTORS.flatMap((c) => c.capabilities.map((cap) => cap.contractFamily)),
  );
  const criticalFamilies = [
    "financial_statements", "market_data", "price_history", "macro",
    "portfolio", "fixed_income", "derivatives", "ai",
  ];
  for (const family of criticalFamilies) {
    assert.ok(connectorFamilies.has(family), `No connector provides critical family: ${family}`);
  }
});

test("DCF engine full readiness scenario", () => {
  // Simulate: SEC EDGAR (financial_statements), Finnhub (market_data), manual (assumptions)
  const available = new Set(["financial_statements", "market_data", "assumptions"]);
  const readiness = resolveAllEngineReadiness(available);
  const dcf = readiness.find((r) => r.engineId === "valuation.dcf");
  assert.ok(dcf);
  assert.equal(dcf.missingRequired.length, 0);
  // DCF has manual inputs, so state is manual_input_required
  assert.equal(dcf.state, "manual_input_required");
  assert.ok(dcf.manualInputsNeeded.length > 0);
  assert.ok(dcf.manualInputsNeeded.some((m) => m.field === "wacc"));
});
