import assert from "node:assert/strict";
import test from "node:test";
import { requireAuth } from "./auth";
import { registerWaveCRoutes } from "./waveCRoutes";

test("Wave C registers governed adapter, series, benchmark, AI and state surfaces", () => {
  const routes: string[] = [];
  const app = {
    get(path: string) { routes.push(`GET ${path}`); return this; },
    post(path: string) { routes.push(`POST ${path}`); return this; },
    put(path: string) { routes.push(`PUT ${path}`); return this; },
  };
  registerWaveCRoutes(app as never);
  for (const expected of [
    "POST /api/wave-c/canonical/adapt",
    "GET /api/wave-c/analytics/series",
    "POST /api/wave-c/benchmarks/evaluate",
    "POST /api/wave-c/ai/execute",
    "GET /api/wave-c/ai/state",
    "PUT /api/wave-c/ai/state",
  ]) assert.ok(routes.includes(expected), `missing ${expected}`);
});

test("Master AI state routes are available to authenticated users and remain self-scoped", () => {
  const routes = new Map<string, unknown[]>();
  const app = {
    get(path: string, ...handlers: unknown[]) { routes.set(`GET ${path}`, handlers); return this; },
    post(path: string, ...handlers: unknown[]) { routes.set(`POST ${path}`, handlers); return this; },
    put(path: string, ...handlers: unknown[]) { routes.set(`PUT ${path}`, handlers); return this; },
  };

  registerWaveCRoutes(app as never);

  assert.equal(routes.get("GET /api/wave-c/ai/state")?.[0], requireAuth);
  assert.equal(routes.get("PUT /api/wave-c/ai/state")?.[0], requireAuth);
  assert.equal(routes.get("POST /api/wave-c/ai/execute")?.[0] === requireAuth, false, "AI execution remains behind its existing internal-role gate");
});
