import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@shared/schema";

test("fresh PGlite databases apply the complete migration chain", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-migration-smoke-"));
  const dataDir = path.join(root, "pgdata");
  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await migrate(drizzle(client, { schema }), { migrationsFolder: path.resolve(process.cwd(), "migrations") });

  const tables = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename in ('calculation_jobs', 'data_coverage_ledger', 'data_deletion_receipts', 'data_field_mappings', 'data_lineage_receipts', 'dataset_snapshots', 'diagnostic_events', 'enterprise_saml_requests', 'enterprise_sso_device_authorizations', 'event_relay_deliveries', 'export_custody_receipts', 'external_rights_assessments', 'production_retention_policies', 'artifact_interaction_receipts', 'project_artifact_proposals', 'project_artifact_references', 'project_artifact_versions', 'project_artifacts', 'project_ledger_events', 'project_ledger_stream_heads', 'securities', 'semantic_metric_definitions', 'user_persona_preferences') order by tablename",
  );
  assert.deepEqual(
    tables.rows.map((row) => row.tablename),
    [
      "artifact_interaction_receipts",
      "calculation_jobs",
      "data_coverage_ledger",
      "data_deletion_receipts",
      "data_field_mappings",
      "data_lineage_receipts",
      "dataset_snapshots",
      "diagnostic_events",
      "enterprise_saml_requests",
      "enterprise_sso_device_authorizations",
      "export_custody_receipts",
      "external_rights_assessments",
      "production_retention_policies",
      "project_artifact_proposals",
      "project_artifact_references",
      "project_artifact_versions",
      "project_artifacts",
      "project_ledger_events",
      "project_ledger_stream_heads",
      "securities",
      "semantic_metric_definitions",
      "user_persona_preferences",
    ],
  );

  const constraints = await client.query<{ conname: string; definition: string }>(
    `select conname, pg_get_constraintdef(oid) as definition
       from pg_constraint
      where conrelid = 'public.user_persona_preferences'::regclass
        and contype = 'c'
      order by conname`,
  );
  assert.deepEqual(
    constraints.rows.map((row) => row.conname),
    [
      "user_persona_preferences_active_context_shape",
      "user_persona_preferences_preferences_shape",
      "user_persona_preferences_secondary_personas_shape",
    ],
  );
  assert.match(constraints.rows[0].definition, /jsonb_typeof\("?active_context"?\) = 'object'/);
  assert.match(constraints.rows[0].definition, /pg_column_size\("?active_context"?\) <= 65536/);
  assert.match(constraints.rows[1].definition, /jsonb_typeof\("?preferences"?\) = 'object'/);
  assert.match(constraints.rows[1].definition, /pg_column_size\("?preferences"?\) <= 65536/);
  assert.match(constraints.rows[2].definition, /jsonb_typeof\("?secondary_personas"?\) = 'array'/);
  assert.match(constraints.rows[2].definition, /jsonb_array_length\("?secondary_personas"?\) <= 8/);

  const migrationsFolder = path.resolve(process.cwd(), "migrations");
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  // The journal ends at the newest numbered migration file; do not pin a number that every new migration breaks.
  const newestFile = fs.readdirSync(migrationsFolder).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort().at(-1)!;
  assert.equal(journal.entries.at(-1)?.tag, newestFile.replace(/\.sql$/, ""));
  assert.equal(journal.entries.at(-1)?.idx, Number(newestFile.slice(0, 4)));
  const previousSnapshot = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta", "0041_snapshot.json"), "utf8"),
  ) as { id: string };
  const currentSnapshot = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, "meta", "0042_snapshot.json"), "utf8"),
  ) as {
    prevId: string;
    tables: Record<string, { checkConstraints: Record<string, unknown> }>;
  };
  assert.equal(currentSnapshot.prevId, previousSnapshot.id);
  assert.deepEqual(
    Object.keys(currentSnapshot.tables["public.user_persona_preferences"].checkConstraints).sort(),
    [
      "user_persona_preferences_active_context_shape",
      "user_persona_preferences_preferences_shape",
      "user_persona_preferences_secondary_personas_shape",
    ],
  );

  // GM-03 / Q4: the generic vendor event relay is gone from the schema, and old purge receipts were relabelled.
  const retired = await client.query<{ n: string }>(
    `select (select count(*) from pg_tables where schemaname = 'public' and tablename = 'event_relay_deliveries')
          + (select count(*) from information_schema.columns where table_name = 'production_retention_policies' and column_name = 'relay_days') as n`,
  );
  assert.equal(Number(retired.rows[0].n), 0);

  const columns = await client.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'dataset_snapshots' and column_name = 'expires_at'",
  );
  assert.deepEqual(columns.rows.map((row) => row.column_name), ["expires_at"]);

  const applied = await client.query<{ created_at: number }>(
    "select created_at from drizzle.__drizzle_migrations order by created_at desc limit 2",
  );
  assert.equal(applied.rows.length, 2);
  assert.equal(applied.rows[0].created_at > applied.rows[1].created_at, true);
});

