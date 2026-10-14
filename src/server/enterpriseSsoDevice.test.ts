import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { Request } from "express";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p4-sso-device-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { enterpriseSsoDeviceAuthorizations, organizations, users } = await import("@shared/schema");
const { DEFAULT_ENTERPRISE_POLICY } = await import("@shared/enterpriseContracts");
const { saveEnterprisePolicy } = await import("./enterprisePolicyService");
const {
  createEnterpriseSsoDeviceAuthorization,
  pollEnterpriseSsoDeviceAuthorization,
} = await import("./enterpriseSso");

await initDb();

let organizationId = 0;
let clientUserId = 0;
let clientEmail = "";
let adminId = 0;
let adminEmail = "";

test.before(async () => {
  const [organization] = await getDb().insert(organizations).values({
    name: "P4 SSO Device Org",
    slug: `p4-sso-device-${crypto.randomUUID().slice(0, 8)}`,
  }).returning();
  organizationId = organization.id;

  adminEmail = `p4-sso-admin-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const [admin] = await getDb().insert(users).values({
    email: adminEmail,
    passwordHash: "not-used",
    role: "internal_admin",
    organizationId: null,
    name: "P4 SSO Admin",
  }).returning();
  adminId = admin.id;

  clientEmail = `employee-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const [client] = await getDb().insert(users).values({
    email: clientEmail,
    passwordHash: "not-used",
    role: "client_user",
    organizationId,
    name: "Enterprise Employee",
  }).returning();
  clientUserId = client.id;

  await saveEnterprisePolicy(organizationId, {
    ...DEFAULT_ENTERPRISE_POLICY,
    sso: {
      mode: "oidc",
      status: "ready",
      issuer: "https://idp.example.test",
      clientId: "lios-enterprise-test",
      authorizationUrl: null,
      externalProvisioning: true,
    },
  }, { id: adminId, email: adminEmail });
});

test.after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function startRequest(): Request {
  return {
    secure: false,
    get(name: string) {
      const normalized = name.toLowerCase();
      if (normalized === "host") return "127.0.0.1:5052";
      if (normalized === "x-forwarded-proto") return undefined;
      return undefined;
    },
  } as unknown as Request;
}

function pollRequest(): Request & { loggedInUser?: Express.User } {
  const request = {
    session: {
      regenerate(done: (error?: Error) => void) { done(); },
    },
    loggedInUser: undefined as Express.User | undefined,
    logIn(user: Express.User, done: (error?: Error) => void) {
      request.loggedInUser = user;
      done();
    },
  };
  return request as unknown as Request & { loggedInUser?: Express.User };
}

test("P4 desktop SSO persists only verifier hash and consumes approval exactly once", async () => {
  const authorization = await createEnterpriseSsoDeviceAuthorization(startRequest(), clientEmail);
  assert.match(authorization.requestId, /^sso-device:/);
  assert.match(authorization.verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(authorization.verificationUrl, /deviceRequest=/);

  const [stored] = await getDb().select().from(enterpriseSsoDeviceAuthorizations)
    .where(eq(enterpriseSsoDeviceAuthorizations.id, authorization.requestId)).limit(1);
  assert.ok(stored);
  assert.notEqual(stored.verifierHash, authorization.verifier);
  assert.equal(stored.verifierHash, crypto.createHash("sha256").update(authorization.verifier).digest("hex"));
  assert.equal(JSON.stringify(stored).includes(authorization.verifier), false);

  const pendingRequest = pollRequest();
  const pending = await pollEnterpriseSsoDeviceAuthorization(
    pendingRequest,
    authorization.requestId,
    authorization.verifier,
  );
  assert.equal(pending.status, "pending");
  assert.equal(pendingRequest.loggedInUser, undefined);

  await getDb().update(enterpriseSsoDeviceAuthorizations).set({
    status: "approved",
    userId: clientUserId,
    approvedAt: new Date(),
  }).where(eq(enterpriseSsoDeviceAuthorizations.id, authorization.requestId));

  const approvedRequest = pollRequest();
  const authenticated = await pollEnterpriseSsoDeviceAuthorization(
    approvedRequest,
    authorization.requestId,
    authorization.verifier,
  );
  assert.equal(authenticated.status, "authenticated");
  assert.equal(approvedRequest.loggedInUser?.id, clientUserId);

  await assert.rejects(
    () => pollEnterpriseSsoDeviceAuthorization(
      pollRequest(),
      authorization.requestId,
      authorization.verifier,
    ),
    /no longer usable/i,
  );

  const [consumed] = await getDb().select().from(enterpriseSsoDeviceAuthorizations)
    .where(eq(enterpriseSsoDeviceAuthorizations.id, authorization.requestId)).limit(1);
  assert.equal(consumed.status, "consumed");
  assert.ok(consumed.consumedAt);
});

test("P4 desktop SSO rejects a wrong one-time verifier without changing request state", async () => {
  const authorization = await createEnterpriseSsoDeviceAuthorization(startRequest(), clientEmail);
  await assert.rejects(
    () => pollEnterpriseSsoDeviceAuthorization(
      pollRequest(),
      authorization.requestId,
      "x".repeat(64),
    ),
    /verifier is invalid/i,
  );
  const [row] = await getDb().select().from(enterpriseSsoDeviceAuthorizations)
    .where(eq(enterpriseSsoDeviceAuthorizations.id, authorization.requestId)).limit(1);
  assert.equal(row.status, "pending");
});


test("P4 enterprise SSO device authorization migration is tenant-RLS protected", () => {
  const migration = fs.readFileSync(
    path.resolve(process.cwd(), "migrations/0060_enterprise_sso_device_authorization.sql"),
    "utf8",
  );
  assert.match(migration, /ALTER TABLE "enterprise_sso_device_authorizations" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY "li_os_enterprise_sso_device_authorizations_tenant"/);
  assert.match(migration, /USING \("organization_id" = li_os_current_organization_id\(\)\)/);
  assert.match(migration, /WITH CHECK \("organization_id" = li_os_current_organization_id\(\)\)/);
});
