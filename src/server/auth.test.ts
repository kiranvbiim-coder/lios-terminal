import test from "node:test";
import assert from "node:assert/strict";
import passport from "passport";
import type { Express, NextFunction, Request, Response } from "express";
import {
  canAuthenticateAccount,
  deviceFingerprintHashFromRequest,
  ensureDeviceBindingCookie,
  hasFullClientAccess,
  registerAuthRoutes,
  registerClientAuthRoutes,
  requireAuth,
  requireClient,
  requireCurrentClient,
  requireInternal,
  requireRole,
  isLocalAdminBootstrapEnabled,
  isServerHomeOwnerBootstrapEnabled,
  isTrustedBootstrapOrigin,
} from "./auth";
import type { UserRole } from "@shared/schema";
import fs from "node:fs";
import path from "node:path";

function requestFor(role: UserRole | null): Request {
  return {
    isAuthenticated: () => role !== null,
    user: role === null ? undefined : {
      id: 1,
      email: "test@limuria.local",
      name: "Test User",
      role,
      organizationId: role.startsWith("client_") ? 10 : null,
      mustChangePassword: false,
    },
  } as unknown as Request;
}

function requestWithHeaders(headers: Record<string, string | undefined>, secure = false): Request {
  const lowered = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    secure,
    header(name: string) {
      return lowered[name.toLowerCase()];
    },
  } as unknown as Request;
}

function responseRecorder() {
  const record = { status: 200, body: undefined as unknown };
  const response = {
    status(code: number) {
      record.status = code;
      return this;
    },
    json(body: unknown) {
      record.body = body;
      return this;
    },
  } as unknown as Response;
  return { record, response };
}

function run(middleware: (req: Request, res: Response, next: NextFunction) => unknown, role: UserRole | null) {
  const { record, response } = responseRecorder();
  let nextCalled = false;
  middleware(requestFor(role), response, (() => { nextCalled = true; }) as NextFunction);
  return { ...record, nextCalled };
}

test("requireAuth admits authenticated roles and rejects anonymous requests", () => {
  assert.equal(run(requireAuth, "internal_admin").nextCalled, true);
  assert.equal(run(requireAuth, "client_user").nextCalled, true);
  assert.equal(run(requireAuth, null).status, 401);
});

test("internal and client audience gates are mutually exclusive", () => {
  for (const role of ["internal_admin", "internal_analyst", "internal_compliance"] as const) {
    assert.equal(run(requireInternal, role).nextCalled, true);
    assert.equal(run(requireClient, role).status, 403);
  }
  for (const role of ["client_admin", "client_user"] as const) {
    assert.equal(run(requireClient, role).nextCalled, true);
    assert.equal(run(requireInternal, role).status, 403);
  }
});

test("current-client lifecycle gate keeps anonymous and internal sessions out", () => {
  assert.equal(run(requireCurrentClient, null).status, 403);
  assert.equal(run(requireCurrentClient, "internal_admin").status, 403);
});

test("role gates keep compliance read-only and client roles outside internal author actions", () => {
  const authorGate = requireRole("internal_admin", "internal_analyst");
  assert.equal(run(authorGate, "internal_admin").nextCalled, true);
  assert.equal(run(authorGate, "internal_analyst").nextCalled, true);
  assert.equal(run(authorGate, "internal_compliance").status, 403);
  assert.equal(run(authorGate, "client_admin").status, 403);
  assert.equal(run(authorGate, null).status, 403);
});

test("inactive accounts and non-client lifecycle stages fail closed", () => {
  assert.equal(canAuthenticateAccount({ active: true }), true);
  assert.equal(canAuthenticateAccount({ active: false }), false);
  assert.equal(canAuthenticateAccount(undefined), false);
  assert.equal(hasFullClientAccess({ status: "active", lifecycleStage: "client" }), true);
  assert.equal(hasFullClientAccess({ status: "inactive", lifecycleStage: "client" }), false);
  assert.equal(hasFullClientAccess({ status: "active", lifecycleStage: "trial" }), false);
  assert.equal(hasFullClientAccess({ status: "active", lifecycleStage: "churned" }), false);
  assert.equal(hasFullClientAccess(null), false);
});