test("0048_securities backfills legacy listing share classes into one security per class", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-securities-backfill-"));
  const dataDir = path.join(root, "pgdata");
  const legacyMigrationsFolder = path.join(root, "migrations-through-0047");
  const migrationsFolder = path.resolve(process.cwd(), "migrations");
  fs.cpSync(migrationsFolder, legacyMigrationsFolder, { recursive: true });
  fs.rmSync(path.join(legacyMigrationsFolder, "0048_securities.sql"));
  const legacyJournalPath = path.join(legacyMigrationsFolder, "meta", "_journal.json");
  const legacyJournal = JSON.parse(fs.readFileSync(legacyJournalPath, "utf8")) as {
    entries: Array<{ idx: number }>;
  };
  fs.writeFileSync(
    legacyJournalPath,
    `${JSON.stringify({ ...legacyJournal, entries: legacyJournal.entries.filter((entry) => entry.idx < 48) }, null, 2)}\n`,
  );

  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: legacyMigrationsFolder });
  const companyResult = await client.query<{ id: number }>(
    "insert into companies (symbol, name, asset_class) values ('ACME', 'Acme Corp', 'equity') returning id",
  );
  const companyId = companyResult.rows[0].id;
  await client.query(
    "insert into company_listings (company_id, symbol, exchange, share_class, asset_class) values ($1, 'ACME', 'NASDAQ', null, 'equity'), ($1, 'ACME.L', 'LSE', null, 'equity'), ($1, 'ACME.A', 'NYSE', 'A', 'equity')",
    [companyId],
  );

  await migrate(db, { migrationsFolder });

  const rows = await client.query<{ symbol: string; security_id: number; share_class: string | null }>(
    `select cl.symbol, cl.security_id, s.share_class
       from company_listings cl
       inner join securities s on s.id = cl.security_id
      where cl.company_id = $1
      order by cl.symbol`,
    [companyId],
  );
  assert.equal(rows.rows.length, 3);
  const bySymbol = new Map(rows.rows.map((row) => [row.symbol, row]));
  assert.equal(bySymbol.get("ACME")?.share_class, null);
  assert.equal(bySymbol.get("ACME.L")?.share_class, null);
  assert.equal(bySymbol.get("ACME.A")?.share_class, "A");
  assert.equal(bySymbol.get("ACME")?.security_id, bySymbol.get("ACME.L")?.security_id);
  assert.notEqual(bySymbol.get("ACME")?.security_id, bySymbol.get("ACME.A")?.security_id);

  const listingColumns = await client.query<{ column_name: string; is_nullable: string }>(
    `select column_name, is_nullable
       from information_schema.columns
      where table_schema = 'public'
        and table_name = 'company_listings'
        and column_name in ('security_id', 'share_class')
      order by column_name`,
  );
  assert.deepEqual(listingColumns.rows, [{ column_name: "security_id", is_nullable: "NO" }]);

  await assert.rejects(
    client.query(
      "insert into securities (company_id, name, asset_class) values ($1, 'Duplicate ordinary security', 'equity')",
      [companyId],
    ),
    /security_company_asset_no_class_unique/,
  );
  await assert.rejects(
    client.query(
      "insert into company_listings (company_id, security_id, symbol, exchange) values ($1, 999999, 'ACME.BAD', 'TEST')",
      [companyId],
    ),
    /company_listings_security_id_securities_id_fk/,
  );

  const otherCompany = await client.query<{ id: number }>(
    "insert into companies (symbol, name, asset_class) values ('OTHER', 'Other Corp', 'equity') returning id",
  );
  const otherSecurity = await client.query<{ id: number }>(
    "insert into securities (company_id, name, asset_class) values ($1, 'Other Corp Common Stock', 'equity') returning id",
    [otherCompany.rows[0].id],
  );
  await assert.rejects(
    client.query(
      "insert into company_listings (company_id, security_id, symbol, exchange) values ($1, $2, 'ACME.CROSS', 'TEST')",
      [companyId, otherSecurity.rows[0].id],
    ),
    /company_listings_security_company_asset_fk/,
  );
  await assert.rejects(
    client.query(
      "insert into company_listings (company_id, security_id, symbol, exchange, asset_class) values ($1, $2, 'ACME.ETF', 'TEST', 'etf')",
      [companyId, bySymbol.get("ACME")!.security_id],
    ),
    /company_listings_security_company_asset_fk/,
  );

  await client.query(
    "insert into companies (symbol, name, cik, asset_class) values ('CIKONE', 'CIK One', '0001652044', 'equity')",
  );
  await assert.rejects(
    client.query(
      "insert into companies (symbol, name, cik, asset_class) values ('CIKTWO', 'CIK Two', '0001652044', 'equity')",
    ),
    /company_cik_unique/,
  );
});

