import test from "node:test";
import assert from "node:assert/strict";
import { BETA_CHECK_CATALOG, buildBetaChecks, evaluateBetaReadiness } from "./betaReadiness";

test("beta catalog includes all required end-to-end workflows", () => {
  const ids = new Set(BETA_CHECK_CATALOG.map((c) => c.id));
  for (const required of [
    "fresh_install", "authentication", "license_device", "provider_credentials",
    "byod_source", "contract_binding", "dcf_receipt", "portfolio_risk",
    "fixed_income", "derivatives", "macro", "research", "exports", "ai_off",
    "admin_controls", "diagnostics_redaction", "no_secret_leak", "tenant_isolation",
  ]) assert.equal(ids.has(required as never), true, `missing beta check: ${required}`);
});

test("beta readiness blocks launch when a required check fails", () => {
  const checks = buildBetaChecks({
    fresh_install: { passed: true, detail: "Packaged app installed" },
    authentication: { passed: true, detail: "Login works" },
    no_secret_leak: { passed: false, detail: "Secret found in diagnostic output" },
  });
  const report = evaluateBetaReadiness(checks);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((b) => b.includes("No secret leakage")));
  assert.equal(report.requiredPassed, 2);
  assert.equal(report.requiredTotal, 18);
});

test("beta readiness passes only when every required check passes", () => {
  const results = Object.fromEntries(BETA_CHECK_CATALOG.map((c) => [c.id, { passed: true, detail: "Verified" }]));
  const report = evaluateBetaReadiness(buildBetaChecks(results));
  assert.equal(report.ready, true);
  assert.equal(report.requiredPassed, report.requiredTotal);
  assert.equal(report.blockers.length, 0);
});

test("beta readiness reports optional BYOAI separately", () => {
  const results = Object.fromEntries(BETA_CHECK_CATALOG.map((c) => [c.id, { passed: c.id !== "byoai", detail: c.id === "byoai" ? "No AI key configured" : "Verified" }]));
  const report = evaluateBetaReadiness(buildBetaChecks(results));
  assert.equal(report.ready, true); // BYOAI is optional; AI-off is required
  assert.equal(report.optionalPassed, 0);
  assert.equal(report.optionalTotal, 1);
});

test("buildBetaChecks fails closed for missing results", () => {
  const checks = buildBetaChecks({});
  assert.ok(checks.every((c) => c.passed === false));
  assert.ok(checks.every((c) => c.detail === "Check has not been executed."));
});
