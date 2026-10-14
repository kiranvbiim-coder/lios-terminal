import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { companies, companyListings, securities } from "@shared/schema";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sec-entity-identity-"));
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { upsertEntity, getFilingsForCompanyId, persistFilings } = await import("./companyStore");
const { getCompanyFilings, getInsiderTransactions } = await import("./secEdgarData");

test("EDGAR retrieves real-format CIK-only fixtures without creating securities or listings", async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const entityId = await upsertEntity({ name: "Northwind SEC Fixture LLC", cik: "0007654321" });
  const identity = { entityId, name: "Northwind SEC Fixture LLC", cik: "0007654321", symbol: null };
  const urls: string[] = [];
  const submissions = {
    filings: { recent: { form: ["10-K", "4"], filingDate: ["2026-01-01", "2026-01-02"], accessionNumber: ["0007654321-26-000001", "0007654321-26-000002"] }, files: [] },
  };
  const xml = `<ownershipDocument><issuer><issuerName>Northwind SEC Fixture LLC</issuerName></issuer><reportingOwner><reportingOwnerId><rptOwnerName>Fixture Officer</rptOwnerName></reportingOwnerId></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common units</value></securityTitle><transactionDate><value>2026-01-02</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>2</value></transactionShares><transactionPricePerShare><value>3</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;
  const fetchMock = t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://data.sec.gov/submissions/CIK0007654321.json") return Response.json(submissions);
    if (url.endsWith("/index.json")) return Response.json({ directory: { item: [{ name: "form4.xml" }] } });
    if (url.endsWith("/form4.xml")) return new Response(xml);
    throw new Error(`Unexpected provider call: ${url}`);
  });
  t.after(() => fetchMock.mock.restore());

  const filings = await getCompanyFilings(identity);
  assert.equal(filings.length, 2);
  assert.ok(filings.every((filing) => filing.filingUrl.startsWith("https://www.sec.gov/Archives/edgar/data/7654321/")));
  assert.deepEqual(filings.map(filing => filing.filingUrl), [
    "https://www.sec.gov/Archives/edgar/data/7654321/000765432126000002/0007654321-26-000002-index.htm",
    "https://www.sec.gov/Archives/edgar/data/7654321/000765432126000001/0007654321-26-000001-index.htm",
  ]);
  assert.equal((await getFilingsForCompanyId(entityId)).length, 2);
  const insiders = await getInsiderTransactions(identity);
  assert.ok(urls.some(url => url.endsWith("/000765432126000002/index.json")));
  assert.ok(urls.some(url => url.endsWith("/000765432126000002/form4.xml")));
  assert.equal(insiders.length, 1);
  assert.equal(insiders[0].symbol, null);
  assert.equal(insiders[0].issuerName, identity.name);
  assert.ok(urls.every((url) => !url.includes("company_tickers")), "the explicit CIK never enters ticker discovery");
  const db = getDb();
  const [row] = await db.select().from(companies).where(eq(companies.id, entityId));
  assert.equal(row.symbol, null);
  assert.equal((await db.select().from(companies)).length, 1);
  assert.equal((await db.select().from(companyListings)).length, 0);
  assert.equal((await db.select().from(securities)).length, 0);

  const before = urls.length;
  await assert.rejects(getCompanyFilings({ ...identity, cik: "CIK:0007654321" }), /valid CIK/);
  await assert.rejects(getInsiderTransactions({ ...identity, entityId: 0 }), /resolved entity/);
  assert.equal(urls.length, before);
  const fallbackId = await upsertEntity({ name: "Fallback SEC Fixture LLC", cik: "0007654322" });
  await persistFilings(fallbackId, [{ formType: "10-K", filedDate: "2026-01-01", accessionNumber: "cached-fixture", filingUrl: "https://example.test/known-cache" }]);
  fetchMock.mock.mockImplementation(async () => new Response("unavailable", { status: 503 }));
  const cached = await getCompanyFilings({ entityId: fallbackId, name: "Fallback SEC Fixture LLC", cik: "0007654322" });
  assert.deepEqual(cached.map((filing) => filing.accessionNumber), ["cached-fixture"]);
  assert.equal((await db.select().from(companyListings)).length, 0);
});