test("Drizzle enum declarations never silently drift from the migrated database", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-enum-drift-"));
  const dataDir = path.join(root, "pgdata");
  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await migrate(drizzle(client, { schema }), { migrationsFolder: path.resolve(process.cwd(), "migrations") });

  // Each Drizzle pgEnum() call is a TypeScript-side declaration of the values
  // Postgres will accept. A migration that ALTERs the underlying enum type
  // without a matching update to schema.ts compiles fine (pgEnum() takes a
  // plain string array) but silently desyncs the type system from what the
  // database actually enforces -- exactly what happened to
  // platform_plan_tier after the personal/team -> starter/pro migration.
  const enumsToCheck: Array<{ pgName: string; declared: readonly string[] }> = [
    { pgName: "platform_plan_tier", declared: schema.platformPlanTierEnum.enumValues },
    { pgName: "license_lifecycle_status", declared: schema.licenseLifecycleStatusEnum.enumValues },
    { pgName: "device_authorization_status", declared: schema.deviceAuthorizationStatusEnum.enumValues },
    { pgName: "license_entitlement_type", declared: schema.licenseEntitlementTypeEnum.enumValues },
    { pgName: "client_audit_event_type", declared: schema.clientAuditEventTypeEnum.enumValues },
    { pgName: "instrument_relationship_type", declared: schema.instrumentRelationshipTypeEnum.enumValues },
  ];

  for (const { pgName, declared } of enumsToCheck) {
    const result = await client.query<{ enumlabel: string }>(
      "select enumlabel from pg_enum e join pg_type t on e.enumtypid = t.oid where t.typname = $1 order by enumsortorder",
      [pgName],
    );
    const actual = result.rows.map((row) => row.enumlabel);
    assert.deepEqual(
      [...declared].sort(),
      [...actual].sort(),
      `schema.ts enum for "${pgName}" (${JSON.stringify(declared)}) no longer matches the migrated database (${JSON.stringify(actual)})`,
    );
  }
});

test("global market master seeds resolve every seeded exchange to a valid country", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-market-master-"));
  const dataDir = path.join(root, "pgdata");
  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await migrate(drizzle(client, { schema }), { migrationsFolder: path.resolve(process.cwd(), "migrations") });

  const countryCount = await client.query<{ count: string }>("select count(*)::text from countries");
  assert.equal(Number(countryCount.rows[0].count) >= 12, true, "expected at least the 12 seeded countries");

  const orphanedExchanges = await client.query<{ mic: string }>(
    "select mic from exchanges e where not exists (select 1 from countries c where c.code = e.country_code)",
  );
  assert.deepEqual(orphanedExchanges.rows, [], "every seeded exchange must reference a seeded country");

  const nse = await client.query<{ mic: string; country_code: string; aliases: string[] }>(
    "select mic, country_code, aliases from exchanges where mic = 'XNSE'",
  );
  assert.equal(nse.rows.length, 1);
  assert.equal(nse.rows[0].country_code, "IN");
  assert.deepEqual(nse.rows[0].aliases, ["NSE"]);
});

