import test from "node:test";
import assert from "node:assert/strict";
import { assertProfessionalDecisionSourceRole, isProfessionalDecisionSourceRoleAccurate } from "./professionalSourceRole";

test("a report source cannot be labeled as decision unless the Artifact is a Decision", () => {
  assert.equal(isProfessionalDecisionSourceRoleAccurate("decision", "decision"), true);
  for (const kind of ["valuation", "portfolio", "research", "report", "spreadsheet", "chart", "screen"] as const) {
    assert.equal(isProfessionalDecisionSourceRoleAccurate(kind, "decision"), false);
    assert.throws(() => assertProfessionalDecisionSourceRole(kind, "decision"), /Only a Decision Artifact/);
    assert.doesNotThrow(() => assertProfessionalDecisionSourceRole(kind, "evidence"));
  }
  assert.doesNotThrow(() => assertProfessionalDecisionSourceRole("decision", "decision"));
  assert.doesNotThrow(() => assertProfessionalDecisionSourceRole("valuation", "financial_model"));
});

