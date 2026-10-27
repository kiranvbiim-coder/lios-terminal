import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request } from "express";
import { registerMediaRoutes } from "./mediaRoutes";

test("Commons discovery is authenticated and rejects invalid search terms before any external request", async t => {
  const app = express();
  let authenticated = false;
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => authenticated) as Request["isAuthenticated"];
    next();
  });
  registerMediaRoutes(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const denied = await fetch(origin + "/api/media/commons/cc0?q=solar");
  assert.equal(denied.status, 401);
  authenticated = true;
  const empty = await fetch(origin + "/api/media/commons/cc0?q=x");
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /Search must be/);
  const huge = await fetch(origin + "/api/media/commons/cc0?q=" + "x".repeat(101));
  assert.equal(huge.status, 400);
});