test("currency master (LV4-05-01) seeds resolve every country/exchange currency_code and portfolios gains a base_currency default", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-currency-master-"));
  const dataDir = path.join(root, "pgdata");
  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await migrate(drizzle(client, { schema }), { migrationsFolder: path.resolve(process.cwd(), "migrations") });

  const currencyCount = await client.query<{ count: string }>("select count(*)::text from currencies");
  assert.equal(Number(currencyCount.rows[0].count) >= 30, true, "expected at least the 30 seeded currencies");

  const orphanedCountries = await client.query<{ code: string }>(
    "select code from countries c where not exists (select 1 from currencies x where x.code = c.currency_code)",
  );
  assert.deepEqual(orphanedCountries.rows, [], "every seeded country must reference a seeded currency");

  const orphanedExchanges = await client.query<{ mic: string }>(
    "select mic from exchanges e where not exists (select 1 from currencies x where x.code = e.currency_code)",
  );
  assert.deepEqual(orphanedExchanges.rows, [], "every seeded exchange must reference a seeded currency");

  const jpy = await client.query<{ minor_unit: number; symbol: string }>("select minor_unit, symbol from currencies where code = 'JPY'");
  assert.equal(jpy.rows[0].minor_unit, 0, "JPY has no minor unit");
  assert.equal(jpy.rows[0].symbol, "\u00A5");

  await client.query("insert into organizations (name, slug) values ('Currency Test Org', 'currency-test-org')");
  await client.query("insert into portfolios (organization_id, name) values (1, 'Default Currency Portfolio')");
  const portfolio = await client.query<{ base_currency: string }>("select base_currency from portfolios where name = 'Default Currency Portfolio'");
  assert.equal(portfolio.rows[0].base_currency, "USD", "portfolios.base_currency defaults to USD for existing/new rows");

  await assert.rejects(
    client.query("insert into countries (code, name, region, currency_code) values ('ZZ', 'Fictional Country', 'Nowhere', 'ZZZ')"),
    /foreign key constraint|violates/i,
    "a country with an unregistered currency_code must be rejected",
  );

  await assert.rejects(
    client.query("insert into portfolios (organization_id, name, base_currency) values (1, 'Bad Currency Portfolio', 'ZZZ')"),
    /foreign key constraint|violates/i,
    "a portfolio with an unregistered base_currency must be rejected",
  );
});

test("fx_rates (LV4-05-02) enforces distinct base/quote currencies, a positive rate, known currency codes, and one row per (pair, date, source)", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-fx-rates-"));
  const dataDir = path.join(root, "pgdata");
  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await migrate(drizzle(client, { schema }), { migrationsFolder: path.resolve(process.cwd(), "migrations") });

  await assert.rejects(
    client.query("insert into fx_rates (base_currency, quote_currency, rate_date, rate, source) values ('USD', 'USD', '2026-06-01', 1, 'test')"),
    /check constraint|violates/i,
    "a row where base_currency equals quote_currency must be rejected",
  );

  await assert.rejects(
    client.query("insert into fx_rates (base_currency, quote_currency, rate_date, rate, source) values ('USD', 'EUR', '2026-06-01', 0, 'test')"),
    /check constraint|violates/i,
    "a zero rate must be rejected",
  );

  await assert.rejects(
    client.query("insert into fx_rates (base_currency, quote_currency, rate_date, rate, source) values ('USD', 'EUR', '2026-06-01', -1.1, 'test')"),
    /check constraint|violates/i,
    "a negative rate must be rejected",
  );

  await assert.rejects(
    client.query("insert into fx_rates (base_currency, quote_currency, rate_date, rate, source) values ('ZZZ', 'USD', '2026-06-01', 1.1, 'test')"),
    /foreign key constraint|violates/i,
    "an unregistered base_currency must be rejected",
  );

  await client.query("insert into fx_rates (base_currency, quote_currency, rate_date, rate, source) values ('EUR', 'USD', '2026-06-01', 1.1, 'test')");
  await assert.rejects(
    client.query("insert into fx_rates (base_currency, quote_currency, rate_date, rate, source) values ('EUR', 'USD', '2026-06-01', 1.15, 'test')"),
    /unique constraint|duplicate key|violates/i,
    "a raw duplicate (base, quote, date, source) insert must be rejected -- server/fxRateStore.ts's upsert is what callers should use to revise a rate",
  );
});

