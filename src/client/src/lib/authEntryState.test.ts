import test from "node:test";
import assert from "node:assert/strict";
import { authEntryErrorMessage, authEntryFetch, safeSsoVerificationUrl, verifiedEntrySession } from "./authEntryState";

const principal = { email: "tester@example.test", role: "client", name: "Tester", mustChangePassword: false, authState: { state: "authenticated_online" } };
const fetchStatus = (status: number, body: unknown = principal): typeof fetch => async () => new Response(JSON.stringify(body), { status });

test("WS-13 session enters only after server /auth/me verifies identity", async () => {
  const s = await verifiedEntrySession({ fetcher: fetchStatus(200) });
  assert.deepEqual(s, principal);
});
test("WS-13 acknowledged sign-in but missing session never grants workspace", async () => {
  await assert.rejects(verifiedEntrySession({ fetcher: fetchStatus(401) }), /Session verification required/);
  await assert.rejects(verifiedEntrySession({ fetcher: fetchStatus(200, { name: "fake" }) }), /incomplete session/);
});
test("WS-13 temporary restore failures remain retryable and never impersonate sign-out", async () => {
  for (const status of [403, 500, 503]) {
    await assert.rejects(verifiedEntrySession({ fetcher: fetchStatus(status) }), /restore your session/);
  }
});
test("WS-13 login errors distinguish known credential, limits, and service failures", () => {
  assert.match(authEntryErrorMessage("signin", 401), /email or password/);
  assert.match(authEntryErrorMessage("signin", 429), /Too many attempts/);
  assert.match(authEntryErrorMessage("signin", 503), /unavailable/);
  assert.match(authEntryErrorMessage("register", 409), /already exist/);
});
test("WS-13 403 only maps allow-listed entitlement codes, never arbitrary backend body", () => {
  assert.match(authEntryErrorMessage("signin", 403, "license_suspended"), /suspended/);
  assert.match(authEntryErrorMessage("signin", 403, "license_grace_expired"), /billing grace period/);
  assert.match(authEntryErrorMessage("signin", 403, "license_security_locked"), /security reasons/);
  assert.match(authEntryErrorMessage("signin", 403, "license_terminated"), /terminated/);
  assert.doesNotMatch(authEntryErrorMessage("signin", 403, "SECRET_FAKE_SERVER_DETAIL"), /SECRET_FAKE_SERVER_DETAIL/);
  assert.doesNotMatch(authEntryErrorMessage("register", 400, "SECRET_FAKE_SERVER_DETAIL"), /SECRET_FAKE_SERVER_DETAIL/);
});
test("WS-13 enterprise device authorization URL must use HTTPS without embedded credentials", () => {
  assert.equal(safeSsoVerificationUrl("https://auth.example.test/approve?id=1"), "https://auth.example.test/approve?id=1");
  for (const url of ["javascript:alert(1)", "data:text/plain,abc", "http://auth.example.test", "https://bob:secret@auth.example.test/", "//auth.example.test", "bad-url", "", null]) {
    assert.equal(safeSsoVerificationUrl(url), null);
  }
});
test("WS-13 auth entry POST uses a bounded deadline and genuine HTTP response", async () => {
  let method: string | undefined;
  const response = await authEntryFetch("/api/auth/login", { method: "POST" }, { fetcher: async (_, init) => {
    method = init?.method;
    return new Response(null, { status: 204 });
  } });
  assert.equal(response.status, 204);
  assert.equal(method, "POST");
});
test("WS-13 stalled auth request aborts and becomes retryable even when adapter ignores abort", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(authEntryFetch("/api/auth/login", { method: "POST" }, { timeoutMs: 10, fetcher: async (_, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  } }), /timed out/);
  assert.equal(signal?.aborted, true);
});
test("WS-13 no-credential data is forwarded into error copy", () => {
  const malicious = "<private refresh_token=SECRET>";

  for (const status of [400, 401, 403, 409, 429, 500]) {
    for (const mode of ["signin", "register", "sso"] as const) {
      assert.equal(authEntryErrorMessage(mode, status, malicious).includes("SECRET"), false);
    }
  }
});

test("development loopback SSO remains supported without permitting remote HTTP or credentials", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(safeSsoVerificationUrl(`http://${host}:5052/approve`, true), `http://${host}:5052/approve`);
    assert.equal(safeSsoVerificationUrl(`http://${host}:5052/approve`), null);
  }
  assert.equal(safeSsoVerificationUrl("http://auth.example.test/approve", true), null);
  assert.equal(safeSsoVerificationUrl("http://user:secret@localhost/approve", true), null);
});
