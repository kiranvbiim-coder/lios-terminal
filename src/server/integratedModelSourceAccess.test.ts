import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
import { runIntegratedFinancialModel } from "@shared/integratedFinancialModel";
import type { DrizzleDb } from "./db";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-model-source-access-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations, datasetSnapshots, financialModelRuns, dataEntitlementPolicies, auditEvents } = await import("@shared/schema");
const { createEntitlementPolicy } = await import("./dataEntitlementStore");
const { stableSnapshotHash } = await import("./pointInTimeDatasetStore");
const { registerDataFabricRoutes } = await import("./dataFabricRoutes");
const { saveFinancialModelRun } = await import("./financialModelRunStore");
const { loadIntegratedModelDatasetSource, assertIntegratedModelDatasetSourceCurrent } = await import("./integratedModelArtifact");

// Entirely synthetic statements and rights; no connected-provider or owner Home data.
const payload = financialDatasetPayloadSchema.parse({ symbol: "TEST", periods: [{
  period: "FY", fiscalYear: "2023", periodEnd: "2023-12-31", filingDate: "2024-02-15", availableAt: "2024-02-15T00:00:00.000Z", currency: "USD", sources: [{ statementType: "income", provider: "user_supplied" }],
  income: { revenue: 1000, costOfRevenue: 600, sellingGeneralAndAdministrativeExpenses: 200, incomeBeforeTax: 140, incomeTaxExpense: 28, netIncome: 112, weightedAverageShsOutDil: 100 },
  balance: { cashAndCashEquivalents: 100, netReceivables: 100, inventory: 100, propertyPlantEquipmentNet: 500, accountPayables: 100, shortTermDebt: 50, longTermDebt: 150, totalAssets: 800, totalLiabilities: 300, totalStockholdersEquity: 500 },
  cashflow: { depreciationAndAmortization: 50, investmentsInPropertyPlantAndEquipment: -60 },
}] });

