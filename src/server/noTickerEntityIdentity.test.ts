import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { InstrumentResolutionResult } from "@shared/globalInstrumentMaster";
import * as schema from "@shared/schema";

// CA-03: companies without a ticker, proven on a real embedded Postgres (PGlite) that was
// populated by the PREVIOUS schema (every migration but 0077) and then upgraded by the real
// initDb() path. db.ts reads LIMURIA_DATA_DIR at import, so every ./db consumer is imported
// dynamically after the data directory exists.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-no-ticker-identity-"));
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;

type ResolveResponse = InstrumentResolutionResult & { error?: string };

const migrationsFolder = path.resolve(process.cwd(), "migrations");
const previousMigrations = path.join(dataDir, "migrations-through-0076");
fs.cpSync(migrationsFolder, previousMigrations, { recursive: true });
fs.rmSync(path.join(previousMigrations, "0077_lios_ca03_no_ticker_entity_identity.sql"));
const journalPath = path.join(previousMigrations, "meta", "_journal.json");
const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
fs.writeFileSync(journalPath, `${JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx < 77) }, null, 2)}\n`);

// ── A database populated by the previous schema ────────────────────────────
const legacy = new PGlite(path.join(dataDir, "pgdata"));
await migrate(drizzle(legacy, { schema }), { migrationsFolder: previousMigrations });
const legacyColumns = await legacy.query<{ column_name: string }>(
  "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name in ('name_is_placeholder', 'jurisdiction', 'lifecycle_status')",
);
assert.deepEqual(legacyColumns.rows, [], "the fixture database must really be on the previous schema");
const legacySymbolNullable = await legacy.query<{ is_nullable: string }>(
  "select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'symbol'",
);
assert.equal(legacySymbolNullable.rows[0].is_nullable, "NO");

const ids: Record<string, number> = {};
async function legacyCompany(key: string, symbol: string, name: string, cik: string | null): Promise<number> {
  const company = await legacy.query<{ id: number }>(
    "insert into companies (symbol, name, cik, exchange, country, asset_class) values ($1, $2, $3, 'NASDAQ', 'US', 'equity') returning id",
    [symbol, name, cik],
  );
  ids[key] = company.rows[0].id;
  return company.rows[0].id;
}
async function legacyListing(companyId: number, symbol: string, name: string): Promise<void> {
  const security = await legacy.query<{ id: number }>(
    "insert into securities (company_id, name, asset_class) values ($1, $2, 'equity') returning id",
    [companyId, name],
  );
  await legacy.query(
    "insert into company_listings (company_id, security_id, symbol, exchange, asset_class, is_primary, source) values ($1, $2, $3, 'NASDAQ', 'equity', true, 'legacy-fixture')",
    [companyId, security.rows[0].id, symbol],
  );
}
const aapl = await legacyCompany("aapl", "AAPL", "Apple Inc.", "0000320193");
await legacyListing(aapl, "AAPL", "Apple Inc.");
await legacy.query(
  "insert into company_identifiers (company_id, identifier_type, identifier, source, is_primary) values ($1, 'cik', '0000320193', 'sec_edgar', true), ($1, 'isin', 'US0378331005', 'legacy-fixture', false), ($1, 'provider', 'AAPL-VENDOR', 'vendorx', false)",
  [aapl],
);
// Ingestion providers without a legal name persisted the ticker (finnhub/yfinance/simfin/bse) or a slug (screener) as the name.
const finn = await legacyCompany("finn", "FINNTEST", "FINNTEST", null);
await legacyListing(finn, "FINNTEST", "FINNTEST");
const tcs = await legacyCompany("tcs", "TCS.NS", "TCS", null);
await legacyListing(tcs, "TCS.NS", "TCS");
// A real company whose legal name merely resembles nothing: must not be flagged.
const realName = await legacyCompany("real", "MSFT", "Microsoft Corporation", "0000789019");
await legacyListing(realName, "MSFT", "Microsoft Corporation");
// A pre-listing-backfill row: a company with a symbol and zero listings.
await legacyCompany("oldco", "OLDCO", "Old Company Ltd", null);
await legacy.close();

const { initDb, closeDb, getDb } = await import("./db");
const { upsertCompany, upsertEntity } = await import("./companyStore");
const { resolvePersistedInstrument } = await import("./globalInstrumentMasterStore");
const { registerGlobalInstrumentMasterRoutes } = await import("./globalInstrumentMasterRoutes");
const { companies, companyIdentifiers, companyListings, securities } = schema;

// Drizzle wraps the driver error; the Postgres message naming the violated constraint is the cause.
const violates = (constraint: string) => (error: unknown): boolean =>
  error instanceof Error && String(error.cause).includes(constraint);

