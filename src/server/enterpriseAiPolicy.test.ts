import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p4-ai-policy-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { organizations, users } = await import("@shared/schema");
const { DEFAULT_ENTERPRISE_POLICY } = await import("@shared/enterpriseContracts");
const { saveEnterprisePolicy } = await import("./enterprisePolicyService");
const { runWithRequestIdentity } = await import("./requestContext");
const { invokeAIProvider } = await import("./byoaiTransport");
const { AIProviderError } = await import("./byoaiRouter");

await initDb();

let organizationId = 0;
let adminId = 0;
let adminEmail = "";

test.before(async () => {
  const [organization] = await getDb().insert(organizations).values({
    name: "P4 AI Policy Org",
    slug: `p4-ai-${crypto.randomUUID().slice(0, 8)}`,
  }).returning();
  adminEmail = `p4-ai-admin-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const [admin] = await getDb().insert(users).values({
    email: adminEmail,
    passwordHash: "not-used",
    role: "internal_admin",
    organizationId: null,
    name: "P4 AI Admin",
  }).returning();
  organizationId = organization.id;
  adminId = admin.id;
});

test.after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function expectPolicyDenied(): Promise<AIProviderError> {
  try {
    await runWithRequestIdentity(
      { userId: adminId, organizationId, credentials: {}, selectedConnectorIds: [] },
      () => invokeAIProvider({
        provider: "openai",
        model: "gpt-4o",
        messages: [{ role: "user", content: "Policy test" }],
      }),
    );
    assert.fail("Expected enterprise policy denial.");
  } catch (error) {
    assert.ok(error instanceof AIProviderError);
    assert.equal(error.code, "policy_denied");
    return error;
  }
}

test("P4 AI runtime blocks external providers under local-only enterprise policy", async () => {
  await saveEnterprisePolicy(organizationId, {
    ...DEFAULT_ENTERPRISE_POLICY,
    ai: {
      ...DEFAULT_ENTERPRISE_POLICY.ai,
      allowedProviders: ["openai"],
      allowedModels: ["gpt-4o"],
      endpointMode: "local_only",
      allowExternalData: true,
      requireApproval: false,
    },
  }, { id: adminId, email: adminEmail });

  const error = await expectPolicyDenied();
  assert.match(error.message, /local AI endpoints/i);
});

test("P4 AI runtime blocks organization data when external-data policy is false", async () => {
  await saveEnterprisePolicy(organizationId, {
    ...DEFAULT_ENTERPRISE_POLICY,
    ai: {
      ...DEFAULT_ENTERPRISE_POLICY.ai,
      allowedProviders: ["openai"],
      allowedModels: ["gpt-4o"],
      endpointMode: "hosted",
      endpointUrl: "https://api.openai.com",
      allowExternalData: false,
      requireApproval: false,
    },
  }, { id: adminId, email: adminEmail });

  const error = await expectPolicyDenied();
  assert.match(error.message, /forbids sending organization data/i);
});

test("P4 AI runtime requires explicit per-call approval when enterprise policy requires it", async () => {
  await saveEnterprisePolicy(organizationId, {
    ...DEFAULT_ENTERPRISE_POLICY,
    ai: {
      ...DEFAULT_ENTERPRISE_POLICY.ai,
      allowedProviders: ["openai"],
      allowedModels: ["gpt-4o"],
      endpointMode: "hosted",
      endpointUrl: "https://api.openai.com",
      allowExternalData: true,
      requireApproval: true,
    },
  }, { id: adminId, email: adminEmail });

  const error = await expectPolicyDenied();
  assert.match(error.message, /requires explicit approval/i);
});
