import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p4-deployment-"));
process.env.LIMURIA_DATA_DIR = dataDir;
process.env.LIMURIA_CREDENTIAL_STORE = "organization";
process.env.LIMURIA_HOSTED_VAULT_SECRET = "p4-test-vault-secret-0123456789abcdef-0123456789abcdef";

const { initDb, closeDb, getDb } = await import("./db");
const { organizations, users } = await import("@shared/schema");
const { DEFAULT_ENTERPRISE_POLICY } = await import("@shared/enterpriseContracts");
const { saveEnterprisePolicy } = await import("./enterprisePolicyService");
const { setOrganizationCredential } = await import("./organizationCredentialVault");
const {
  ENTERPRISE_PRIVATE_DEPLOYMENT_CREDENTIAL,
  getEnterpriseDeploymentReadiness,
  verifyEnterpriseDeploymentEndpoint,
} = await import("./enterpriseDeployment");

await initDb();

let organizationId = 0;
let adminId = 0;
let adminEmail = "";

test.before(async () => {
  const [organization] = await getDb().insert(organizations).values({
    name: "P4 Private Deployment Org",
    slug: `p4-deploy-${crypto.randomUUID().slice(0, 8)}`,
  }).returning();
  adminEmail = `p4-admin-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const [admin] = await getDb().insert(users).values({
    email: adminEmail,
    passwordHash: "not-used",
    role: "internal_admin",
    organizationId: null,
    name: "P4 Admin",
  }).returning();
  organizationId = organization.id;
  adminId = admin.id;

  await saveEnterprisePolicy(organizationId, {
    ...DEFAULT_ENTERPRISE_POLICY,
    deployment: {
      mode: "private_cloud",
      status: "ready",
      privateEndpointUrl: "https://private.example.test/lios/health",
    },
  }, { id: adminId, email: adminEmail });

  await setOrganizationCredential(
    organizationId,
    ENTERPRISE_PRIVATE_DEPLOYMENT_CREDENTIAL,
    "private-deployment-token-0123456789abcdef",
    "P4 test private deployment token",
    adminId,
  );
});

test.after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("P4 private deployment readiness exposes no secret material", async () => {
  const readiness = await getEnterpriseDeploymentReadiness(organizationId);
  assert.equal(readiness.configured, true);
  assert.equal(readiness.credentialConfigured, true);
  assert.equal(readiness.endpointOrigin, "https://private.example.test");
  assert.equal(JSON.stringify(readiness).includes("private-deployment-token"), false);
});

test("P4 private deployment verification requires an authenticated challenge response", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const challenge = headers.get("x-lios-deployment-challenge") ?? "";
      const timestamp = headers.get("x-lios-deployment-timestamp") ?? "";
      const organization = headers.get("x-lios-organization-id") ?? "";
      const token = "private-deployment-token-0123456789abcdef";
      const responseSignature = crypto.createHmac("sha256", token)
        .update(`ok:${organization}:${timestamp}:${challenge}`)
        .digest("hex");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-lios-deployment-challenge": challenge,
          "x-lios-deployment-signature-sha256": responseSignature,
        },
      });
    }) as typeof fetch;

    const verified = await verifyEnterpriseDeploymentEndpoint(organizationId, new Date("2026-09-19T15:30:00.000Z"));
    assert.equal(verified.verified, true);
    assert.equal(verified.challengeMatched, true);
    assert.equal(verified.statusCode, 200);

    globalThis.fetch = (async () => new Response(null, {
      status: 200,
      headers: {
        "x-lios-deployment-challenge": "wrong",
        "x-lios-deployment-signature-sha256": "0".repeat(64),
      },
    })) as typeof fetch;
    const rejected = await verifyEnterpriseDeploymentEndpoint(organizationId);
    assert.equal(rejected.verified, false);
    assert.equal(rejected.challengeMatched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