test("trading calendar (LV4-05-03) seeds resolve to known exchanges and enforce session time order, holiday shape, and uniqueness", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-trading-calendar-"));
  const dataDir = path.join(root, "pgdata");
  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await migrate(drizzle(client, { schema }), { migrationsFolder: path.resolve(process.cwd(), "migrations") });

  const sessionCount = await client.query<{ count: string }>("select count(*)::text from exchange_trading_sessions");
  assert.equal(Number(sessionCount.rows[0].count), 25, "expected exactly the 25 seeded sessions across all 15 exchanges");

  const holidayCount = await client.query<{ count: string }>("select count(*)::text from exchange_holidays");
  assert.equal(Number(holidayCount.rows[0].count), 197, "expected complete 2026 coverage across all 15 seeded exchanges");

  const holidayCoverage = await client.query<{ exchange_mic: string; count: string }>(
    "select exchange_mic, count(*)::text from exchange_holidays where holiday_date like '2026-%' group by exchange_mic order by exchange_mic",
  );
  assert.deepEqual(
    holidayCoverage.rows,
    [
      { exchange_mic: "BVMF", count: "14" },
      { exchange_mic: "XASX", count: "10" },
      { exchange_mic: "XBOM", count: "15" },
      { exchange_mic: "XETR", count: "7" },
      { exchange_mic: "XHKG", count: "17" },
      { exchange_mic: "XLON", count: "10" },
      { exchange_mic: "XNAS", count: "12" },
      { exchange_mic: "XNSE", count: "15" },
      { exchange_mic: "XNYS", count: "12" },
      { exchange_mic: "XPAR", count: "7" },
      { exchange_mic: "XSES", count: "12" },
      { exchange_mic: "XSHE", count: "18" },
      { exchange_mic: "XSHG", count: "18" },
      { exchange_mic: "XTKS", count: "19" },
      { exchange_mic: "XTSE", count: "11" },
    ],
    "every seeded exchange must have the expected verified 2026 holiday coverage",
  );
  const orphanedSessions = await client.query<{ id: number }>(
    "select id from exchange_trading_sessions s where not exists (select 1 from exchanges e where e.mic = s.exchange_mic)",
  );
  assert.deepEqual(orphanedSessions.rows, [], "every seeded session must reference a seeded exchange");

  const orphanedHolidays = await client.query<{ id: number }>(
    "select id from exchange_holidays h where not exists (select 1 from exchanges e where e.mic = h.exchange_mic)",
  );
  assert.deepEqual(orphanedHolidays.rows, [], "every seeded holiday must reference a seeded exchange");

  const xtksRegular = await client.query<{ sequence: number; start_time: string; end_time: string }>(
    "select sequence, start_time, end_time from exchange_trading_sessions where exchange_mic = 'XTKS' and session_type = 'regular' order by sequence",
  );
  assert.deepEqual(xtksRegular.rows, [
    { sequence: 0, start_time: "09:00", end_time: "11:30" },
    { sequence: 1, start_time: "12:30", end_time: "15:30" },
  ]);

  const thanksgiving = await client.query<{ status: string; early_close_time: string | null }>(
    "select status, early_close_time from exchange_holidays where exchange_mic = 'XNYS' and holiday_date = '2026-11-27'",
  );
  assert.deepEqual(thanksgiving.rows, [{ status: "early_close", early_close_time: "13:00" }]);
  const b3YearEnd = await client.query<{ holiday_date: string; status: string }>(
    "select holiday_date, status from exchange_holidays where exchange_mic = 'BVMF' and holiday_date in ('2026-12-24', '2026-12-31') order by holiday_date",
  );
  assert.deepEqual(b3YearEnd.rows, [
    { holiday_date: "2026-12-24", status: "closed" },
    { holiday_date: "2026-12-31", status: "closed" },
  ], "B3 year-end closures must not be omitted from the complete calendar");

  await assert.rejects(
    client.query("insert into exchange_trading_sessions (exchange_mic, session_type, sequence, start_time, end_time, source) values ('XNYS', 'regular', 5, '16:00', '09:30', 'test')"),
    /check constraint|violates/i,
    "a session whose start_time is not before end_time must be rejected",
  );

  await assert.rejects(
    client.query("insert into exchange_holidays (exchange_mic, holiday_date, name, status, early_close_time, source) values ('XNYS', '2026-03-01', 'Bad Row', 'early_close', NULL, 'test')"),
    /check constraint|violates/i,
    "an early_close holiday without an early_close_time must be rejected",
  );

  await assert.rejects(
    client.query("insert into exchange_holidays (exchange_mic, holiday_date, name, status, early_close_time, source) values ('XNYS', '2026-03-01', 'Bad Row', 'closed', '13:00', 'test')"),
    /check constraint|violates/i,
    "a closed holiday carrying a non-null early_close_time must be rejected",
  );

  await assert.rejects(
    client.query("insert into exchange_trading_sessions (exchange_mic, session_type, sequence, start_time, end_time, source) values ('ZZZZ', 'regular', 0, '09:00', '10:00', 'test')"),
    /foreign key constraint|violates/i,
    "a session referencing an unregistered exchange must be rejected",
  );

  await assert.rejects(
    client.query("insert into exchange_trading_sessions (exchange_mic, session_type, sequence, start_time, end_time, source) values ('XNYS', 'regular', 0, '09:00', '10:00', 'test')"),
    /unique constraint|duplicate key|violates/i,
    "a duplicate (exchange_mic, session_type, sequence) must be rejected",
  );

  await assert.rejects(
    client.query("insert into exchange_holidays (exchange_mic, holiday_date, name, status, early_close_time, source) values ('XNYS', '2026-11-26', 'Duplicate', 'closed', NULL, 'test')"),
    /unique constraint|duplicate key|violates/i,
    "a duplicate (exchange_mic, holiday_date) must be rejected",
  );
});

