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

test("partial passing submissions never qualify the full required beta catalog", () => {
  const first = BETA_CHECK_CATALOG.find((check) => check.id === "fresh_install")!;
  const report = evaluateBetaReadiness([{ ...first, passed: true, detail: "Installed" }]);
  assert.equal(report.ready, false);
  assert.equal(report.requiredTotal, 18);
  assert.equal(report.requiredPassed, 1);
  assert.equal(report.checks.length, BETA_CHECK_CATALOG.length);
  assert.ok(report.blockers.some((blocker) => blocker.includes("Authentication")));
});

test("duplicating a passing required check invalidates readiness instead of inflating the count", () => {
  const all = buildBetaChecks(
    Object.fromEntries(BETA_CHECK_CATALOG.map((check) => [check.id, { passed: true, detail: "Verified" }])),
  );
  const duplicate = all.find((check) => check.id === "authentication")!;
  const report = evaluateBetaReadiness([...all, duplicate]);
  assert.equal(report.ready, false);
  assert.equal(report.requiredTotal, 18);
  assert.equal(report.requiredPassed, 17);
  assert.ok(report.blockers.includes("Duplicate readiness check: authentication"));
});

test("caller cannot demote required checks or alter required/optional labels to spoof readiness", () => {
  const all = buildBetaChecks(
    Object.fromEntries(BETA_CHECK_CATALOG.map((check) => [check.id, { passed: true, detail: "Verified" }])),
  );
  const forged = all.map((check) => check.id === "tenant_isolation"
    ? { ...check, required: false, label: "Not required" }
    : check);
  const report = evaluateBetaReadiness(forged);
  assert.equal(report.ready, false);
  assert.equal(report.requiredTotal, 18);
  assert.equal(report.requiredPassed, 17);
  assert.ok(report.blockers.includes("Altered readiness check declaration: tenant_isolation"));

  const changedOptional = all.map((check) => check.id === "byoai"
    ? { ...check, required: true }
    : check);
  const optionalReport = evaluateBetaReadiness(changedOptional);
  assert.equal(optionalReport.ready, false);
  assert.equal(optionalReport.optionalTotal, 1);
  assert.ok(optionalReport.blockers.includes("Altered readiness check declaration: byoai"));
});

test("unknown check IDs cannot silently validate a partial or complete release report", () => {
  const all = buildBetaChecks(
    Object.fromEntries(BETA_CHECK_CATALOG.map((check) => [check.id, { passed: true, detail: "Verified" }])),
  );
  const result = evaluateBetaReadiness([
    ...all,
    { id: "synthetic_release_pass" as never, required: true, passed: true, label: "Everything", detail: "ok" },
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.requiredPassed, 18);
  assert.equal(result.requiredTotal, 18);
  assert.ok(result.blockers.includes("Unrecognized readiness check: synthetic_release_pass"));
  assert.equal(result.checks.some((check) => check.id === ("synthetic_release_pass" as never)), false);
});
