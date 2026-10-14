import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderConflictView, providerConflictQuerySchema } from "./providerConflictService";

const hash = "a".repeat(64);
const snapshot = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  contentHash: hash,
  retrievedAt: "2026-08-31T10:00:00.000Z",
  availableAt: "2026-08-31T10:00:00.000Z",
  createdAt: "2026-08-31T10:00:00.000Z",
  payload: {
    symbol: "ACME",
    reportType: "income",
    period: "FY",
    observationProviderIds: ["sec_edgar", "finnhub"],
    conflicts: [{ key: "income:2025:FY", field: "revenue", values: [{ providerId: "sec_edgar", value: 100 }, { providerId: "finnhub", value: 110 }] }],
  },
  ...overrides,
});

const row = (source: string, value: number) => ({
  reportType: "income",
  periodEnd: "2025-12-31",
  fiscalYear: "2025",
  period: "FY",
  data: { revenue: value },
  filingDate: "2026-02-01",
  source,
  fetchedAt: new Date("2026-08-31T10:00:00.000Z"),
});

test("provider conflict query schema bounds and canonical period forms", () => {
  assert.equal(providerConflictQuerySchema.safeParse({ symbol: "AAPL", metric: "revenue", period: "FY2025" }).success, true);
  assert.equal(providerConflictQuerySchema.safeParse({ symbol: "AAPL", metric: "revenue", period: "2025:FY" }).success, true);
  assert.equal(providerConflictQuerySchema.safeParse({ symbol: "AAPL", metric: "revenue", period: "2025-13" }).success, false);
  assert.equal(providerConflictQuerySchema.safeParse({ symbol: "AAPL", metric: "revenue", period: "" }).success, false);
});

test("view preserves disagreeing provider values and immutable provenance", () => {
  const result = buildProviderConflictView({ symbol: "acme", metric: "revenue", period: "FY2025", snapshots: [snapshot()], statementRows: [row("sec_edgar", 100)] });
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].status, "disagreement");
  assert.equal(result.groups[0].unresolved, true);
  assert.deepEqual(result.groups[0].observations.map((item) => [item.providerId, item.value]), [["finnhub", 110], ["sec_edgar", 100]]);
  assert.equal(result.groups[0].observations[0].snapshotId, snapshot().id);
  assert.equal(result.groups[0].observations[0].contentHash, hash);
  assert.equal(result.groups[0].observations[0].status, "CACHED");
  assert.equal(result.groups[0].observations[0].temporalStatus, "HISTORICAL");
  assert.match(result.groups[0].conflictHash, /^[a-f0-9]{64}$/);
});

test("a single durable source is explicitly insufficient, never implied agreement", () => {
  const oneSource = snapshot({ payload: { ...snapshot().payload, observationProviderIds: ["sec_edgar"], conflicts: [] } });
  const result = buildProviderConflictView({ symbol: "ACME", metric: "revenue", period: "2025:FY", snapshots: [oneSource], statementRows: [row("sec_edgar", 100)] });
  assert.equal(result.groups[0].status, "insufficient");
  assert.equal(result.groups[0].unresolved, false);
});

test("agreement is reported only when two stored source values are present", () => {
  const agreed = snapshot({ payload: { ...snapshot().payload, conflicts: [{ key: "income:2025:FY", field: "revenue", values: [{ providerId: "sec_edgar", value: 100 }, { providerId: "finnhub", value: 100 }] }] } });
  const result = buildProviderConflictView({ symbol: "ACME", metric: "revenue", period: "FY", snapshots: [agreed], statementRows: [] });
  assert.equal(result.groups[0].status, "agreement");
  assert.equal(result.groups[0].unresolved, false);
});

test("rows without a matching immutable capture are omitted and limitation is explicit", () => {
  const result = buildProviderConflictView({ symbol: "ACME", metric: "revenue", period: "FY2025", snapshots: [], statementRows: [row("sec_edgar", 100)] });
  assert.equal(result.groups.length, 0);
  assert.ok(result.limitations.some((item) => item.includes("immutable financial-statements conflict capture")));
});