test("corporate actions (LV4-05-05) provide a canonical multi-leg event model with enforced leg shape", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-corporate-actions-"));
  const dataDir = path.join(root, "pgdata");
  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  await migrate(drizzle(client, { schema }), { migrationsFolder: path.resolve(process.cwd(), "migrations") });
  const company = await client.query<{ id: number }>(
    "insert into companies (symbol, name) values ('CANONCA', 'Canonical Action Test') returning id",
  );
  const security = await client.query<{ id: number }>(
    `insert into securities (company_id, name, asset_class) values (${company.rows[0].id}, 'Canonical Action Common', 'equity') returning id`,
  );
  const action = await client.query<{ id: number }>(
    `insert into corporate_actions (action_type, issuer_company_id, effective_date, source, provider_event_id) values ('merger', ${company.rows[0].id}, '2026-06-01', 'test', 'canon-1') returning id`,
  );

  await client.query(
    `insert into corporate_action_legs (action_id, security_id, role, ratio_numerator, ratio_denominator) values (${action.rows[0].id}, ${security.rows[0].id}, 'subject', 1, 1)`,
  );

  await assert.rejects(
    client.query(`insert into corporate_action_legs (action_id, role) values (${action.rows[0].id}, 'target')`),
    /check constraint|violates/i,
    "a leg must reference exactly one security or listing",
  );
  await assert.rejects(
    client.query(`insert into corporate_action_legs (action_id, security_id, role, ratio_numerator) values (${action.rows[0].id}, ${security.rows[0].id}, 'successor', 2)`),
    /check constraint|violates/i,
    "a ratio must provide two positive terms",
  );
  await assert.rejects(
    client.query(`insert into corporate_action_legs (action_id, security_id, role, cash_amount) values (${action.rows[0].id}, ${security.rows[0].id}, 'target', -1)`),
    /check constraint|violates/i,
    "cash consideration must not be negative",
  );
  await assert.rejects(
    client.query(`insert into corporate_action_legs (action_id, security_id, role, ratio_numerator, ratio_denominator) values (${action.rows[0].id}, ${security.rows[0].id}, 'successor', 'NaN'::real, 1)`),
    /check constraint|violates/i,
    "a NaN ratio must be rejected",
  );
  await assert.rejects(
    client.query(`insert into corporate_action_legs (action_id, security_id, role, cash_amount) values (${action.rows[0].id}, ${security.rows[0].id}, 'target', 'Infinity'::real)`),
    /check constraint|violates/i,
    "an infinite cash amount must be rejected",
  );
});

