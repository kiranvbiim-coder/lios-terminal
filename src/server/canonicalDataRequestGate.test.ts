import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canonicalDataRequestSchema, type CanonicalDataRequest } from "@shared/universalDataFabric";
import type { TenantContext } from "./tenantContext";
import { authorizeCanonicalDataRequests } from "./canonicalDataRequestGate";

const tenant = { userId: 31, organizationId: 17, role: "client_user" } as TenantContext;

function request(options: {
  projectId?: number | null;
  workflowKind?: string;
  pointInTime?: Record<string, unknown>;
} = {}): CanonicalDataRequest {
  return canonicalDataRequestSchema.parse({
    schemaVersion: "1",
    requestId: "00000000-0000-4000-8000-000000000031",
    projectId: options.projectId ?? null,
    capability: "prices",
    entity: { ref: "EXAMPLE", symbol: "EXAMPLE", identifiers: {} },
    parameters: options.workflowKind ? { workflowKind: options.workflowKind } : {},
    ...(options.pointInTime ? { pointInTime: options.pointInTime } : {}),
  });
}

test("Phase 2: batch prefetch checks every unique Project against the request tenant before execution", async () => {
  const authorized: Array<{ projectId: number; owner: number; org: number | null }> = [];
  const check = async (ctx: TenantContext, projectId: number) => {
    authorized.push({ projectId, owner: ctx.userId, org: ctx.organizationId });
  };
  await authorizeCanonicalDataRequests([
    request({ projectId: 15 }),
    request({ projectId: 15 }),
    request({ projectId: 16 }),
    request(),
  ], tenant, check);
  assert.deepEqual(authorized, [
    { projectId: 15, owner: 31, org: 17 },
    { projectId: 16, owner: 31, org: 17 },
  ]);
});

test("Phase 2: any inaccessible Project rejects the entire batch", async () => {
  const checked: number[] = [];
  const check = async (_ctx: TenantContext, projectId: number) => {
    checked.push(projectId);
    if (projectId === 99) throw new Error("Project not found or not accessible");
  };
  await assert.rejects(
    authorizeCanonicalDataRequests([request({ projectId: 12 }), request({ projectId: 99 })], tenant, check),
    /not accessible/,
  );
  assert.deepEqual(checked, [12, 99]);
});

test("Phase 2: a later backtest or historical-research policy error rejects before any Project access", async () => {
  const checked: number[] = [];
  const check = async (_ctx: TenantContext, projectId: number) => { checked.push(projectId); };
  await assert.rejects(
    authorizeCanonicalDataRequests([
      request({ projectId: 12 }),
      request({ projectId: 99, workflowKind: "backtest" }),
    ], tenant, check),
    /Backtest data must declare/,
  );
  assert.deepEqual(checked, []);
  await assert.rejects(
    authorizeCanonicalDataRequests([
      request({ projectId: 12, workflowKind: "research", pointInTime: {
        mode: "as_known_on",
        asKnownOn: "2026-01-01T00:00:00.000Z",
        requirePublicationTime: false,
      } }),
    ], tenant, check),
    /require publication/,
  );
  assert.deepEqual(checked, []);
});

test("Phase 2: as-known-on backtest with publication gate is eligible only after Project authorization", async () => {
  let checked = false;
  await authorizeCanonicalDataRequests([
    request({
      projectId: 12,
      workflowKind: "backtest",
      pointInTime: {
        mode: "as_known_on",
        asKnownOn: "2025-01-01T00:00:00.000Z",
        requirePublicationTime: true,
      },
    }),
  ], tenant, async () => { checked = true; });
  assert.equal(checked, true);
});

test("Phase 2: execute and prefetch routes share the same authorization gate before provider registry/execution", () => {
  const route = readFileSync(new URL("./universalDataFabricRoutes.ts", import.meta.url), "utf8");
  const single = route.match(/app\.post\("\/api\/data-fabric\/execute",[\s\S]*?(?=app\.post\("\/api\/data-fabric\/prefetch")/);
  const batch = route.match(/app\.post\("\/api\/data-fabric\/prefetch",[\s\S]*?(?=app\.get\("\/api\/data-fabric\/cache")/);
  assert.ok(single && batch);
  assert.match(single[0], /authorizeCanonicalDataRequests\(\[request\],tenant\)/);
  assert.match(batch[0], /authorizeCanonicalDataRequests\(requests,tenant\)/);
  assert.ok(single[0].indexOf("authorizeCanonicalDataRequests") < single[0].indexOf("createProviderRegistryForUser"));
  assert.ok(batch[0].indexOf("authorizeCanonicalDataRequests") < batch[0].indexOf("createProviderRegistryForUser"));
  assert.ok(batch[0].indexOf("authorizeCanonicalDataRequests") < batch[0].indexOf("prefetchCanonicalDataRequests"));
});
