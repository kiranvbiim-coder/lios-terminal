import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_FAMILIES,
  ENGINE_CONTRACT_DECLARATIONS,
  getContractFamily,
  getEngineDeclaration,
  resolveAllEngineReadiness,
  resolveEngineReadiness,
} from "./dataContracts";
import { CANONICAL_FIELDS } from "./financialFields";

test("contract family ids are unique", () => {
  const ids = CONTRACT_FAMILIES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate contract family id");
});

test("every contract family has at least one field", () => {
  for (const family of CONTRACT_FAMILIES) {
    assert.ok(family.fields.length > 0, `${family.id} has no fields`);
  }
});

test("every required engine contract references a defined contract family", () => {
  const familyIds = new Set(CONTRACT_FAMILIES.map((f) => f.id));
  for (const engine of ENGINE_CONTRACT_DECLARATIONS) {
    for (const req of engine.required) {
      assert.ok(familyIds.has(req), `${engine.engineId} requires unknown contract family: ${req}`);
    }
    for (const opt of engine.optional) {
      assert.ok(familyIds.has(opt), `${engine.engineId} optionally uses unknown contract family: ${opt}`);
    }
  }
});

test("engine declaration ids are unique", () => {
  const ids = ENGINE_CONTRACT_DECLARATIONS.map((e) => e.engineId);
  assert.equal(new Set(ids).size, ids.length, "duplicate engine id");
});

test("getContractFamily and getEngineDeclaration resolve correctly", () => {
  assert.equal(getContractFamily("financial_statements")?.name, "Financial Statements");
  assert.equal(getContractFamily("nonexistent"), undefined);
  assert.equal(getEngineDeclaration("valuation.dcf")?.engineName, "DCF Valuation");
  assert.equal(getEngineDeclaration("nonexistent"), undefined);
});

test("financial statement fields use canonical financial keys", () => {
  const fields = new Set(getContractFamily("financial_statements")!.fields.map((field) => field.name));
  for (const fieldName of Object.values(CANONICAL_FIELDS).flatMap((section) => section.map((field) => field.key))) {
    assert.ok(fields.has(fieldName), `missing canonical financial field: ${fieldName}`);
  }
  for (const legacyField of ["depreciationAmortization", "totalEquity", "cashAndEquivalents"]) {
    assert.equal(fields.has(legacyField), false, `legacy financial field remains: ${legacyField}`);
  }
});

test("DCF engine is ready when all required contracts are available", () => {
  const dcf = getEngineDeclaration("valuation.dcf")!;
  const available = new Set(["financial_statements", "market_data", "assumptions", "estimates", "company"]);
  const readiness = resolveEngineReadiness(dcf, available);
  // DCF has manual inputs, so with all data available but no manual inputs provided it's manual_input_required
  // But readiness state depends on whether there are manual inputs and blocked required
  assert.equal(readiness.engineId, "valuation.dcf");
  assert.equal(readiness.missingRequired.length, 0);
  // Has manual inputs needed, so state is manual_input_required when not blocked
  assert.equal(readiness.state, "manual_input_required");
});

test("DCF engine is blocked when financial_statements are unavailable", () => {
  const dcf = getEngineDeclaration("valuation.dcf")!;
  const available = new Set(["market_data", "assumptions"]);
  const readiness = resolveEngineReadiness(dcf, available);
  assert.equal(readiness.state, "blocked");
  assert.ok(readiness.missingRequired.includes("financial_statements"));
});

test("reverse DCF is ready with minimal contracts (no manual inputs)", () => {
  const rdcf = getEngineDeclaration("valuation.reverse_dcf")!;
  const available = new Set(["market_data", "financial_statements"]);
  const readiness = resolveEngineReadiness(rdcf, available);
  assert.equal(readiness.state, "partial"); // optional assumptions not available
  assert.equal(readiness.missingRequired.length, 0);
});

test("reverse DCF is fully ready with all contracts", () => {
  const rdcf = getEngineDeclaration("valuation.reverse_dcf")!;
  const available = new Set(["market_data", "financial_statements", "assumptions"]);
  const readiness = resolveEngineReadiness(rdcf, available);
  assert.equal(readiness.state, "ready");
});

test("resolveAllEngineReadiness returns one entry per engine", () => {
  const all = resolveAllEngineReadiness(new Set(["market_data", "financial_statements"]));
  assert.equal(all.length, ENGINE_CONTRACT_DECLARATIONS.length);
  const dcfResult = all.find((r) => r.engineId === "valuation.dcf");
  assert.ok(dcfResult);
  assert.equal(dcfResult.state, "blocked"); // missing assumptions
});

test("bond pricer is ready with fixed_income contract", () => {
  const pricer = getEngineDeclaration("fixed_income.bond_pricer")!;
  const readiness = resolveEngineReadiness(pricer, new Set(["fixed_income"]));
  assert.equal(readiness.state, "partial"); // macro is optional, not available
  assert.equal(readiness.missingRequired.length, 0);
});

test("portfolio optimizer is blocked without price_history", () => {
  const opt = getEngineDeclaration("portfolio.optimizer")!;
  const readiness = resolveEngineReadiness(opt, new Set(["portfolio"]));
  assert.equal(readiness.state, "blocked");
  assert.ok(readiness.missingRequired.includes("price_history"));
});

test("quote monitor is ready with market_data", () => {
  const engine = getEngineDeclaration("market.quote_monitor")!;
  assert.ok(engine);
  const readiness = resolveEngineReadiness(engine, new Set(["market_data"]));
  assert.equal(readiness.state, "partial"); // price_history optional, not available
  assert.equal(readiness.missingRequired.length, 0);
});

test("screener is ready with market_data", () => {
  const engine = getEngineDeclaration("market.screener")!;
  assert.ok(engine);
  const readiness = resolveEngineReadiness(engine, new Set(["market_data"]));
  assert.equal(readiness.state, "partial"); // optional not available
  assert.equal(readiness.missingRequired.length, 0);
});

test("charting is blocked without price_history", () => {
  const engine = getEngineDeclaration("market.charting")!;
  assert.ok(engine);
  const readiness = resolveEngineReadiness(engine, new Set(["market_data"]));
  assert.equal(readiness.state, "blocked");
  assert.ok(readiness.missingRequired.includes("price_history"));
});

test("charting is ready with price_history", () => {
  const engine = getEngineDeclaration("market.charting")!;
  const readiness = resolveEngineReadiness(engine, new Set(["price_history"]));
  assert.equal(readiness.state, "partial"); // market_data optional
  assert.equal(readiness.missingRequired.length, 0);
});

test("macro shock analysis requires both macro and portfolio", () => {
  const engine = getEngineDeclaration("macro.shock_analysis")!;
  assert.ok(engine);
  assert.equal(resolveEngineReadiness(engine, new Set(["macro"])).state, "blocked");
  assert.equal(resolveEngineReadiness(engine, new Set(["portfolio"])).state, "blocked");
  assert.equal(resolveEngineReadiness(engine, new Set(["macro", "portfolio"])).state, "partial");
  assert.equal(resolveEngineReadiness(engine, new Set(["macro", "portfolio", "price_history", "market_data"])).state, "ready");
});

test("new engine declarations all have unique ids", () => {
  const ids = ENGINE_CONTRACT_DECLARATIONS.map((e) => e.engineId);
  assert.equal(new Set(ids).size, ids.length, "duplicate engine id found");
  // Verify total count is reasonable (at least 20 engines now)
  assert.ok(ids.length >= 20, `Expected >= 20 engines, got ${ids.length}`);
});
