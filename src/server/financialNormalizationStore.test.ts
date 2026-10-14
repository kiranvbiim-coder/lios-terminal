import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { users } from "@shared/schema";

// db.ts resolves its PGLITE_DIR from LIMURIA_DATA_DIR at module-evaluation
// time, so these imports must stay dynamic and run after the env var is set
// above -- a static import would bind to whatever data dir an earlier test
// file in the same process already initialized. Same requirement as
// dataSpineIngestionMonitor.test.ts / entityResolver.test.ts.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-normalization-store-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { listNormalizationPolicies, upsertNormalizationPolicy, deleteNormalizationAdjustment } = await import("./financialNormalizationStore");
const { initDb, closeDb, getDb } = await import("./db");
const { tenantContext } = await import("./tenantContext");

test("financial normalization policy store", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const db = getDb();

  const [analystA] = await db.insert(users).values({ email: "analyst-a@example.test", passwordHash: "x", role: "internal_analyst", name: "Analyst A" }).returning();
  const [analystB] = await db.insert(users).values({ email: "analyst-b@example.test", passwordHash: "x", role: "internal_analyst", name: "Analyst B" }).returning();
  const ctxA = tenantContext(analystA);
  const ctxB = tenantContext(analystB);

  let firstAdjustmentId = "";

  await t.test("upsertNormalizationPolicy creates a policy and its adjustment row in one call", async () => {
    const policy = await upsertNormalizationPolicy(ctxA, {
      symbol: "aapl",
      label: "Analyst A Normalization",
      adjustments: [{ label: "Stock-Based Compensation FY2025", metricId: "operatingIncome", kind: "add-back", amount: 50_000_000, period: "FY2025", rationale: "Add back non-cash SBC" }],
    });
    assert.match(policy.id, /^fnp_/);
    assert.equal(policy.label, "Analyst A Normalization");
    assert.equal(policy.adjustments.length, 1);
    assert.match(policy.adjustments[0].id, /^fna_/);
    assert.equal(policy.adjustments[0].amount, 50_000_000);
    assert.equal(policy.adjustments[0].rationale, "Add back non-cash SBC");
    firstAdjustmentId = policy.adjustments[0].id;
  });

  await t.test("listNormalizationPolicies returns the policy with its adjustments for the owner, symbol uppercased", async () => {
    const policies = await listNormalizationPolicies(ctxA, "aapl");
    assert.equal(policies.length, 1);
    assert.equal(policies[0].adjustments.length, 1);
    assert.equal(policies[0].adjustments[0].metricId, "operatingIncome");
  });

  await t.test("tenant isolation: a policy owned by analyst A is invisible to analyst B", async () => {
    const policiesForB = await listNormalizationPolicies(ctxB, "aapl");
    assert.deepEqual(policiesForB, []);
  });

  await t.test("upsertNormalizationPolicy updates an existing adjustment by id and appends a new one without duplicating the policy", async () => {
    const updated = await upsertNormalizationPolicy(ctxA, {
      symbol: "AAPL",
      label: "Analyst A Normalization",
      adjustments: [
        { id: firstAdjustmentId, label: "Stock-Based Compensation FY2025 (revised)", metricId: "operatingIncome", kind: "add-back", amount: 55_000_000, period: "FY2025", rationale: "Revised SBC add-back" },
        { label: "Restructuring Charges FY2025", metricId: "operatingIncome", kind: "add-back", amount: 8_000_000, period: "FY2025" },
      ],
    });
    assert.equal(updated.adjustments.length, 2, "still one policy for the symbol, now carrying two adjustments");
    const revised = updated.adjustments.find((a) => a.id === firstAdjustmentId);
    assert.ok(revised);
    assert.equal(revised!.amount, 55_000_000);
    assert.equal(revised!.label, "Stock-Based Compensation FY2025 (revised)");
    const added = updated.adjustments.find((a) => a.id !== firstAdjustmentId);
    assert.ok(added);
    assert.equal(added!.amount, 8_000_000);

    const policies = await listNormalizationPolicies(ctxA, "AAPL");
    assert.equal(policies.length, 1, "upserting by (owner, symbol) must not create a second policy row");
  });

  await t.test("deleteNormalizationAdjustment refuses to delete another owner's adjustment", async () => {
    const deleted = await deleteNormalizationAdjustment(ctxB, firstAdjustmentId);
    assert.equal(deleted, false);
    const policies = await listNormalizationPolicies(ctxA, "AAPL");
    assert.equal(policies[0].adjustments.length, 2, "adjustment must survive an unauthorized delete attempt");
  });

  await t.test("deleteNormalizationAdjustment removes the row for its owner", async () => {
    const deleted = await deleteNormalizationAdjustment(ctxA, firstAdjustmentId);
    assert.equal(deleted, true);
    const policies = await listNormalizationPolicies(ctxA, "AAPL");
    assert.equal(policies[0].adjustments.length, 1);
    assert.notEqual(policies[0].adjustments[0].id, firstAdjustmentId);
  });

  await t.test("deleteNormalizationAdjustment returns false for an unknown id", async () => {
    assert.equal(await deleteNormalizationAdjustment(ctxA, "fna_does_not_exist"), false);
  });
});
