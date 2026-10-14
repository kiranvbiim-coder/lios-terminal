import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { registerProductionControlRoutes } from "./productionControlRoutes";

test("P3 production-control route inventory is explicit", () => {
  const routes: string[] = [];
  const app = {
    get(route: string) { routes.push(`GET ${route}`); return this; },
    post(route: string) { routes.push(`POST ${route}`); return this; },
    put(route: string) { routes.push(`PUT ${route}`); return this; },
    delete(route: string) { routes.push(`DELETE ${route}`); return this; },
  } as unknown as Express;

  registerProductionControlRoutes(app);

  for (const expected of [
    "GET /api/public/desktop-distribution",
    "GET /api/client/diagnostics/config",
    "POST /api/client/diagnostics",
    "GET /api/client/export-custody",
    "POST /api/client/export-custody",
    "DELETE /api/client/export-custody/:id",
    "GET /api/admin/production-control/status",
    "PUT /api/admin/production-control/retention",
    "POST /api/admin/production-control/purge",
    "POST /api/admin/production-control/organizations/:organizationId/purge-operational-metadata",
    "GET /api/admin/production-control/deletion-receipts",
    "GET /api/admin/production-control/export-custody",
    "POST /api/admin/production-control/distribution/verify",
    "POST /api/admin/production-control/notification/test",
  ]) {
    assert.ok(routes.includes(expected), `missing P3 route ${expected}`);
  }
});

test("P3 mixed-audience route registrar stays before the generic internal-only API gate", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes.ts"), "utf8");
  const registration = source.indexOf("registerProductionControlRoutes(app)");
  const internalGate = source.indexOf('app.use("/api",');
  assert.ok(registration >= 0, "production-control registrar is missing");
  assert.ok(internalGate >= 0, "generic internal API gate is missing");
  assert.ok(registration < internalGate, "P3 public/client routes would be shadowed by the internal-only gate");

  const moduleSource = fs.readFileSync(path.resolve(process.cwd(), "server/productionControlRoutes.ts"), "utf8");
  assert.match(moduleSource, /\/api\/client\/diagnostics".*requireClient/s);
  assert.match(moduleSource, /\/api\/client\/export-custody".*requireClient/s);
  assert.match(moduleSource, /\/api\/admin\/production-control\/retention".*requireRole\("internal_admin"\)/s);
  assert.match(moduleSource, /\/api\/admin\/production-control\/deletion-receipts".*internal_compliance/s);
});
