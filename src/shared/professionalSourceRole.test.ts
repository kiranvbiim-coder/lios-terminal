import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the existing server report owner validates source roles after resolving owned Artifacts", () => {
  const source = readFileSync(new URL("../server/professionalWorkPackage.ts", import.meta.url), "utf8");
  const owned = source.indexOf("artifact.ownerUserId !== ctx.userId");
  const roleGuard = source.indexOf("assertProfessionalDecisionSourceRole(artifact.kind, selected.role)");
  const snapshot = source.indexOf("snapshots.push({ id: artifact.id");
  assert.ok(owned > 0 && roleGuard > owned && snapshot > roleGuard);
  assert.match(source, /version\.contentHash !== selected\.contentHash/);
  assert.match(source, /Current source rights do not permit this work package/);
});

test("source-specific review packages label only actual decisions as decision sources", () => {
  const source = readFileSync(new URL("../server/artifactReviewPackage.ts", import.meta.url), "utf8");
  assert.match(source, /role: artifact\.kind === "decision" \? "decision" : "evidence"/);
});

test("professional report editor keeps evidence, risk and proposed actions separate from authored recommendation", () => {
  const source = readFileSync(new URL("../client/src/components/terminal/ProfessionalWorkPackage.tsx", import.meta.url), "utf8");
  for (const text of ["Authored evidence assessment", "Authored risks and dissent", "Authored proposed actions", "Authored package recommendation", "sourceRoleCompatible"]) {
    assert.ok(source.includes(text), `missing separate report boundary: ${text}`);
  }
  assert.match(source, /const authoredSections = \[/);
  assert.match(source, /evidenceAssessment\.trim\(\)/);
  assert.match(source, /riskAssessment\.trim\(\)/);
  assert.match(source, /proposedActions\.trim\(\)/);
  assert.match(source, /Proposed actions · not authorized/);
  assert.match(source, /isProfessionalDecisionSourceRoleAccurate\(detail\.artifact\.kind, role\)/);
});
