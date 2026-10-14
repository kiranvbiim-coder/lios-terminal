import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the customer runtime registers no billing or credit routes", () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "routes.ts"), "utf8");
  assert.ok(source.indexOf('app.use("/api", (req, res, next) => {') >= 0, "the internal API gate must remain explicit");
  assert.doesNotMatch(source, /registerBilling|billingRoutes|billingWebhook/);
});

test("global API gate exposes only the exact self-scoped Master AI preference routes to authenticated clients", () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "routes.ts"), "utf8");
  assert.match(source, /isAuthenticatedSelfServiceRoute\(req\.method, req\.path\)/);
  assert.match(source, /isPublicData \|\| isAuthenticatedSelfService \? requireAuth\(req, res, next\) : requireInternal\(req, res, next\)/);
});


test("public preview support stays non-executable while authenticated data routes remain behind the API gate", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(root, "routes.ts"), "utf8");
  const publicSource = fs.readFileSync(path.join(root, "publicRoutes.ts"), "utf8");
  const gate = source.indexOf('app.use("/api", (req, res, next) => {');
  const publicRoutes = source.indexOf("registerPublicRoutes(app);");
  assert.ok(publicRoutes >= 0, "public lead-capture registrar must remain registered");
  assert.ok(gate >= 0 && publicRoutes < gate, "public lead capture must remain reachable before the authenticated API gate");
  assert.ok(publicSource.includes("/api/public/leads"), "the intentional public lead-capture route must remain explicit");
  for (const forbidden of ["/api/public/research/quick", "runGuestPublicResearch", "guestResearchRequestSchema"]) {
    assert.equal(publicSource.includes(forbidden), false, "public route surface must not expose executable guest research: " + forbidden);
  }
});
