import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p4-saml-flow-"));
process.env.LIMURIA_DATA_DIR = dataDir;
process.env.LIMURIA_CREDENTIAL_STORE = "organization";
process.env.LIMURIA_HOSTED_VAULT_SECRET = "p4-saml-test-vault-secret-0123456789abcdef-0123456789abcdef";
process.env.LIOS_HOME_PUBLIC_URL = "https://control.example.test/";
process.env.LIOS_SAML_VERIFIER_URL = "https://verifier.example.test/verify";

const { initDb, closeDb, getDb } = await import("./db");
const { enterpriseSamlRequests, organizations, users } = await import("@shared/schema");
const { DEFAULT_ENTERPRISE_POLICY } = await import("@shared/enterpriseContracts");
const { saveEnterprisePolicy } = await import("./enterprisePolicyService");
const { setOrganizationCredential } = await import("./organizationCredentialVault");
const {
  ENTERPRISE_SSO_CREDENTIALS,
  registerEnterpriseSsoRoutes,
  signEnterpriseSamlRelayState,
  verifyEnterpriseSamlRelayState,
} = await import("./enterpriseSso");

await initDb();

let organizationId = 0;
let adminId = 0;
let adminEmail = "";
const samlSecret = "p4-saml-verifier-secret-0123456789abcdef";