test("integrated calculation admits current synthetic source rights before loading values or persisting output", { timeout: 120_000 }, async t => {
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  await initDb();
  const db = getDb();
  const [orgA, orgB] = await db.insert(organizations).values([
    { name: "Synthetic model A", slug: `model-source-a-${crypto.randomUUID()}` },
    { name: "Synthetic model B", slug: `model-source-b-${crypto.randomUUID()}` },
  ]).returning();
  const [owner, colleague, outsider] = await db.insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Synthetic owner", role: "internal_analyst" as const, organizationId: orgA.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Synthetic colleague", role: "internal_analyst" as const, organizationId: orgA.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Synthetic outsider", role: "internal_analyst" as const, organizationId: orgB.id },
  ]).returning();
  const { policy } = await createEntitlementPolicy({ provider: "user_supplied", dataClass: "financial_statements", licenseType: "user_supplied", accessScope: "internal_only", redistribution: "restricted", permittedUses: ["display", "model_input", "derived_output"], attribution: "Synthetic regression fixture only", termsUrl: null, effectiveFrom: "1970-01-01T00:00:00.000Z", effectiveTo: null, reviewedAt: null, notes: null }, owner.id);
  const lineage = { sourceRefs: ["https://example.test/synthetic-statements"] };
  const contentHash = stableSnapshotHash({ payload, provider: "user_supplied", lineage });
  const base = { datasetKey: "", entityKey: "TEST", dataClass: "financial_statements", schemaVersion: "1.0.0", source: "user_import", provider: "user_supplied", frequency: "annual", currency: "USD", retrievedAt: new Date("2024-02-15T00:00:00Z"), availableAt: new Date("2024-02-15T00:00:00Z"), contentHash, quality: { score: 1, statementCoverage: { income: 1, balance: 1, cashflow: 1 }, criticalFieldsPresent: 1, criticalFieldsExpected: 1, missingCriticalFields: [], warnings: [] }, lineage, payload, organizationId: null, createdByUserId: owner.id, entitlementPolicyId: policy.id };
  async function snapshot(overrides: Partial<typeof datasetSnapshots.$inferInsert> = {}) {
    const id = crypto.randomUUID();
    const [row] = await db.insert(datasetSnapshots).values({ ...base, id, datasetKey: `financials:TEST:FY:${id}`, ...overrides }).returning();
    return row;
  }
  let payloadReads = 0;
  function observePayloadSelects(executor: Pick<DrizzleDb, "select">) {
    const originalSelect = executor.select.bind(executor);
    return t.mock.method(executor, "select", (fields?: Parameters<typeof executor.select>[0]) => {
      const builder = fields === undefined ? originalSelect() : originalSelect(fields);
      const originalFrom = builder.from.bind(builder);
      builder.from = ((table: Parameters<typeof builder.from>[0]) => {
        if (table === datasetSnapshots && (fields === undefined || Object.values(fields).includes(datasetSnapshots.payload))) payloadReads++;
        return originalFrom(table);
      }) as typeof builder.from;
      return builder;
    });
  }
  const selectSpy = observePayloadSelects(db);
  type ModelTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
  const originalTransaction = db.transaction.bind(db);
  const transactionSpy = t.mock.method(db, "transaction", function<R>(work: (tx: ModelTransaction) => Promise<R>, config?: Parameters<DrizzleDb["transaction"]>[1]) {
    return originalTransaction(async tx => { observePayloadSelects(tx); return work(tx); }, config);
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = [owner, colleague, outsider].find(user => String(user.id) === req.get("x-test-user"));
    req.isAuthenticated = (() => actor !== undefined) as typeof req.isAuthenticated;
    if (actor) req.user = actor;
    next();
  });
  registerDataFabricRoutes(app);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { selectSpy.mock.restore(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/financial-models/integrated`;
  const request = (id: string, actor = owner) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-test-user": String(actor.id) }, body: JSON.stringify({ datasetSnapshotId: id, assumptions: { projectionYears: 2, revenueGrowth: 0.1 } }) });
  async function denied(id: string, status: number, metadataOnly: boolean, actor = owner) {
    const before = await db.select({ id: financialModelRuns.id }).from(financialModelRuns);
    const auditBefore = await db.select({ id: auditEvents.id }).from(auditEvents);
    payloadReads = 0;
    const response = await request(id, actor);
    assert.equal(response.status, status, await response.text());
    if (metadataOnly) assert.equal(payloadReads, 0, "Admission denial must not select the dataset payload.");
    assert.deepEqual(await db.select({ id: financialModelRuns.id }).from(financialModelRuns), before, "Denied calculation must not persist a run.");
    assert.deepEqual(await db.select({ id: auditEvents.id }).from(auditEvents), auditBefore, "Denied calculation must not emit a success audit.");
  }
  await t.test("missing snapshots and inaccessible personal or organization sources stay metadata-only", async () => {
    await denied((await snapshot()).id, 404, true, colleague);
    await denied(crypto.randomUUID(), 404, false);
    await denied((await snapshot({ organizationId: orgB.id, createdByUserId: outsider.id })).id, 404, true);
    await denied((await snapshot({ dataClass: "market_series" })).id, 404, true);
  });
  await t.test("unlinked or mismatched rights never load source values", async () => {
    await denied((await snapshot({ entitlementPolicyId: null })).id, 403, true);
    await denied((await snapshot({ provider: "synthetic_other_provider" })).id, 403, true);
    await db.update(dataEntitlementPolicies).set({ dataClass: "market_series" }).where(eq(dataEntitlementPolicies.id, policy.id));
    try { await denied((await snapshot()).id, 403, true); }
    finally { await db.update(dataEntitlementPolicies).set({ dataClass: policy.dataClass }).where(eq(dataEntitlementPolicies.id, policy.id)); }
  });
  await t.test("each calculation use and current effective interval are required", async () => {
    for (const use of ["model_input", "display", "derived_output"]) {
      await db.update(dataEntitlementPolicies).set({ permittedUses: policy.permittedUses.filter(value => value !== use) }).where(eq(dataEntitlementPolicies.id, policy.id));
      try { await denied((await snapshot()).id, 403, true); }
      finally { await db.update(dataEntitlementPolicies).set({ permittedUses: policy.permittedUses }).where(eq(dataEntitlementPolicies.id, policy.id)); }
    }
    for (const bounds of [{ effectiveTo: new Date("2000-01-01") }, { effectiveFrom: new Date("2999-01-01") }]) {
      await db.update(dataEntitlementPolicies).set(bounds).where(eq(dataEntitlementPolicies.id, policy.id));
      try { await denied((await snapshot()).id, 403, true); }
      finally { await db.update(dataEntitlementPolicies).set({ effectiveFrom: policy.effectiveFrom, effectiveTo: policy.effectiveTo }).where(eq(dataEntitlementPolicies.id, policy.id)); }
    }
  });
  await t.test("source availability, expiry and immutable content are enforced", async () => {
    await denied((await snapshot({ availableAt: new Date("2999-01-01") })).id, 409, true);
    await denied((await snapshot({ expiresAt: new Date("2000-01-01") })).id, 409, true);
    await denied((await snapshot({ contentHash: "0".repeat(64) })).id, 409, false);
    await denied((await snapshot({ lineage: { changed: true } })).id, 409, false);
    await denied((await snapshot({ payload: { ...payload, periods: [{ ...payload.periods[0], income: { revenue: 2000 } }] } })).id, 409, false);
  });
  await t.test("stale session role and organization cannot calculate", async () => {
    for (const changed of [{ role: "internal_compliance" as const }, { organizationId: orgB.id }, { active: false }]) {
      await db.update(users).set(changed).where(eq(users.id, owner.id));
      try { await denied((await snapshot()).id, 403, true); }
      finally { await db.update(users).set({ role: owner.role, organizationId: owner.organizationId, active: owner.active }).where(eq(users.id, owner.id)); }
    }
  });
  await t.test("permitted calculation needs no export grant and reconciles known revenue", async () => {
    const source = await snapshot({ organizationId: orgA.id, createdByUserId: colleague.id });
    const response = await request(source.id);
    assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
    const body = await response.json();
    assert.ok(Math.abs(body.result.forecast[0].income.revenue - 1100) < 1e-9);
    assert.ok(Math.abs(body.result.forecast[1].income.revenue - 1210) < 1e-9);
    assert.equal(body.receipt.datasetContentHash, contentHash);
    const [run] = await db.select().from(financialModelRuns).where(eq(financialModelRuns.id, body.receipt.runId));
    assert.equal(run.createdByUserId, owner.id);
    assert.equal(run.datasetSnapshotId, source.id);
    const replay = await request(source.id);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).receipt.runId, run.id);
    await denied(source.id, 409, false, colleague);
  });
  await t.test("explicitly shared source still requires rights but not personal ownership", async () => {
    const source = await snapshot({ organizationId: null, createdByUserId: null });
    const response = await request(source.id, outsider);
    assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
    assert.equal((await response.json()).receipt.datasetSnapshotId, source.id);
  });
  await t.test("post-save actor, source and same-ID policy changes roll back actual database output", async () => {
    const ctx = { userId: owner.id, organizationId: orgA.id, role: owner.role };
    const uses = ["model_input", "display", "derived_output"];
    const mutations: { status: number; apply: (tx: ModelTransaction, id: string) => Promise<unknown> }[] = [
      { status: 403, apply: async tx => tx.update(dataEntitlementPolicies).set({ permittedUses: ["display"] }).where(eq(dataEntitlementPolicies.id, policy.id)) },
      { status: 404, apply: async (tx, id) => tx.update(datasetSnapshots).set({ organizationId: orgB.id }).where(eq(datasetSnapshots.id, id)) },
      { status: 403, apply: async tx => tx.update(users).set({ organizationId: orgB.id }).where(eq(users.id, owner.id)) },
      { status: 409, apply: async (tx, id) => tx.update(datasetSnapshots).set({ expiresAt: new Date("2000-01-01") }).where(eq(datasetSnapshots.id, id)) },
    ];
    for (const mutation of mutations) {
      const source = await snapshot();
      const before = await db.select({ id: financialModelRuns.id }).from(financialModelRuns);
      await assert.rejects(db.transaction(async tx => {
        const admitted = await loadIntegratedModelDatasetSource(ctx, source.id, uses, tx, true);
        const result = runIntegratedFinancialModel({ datasetSnapshotId: source.id, payload: admitted.snapshot.payload, assumptions: { projectionYears: 2, revenueGrowth: 0.1 } });
        const resultHash = stableSnapshotHash({ modelVersion: result.modelVersion, datasetContentHash: source.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules, forecast: result.forecast });
        await saveFinancialModelRun({ result, resultHash, createdByUserId: owner.id }, tx);
        await mutation.apply(tx, source.id);
        await assertIntegratedModelDatasetSourceCurrent(ctx, source.id, admitted.revision, uses, tx);
      }), { status: mutation.status });
      assert.deepEqual(await db.select({ id: financialModelRuns.id }).from(financialModelRuns), before);
    }
    transactionSpy.mock.restore();
  });
});
