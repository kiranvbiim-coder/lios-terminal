import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-corporate-action-ingestion-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { companies, securities } = await import("@shared/schema");
const { normalizeBseCorporateAction, persistNormalizedCorporateAction } = await import("./corporateActionIngestion");

test("corporate action ingestion contract", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [company] = await getDb().insert(companies).values({ symbol: "BSECA", name: "BSE Adapter Test" }).returning();
  const [security] = await getDb().insert(securities).values({ companyId: company.id, name: "BSE Adapter Common", assetClass: "equity" }).returning();

  await t.test("normalizes verified BSE bonus and split payload text into canonical external-reference events", () => {
    const bonus = normalizeBseCorporateAction("500209", { Ex_date: "02 Dec 2014", Purpose: "Bonus issue 1:1" });
    assert.equal(bonus?.actionType, "bonus_issue");
    assert.equal(bonus?.effectiveDate, "2014-12-02");
    assert.deepEqual(bonus?.legs[0], {
      instrument: { kind: "security", source: "bse_india", externalId: "500209" },
      role: "subject",
      ratioNumerator: 2,
      ratioDenominator: 1,
    });

    const split = normalizeBseCorporateAction("500825", { Ex_date: "15 Jun 2018", Purpose: "Stock  Split From Rs.10/- to Rs.2/-" });
    assert.equal(split?.actionType, "split");
    assert.equal(split?.effectiveDate, "2018-06-15");
    assert.equal(split?.legs[0].ratioNumerator, 5);
    assert.equal(split?.legs[0].ratioDenominator, 1);
  });

  await t.test("distinguishes reverse splits from ordinary splits", () => {
    const reverse = normalizeBseCorporateAction("500825", { Ex_date: "15 Jun 2018", Purpose: "Stock Split From Rs.2/- to Rs.10/-" });
    assert.equal(reverse?.actionType, "reverse_split");
    assert.equal(reverse?.legs[0].ratioNumerator, 0.2);
    assert.equal(reverse?.legs[0].ratioDenominator, 1);
  });

  await t.test("rejects malformed and calendar-invalid provider dates without throwing", () => {
    assert.equal(normalizeBseCorporateAction("500209", { Ex_date: "31 Feb 2014", Purpose: "Bonus issue 1:1" }), null);
    assert.equal(normalizeBseCorporateAction("500209", { Ex_date: 42 as unknown as string, Purpose: "Bonus issue 1:1" }), null);
  });

  await t.test("unsupported provider payloads return null instead of inventing a canonical event", () => {
    assert.equal(normalizeBseCorporateAction("500209", { Ex_date: "02 Dec 2014", Purpose: "Dividend 10%" }), null);
    assert.equal(normalizeBseCorporateAction("500209", { Ex_date: "bad", Purpose: "Bonus issue 1:1" }), null);
  });

  await t.test("persistNormalizedCorporateAction rejects unresolved external instruments without creating a partial event", async () => {
    const normalized = normalizeBseCorporateAction("missing", { Ex_date: "02 Dec 2014", Purpose: "Bonus issue 1:1" });
    assert.ok(normalized);
    const result = await persistNormalizedCorporateAction(normalized!, async () => null);
    assert.deepEqual(result, { status: "unresolved", externalIds: ["missing"] });
  });

  await t.test("persistNormalizedCorporateAction resolves external instruments and persists the canonical event", async () => {
    const normalized = normalizeBseCorporateAction("500209", { Ex_date: "02 Dec 2014", Purpose: "Bonus issue 1:1" });
    assert.ok(normalized);
    const result = await persistNormalizedCorporateAction(normalized!, async (reference) => reference.externalId === "500209" ? { securityId: security.id } : null);
    assert.equal(result.status, "created");
    if (result.status === "created") {
      assert.equal(result.legs.length, 1);
      assert.equal(result.legs[0].securityId, security.id);
      assert.equal(result.action.actionType, "bonus_issue");
    }
  });
  await t.test("rejects an invalid resolver result instead of writing an unbound leg", async () => {
    const normalized = normalizeBseCorporateAction("500209", { Ex_date: "02 Dec 2014", Purpose: "Bonus issue 1:1" });
    assert.ok(normalized);
    const result = await persistNormalizedCorporateAction(normalized!, async () => ({}));
    assert.deepEqual(result, { status: "unresolved", externalIds: ["500209"] });
  });
});