test("instrument_relationships rejects a row that mixes the listing-level and company-level shapes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-instrument-relationships-"));
  const dataDir = path.join(root, "pgdata");
  const client = new PGlite(dataDir);
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "migrations") });

  const [company] = await db.insert(schema.companies).values({ symbol: "ACME", name: "Acme Corp" }).returning();
  const [security] = await db.insert(schema.securities).values({
    companyId: company.id,
    name: "Acme Corp Common Stock",
    assetClass: "equity",
  }).returning();
  const [listingA] = await db.insert(schema.companyListings).values({
    companyId: company.id, securityId: security.id, symbol: "ACME", exchange: "NASDAQ",
  }).returning();
  const [listingB] = await db.insert(schema.companyListings).values({
    companyId: company.id, securityId: security.id, symbol: "ACME.L", exchange: "LSE",
  }).returning();

  // Valid: a listing-level ADR/GDR edge with both company ids left null.
  await db.insert(schema.instrumentRelationships).values({
    relationshipType: "adr_gdr",
    sourceListingId: listingA.id,
    targetListingId: listingB.id,
    ratio: "1:2",
  });

  // Invalid: succession must carry company ids, never listing ids. Drizzle
  // wraps the real Postgres error under `.cause` rather than `.message`, so
  // the matcher inspects `.cause` directly instead of the default
  // message-only RegExp check.
  const violatesShapeConstraint = (error: unknown): boolean => {
    const cause = error instanceof Error ? error.cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : String(cause ?? "");
    return causeMessage.includes("instrument_relationships_listing_or_company_shape");
  };

  await assert.rejects(
    db.insert(schema.instrumentRelationships).values({
      relationshipType: "succession",
      sourceListingId: listingA.id,
      targetListingId: listingB.id,
    }),
    violatesShapeConstraint,
  );

  // Invalid: a non-succession row must carry listing ids, never company ids.
  await assert.rejects(
    db.insert(schema.instrumentRelationships).values({
      relationshipType: "related_instrument",
      sourceCompanyId: company.id,
      targetCompanyId: company.id,
    }),
    violatesShapeConstraint,
  );

  const rows = await db.select().from(schema.instrumentRelationships);
  assert.equal(rows.length, 1, "only the one valid row must have been persisted");
});

test("repair migration restores ledger tables skipped by a divergent historical 0067", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-migration-repair-"));
  const client = new PGlite(path.join(root, "pgdata"));
  t.after(async () => {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const migrationsFolder = path.resolve(process.cwd(), "migrations");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });

  // Reproduce a desktop database created by an earlier build: later migrations are
  // recorded, but the current 0067 ledger tables were never created.
  await client.exec('DROP TABLE project_ledger_events; DROP TABLE project_ledger_stream_heads;');
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string; when: number }> };
  const repair = journal.entries.find((entry) => entry.tag === "0074_lios_ledger_schema_repair");
  assert.ok(repair, "repair migration must be journaled");
  // Drizzle only applies journal entries newer than the last recorded one, so forget the repair AND everything after it.
  await client.query("delete from drizzle.__drizzle_migrations where created_at >= $1", [repair.when]);

  await migrate(db, { migrationsFolder });
  const tables = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename like 'project_ledger_%' order by tablename",
  );
  assert.deepEqual(tables.rows.map((row) => row.tablename), ["project_ledger_events", "project_ledger_stream_heads"]);
  const fks = await client.query<{ n: number }>("select count(*)::int as n from pg_constraint where contype = 'f' and conrelid::regclass::text in ('project_ledger_events', 'project_ledger_stream_heads')");
  assert.equal(fks.rows[0].n, 10);

  // Running the repair against a healthy schema must be a no-op.
  // Drizzle only applies journal entries newer than the last recorded one, so forget the repair AND everything after it.
  await client.query("delete from drizzle.__drizzle_migrations where created_at >= $1", [repair.when]);
  await migrate(db, { migrationsFolder });
});
