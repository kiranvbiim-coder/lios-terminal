import test from "node:test";
import assert from "node:assert/strict";
import {
  grantSupportConsent,
  revokeSupportConsent,
  evaluateSupportAccess,
  clearAllConsents,
  redactDiagnostics,
  generateDiagnosticBundle,
  hasPermission,
  getPermissionsForRole,
} from "./governanceEngine";

test.afterEach(() => clearAllConsents());

// ─── Support Mode Consent ─────────────────────────────────────────────────

test("support consent: grants and evaluates active consent", () => {
  const consent = grantSupportConsent({ userId: 1, consentDurationMinutes: 30, reason: "Debug issue #123" });
  assert.ok(consent.id.startsWith("sc_"));
  assert.equal(consent.userId, 1);
  assert.equal(consent.revoked, false);

  const decision = evaluateSupportAccess(1);
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "consent_active");
});

test("support consent: expired consent is denied", () => {
  const consent = grantSupportConsent({ userId: 2, consentDurationMinutes: 1, reason: "Quick check" });
  // Evaluate at a time after expiry
  const future = new Date(new Date(consent.expiresAt).getTime() + 1000);
  const decision = evaluateSupportAccess(2, future);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "consent_expired");
});

test("support consent: revoked consent is denied", () => {
  const consent = grantSupportConsent({ userId: 3, consentDurationMinutes: 60, reason: "Support session" });
  assert.equal(revokeSupportConsent(consent.id), true);

  const decision = evaluateSupportAccess(3);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "consent_revoked");
});

test("support consent: no consent returns no_consent", () => {
  const decision = evaluateSupportAccess(999);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "no_consent");
});

test("support consent: rejects invalid duration", () => {
  assert.throws(() => grantSupportConsent({ userId: 1, consentDurationMinutes: 0, reason: "x" }));
  assert.throws(() => grantSupportConsent({ userId: 1, consentDurationMinutes: 500, reason: "x" }));
});

// ─── Diagnostic Redaction ─────────────────────────────────────────────────

test("redaction: strips secret fields", () => {
  const result = redactDiagnostics({
    name: "Test App",
    apiKey: "sk-abc123secret",
    database: { password: "supersecret", host: "localhost" },
    normalField: 42,
  });
  assert.equal(result.redactedData.name, "Test App");
  assert.equal(result.redactedData.apiKey, "[REDACTED]");
  assert.equal(result.redactedData.normalField, 42);
  assert.ok(result.redactedCount >= 2);
  assert.ok(result.redactedFields.includes("apiKey"));

  const db = result.redactedData.database as Record<string, unknown>;
  assert.equal(db.password, "[REDACTED]");
  assert.equal(db.host, "localhost");
});

test("redaction: strips PII fields", () => {
  const result = redactDiagnostics({
    userName: "John",
    email: "john@example.com",
    phoneNumber: "+1234567890",
    status: "active",
  });
  assert.equal(result.redactedData.email, "[REDACTED]");
  assert.equal(result.redactedData.status, "active");
});

test("redaction: strips long hex/base64 strings", () => {
  const result = redactDiagnostics({
    normalText: "This is fine",
    suspiciousToken: "abcdef0123456789abcdef0123456789", // 32 chars hex
  });
  assert.equal(result.redactedData.normalText, "This is fine");
  assert.equal(result.redactedData.suspiciousToken, "[REDACTED]");
});

test("redaction: custom patterns", () => {
  const result = redactDiagnostics(
    { internalCode: "IC-12345", publicCode: "PC-999" },
    [/internalCode/i],
  );
  assert.equal(result.redactedData.internalCode, "[REDACTED]");
  assert.equal(result.redactedData.publicCode, "PC-999");
});

// ─── Diagnostic Bundle ────────────────────────────────────────────────────

test("diagnostic bundle: includes system info and redacted config", () => {
  const bundle = generateDiagnosticBundle(
    "sc_test",
    [{ connectorId: "fred", state: "healthy" }],
    { databasePassword: "supersecret", logLevel: "info", apiToken: "tk-12345" },
    ["Error: Connection timeout", "Error: apiKey=sk-secret123 failed"],
  );
  assert.equal(bundle.consentId, "sc_test");
  assert.ok(bundle.systemInfo.platform.length > 0);
  assert.ok(bundle.systemInfo.nodeVersion.startsWith("v"));
  assert.ok(bundle.systemInfo.uptime > 0);

  // Config should be redacted
  assert.ok(bundle.redactedFields.length > 0);

  // Errors should have secrets stripped
  assert.ok(!bundle.recentErrors[1].includes("sk-secret123"));
});

// ─── Permission Matrix ────────────────────────────────────────────────────

test("permission matrix: admin has all permissions", () => {
  const perms = getPermissionsForRole("internal_admin");
  assert.ok(perms.includes("manage_users"));
  assert.ok(perms.includes("manage_licenses"));
  assert.ok(perms.includes("manage_credentials"));
  assert.ok(perms.includes("export_diagnostics"));
  assert.ok(perms.includes("run_engines"));
});

test("permission matrix: analyst cannot manage users", () => {
  assert.equal(hasPermission("internal_analyst", "manage_users"), false);
  assert.equal(hasPermission("internal_analyst", "run_engines"), true);
  assert.equal(hasPermission("internal_analyst", "export_reports"), true);
});

test("permission matrix: compliance is read-only", () => {
  assert.equal(hasPermission("internal_compliance", "manage_users"), false);
  assert.equal(hasPermission("internal_compliance", "run_engines"), false);
  assert.equal(hasPermission("internal_compliance", "view_audit_log"), true);
  assert.equal(hasPermission("internal_compliance", "export_reports"), true);
});

test("permission matrix: client user has minimal access", () => {
  assert.equal(hasPermission("client_user", "view_dashboard"), true);
  assert.equal(hasPermission("client_user", "export_reports"), true);
  assert.equal(hasPermission("client_user", "manage_users"), false);
  assert.equal(hasPermission("client_user", "run_engines"), false);
});

test("permission matrix: internal and client roles are disjoint in admin capabilities", () => {
  const adminActions: Array<"manage_users" | "manage_licenses" | "manage_devices" | "manage_sessions"> = ["manage_users", "manage_licenses", "manage_devices", "manage_sessions"];
  for (const action of adminActions) {
    assert.equal(hasPermission("client_admin", action), false, `client_admin should not have ${action}`);
    assert.equal(hasPermission("client_user", action), false, `client_user should not have ${action}`);
  }
});
