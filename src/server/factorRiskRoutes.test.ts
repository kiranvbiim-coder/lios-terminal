import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { calculateFactorAttribution } from "@shared/factorAttribution";

// db.ts freezes its PGLITE_DIR the instant it's first imported, including
// transitively through a static import of ./factorRiskRoutes at this
// file's own top level -- same isolation requirement documented in
// calculationJobService.test.ts/factorRiskSnapshotStore.test.ts. The
// default (non-mocked) `factorRiskRouteHandlers` used below hit the real
// DB-backed factor-risk snapshot store, so this file needs its own
// initialized, isolated database just like those.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-factor-risk-routes-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const {
  buildFactorAttributionInput,
  factorRiskDecomposeRequestSchema,
  factorRiskSnapshotRequestSchema,
  factorRiskRouteHandlers,
  createFactorRiskRouteHandlers,
  normalizeCaptureResult,
  registerFactorRiskRoutes,
  registerFactorRiskSnapshotListingRoutes,
  validateDecomposeWeights,
} = await import("./factorRiskRoutes");
const { runWithRequestIdentity } = await import("./requestContext");
const { initDb, closeDb } = await import("./db");

await initDb();
after(async () => {
  await closeDb();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("factor-risk capture schema bounds the universe and history window", () => {
  const valid = factorRiskSnapshotRequestSchema.parse({ symbols: ["aapl"], benchmarkSymbol: "^GSPC", range: "5Y" });
  assert.deepEqual(valid.symbols, ["aapl"]);
  assert.equal(valid.range, "5Y");
  assert.equal(valid.benchmarkSymbol, "^GSPC");
  assert.equal(factorRiskSnapshotRequestSchema.safeParse({ symbols: [], range: "5Y" }).success, false);
  assert.equal(factorRiskSnapshotRequestSchema.safeParse({ symbols: Array.from({ length: 101 }, (_, i) => `S${i}`), range: "5Y" }).success, false);
  assert.equal(factorRiskSnapshotRequestSchema.safeParse({ symbols: ["AAPL"], range: "MAX" }).success, false);
  assert.equal(factorRiskSnapshotRequestSchema.safeParse({ symbols: ["AAPL", "aapl"], range: "5Y" }).success, false);
});

test("capture result makes provider cache reuse explicit", () => {
  const snapshot = { snapshotId: "snap-1", contentHash: "a" };
  assert.equal(normalizeCaptureResult({ snapshot, cache: "hit" }).cache, "hit");
  assert.equal(normalizeCaptureResult(snapshot).cache, "miss");
  assert.equal(normalizeCaptureResult({ snapshot, cache: "miss" }).cache, "miss");
});

test("decompose weights reject unknown and missing securities", () => {
  assert.match(validateDecomposeWeights({ AAPL: 1 }, ["AAPL", "MSFT"], "portfolioWeights")!, /missing/);
  assert.match(validateDecomposeWeights({ AAPL: 1, MSFT: 0, TSLA: 0 }, ["AAPL", "MSFT"], "portfolioWeights")!, /unknown/);
  assert.equal(validateDecomposeWeights({ AAPL: 0.5, MSFT: 0.5 }, ["AAPL", "MSFT"], "portfolioWeights"), null);
});
test("capture handler uses a stubbed data service and reports miss then hit status", async () => {
  let captureCount = 0;
  const service = {
    captureFactorRiskSnapshot: async () => {
      captureCount += 1;
      return {
        snapshot: { snapshotId: `snap-${captureCount}`, contentHash: `hash-${captureCount}` },
        cache: captureCount === 1 ? "miss" as const : "hit" as const,
      };
    },
    getFactorRiskSnapshot: () => null,
  };
  const handlers = createFactorRiskRouteHandlers(service as never);
  const statuses: number[] = [];
  const response = {
    status(code: number) { statuses.push(code); return this; },
    json(_value: unknown) { return this; },
  };
  const request = { body: { symbols: ["AAPL"], range: "5Y" } };
  await handlers.captureHandler(request as never, response as never);
  await handlers.captureHandler(request as never, response as never);
  assert.deepEqual(statuses, [201, 200]);
  assert.equal(captureCount, 2);
});


test("decompose builds a known-answer average-period attribution input", () => {
  const snapshot = {
    snapshotId: "snap-known",
    factors: [{ id: "value", label: "Value", source: "provider", asOf: "2026-01-01", units: "z-score", status: "derived" as const }],
    securities: [
      { securityId: "AAPL", exposures: { value: 0.2 }, source: "provider", asOf: "2026-01-01", units: "z-score" },
      { securityId: "MSFT", exposures: { value: 0.4 }, source: "provider", asOf: "2026-01-01", units: "z-score" },
    ],
    estimation: {
      factorReturnSeries: [
        { periodEnd: "2025-12-31", returns: { value: 0.01 } },
        { periodEnd: "2026-01-31", returns: { value: 0.10 } },
      ],
      factorCovariance: [[0.04]],
      specificVariances: { AAPL: 0.01, MSFT: 0.02 },
    },
  };
  const request = factorRiskDecomposeRequestSchema.parse({ snapshotId: "snap-known", portfolioWeights: { AAPL: 0.5, MSFT: 0.5 } });
  const input = buildFactorAttributionInput(snapshot, request);
  const result = calculateFactorAttribution(input);
  assert.ok(Math.abs(input.factorReturns.value - 0.055) < 1e-12);
  assert.ok(Math.abs(result.portfolioExposure.value - 0.3) < 1e-12);
  assert.ok(Math.abs(result.expectedReturn - 0.0165) < 1e-12);
  assert.ok(Math.abs(result.risk.factorVariance - 0.0036) < 1e-12);
});

test("GET unknown snapshot returns 404 without recomputing", async () => {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await factorRiskRouteHandlers.getHandler(
    { params: { snapshotId: "does-not-exist" } } as never,
    response as never,
  );
  assert.equal(statusCode, 404);
  assert.ok(body && typeof body === "object" && "error" in body);
  assert.match(String(body && typeof body === "object" && "error" in body ? body.error : ""), /not found/i);
});

test("snapshot listing enforces the request organization scope and query bounds", async () => {
  const service = {
    captureFactorRiskSnapshot: async () => ({ snapshot: {}, cache: "miss" as const }),
    getFactorRiskSnapshot: () => null,
    listFactorRiskSnapshots: (options: { organizationScope?: string; page?: number; limit?: number }) => ({
      items: [{ snapshotId: "org-7", organizationScope: options.organizationScope ?? "local" }],
      page: options.page ?? 1,
      limit: options.limit ?? 25,
      total: 1,
      hasMore: false,
      nextPage: null,
    }),
  };
  const handlers = createFactorRiskRouteHandlers(service as never);
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await runWithRequestIdentity({ userId: 1, organizationId: 7 }, () => handlers.listHandler(
    { query: { organizationId: "7", page: "1", limit: "1", symbol: "AAA" } } as never,
    response as never,
  ));
  assert.equal(statusCode, 200);
  assert.ok(body && typeof body === "object");
  const payload = body as { items: Array<{ organizationScope: string }>; paging: { limit: number } };
  assert.equal(payload.items[0].organizationScope, "organization:7");
  assert.equal(payload.paging.limit, 1);

  await handlers.listHandler(
    { query: { organizationId: "8" } } as never,
    response as never,
  );
  assert.equal(statusCode, 403);
});

test("refreshing an unknown snapshot returns 404 without invoking capture", async () => {
  let captureCount = 0;
  const service = {
    captureFactorRiskSnapshot: async () => { captureCount += 1; return { snapshot: {}, cache: "miss" as const }; },
    getFactorRiskSnapshot: () => null,
  };
  const handlers = createFactorRiskRouteHandlers(service as never);
  let statusCode = 200;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(_value: unknown) { return this; },
  };
  await handlers.refreshHandler({ params: { snapshotId: "unknown" } } as never, response as never);
  assert.equal(statusCode, 404);
  assert.equal(captureCount, 0);
});

test("refreshing a known snapshot replays its captured request through the capture seam", async () => {
  let capturedRequest: unknown;
  const service = {
    captureFactorRiskSnapshot: async (request: unknown) => {
      capturedRequest = request;
      return { snapshot: { snapshotId: "refreshed", contentHash: "hash" }, cache: "hit" as const };
    },
    getFactorRiskSnapshot: () => ({
      snapshotId: "original",
      request: { symbols: ["AAPL"], benchmarkSymbol: "^GSPC", range: "5Y", asOf: "2026-01-01", scope: "local" },
    }),
  };
  const handlers = createFactorRiskRouteHandlers(service as never);
  let statusCode = 201;
  let body: unknown;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await handlers.refreshHandler({ params: { snapshotId: "original" } } as never, response as never);
  assert.equal(statusCode, 200);
  assert.deepEqual(capturedRequest, { symbols: ["AAPL"], benchmarkSymbol: "^GSPC", range: "5Y", asOf: "2026-01-01" });
  assert.ok(body && typeof body === "object" && "cache" in body);
  assert.equal((body as { cache: string }).cache, "hit");
});

test("snapshot catalog registration adds listing and refresh endpoints", () => {
  const registrations: string[] = [];
  const app = {
    get(path: string) { registrations.push(`GET ${path}`); return this; },
    post(path: string) { registrations.push(`POST ${path}`); return this; },
  };
  registerFactorRiskSnapshotListingRoutes(app as never);
  assert.deepEqual(registrations, [
    "GET /api/factor-risk/snapshots",
    "POST /api/factor-risk/snapshots/:snapshotId/refresh",
  ]);
});

test("factor-risk registration exposes all three endpoints", () => {
  const registrations: string[] = [];
  const app = {
    post(path: string) { registrations.push(`POST ${path}`); return this; },
    get(path: string) { registrations.push(`GET ${path}`); return this; },
  };
  registerFactorRiskRoutes(app as never);
  assert.deepEqual(registrations, [
    "POST /api/factor-risk/snapshots",
    "GET /api/factor-risk/snapshots/:snapshotId",
    "POST /api/factor-risk/decompose",
  ]);
});
