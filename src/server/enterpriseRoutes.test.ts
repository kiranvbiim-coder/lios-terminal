import assert from "node:assert/strict";
import test from "node:test";
import { registerEnterpriseRoutes } from "./enterpriseRoutes";

test("V4-24 registers organization policy, overview, and deterministic check surfaces", () => {
  const routes: string[] = [];
  const app = {
    get(path: string) { routes.push(`GET ${path}`); return this; },
    put(path: string) { routes.push(`PUT ${path}`); return this; },
    post(path: string) { routes.push(`POST ${path}`); return this; },
  };
  registerEnterpriseRoutes(app as never);
  for (const expected of [
    "GET /api/enterprise/organizations",
    "GET /api/enterprise/organizations/:orgId",
    "GET /api/enterprise/organizations/:orgId/policy",
    "PUT /api/enterprise/organizations/:orgId/policy",
    "GET /api/enterprise/organizations/:orgId/sso/runtime",
    "PUT /api/enterprise/organizations/:orgId/sso/credentials",
    "GET /api/enterprise/organizations/:orgId/deployment/runtime",
    "PUT /api/enterprise/organizations/:orgId/deployment/credential",
    "POST /api/enterprise/organizations/:orgId/deployment/verify",
    "POST /api/enterprise/organizations/:orgId/policy/check",
  ]) assert.ok(routes.includes(expected), `missing ${expected}`);
});
