import crypto from "crypto";
import { safeEqualSecret } from "./safeEqualSecret";
import type { Request, Response, NextFunction, Express } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_SESSION_KEY = "csrfToken";

function getOrCreateToken(req: Request): string {
  const session = req.session as typeof req.session & { csrfToken?: string };
  if (!session[CSRF_SESSION_KEY]) session[CSRF_SESSION_KEY] = crypto.randomBytes(32).toString("base64url");
  return session[CSRF_SESSION_KEY];
}

export function registerCsrfRoutes(app: Express): void {
  app.get("/api/security/csrf", (req, res) => {
    const token = getOrCreateToken(req);
    res.setHeader("Cache-Control", "no-store");
    res.json({ token });
  });
}

function sameOrigin(req: Request): boolean {
  const origin = req.get("Origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const forwardedProto = req.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
    const protocol = forwardedProto || (req.secure ? "https" : "http");
    return originUrl.protocol === `${protocol}:` && originUrl.host === req.get("Host");
  } catch {
    return false;
  }
}

/**
 * Synchronizer-token CSRF protection for cookie-authenticated browser APIs.
 * A valid same-origin Origin header is accepted as a compatibility fallback
 * for existing same-origin terminal requests. New clients should fetch
 * /api/security/csrf and send X-CSRF-Token.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || !req.path.startsWith("/api/")) {
    next();
    return;
  }

  if (req.path === "/api/auth/login") {
    next();
    return;
  }

  // SAML HTTP-POST binding is intentionally cross-site. This exemption is
  // restricted to the exact ACS shape; enterpriseSso.ts authenticates
  // RelayState with an organization-vault HMAC, atomically claims the
  // short-lived request, and sends the assertion to the hardened verifier.
  if (req.method === "POST" && /^\/api\/client\/auth\/sso\/\d+\/saml\/acs$/.test(req.path)) {
    next();
    return;
  }

  if (!req.isAuthenticated()) {
    next();
    return;
  }

  const session = req.session as typeof req.session & { csrfToken?: string };
  const expected = session[CSRF_SESSION_KEY];
  const supplied = req.get("X-CSRF-Token");

  if (expected && supplied && safeEqualSecret(supplied, expected)) {
    next();
    return;
  }

  if (sameOrigin(req)) {
    next();
    return;
  }

  res.status(403).json({ error: "CSRF validation failed." });
}
