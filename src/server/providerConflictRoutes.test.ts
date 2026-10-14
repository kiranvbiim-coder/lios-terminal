import assert from "node:assert/strict";
import test from "node:test";
import type { Express } from "express";
import { registerProviderConflictRoutes } from "./providerConflictRoutes";

type Handler = (req: unknown, res: unknown) => Promise<unknown> | unknown;

/** Records every registered route by method+path instead of overwriting a
 * single captured handler on each call -- this module now registers four
 * routes (conflicts GET, pins GET/POST/DELETE), so a mock that only kept
 * "whatever was registered last" would silently test the wrong route. */
function buildRouterMock() {
  const routes = new Map<string, Handler>();
  const record = (method: string) => (path: string, ...handlers: unknown[]) => {
    routes.set(`${method} ${path}`, handlers.at(-1) as Handler);
  };
  const app = { get: record("GET"), post: record("POST"), delete: record("DELETE") };
  return { app: app as unknown as Express, routes };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    send() { this.ended = true; return this; },
  };
}

test("provider conflict route registers read-only endpoint and rejects incomplete queries", async () => {
  const { app, routes } = buildRouterMock();
  registerProviderConflictRoutes(app);
  const handler = routes.get("GET /api/data-truth/conflicts");
  assert.ok(handler);

  const response = mockResponse();
  await handler!({ query: { symbol: "AAPL", metric: "revenue" } }, response);
  assert.equal(response.statusCode, 400);
  assert.ok(response.body && typeof response.body === "object" && "error" in response.body && "details" in response.body);
  if (response.body && typeof response.body === "object" && "error" in response.body) {
    assert.equal((response.body as { error: string }).error, "A valid symbol, metric, and period are required.");
  }
});

test("pin routes are registered for read, create, and delete", () => {
  const { app, routes } = buildRouterMock();
  registerProviderConflictRoutes(app);
  assert.ok(routes.has("GET /api/data-truth/pins"), "GET pin list route missing");
  assert.ok(routes.has("POST /api/data-truth/pins"), "POST pin create route missing");
  assert.ok(routes.has("DELETE /api/data-truth/pins/:id"), "DELETE pin route missing");
});

test("creating a pin with an inconsistent scope is rejected before touching the database", async () => {
  const { app, routes } = buildRouterMock();
  registerProviderConflictRoutes(app);
  const handler = routes.get("POST /api/data-truth/pins");
  assert.ok(handler);

  const response = mockResponse();
  // scope "metric" requires both symbol and metric -- neither supplied.
  await handler!({ body: { scope: "metric", providerId: "tiingo" }, user: { id: 1, organizationId: null, email: "a@b.com" } }, response);
  assert.equal(response.statusCode, 400);
  assert.ok(response.body && typeof response.body === "object" && "error" in response.body);
});