test("first-run administrator enrollment is restricted to the local embedded database", () => {
  assert.equal(isLocalAdminBootstrapEnabled({}), true);
  assert.equal(isLocalAdminBootstrapEnabled({ HOST: "127.0.0.1" }), true);
  assert.equal(isLocalAdminBootstrapEnabled({ HOST: "localhost" }), true);
  assert.equal(isLocalAdminBootstrapEnabled({ HOST: "::1" }), true);

  assert.equal(isLocalAdminBootstrapEnabled({ HOST: "0.0.0.0" }), false);
  assert.equal(isLocalAdminBootstrapEnabled({ DATABASE_URL: "postgres://db.example/lios" }), false);
  assert.equal(isLocalAdminBootstrapEnabled({
    HOST: "127.0.0.1",
    DATABASE_URL: "postgres://db.example/lios",
  }), false);
});

test("server-Home setup requires same-origin HTTPS or a direct loopback origin and socket", () => {
  assert.equal(isServerHomeOwnerBootstrapEnabled({ HOST: "0.0.0.0" }), true);
  assert.equal(isServerHomeOwnerBootstrapEnabled({ HOST: "127.0.0.1" }), false);
  const request = (origin: string | undefined, secure: boolean, peer: string, host = "home.example:10000"): Request => ({
    secure,
    socket: { remoteAddress: peer },
    get(name: string) { return name === "Origin" ? origin : name === "Host" ? host : undefined; },
  }) as unknown as Request;
  assert.equal(isTrustedBootstrapOrigin(request("https://home.example:10000", true, "10.0.0.8"), true), true);
  assert.equal(isTrustedBootstrapOrigin(request("https://home.example:10000", false, "10.0.0.8"), true), false);
  assert.equal(isTrustedBootstrapOrigin(request("http://home.example:10000", false, "10.0.0.8"), true), false);
  assert.equal(isTrustedBootstrapOrigin(request("http://localhost:10000", false, "127.0.0.1", "localhost:10000"), true), true);
  assert.equal(isTrustedBootstrapOrigin(request("http://home.example:10000", false, "::ffff:127.0.0.1"), true), false, "a loopback reverse proxy cannot downgrade a public HTTP origin");
  assert.equal(isTrustedBootstrapOrigin(request("https://evil.example", true, "10.0.0.8"), true), false);
  assert.equal(isTrustedBootstrapOrigin(request("https://home.example:10000/path", true, "10.0.0.8"), true), false);
  assert.equal(isTrustedBootstrapOrigin(request(undefined, true, "10.0.0.8"), true), false);
  // Desktop Local keeps its existing same-origin HTTP first-run path.
  assert.equal(isTrustedBootstrapOrigin(request("http://localhost:5052", false, "127.0.0.1", "localhost:5052"), false), true);
});

test("legacy local administrator identity is rejected before Passport authentication", () => {
  type AuthCallback = (err: Error | null, user: Express.User | false, info: { message?: string }) => void;
  type RouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;
  const mutablePassport = passport as unknown as {
    authenticate: (strategy: string, callback: AuthCallback) => RouteHandler;
  };
  const originalAuthenticate = mutablePassport.authenticate;
  let authenticateCalled = false;

  try {
    mutablePassport.authenticate = (_strategy, _callback) => (_req, _res, _next) => {
      authenticateCalled = true;
    };

    let loginRoute: RouteHandler | undefined;
    const app = {
      post(routePath: string, handler: RouteHandler) {
        if (routePath === "/api/auth/login") loginRoute = handler;
      },
      get(_routePath: string, _handler: RouteHandler) {},
    } as unknown as Express;
    registerAuthRoutes(app);
    assert.ok(loginRoute);

    const request = {
      body: { email: "ADMIN@LIMURIA.COM", password: "irrelevant" },
    } as unknown as Request;
    const { record, response } = responseRecorder();
    loginRoute(request, response, (() => {}) as NextFunction);

    assert.equal(record.status, 403);
    assert.equal(authenticateCalled, false);
    assert.match(String((record.body as { error?: string })?.error ?? ""), /legacy local administrator identity/i);
  } finally {
    mutablePassport.authenticate = originalAuthenticate;
  }
});

test("production ignores client-supplied legacy device fingerprints", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLegacy = process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER;
  try {
    process.env.NODE_ENV = "production";
    process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = "true";
    const request = requestWithHeaders({ "x-lios-device-fingerprint": "client-controlled-device-123456" });
    assert.equal(deviceFingerprintHashFromRequest(request), null);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    if (originalLegacy === undefined) delete process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER; else process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = originalLegacy;
  }
});

