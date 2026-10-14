import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { discoverOidc, registerEnterpriseSsoRoutes, validateOidcIdToken } from "./enterpriseSso";

test("P4 enterprise SSO registers hosted OIDC and SAML surfaces before the internal gate", () => {
  const routes: string[] = [];
  const app = {
    get(path: string) { routes.push(`GET ${path}`); return this; },
    post(path: string) { routes.push(`POST ${path}`); return this; },
  };
  registerEnterpriseSsoRoutes(app as never);
  for (const expected of [
    "POST /api/client/auth/sso/device/start",
    "POST /api/client/auth/sso/device/poll",
    "GET /api/client/auth/sso/:orgId",
    "GET /api/client/auth/sso/:orgId/start",
    "GET /api/client/auth/sso/:orgId/callback",
    "POST /api/client/auth/sso/:orgId/saml/acs",
  ]) assert.ok(routes.includes(expected), `missing ${expected}`);
});

test("OIDC discovery fails closed when provider metadata changes issuer", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    issuer: "https://attacker.example",
    authorization_endpoint: "https://idp.example/authorize",
    token_endpoint: "https://idp.example/token",
    jwks_uri: "https://idp.example/jwks",
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await assert.rejects(
      () => discoverOidc("https://idp.example"),
      /issuer does not match organization policy/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OIDC ID token validation verifies signature, issuer, audience and nonce", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  jwk.kid = "kid-1";
  jwk.use = "sig";
  jwk.alg = "RS256";

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "kid-1", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://idp.example",
    aud: "lios-enterprise",
    sub: "subject-123",
    email: "User@Example.com",
    email_verified: true,
    name: "Enterprise User",
    nonce: "nonce-123",
    iat: now,
    exp: now + 300,
  })).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
  const token = `${input}.${signature}`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  try {
    const identity = await validateOidcIdToken({
      idToken: token,
      issuer: "https://idp.example",
      clientId: "lios-enterprise",
      nonce: "nonce-123",
      jwksUri: "https://idp.example/jwks",
    });
    assert.deepEqual(identity, {
      subject: "subject-123",
      email: "user@example.com",
      name: "Enterprise User",
      emailVerified: true,
    });

    await assert.rejects(
      () => validateOidcIdToken({
        idToken: token,
        issuer: "https://idp.example",
        clientId: "lios-enterprise",
        nonce: "wrong-nonce",
        jwksUri: "https://idp.example/jwks",
      }),
      /nonce validation failed/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OIDC rejects unsigned tokens without contacting JWKS", async () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", kid: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({})).toString("base64url");
  await assert.rejects(
    () => validateOidcIdToken({
      idToken: `${header}.${payload}.`,
      issuer: "https://idp.example",
      clientId: "lios-enterprise",
      nonce: "nonce",
      jwksUri: "https://idp.example/jwks",
    }),
    /signing metadata is incomplete/i,
  );
});
