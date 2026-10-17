import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ENTERPRISE_POLICY,
  assessEnterprisePolicy,
  evaluateEnterpriseAiProvider,
  evaluateEnterpriseConnector,
  evaluateEnterpriseExport,
  evaluateEnterpriseSharing,
  normalizeEnterprisePolicy,
  canUseEnterprisePermission,
  DECISION_PERMISSIONS,
  DECISION_ROLE_CEILINGS,
  type EnterpriseRole,
} from "./enterpriseContracts";

test("enterprise policy defaults fail closed for external capabilities", () => {
  const readiness = assessEnterprisePolicy(DEFAULT_ENTERPRISE_POLICY);
  assert.equal(readiness.checks.find((check) => check.id === "sso")?.status, "ready");
  assert.equal(readiness.checks.find((check) => check.id === "private-deployment")?.status, "ready");
  assert.equal(evaluateEnterpriseConnector(DEFAULT_ENTERPRISE_POLICY, "finnhub").allowed, false);
  assert.equal(evaluateEnterpriseAiProvider(DEFAULT_ENTERPRISE_POLICY, "openai").allowed, false);
  assert.equal(evaluateEnterpriseSharing(DEFAULT_ENTERPRISE_POLICY, "external").allowed, false);
});

test("enterprise policy normalization rejects malformed persisted state without inventing values", () => {
  const normalized = normalizeEnterprisePolicy({ seats: { maxSeats: -1 } });
  assert.deepEqual(normalized, DEFAULT_ENTERPRISE_POLICY);
});

test("enterprise connector, AI, sharing, and export decisions use the same policy", () => {
  const policy = normalizeEnterprisePolicy({
    ...DEFAULT_ENTERPRISE_POLICY,
    connectors: { ...DEFAULT_ENTERPRISE_POLICY.connectors, allowedConnectorIds: ["private-db"], allowPrivateConnections: true, requireAdminApproval: false },
    ai: { ...DEFAULT_ENTERPRISE_POLICY.ai, allowedProviders: ["local"], allowedModels: ["local-small"], requireApproval: false },
    workspaces: { ...DEFAULT_ENTERPRISE_POLICY.workspaces, allowExternalSharing: true },
    network: { ...DEFAULT_ENTERPRISE_POLICY.network, allowExternalSharing: true },
    retention: { ...DEFAULT_ENTERPRISE_POLICY.retention, allowedExportFormats: ["json"], allowUserExport: false },
  });
  assert.deepEqual(evaluateEnterpriseConnector(policy, "private-db", true), { allowed: true, reason: "Connector is allowed by organization policy." });
  assert.deepEqual(evaluateEnterpriseAiProvider(policy, "local", "local-small"), { allowed: true, reason: "AI use is allowed by organization policy." });
  assert.equal(evaluateEnterpriseSharing(policy, "external").allowed, true);
  assert.equal(evaluateEnterpriseExport(policy, "csv", "client_user").allowed, false);
  assert.equal(evaluateEnterpriseExport(policy, "json", "client_user").allowed, false);
  assert.equal(evaluateEnterpriseExport(policy, "json", "internal_admin").allowed, true);
});

test("Decision grants migrate legacy policy once and can only narrow existing security-role ceilings", () => {
  const legacy = structuredClone(DEFAULT_ENTERPRISE_POLICY);
  legacy.version = 1;
  for (const role of Object.keys(legacy.roles.grants) as EnterpriseRole[]) {
    legacy.roles.grants[role] = legacy.roles.grants[role].filter((permission) => !(DECISION_PERMISSIONS as readonly string[]).includes(permission));
  }
  const migrated = normalizeEnterprisePolicy(legacy);
  assert.equal(migrated.version, 2);
  for (const role of Object.keys(migrated.roles.grants) as EnterpriseRole[]) {
    for (const permission of DECISION_PERMISSIONS) {
      assert.equal(canUseEnterprisePermission(migrated, role, permission), DECISION_ROLE_CEILINGS[role].includes(permission));
    }
  }
  migrated.roles.grants.internal_compliance = ["read_decisions"];
  assert.equal(canUseEnterprisePermission(normalizeEnterprisePolicy(migrated), "internal_compliance", "review_decisions"), false);
  for (const role of Object.keys(migrated.roles.grants) as EnterpriseRole[]) {
    migrated.roles.grants[role] = [...DECISION_PERMISSIONS];
    for (const permission of DECISION_PERMISSIONS) {
      assert.equal(canUseEnterprisePermission(migrated, role, permission), DECISION_ROLE_CEILINGS[role].includes(permission), `${role}/${permission}`);
    }
  }
});
