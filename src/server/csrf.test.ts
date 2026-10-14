import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { csrfProtection } from "./csrf";

function responseRecorder() {
  const record = { status: 200, body: undefined as unknown };
  const response = {
    status(code: number) { record.status = code; return this; },
    json(body: unknown) { record.body = body; return this; },
  } as unknown as Response;
  return { record, response };
}

function authenticatedPost(path: string): Request {
  return {
    method: "POST",
    path,
    session: { csrfToken: "expected-token" },
    isAuthenticated: () => true,
    get: () => undefined,
    secure: true,
  } as unknown as Request;
}

test("P4 CSRF middleware narrowly exempts only the numeric enterprise SAML ACS path", () => {
  const allowed = responseRecorder();
  let allowedNext = false;
  csrfProtection(
    authenticatedPost("/api/client/auth/sso/42/saml/acs"),
    allowed.response,
    (() => { allowedNext = true; }) as NextFunction,
  );
  assert.equal(allowedNext, true);

  for (const path of [
    "/api/client/auth/sso/not-an-org/saml/acs",
    "/api/client/auth/sso/42/saml/acs/extra",
    "/api/client/auth/sso/42/saml",
    "/api/enterprise/organizations/42/sso/credentials",
  ]) {
    const blocked = responseRecorder();
    let blockedNext = false;
    csrfProtection(
      authenticatedPost(path),
      blocked.response,
      (() => { blockedNext = true; }) as NextFunction,
    );
    assert.equal(blockedNext, false, `${path} must not inherit the SAML ACS exemption`);
    assert.equal(blocked.record.status, 403);
  }
});
