import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { buildRouteManifest, compareStoredRouteManifest } from "./routeManifest";
import type { RouteManifestDocument } from "./routeManifest";

// Small live Express routers exercise probe/comparison behavior, not production authorization evidence.
test("stored route comparison ignores checkout line endings and JSON presentation only", async () => {
  const app = express();
  app.get("/api/public/status", (_req, _res) => assert.fail("final handlers must not run"));
  app.post("/api/private/action", (req, res, next) => {
    if (!req.isAuthenticated()) return void res.sendStatus(401);
    next();
  }, (_req, _res) => assert.fail("final handlers must not run"));
  const current: RouteManifestDocument = { generatedBy: "npm run routes:manifest", routes: await buildRouteManifest(app) };
  const presented = {
    routes: [...current.routes].reverse().map((entry) => ({
      unprobed: entry.unprobed,
      reachableBy: [...entry.reachableBy].reverse(),
      path: entry.path,
      method: entry.method,
    })),
    generatedBy: current.generatedBy,
  };
  for (const stored of [JSON.stringify(presented), JSON.stringify(presented, null, 4).replace(/\n/g, "\r\n") + "\r\n"]) {
    assert.equal(compareStoredRouteManifest(stored, current), undefined);
  }
});

test("removing a real guard still fails with anonymous reachability diagnostics", async () => {
  const protectedApp = express();
  protectedApp.get("/api/private/action", (req, res, next) => {
    if (!req.isAuthenticated()) return void res.sendStatus(401);
    next();
  }, (_req, _res) => assert.fail("final handlers must not run"));
  const publicApp = express();
  publicApp.get("/api/private/action", (_req, _res) => assert.fail("final handlers must not run"));
  const stored = { generatedBy: "npm run routes:manifest", routes: await buildRouteManifest(protectedApp) };
  const current = { generatedBy: stored.generatedBy, routes: await buildRouteManifest(publicApp) };
  assert.equal(stored.routes[0]!.reachableBy.includes("anonymous"), false);
  assert.equal(current.routes[0]!.reachableBy.includes("anonymous"), true);
  const difference = compareStoredRouteManifest(JSON.stringify(stored), current);
  assert.match(difference ?? "", /GET \/api\/private\/action/);
  assert.match(difference ?? "", /current .*reachableBy=\["anonymous"/);
});

test("changing the allowed authenticated role still fails", async () => {
  const clientApp = express();
  clientApp.get("/api/admin/action", (req, res, next) => {
    if (req.user?.role !== "client_admin") return void res.sendStatus(403);
    next();
  }, (_req, _res) => assert.fail("final handlers must not run"));
  const internalApp = express();
  internalApp.get("/api/admin/action", (req, res, next) => {
    if (req.user?.role !== "internal_admin") return void res.sendStatus(403);
    next();
  }, (_req, _res) => assert.fail("final handlers must not run"));
  const stored = { generatedBy: "npm run routes:manifest", routes: await buildRouteManifest(clientApp) };
  const current = { generatedBy: stored.generatedBy, routes: await buildRouteManifest(internalApp) };
  assert.deepEqual(stored.routes[0]!.reachableBy, ["client_admin"]);
  assert.deepEqual(current.routes[0]!.reachableBy, ["internal_admin"]);
  const difference = compareStoredRouteManifest(JSON.stringify(stored), current);
  assert.match(difference ?? "", /stored .*reachableBy=\["client_admin"\]/);
  assert.match(difference ?? "", /current .*reachableBy=\["internal_admin"\]/);
});

test("an unprobed guard differs even when its conservative reachability matches", async () => {
  const uncertainApp = express();
  uncertainApp.get("/api/action", (_req, res, next) => {
    // The synthetic response never emits lifecycle events, so the real probe timeout marks this unprobed.
    res.once("close", next);
  }, (_req, _res) => assert.fail("final handlers must not run"));
  const publicApp = express();
  publicApp.get("/api/action", (_req, _res) => assert.fail("final handlers must not run"));
  const stored = { generatedBy: "npm run routes:manifest", routes: await buildRouteManifest(uncertainApp) };
  const current = { generatedBy: stored.generatedBy, routes: await buildRouteManifest(publicApp) };
  assert.deepEqual(stored.routes[0]!.reachableBy, current.routes[0]!.reachableBy);
  assert.equal(stored.routes[0]!.unprobed, true);
  assert.equal(current.routes[0]!.unprobed, false);
  assert.match(compareStoredRouteManifest(JSON.stringify(stored), current) ?? "", /stored .*unprobed=true; current .*unprobed=false/);
});

test("route identities and multiplicity cannot be normalized away", async () => {
  const app = express();
  app.get("/api/action", (_req, _res) => assert.fail("final handlers must not run"));
  const current = { generatedBy: "npm run routes:manifest", routes: await buildRouteManifest(app) };
  const entry = current.routes[0]!;
  for (const routes of [
    [],
    [{ ...entry, method: "POST" }],
    [{ ...entry, path: "/api/other" }],
    [entry, entry],
    [{ ...entry, reachableBy: [...entry.reachableBy, "anonymous"] }],
    [{ ...entry, reviewed: true }],
  ]) {
    assert.match(compareStoredRouteManifest(JSON.stringify({ ...current, routes }), current) ?? "", /First route difference:/);
  }
  assert.match(compareStoredRouteManifest(JSON.stringify({ ...current, generatedBy: "other generator" }), current) ?? "", /metadata differs/);
});

test("generated route identities use locale-independent path and method ordering", async () => {
  const app = express();
  for (const route of ["/api/a", "/api/_action", "/api/A"]) {
    app.post(route, (_req, _res) => assert.fail("final handlers must not run"));
    app.get(route, (_req, _res) => assert.fail("final handlers must not run"));
  }
  const entries = await buildRouteManifest(app);
  assert.deepEqual(entries.map(({ method, path }) => `${method} ${path}`), [
    "GET /api/A", "POST /api/A",
    "GET /api/_action", "POST /api/_action",
    "GET /api/a", "POST /api/a",
  ]);
});
