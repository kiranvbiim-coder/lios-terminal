import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STARTUP_RETRY_POLICY,
  DESKTOP_PERFORMANCE_BUDGETS,
  evaluatePerformanceBudgets,
  evaluateStartupHealth,
  getRetryDelay,
} from "./desktopHardening";

test("startup health: required components determine readiness", () => {
  const healthy = evaluateStartupHealth([
    { component: "database", state: "healthy", durationMs: 100, detail: "PGlite ready" },
    { component: "auth", state: "healthy", durationMs: 20, detail: "Passport ready" },
    { component: "static_client", state: "healthy", durationMs: 200, detail: "Vite ready" },
    { component: "python_sidecar", state: "unavailable", durationMs: 1500, detail: "Optional sidecar unavailable" },
  ]);
  assert.equal(healthy.ready, true);
  assert.equal(healthy.degraded, true);
  assert.deepEqual(healthy.unavailableComponents, ["python_sidecar"]);
  assert.equal(healthy.totalDurationMs, 1820);
});

test("startup health: database failure blocks readiness", () => {
  const report = evaluateStartupHealth([
    { component: "database", state: "unavailable", durationMs: 3000, detail: "Migration failed" },
    { component: "auth", state: "healthy", durationMs: 20, detail: "" },
    { component: "static_client", state: "healthy", durationMs: 100, detail: "" },
  ]);
  assert.equal(report.ready, false);
  assert.equal(report.degraded, false);
  assert.deepEqual(report.unavailableComponents, ["database"]);
});

test("startup health: disabled optional sidecar does not degrade", () => {
  const report = evaluateStartupHealth([
    { component: "database", state: "healthy", durationMs: 1, detail: "" },
    { component: "auth", state: "healthy", durationMs: 1, detail: "" },
    { component: "static_client", state: "healthy", durationMs: 1, detail: "" },
    { component: "optional_runtime_pack", state: "disabled", durationMs: 0, detail: "Disabled" },
  ]);
  assert.equal(report.ready, true);
  assert.equal(report.degraded, false);
});

test("retry policy uses bounded exponential backoff", () => {
  assert.equal(getRetryDelay(0), 250);
  assert.equal(getRetryDelay(1), 500);
  assert.equal(getRetryDelay(2), 1000);
  assert.equal(getRetryDelay(10), 4000);
  assert.equal(getRetryDelay(-1), DEFAULT_STARTUP_RETRY_POLICY.initialDelayMs);
});

test("performance budgets detect overruns and pass within budget", () => {
  const result = evaluatePerformanceBudgets([
    { name: "startup", budgetMs: 5000, actualMs: 4100 },
    { name: "readiness", budgetMs: 2000, actualMs: 2500 },
    { name: "workspace", budgetMs: 1000, actualMs: 1000 },
  ]);
  assert.equal(result.passed, false);
  assert.equal(result.budgets[0].passed, true);
  assert.equal(result.budgets[1].passed, false);
  assert.equal(result.budgets[1].overrunMs, 500);
  assert.equal(result.totalOverrunMs, 500);
});

test("desktop performance budget catalog contains required launch paths", () => {
  assert.ok(DESKTOP_PERFORMANCE_BUDGETS.startup > 0);
  assert.ok(DESKTOP_PERFORMANCE_BUDGETS.database_init > 0);
  assert.ok(DESKTOP_PERFORMANCE_BUDGETS.static_client_load > 0);
  assert.ok(DESKTOP_PERFORMANCE_BUDGETS.readiness_request > 0);
  assert.ok(DESKTOP_PERFORMANCE_BUDGETS.quote_request > 0);
  assert.ok(DESKTOP_PERFORMANCE_BUDGETS.workspace_restore > 0);
});
