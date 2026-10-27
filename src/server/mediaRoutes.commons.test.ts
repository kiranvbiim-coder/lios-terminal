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


test("saved Commons lookup endpoint requires auth and a bounded File: title before network access", async t => {
  const app = express();
  let allowed = false;
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => allowed) as Request["isAuthenticated"];
    next();
  });
  registerMediaRoutes(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const denied = await fetch(origin + "/api/media/commons/cc0/file?title=File:Example.jpg");
  assert.equal(denied.status, 401);
  allowed = true;
  assert.equal((await fetch(origin + "/api/media/commons/cc0/file?title=bad")).status, 400);
  assert.equal((await fetch(origin + "/api/media/commons/cc0/file?title=" + "a".repeat(300))).status, 400);
});


test("an authenticated editor receives only explicitly requested CC0 candidates, without downloading any photo", async t => {
  const candidate = {
    fileTitle: "File:Policy illustration.jpg",
    filePage: "https://commons.wikimedia.org/wiki/File:Policy_illustration.jpg",
    previewUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/illustration.jpg/640px-illustration.jpg",
    creator: "Commons contributor", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" as const,
    license: "CC0 1.0" as const, mime: "image/jpeg" as const,
  };
  const trace: string[] = [];
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    next();
  });
  registerMediaRoutes(app, {
    search: async query => { trace.push("search:" + query); return [candidate]; },
    lookup: async title => {
      trace.push("lookup:" + title);
      if (title !== candidate.fileTitle) throw new Error("Source revoked");
      return candidate;
    },
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  assert.deepEqual(trace, []);
  const result = await fetch(url + "/api/media/commons/cc0?q=policy");
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.status, "unreviewed");
  assert.deepEqual(body.results, [candidate]);
  assert.deepEqual(trace, ["search:policy"]);
  const fresh = await fetch(url + "/api/media/commons/cc0/file?title=" + encodeURIComponent(candidate.fileTitle));
  assert.equal(fresh.status, 200);
  assert.deepEqual((await fresh.json()).candidate, candidate);
  assert.deepEqual(trace, ["search:policy", "lookup:" + candidate.fileTitle]);
  const denied = await fetch(url + "/api/media/commons/cc0/file?title=File:Revoked.jpg");
  assert.equal(denied.status, 502);
  assert.match((await denied.json()).error, /no longer verified CC0/);
});
