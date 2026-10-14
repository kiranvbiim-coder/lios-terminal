import test from "node:test";
import assert from "node:assert/strict";
import type { Express, NextFunction, Request, Response } from "express";
import { registerSecurityHeaders } from "./securityHeaders";

test("production responses carry restrictive browser security headers", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    let middleware: ((req: Request, res: Response, next: NextFunction) => void) | undefined;
    registerSecurityHeaders({ use(handler: typeof middleware) { middleware = handler; } } as unknown as Express);
    assert.ok(middleware);
    const headers = new Map<string, string>();
    const res = { setHeader(name: string, value: string) { headers.set(name, value); return this; } } as unknown as Response;
    let nextCalled = false;
    middleware!({} as Request, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true);
    assert.equal(headers.get("X-Frame-Options"), "DENY");
    assert.match(headers.get("Content-Security-Policy") ?? "", /object-src 'none'/);
    assert.match(headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
    assert.match(headers.get("Strict-Transport-Security") ?? "", /max-age=31536000/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