async function rowCounts(companyId: number): Promise<{ securities: number; listings: number; identifiers: number }> {
  const db = getDb();
  return {
    securities: (await db.select().from(securities).where(eq(securities.companyId, companyId))).length,
    listings: (await db.select().from(companyListings).where(eq(companyListings.companyId, companyId))).length,
    identifiers: (await db.select().from(companyIdentifiers).where(eq(companyIdentifiers.companyId, companyId))).length,
  };
}

test("CA-03 no-ticker entity identity on a database upgraded from the previous schema", async (t) => {
  await initDb(); // the real boot path: backs up, then migrates the populated database to head
  const db = getDb();

  const server = express().use((_req, _res, next) => next());
  registerGlobalInstrumentMasterRoutes(server);
  const http = server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const get = async (query: string): Promise<{ status: number; body: ResolveResponse }> => {
    const response = await fetch(`${base}/api/finance/instruments/resolve?${query}`);
    const body: ResolveResponse = await response.json();
    return { status: response.status, body };
  };
  t.after(async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test("existing rows survive the upgrade unchanged and gain only honest defaults", async () => {
    const [apple] = await db.select().from(companies).where(eq(companies.id, ids.aapl));
    assert.equal(apple.symbol, "AAPL");
    assert.equal(apple.name, "Apple Inc.");
    assert.equal(apple.cik, "0000320193");
    assert.equal(apple.nameIsPlaceholder, false);
    assert.equal(apple.jurisdiction, null);
    assert.equal(apple.legalEntityKind, null);
    assert.equal(apple.lifecycleStatus, "unknown", "nothing is inferred active from having a ticker");
    assert.equal(apple.identityStatus, "provisional");

    const identifiers = await db.select().from(companyIdentifiers).where(eq(companyIdentifiers.companyId, ids.aapl));
    assert.deepEqual(identifiers.map((row) => `${row.identifierType}:${row.identifier}`).sort(), ["cik:0000320193", "isin:US0378331005", "provider:AAPL-VENDOR"]);
    assert.ok(identifiers.every((row) => row.registry === "" && row.jurisdiction === ""), "legacy identifiers keep the global namespace");
  });

  await t.test("ticker-as-name rows are flagged as placeholders; real names are not", async () => {
    const flag = async (key: string) => (await db.select().from(companies).where(eq(companies.id, ids[key])))[0];
    assert.equal((await flag("finn")).nameIsPlaceholder, true);
    assert.equal((await flag("tcs")).nameIsPlaceholder, true, "a suffix-stripped slug of the symbol is a placeholder too");
    assert.equal((await flag("real")).nameIsPlaceholder, false);
    assert.equal((await flag("aapl")).nameIsPlaceholder, false);
  });

  await t.test("listed companies resolve exactly as before the upgrade", async () => {
    const result = await resolvePersistedInstrument({ ticker: "AAPL" });
    assert.equal(result.status, "resolved");
    assert.equal(result.match?.symbol, "AAPL");
    assert.equal(result.match?.name, "Apple Inc.");
    assert.equal(result.match?.entityId, `lios:entity:${ids.aapl}`);
    assert.match(result.match?.listingId ?? "", /^lios:listing:\d+$/);
    assert.match(result.match?.securityId ?? "", /^lios:security:\d+$/);
    assert.equal(result.match?.canonical, true);
    assert.ok(result.match?.identifiers.some((item) => item.type === "cik" && item.value === "0000320193"));
    assert.ok(result.match?.identifiers.some((item) => item.type === "isin" && item.value === "US0378331005"));

    const byName = await resolvePersistedInstrument({ name: "Apple Inc." });
    assert.equal(byName.match?.symbol, "AAPL");

    const legacyRow = await resolvePersistedInstrument({ ticker: "OLDCO" });
    assert.equal(legacyRow.status, "resolved");
    assert.equal(legacyRow.match?.source, "legacy_company_row");
    assert.equal(legacyRow.match?.symbol, "OLDCO");
    assert.equal(legacyRow.match?.listingId, null);
  });

  await t.test("a real name replaces a placeholder; a placeholder never overwrites a real name", async () => {
    await upsertCompany({ symbol: "AAPL" }); // a ticker-only provider writes through again
    const [apple] = await db.select().from(companies).where(eq(companies.id, ids.aapl));
    assert.equal(apple.name, "Apple Inc.");
    assert.equal(apple.nameIsPlaceholder, false);
    const [appleSecurity] = await db.select().from(securities).where(eq(securities.companyId, ids.aapl));
    assert.equal(appleSecurity.name, "Apple Inc.");

    await upsertCompany({ symbol: "FINNTEST", name: "Finn Test Corporation", exchange: "NASDAQ" });
    const [finn] = await db.select().from(companies).where(eq(companies.id, ids.finn));
    assert.equal(finn.name, "Finn Test Corporation");
    assert.equal(finn.nameIsPlaceholder, false);
    assert.equal((await db.select().from(companies).where(eq(companies.symbol, "FINNTEST"))).length, 1);

    const brandNewId = await upsertCompany({ symbol: "NONAMEYET" });
    const [fresh] = await db.select().from(companies).where(eq(companies.id, brandNewId));
    assert.equal(fresh.name, "NONAMEYET");
    assert.equal(fresh.nameIsPlaceholder, true, "a ticker-only first sight is flagged, not presented as a legal name");
  });

  await t.test("an entity with no symbol, no security and no listing resolves by name as symbol:null with nothing invented", async () => {
    const entityId = await upsertEntity({
      name: "Zephyr Quantum Holdings Ltd",
      jurisdiction: "gb",
      legalEntityKind: "corporation",
      legalForm: "Ltd",
    });
    assert.deepEqual(await rowCounts(entityId), { securities: 0, listings: 0, identifiers: 0 });
    const [row] = await db.select().from(companies).where(eq(companies.id, entityId));
    assert.equal(row.symbol, null);
    assert.equal(row.cik, null);
    assert.equal(row.jurisdiction, "GB");
    assert.equal(row.lifecycleStatus, "unknown", "no ticker does not mean private or inactive");
    assert.equal(row.identityStatus, "provisional");

    const { status, body } = await get(`name=${encodeURIComponent("Zephyr Quantum Holdings Ltd")}`);
    assert.equal(status, 200);
    assert.equal(body.status, "resolved");
    assert.equal(body.source, "local");
    const match = body.match;
    assert.ok(match);
    assert.equal(match.entityId, `lios:entity:${entityId}`);
    assert.equal(match.symbol, null);
    assert.equal(match.listingId, null);
    assert.equal(match.securityId, null);
    assert.deepEqual(match.identifiers, [], "no ticker, CIK, LEI or any other identifier is invented");
    assert.equal(match.exchange, null);
    assert.equal(match.isPrimaryListing, false);
    assert.equal(match.entity?.jurisdiction, "GB");
    assert.equal(match.entity?.legalEntityKind, "corporation");
    assert.equal(match.entity?.lifecycleStatus, "unknown");
    assert.equal(match.entity?.identityStatus, "provisional");
    assert.equal("quote" in body || "quote" in match, false, "the identity route never produces a quote");

    // And a ticker lookup never finds it.
    const byTicker = await get("ticker=ZEPHYR");
    assert.equal(byTicker.body.status, "not_found");
  });

  await t.test("an ambiguous name returns ambiguous with ranked candidates and chooses none", async () => {
    const uk = await upsertEntity({ name: "Meridian Cartography Ltd", jurisdiction: "GB" });
    const de = await upsertEntity({ name: "Meridian Cartography Ltd", jurisdiction: "DE" });
    assert.notEqual(uk, de, "a name alone never merges two entities");

    const { status, body } = await get(`name=${encodeURIComponent("Meridian Cartography Ltd")}`);
    assert.equal(status, 200);
    assert.equal(body.status, "ambiguous");
    assert.equal(body.match, null);
    assert.equal(body.candidates.length, 2);
    assert.deepEqual(body.candidates.map((row) => row.candidate.entityId).sort(), [`lios:entity:${uk}`, `lios:entity:${de}`].sort());
    assert.deepEqual(new Set(body.candidates.map((row) => row.candidate.entity?.jurisdiction)), new Set(["GB", "DE"]));
    assert.ok(body.candidates.every((row, index, all) => index === 0 || all[index - 1].score >= row.score), "candidates are ranked by score");
    assert.ok(body.candidates.every((row) => row.candidate.symbol === null));
  });

  await t.test("registry identifiers are namespaced by registry and jurisdiction", async () => {
    const gb = await upsertEntity({
      name: "Harbour Freight Logistics Ltd",
      identifiers: [{ type: "registry_id", value: "00012345", registry: "uk_companies_house", jurisdiction: "gb" }],
    });
    const de = await upsertEntity({
      name: "Hafen Fracht Logistik GmbH",
      identifiers: [{ type: "registry_id", value: "00012345", registry: "handelsregister", jurisdiction: "de" }],
    });
    assert.notEqual(gb, de, "the same number in another registry is another entity");

    const scoped = await get("identifierType=registry_id&identifierValue=00012345&identifierRegistry=uk_companies_house&identifierJurisdiction=GB");
    assert.equal(scoped.body.status, "resolved");
    assert.equal(scoped.body.match?.entityId, `lios:entity:${gb}`);
    const registryId = scoped.body.match?.identifiers.find((item) => item.type === "registry_id");
    assert.equal(registryId?.registry, "UK_COMPANIES_HOUSE");
    assert.equal(registryId?.jurisdiction, "GB");

    const wrongJurisdiction = await get("identifierType=registry_id&identifierValue=00012345&identifierRegistry=uk_companies_house&identifierJurisdiction=DE");
    assert.equal(wrongJurisdiction.body.status, "not_found");

    const missingRegistry = await get("identifierType=registry_id&identifierValue=00012345");
    assert.equal(missingRegistry.status, 400, "a bare registry number is not a lookup");
    const unscoped = await resolvePersistedInstrument({ identifier: { type: "registry_id", value: "00012345" } });
    assert.equal(unscoped.status, "not_found");

    const again = await upsertEntity({
      name: "Harbour Freight Logistics Limited",
      lifecycleStatus: "active",
      identityStatus: "verified",
      identifiers: [{ type: "registry_id", value: "00012345", registry: "UK_COMPANIES_HOUSE", jurisdiction: "GB" }],
    });
    assert.equal(again, gb, "the same registry identifier updates the same entity");
    const [updated] = await db.select().from(companies).where(eq(companies.id, gb));
    assert.equal(updated.name, "Harbour Freight Logistics Limited");
    assert.equal(updated.lifecycleStatus, "active");
    assert.equal(updated.identityStatus, "verified");

    await assert.rejects(
      upsertEntity({
        name: "Conflicted",
        identifiers: [
          { type: "registry_id", value: "00012345", registry: "uk_companies_house", jurisdiction: "gb" },
          { type: "registry_id", value: "00012345", registry: "handelsregister", jurisdiction: "de" },
        ],
      }),
      /belong to different entities/,
    );
    await assert.rejects(
      upsertEntity({ name: "No namespace", identifiers: [{ type: "registry_id", value: "777", registry: "  " }] }),
      /needs a registry/,
    );
  });

  await t.test("the database itself rejects the shapes the contract forbids", async () => {
    await assert.rejects(db.execute(`insert into companies (symbol, name) values ('   ', 'Blank symbol')`), violates("companies_symbol_not_blank"));
    await assert.rejects(db.execute(`insert into companies (symbol, name, lifecycle_status) values (null, 'Bad lifecycle', 'zombie')`), violates("companies_lifecycle_status_valid"));
    await assert.rejects(db.execute(`insert into companies (symbol, name, identity_status) values (null, 'Bad identity', 'maybe')`), violates("companies_identity_status_valid"));
    await assert.rejects(db.execute(`insert into companies (symbol, name, legal_entity_kind) values (null, 'Bad kind', 'spaceship')`), violates("companies_legal_entity_kind_valid"));
    // Postgres UNIQUE permits many NULLs: several symbol-less entities coexist.
    const nullSymbols = await db.select().from(companies).where(eq(companies.name, "Meridian Cartography Ltd"));
    assert.equal(nullSymbols.length, 2);
    await assert.rejects(
      db.execute(`insert into company_identifiers (company_id, identifier_type, identifier, registry) values (${ids.aapl}, 'registry_id', 'X1', '')`),
      violates("company_identifiers_registry_namespace_shape"),
    );
    await assert.rejects(
      db.execute(`insert into company_identifiers (company_id, identifier_type, identifier, registry, jurisdiction) values (${ids.aapl}, 'lei', 'X2', '', 'GB')`),
      violates("company_identifiers_registry_namespace_shape"),
    );
    await assert.rejects(
      db.execute(`insert into company_identifiers (company_id, identifier_type, identifier) values (${ids.real}, 'cik', '0000320193')`),
      violates("company_identifier_namespace_value_unique"),
    );
  });

  await t.test("a listing attached later binds to the same entity by CIK and gives it its display symbol", async () => {
    const entityId = await upsertEntity({ name: "Northwind Instruments plc", cik: "0001234567", jurisdiction: "GB" });
    assert.deepEqual(await rowCounts(entityId), { securities: 0, listings: 0, identifiers: 1 });

    const sameEntity = await upsertCompany({ symbol: "NWND", name: "Northwind Instruments plc", cik: "0001234567", exchange: "LSE" });
    assert.equal(sameEntity, entityId, "attaching a listing never changes the entity id");
    const [row] = await db.select().from(companies).where(eq(companies.id, entityId));
    assert.equal(row.symbol, "NWND");
    assert.equal(row.jurisdiction, "GB");
    assert.equal(row.identityStatus, "provisional", "listing a company does not verify it");
    assert.deepEqual(await rowCounts(entityId), { securities: 1, listings: 1, identifiers: 1 });

    const listed = await resolvePersistedInstrument({ ticker: "NWND" });
    assert.equal(listed.status, "resolved");
    assert.equal(listed.match?.entityId, `lios:entity:${entityId}`);
    assert.equal(listed.match?.entity?.jurisdiction, "GB");
  });
});
