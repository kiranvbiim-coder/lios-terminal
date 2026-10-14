import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-corporate-actions-"));
process.env.LIMURIA_DATA_DIR = dataDir;

const { initDb, closeDb, getDb } = await import("./db");
const { companies, securities, companyListings, corporateActions } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { createCorporateAction, listCorporateActionsForSecurity, listCorporateActionContinuityForSecurity } = await import("./corporateActionStore");


test("corporateActionStore", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const [company] = await getDb().insert(companies).values({ symbol: "CACT", name: "Corporate Action Test Co" }).returning();
  const [security] = await getDb().insert(securities).values({ companyId: company.id, name: "Corporate Action Test Common", assetClass: "equity" }).returning();
  const [listing] = await getDb().insert(companyListings).values({
    companyId: company.id,
    securityId: security.id,
    symbol: "CACT",
    exchange: "XNYS",
    mic: "XNYS",
  }).returning();
  const [replacement] = await getDb().insert(securities).values({ companyId: company.id, name: "Corporate Action Test Replacement", assetClass: "equity", shareClass: "R" }).returning();
  const [replacementListing] = await getDb().insert(companyListings).values({
    companyId: company.id,
    securityId: replacement.id,
    symbol: "CACT2",
    exchange: "XNYS",
    mic: "XNYS",
  }).returning();
  let tickerActionId = 0;

  await t.test("createCorporateAction persists canonical event dates and instrument legs", async () => {
    const created = await createCorporateAction({
      actionType: "split",
      issuerCompanyId: company.id,
      exDate: "2026-06-01",
      source: "test",
      providerEventId: "split-1",
      terms: { ratio: "2:1" },
      legs: [{ securityId: security.id, role: "subject", ratioNumerator: 2, ratioDenominator: 1 }],
    });
    assert.equal(created.action.actionType, "split");
    assert.equal(created.action.exDate, "2026-06-01");
    assert.equal(created.legs.length, 1);
    assert.equal(created.legs[0].securityId, security.id);
    assert.equal(created.legs[0].ratioNumerator, 2);
  });

  await t.test("listCorporateActionsForSecurity includes actions represented by a listing leg", async () => {
    const tickerAction = await createCorporateAction({
      actionType: "ticker_change",
      issuerCompanyId: company.id,
      effectiveDate: "2026-08-01",
      source: "test",
      providerEventId: "ticker-1",
      terms: { oldSymbol: "CACT", newSymbol: "CACT2" },
      legs: [{ listingId: listing.id, role: "subject", newSymbol: "CACT2" }],
    });
    tickerActionId = tickerAction.action.id;
    const actions = await listCorporateActionsForSecurity(security.id);
    assert.equal(actions.some((item) => item.action.actionType === "ticker_change"), true);
    assert.equal(actions.find((item) => item.action.actionType === "ticker_change")?.legs[0].listingId, listing.id);
  });

  await t.test("continuity loader resolves ticker and successor listing targets", async () => {
    await createCorporateAction({
      actionType: "security_replacement",
      issuerCompanyId: company.id,
      effectiveDate: "2026-09-01",
      source: "test",
      providerEventId: "replacement-1",
      legs: [
        { securityId: security.id, role: "subject" },
        { listingId: replacementListing.id, role: "successor" },
      ],
    });
    const continuity = await listCorporateActionContinuityForSecurity(security.id, "CACT");
    const ticker = continuity.find((item) => item.actionId === tickerActionId);
    assert.deepEqual(ticker, {
      actionId: tickerActionId,
      actionType: "ticker_change",
      effectiveDate: "2026-08-01",
      sourceSymbol: "CACT",
      targetSymbol: "CACT2",
      sourceSecurityId: security.id,
      targetSecurityId: security.id,
      targetListingId: listing.id,
    });
    assert.equal(continuity.some((item) =>
      item.actionType === "security_replacement" &&
      item.targetSymbol === "CACT2" &&
      item.targetSecurityId === replacement.id &&
      item.targetListingId === replacementListing.id,
    ), true);
  });

  await t.test("createCorporateAction rejects non-finite numeric terms before persistence", async () => {
    await assert.rejects(
      createCorporateAction({
        actionType: "split",
        issuerCompanyId: company.id,
        effectiveDate: "2026-09-01",
        source: "test",
        providerEventId: "non-finite-ratio",
        legs: [{ securityId: security.id, role: "subject", ratioNumerator: Number.NaN, ratioDenominator: 1 }],
      }),
      /finite/i,
    );
    await assert.rejects(
      createCorporateAction({
        actionType: "dividend",
        issuerCompanyId: company.id,
        payableDate: "2026-09-15",
        source: "test",
        providerEventId: "non-finite-cash",
        legs: [{ securityId: security.id, role: "subject", cashAmount: Number.POSITIVE_INFINITY }],
      }),
      /finite/i,
    );
  });

  await t.test("provider event identity is unique per source, while the same provider event may exist in another source", async () => {
    await assert.rejects(
      createCorporateAction({
        actionType: "split",
        issuerCompanyId: company.id,
        effectiveDate: "2026-06-01",
        source: "test",
        providerEventId: "split-1",
        legs: [{ securityId: security.id, role: "subject" }],
      }),
      /unique|duplicate|constraint/i,
    );
    const otherSource = await createCorporateAction({
      actionType: "split",
      issuerCompanyId: company.id,
      effectiveDate: "2026-06-01",
      source: "other-source",
      providerEventId: "split-1",
      legs: [{ securityId: security.id, role: "subject" }],
    });
    assert.equal(otherSource.action.source, "other-source");
  });
  await t.test("createCorporateAction rolls back the event header when leg validation fails", async () => {
    await assert.rejects(
      createCorporateAction({
        actionType: "merger",
        issuerCompanyId: company.id,
        effectiveDate: "2026-10-01",
        source: "test",
        providerEventId: "rollback-1",
        legs: [{ role: "target" }],
      }),
      /check|constraint/i,
    );
    const persisted = await getDb().select().from(corporateActions).where(eq(corporateActions.providerEventId, "rollback-1"));
    assert.deepEqual(persisted, [], "failed leg validation must roll back the event header");
  });
});