test.before(async () => {
  const [organization] = await getDb().insert(organizations).values({
    name: "P4 SAML Sessionless Org",
    slug: `p4-saml-${crypto.randomUUID().slice(0, 8)}`,
  }).returning();
  organizationId = organization.id;

  adminEmail = `p4-saml-admin-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const [admin] = await getDb().insert(users).values({
    email: adminEmail,
    passwordHash: "not-used",
    role: "internal_admin",
    organizationId: null,
    name: "P4 SAML Admin",
  }).returning();
  adminId = admin.id;

  await saveEnterprisePolicy(organizationId, {
    ...DEFAULT_ENTERPRISE_POLICY,
    seats: {
      ...DEFAULT_ENTERPRISE_POLICY.seats,
      allowedEmailDomains: ["example.test"],
      requireAdminApproval: false,
    },
    sso: {
      mode: "saml",
      status: "ready",
      issuer: "https://idp.example.test/entity",
      clientId: "https://control.example.test/saml/sp",
      authorizationUrl: "https://idp.example.test/sso",
      externalProvisioning: true,
    },
  }, { id: adminId, email: adminEmail });

  await setOrganizationCredential(
    organizationId,
    ENTERPRISE_SSO_CREDENTIALS.samlVerifierSecret,
    samlSecret,
    "P4 SAML verifier secret",
    adminId,
  );
});

test.after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

type RouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;

function captureSsoRoutes() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();
  const app = {
    get(routePath: string, handler: RouteHandler) {
      gets.set(routePath, handler);
      return this;
    },
    post(routePath: string, handler: RouteHandler) {
      posts.set(routePath, handler);
      return this;
    },
  };
  registerEnterpriseSsoRoutes(app as never);
  return { gets, posts };
}

function responseRecorder() {
  const record = {
    status: 200,
    body: undefined as unknown,
    redirectStatus: 0,
    redirectUrl: "",
    headers: {} as Record<string, string>,
  };
  const response = {
    status(code: number) { record.status = code; return this; },
    json(body: unknown) { record.body = body; return this; },
    setHeader(name: string, value: string | number | readonly string[]) {
      record.headers[name.toLowerCase()] = String(value);
      return this;
    },
    redirect(code: number, url: string) {
      record.redirectStatus = code;
      record.redirectUrl = url;
      return this;
    },
  } as unknown as Response;
  return { record, response };
}

test("P4 SAML RelayState is authenticated, bounded, and rejects tampering", () => {
  const now = new Date("2026-09-19T15:30:00.000Z");
  const requestId = "_lios_0123456789abcdefghijklmnopqrstuv";
  const relayState = signEnterpriseSamlRelayState({
    organizationId,
    requestId,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    secret: samlSecret,
  });
  const verified = verifyEnterpriseSamlRelayState({
    organizationId,
    relayState,
    secret: samlSecret,
    now,
  });
  assert.equal(verified.requestId, requestId);

  const tampered = relayState.replace(requestId, "_lios_Z123456789abcdefghijklmnopqrstuv");
  assert.throws(
    () => verifyEnterpriseSamlRelayState({ organizationId, relayState: tampered, secret: samlSecret, now }),
    /authentication failed/i,
  );

  assert.throws(
    () => verifyEnterpriseSamlRelayState({
      organizationId,
      relayState,
      secret: samlSecret,
      now: new Date(now.getTime() + 20 * 60_000),
    }),
    /expired|outside the allowed/i,
  );
});

test("P4 SAML HTTP-POST callback succeeds without the pre-redirect session cookie and blocks replay", async () => {
  const { gets, posts } = captureSsoRoutes();
  const start = gets.get("/api/client/auth/sso/:orgId/start");
  const acs = posts.get("/api/client/auth/sso/:orgId/saml/acs");
  assert.ok(start);
  assert.ok(acs);

  const startRequest = {
    params: { orgId: String(organizationId) },
    query: { returnTo: "/" },
    session: {},
  } as unknown as Request;
  const started = responseRecorder();
  let startError: unknown;
  await start(startRequest, started.response, ((error?: unknown) => { startError = error; }) as NextFunction);
  assert.equal(startError, undefined);
  assert.equal(started.record.redirectStatus, 302);

  const idpUrl = new URL(started.record.redirectUrl);
  assert.equal(idpUrl.origin, "https://idp.example.test");
  const relayState = idpUrl.searchParams.get("RelayState");
  assert.ok(relayState);
  assert.ok(idpUrl.searchParams.get("SAMLRequest"));
  assert.equal("liosEnterpriseSso" in (startRequest.session as object), false, "SAML start must not depend on browser session state");

  const relay = verifyEnterpriseSamlRelayState({
    organizationId,
    relayState,
    secret: samlSecret,
  });
  const [stored] = await getDb().select().from(enterpriseSamlRequests)
    .where(eq(enterpriseSamlRequests.id, relay.requestId)).limit(1);
  assert.ok(stored);
  assert.equal(stored.status, "pending");
  assert.equal(stored.returnTo, "/");

  const originalFetch = globalThis.fetch;
  let verifierCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    verifierCalls += 1;
    assert.equal(String(input), "https://verifier.example.test/verify");
    const body = String(init?.body ?? "");
    const signature = new Headers(init?.headers).get("x-lios-saml-signature-sha256");
    const expected = crypto.createHmac("sha256", samlSecret).update(body).digest("hex");
    assert.equal(signature, expected);
    const payload = JSON.parse(body) as { requestId?: string };
    assert.equal(payload.requestId, relay.requestId);
    return new Response(JSON.stringify({
      valid: true,
      issuer: "https://idp.example.test/entity",
      audience: "https://control.example.test/saml/sp",
      inResponseTo: relay.requestId,
      subject: "saml-user-123",
      email: "employee@example.test",
      name: "Enterprise SAML User",
      emailVerified: true,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    let loggedInUser: Express.User | undefined;
    const callbackRequest = {
      params: { orgId: String(organizationId) },
      body: { SAMLResponse: "signed-assertion-placeholder", RelayState: relayState },
      // Deliberately a fresh callback session with no liosEnterpriseSso state.
      session: {
        regenerate(done: (error?: Error) => void) { done(); },
      },
      logIn(user: Express.User, done: (error?: Error) => void) {
        loggedInUser = user;
        done();
      },
    } as unknown as Request;
    const callback = responseRecorder();
    let callbackError: unknown;
    await acs(callbackRequest, callback.response, ((error?: unknown) => { callbackError = error; }) as NextFunction);
    assert.equal(callbackError, undefined);
    assert.equal(callback.record.redirectStatus, 303);
    assert.equal(callback.record.redirectUrl, "/");
    assert.equal(loggedInUser?.email, "employee@example.test");
    assert.equal(verifierCalls, 1);

    const [consumed] = await getDb().select().from(enterpriseSamlRequests)
      .where(eq(enterpriseSamlRequests.id, relay.requestId)).limit(1);
    assert.equal(consumed.status, "consumed");
    assert.ok(consumed.consumedAt);

    const replayRequest = {
      params: { orgId: String(organizationId) },
      body: { SAMLResponse: "signed-assertion-placeholder", RelayState: relayState },
      session: { regenerate(done: (error?: Error) => void) { done(); } },
      logIn(_user: Express.User, done: (error?: Error) => void) { done(); },
    } as unknown as Request;
    const replay = responseRecorder();
    await acs(replayRequest, replay.response, (() => {}) as NextFunction);
    assert.equal(replay.record.status, 409);
    assert.equal((replay.record.body as { code?: string })?.code, "saml_request_replayed");
    assert.equal(verifierCalls, 1, "replayed callback must be rejected before calling the external verifier");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("P4 SAML request-state migration is tenant-RLS protected", () => {
  const migration = fs.readFileSync(
    path.resolve(process.cwd(), "migrations/0061_enterprise_saml_request_state.sql"),
    "utf8",
  );
  assert.match(migration, /ALTER TABLE "enterprise_saml_requests" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY "li_os_enterprise_saml_requests_tenant"/);
  assert.match(migration, /USING \("organization_id" = li_os_current_organization_id\(\)\)/);
  assert.match(migration, /WITH CHECK \("organization_id" = li_os_current_organization_id\(\)\)/);
});
