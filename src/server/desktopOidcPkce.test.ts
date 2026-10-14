import assert from "node:assert/strict";
import test from "node:test";
import {
  beginDesktopOidc,
  clearPendingDesktopOidcForTests,
  completeDesktopOidc,
  pkceChallenge,
} from "./desktopOidcPkce";
import { principalFromUser } from "@shared/identityContracts";

const provider = {
  id: "example",
  authorizationEndpoint: "https://identity.example.com/authorize",
  tokenEndpoint: "https://identity.example.com/token",
  clientId: "lios-desktop",
  scopes: ["openid", "profile", "email"],
  redirectUri: "http://127.0.0.1:43761/callback",
};

test("desktop OIDC start uses authorization code + PKCE S256 without exposing the verifier", () => {
  clearPendingDesktopOidcForTests();
  const started = beginDesktopOidc(provider, new Date("2026-09-26T00:00:00.000Z"), 5 * 60_000);
  const url = new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{40,}$/);
  assert.match(url.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(started.authorizationUrl.includes("code_verifier"), false);
});

test("desktop OIDC callback validates state, consumes once, and passes the verifier only to the provider adapter", async () => {
  clearPendingDesktopOidcForTests();
  const now = new Date("2026-09-26T00:00:00.000Z");
  const started = beginDesktopOidc(provider, now);
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  let receivedVerifier = "";

  const principal = await completeDesktopOidc({
    requestId: started.requestId,
    state,
    code: "authorization-code",
  }, {
    async exchangeAuthorizationCode(input) {
      receivedVerifier = input.codeVerifier;
      assert.equal(input.code, "authorization-code");
      assert.equal(input.provider.id, "example");
      return principalFromUser({
        id: 9,
        email: "user@example.com",
        name: "User",
        role: "client_user",
        organizationId: 12,
      });
    },
  }, new Date(now.getTime() + 30_000));

  assert.equal(principal.userId, 9);
  assert.match(receivedVerifier, /^[A-Za-z0-9_-]{43,}$/);
  assert.match(pkceChallenge(receivedVerifier), /^[A-Za-z0-9_-]{40,}$/);

  await assert.rejects(() => completeDesktopOidc({
    requestId: started.requestId,
    state,
    code: "replay",
  }, { async exchangeAuthorizationCode() { return principal; } }, now), /missing or already consumed/);
});

test("desktop OIDC state mismatch fails closed before adapter exchange", async () => {
  clearPendingDesktopOidcForTests();
  const started = beginDesktopOidc(provider, new Date("2026-09-26T00:00:00.000Z"));
  let exchanged = false;
  await assert.rejects(() => completeDesktopOidc({
    requestId: started.requestId,
    state: "x".repeat(43),
    code: "authorization-code",
  }, {
    async exchangeAuthorizationCode() {
      exchanged = true;
      return principalFromUser({
        id: 1,
        email: "x@example.com",
        name: "X",
        role: "client_user",
        organizationId: 2,
      });
    },
  }, new Date("2026-09-26T00:00:30.000Z")), /state validation failed/);
  assert.equal(exchanged, false);
});