test("legacy device fingerprint header is available only behind an explicit non-production migration switch", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLegacy = process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER;
  try {
    process.env.NODE_ENV = "development";
    delete process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER;
    const request = requestWithHeaders({ "x-lios-device-fingerprint": "legacy-device-1234567890" });
    assert.equal(deviceFingerprintHashFromRequest(request), null);

    process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = "true";
    assert.equal(deviceFingerprintHashFromRequest(request), "legacy-device-1234567890");
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    if (originalLegacy === undefined) delete process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER; else process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = originalLegacy;
  }
});

test("server-issued signed device cookie takes precedence over a spoofed header", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLegacy = process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER;
  const originalSecret = process.env.LIMURIA_DEVICE_BINDING_SECRET;
  try {
    process.env.NODE_ENV = "production";
    process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = "true";
    process.env.LIMURIA_DEVICE_BINDING_SECRET = "test-device-binding-secret-with-sufficient-entropy";

    let setCookie = "";
    const response = {
      append(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") setCookie = value;
        return this;
      },
    } as unknown as Response;
    ensureDeviceBindingCookie(requestWithHeaders({}), response);
    assert.match(setCookie, /^lios_device_binding=/);
    const cookiePair = setCookie.split(";")[0];

    const request = requestWithHeaders({
      cookie: cookiePair,
      "x-lios-device-fingerprint": "spoofed-client-device-123456",
    });
    const fingerprint = deviceFingerprintHashFromRequest(request);
    assert.match(fingerprint ?? "", /^[a-f0-9]{64}$/);
    assert.notEqual(fingerprint, "spoofed-client-device-123456");
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    if (originalLegacy === undefined) delete process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER; else process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER = originalLegacy;
    if (originalSecret === undefined) delete process.env.LIMURIA_DEVICE_BINDING_SECRET; else process.env.LIMURIA_DEVICE_BINDING_SECRET = originalSecret;
  }
});

test("internal and client login rotate the session before Passport login", async () => {
  type AuthCallback = (err: Error | null, user: Express.User | false, info: { message?: string }) => void;
  type RouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;
  const mutablePassport = passport as unknown as {
    authenticate: (strategy: string, callback: AuthCallback) => RouteHandler;
  };
  const originalAuthenticate = mutablePassport.authenticate;

  try {
    for (const role of ["internal_admin", "client_user"] as const) {
      const path = "/api/auth/login";
      const user = {
        id: 7,
        email: "login-test@limuria.local",
        name: "Login Test",
        role,
        organizationId: null,
        mustChangePassword: false,
      } as Express.User;
      mutablePassport.authenticate = (_strategy, callback) => (_req, _res, _next) => {
        callback(null, user, {});
      };

      let loginRoute: RouteHandler | undefined;
      const app = {
        post(routePath: string, handler: RouteHandler) {
          if (routePath === path) loginRoute = handler;
        },
        get(_routePath: string, _handler: RouteHandler) {},
      } as unknown as Express;
      registerAuthRoutes(app);
      assert.ok(loginRoute);

      const originalSession = {
        id: "attacker-fixed-session",
        csrfToken: "pre-auth-token",
        returnTo: "/attacker-controlled",
      };
      const request = {
        session: originalSession,
        logIn(_loggedInUser: Express.User, done: (err?: Error) => void) {
          assert.notEqual(request.session, originalSession);
          assert.equal(request.session.id, "fresh-session");
          assert.equal("csrfToken" in request.session, false);
          assert.equal("returnTo" in request.session, false);
          done();
        },
      } as unknown as Request & { session: typeof originalSession & { id: string } };
      (originalSession as typeof originalSession & { regenerate?: (done: (err?: Error) => void) => void }).regenerate = (done) => {
        request.session = { id: "fresh-session" } as typeof request.session;
        done();
      };

      let responseBody: unknown;
      let nextError: unknown;
      const response = {
        status(_code: number) { return this; },
        json(body: unknown) { responseBody = body; return this; },
      } as unknown as Response;
      loginRoute(request, response, ((error?: unknown) => { nextError = error; }) as NextFunction);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(nextError, undefined);
      assert.deepEqual(responseBody, {
        success: true,
        user: { email: user.email, role: user.role, name: user.name, mustChangePassword: false },
      });
    }
  } finally {
    mutablePassport.authenticate = originalAuthenticate;
  }
});
