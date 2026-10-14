import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { LOCAL_TRUST_HANDOFF, LOCAL_TRUST_HEADER, hasLocalTrust, localTrustRequired, requireLocalDesktopTrust } from "./localDesktopTrust";

const slot = globalThis as Record<symbol, unknown>;
const TOKEN = "k".repeat(43);
const setToken = (value: unknown) => { if (value === undefined) delete slot[LOCAL_TRUST_HANDOFF]; else slot[LOCAL_TRUST_HANDOFF] = value; };
test.afterEach(() => setToken(undefined));

test("without a configured token the layer is off (dev and server Homes)", () => {
  assert.equal(localTrustRequired(), false);
  assert.equal(hasLocalTrust({ headers: {} }), true);
});

test("a token shorter than 32 characters is not accepted as configuration", () => {
  setToken("short");
  assert.equal(localTrustRequired(), false);
});

test("with a token, only requests that present exactly that token are trusted", () => {
  setToken(TOKEN);
  assert.equal(hasLocalTrust({ headers: { [LOCAL_TRUST_HEADER]: TOKEN } }), true);
  assert.equal(hasLocalTrust({ headers: {} }), false);
  assert.equal(hasLocalTrust({ headers: { [LOCAL_TRUST_HEADER]: "k".repeat(42) } }), false);
  assert.equal(hasLocalTrust({ headers: { [LOCAL_TRUST_HEADER]: `${TOKEN}x` } }), false);
  assert.equal(hasLocalTrust({ headers: { [LOCAL_TRUST_HEADER]: [TOKEN, "other"] } }), true, "first header value is the one compared");
});

test("the middleware answers 401 with no cookies and no body leak before any route runs", async () => {
  setToken(TOKEN);
  const app = express();
  app.use(requireLocalDesktopTrust);
  app.get("/api/secret", (_req, res) => { res.cookie("session", "x"); res.json({ secret: true }); });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const denied = await fetch(`${base}/api/secret`);
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: "local_trust_required" });
    assert.equal(denied.headers.get("set-cookie"), null);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${base}/api/secret`, { headers: { [LOCAL_TRUST_HEADER]: "wrong".repeat(10) } })).status, 401);
    const allowed = await fetch(`${base}/api/secret`, { headers: { [LOCAL_TRUST_HEADER]: TOKEN } });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { secret: true });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
