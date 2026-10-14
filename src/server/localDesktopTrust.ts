import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { safeEqualSecret } from "./safeEqualSecret";

/**
 * GM-03 / owner decision Q5: when the desktop starts this server it hands over a random per-launch token
 * (see desktopHandoff.ts) and injects it into every request its own window makes. Any other local process,
 * browser tab or malicious web page can reach the loopback port but cannot present the token, so it cannot
 * use the API even though the session cookie alone would otherwise be enough for a page on the same machine.
 *
 * No token configured (plain `npm run dev`, a server Home exposed on a LAN) means this layer is off and the
 * normal authentication still applies.
 */
export const LOCAL_TRUST_HEADER = "x-lios-local-token";
export const LOCAL_TRUST_HANDOFF = Symbol.for("lios.localTrustToken");

function configuredToken(): string | null {
  const value = (globalThis as Record<symbol, unknown>)[LOCAL_TRUST_HANDOFF];
  return typeof value === "string" && value.length >= 32 ? value : null;
}

export function localTrustRequired(): boolean {
  return configuredToken() !== null;
}

/** True when the request carries the per-launch token (or none is required). Used by HTTP and WebSocket upgrade. */
export function hasLocalTrust(req: Pick<IncomingMessage, "headers">): boolean {
  const expected = configuredToken();
  if (!expected) return true;
  const supplied = req.headers[LOCAL_TRUST_HEADER];
  return safeEqualSecret(Array.isArray(supplied) ? supplied[0] : supplied, expected);
}

export function requireLocalDesktopTrust(req: Request, res: Response, next: NextFunction): void {
  if (hasLocalTrust(req)) {
    next();
    return;
  }
  res.status(401).setHeader("Cache-Control", "no-store").json({ error: "local_trust_required" });
}
