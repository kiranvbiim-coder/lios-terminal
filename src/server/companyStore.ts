/**
 * Write-through persistence for the companies/securities master table,
 * SEC filings metadata, and financial-statement periods (see
 * shared/schema.ts). Every provider that resolves a ticker to real data
 * (secEdgarData.ts, secEdgarFinancials.ts, financialDataProviders.ts) calls
 * into this module so those facts survive independently of each
 * provider's own disk cache -- this is what gives future work (Digital
 * Twin, knowledge graph) a stable companyId to key off instead of a raw
 * ticker string.
 *
 * Upserts are additive: a call with fewer known fields (e.g. a financial
 * report from a provider that doesn't know the CIK) never blanks out a
 * value a previous call already set, via coalesce-on-conflict.
 */
import { sql, eq, and, desc, isNotNull } from "drizzle-orm";
import { getDb, type DrizzleDb } from "./db";
import { companies, companyIdentifiers, companyListings, securities, secFilings, financialStatementPeriods } from "@shared/schema";
import type { EntityIdentityStatus, EntityLifecycleStatus, LegalEntityKind } from "@shared/globalInstrumentMaster";

// A globally unique identifier type (isin, figi, lei, provider) or a
// registry-scoped one: a company number only means something inside its
// registry + jurisdiction, so `registry_id` always carries its namespace.
export type CompanyIdentifierInput =
  | { type: "isin" | "figi" | "lei" | "provider"; value: string; primary?: boolean }
  | { type: "registry_id"; value: string; registry: string; jurisdiction?: string | null; primary?: boolean };

export interface CompanyUpsertInput {
  // `symbol` is the venue listing symbol, not necessarily the issuer's
  // canonical display symbol (GOOG and GOOGL are the motivating case).
  symbol: string;
  // Legal name when the caller really has one. Ticker-only providers omit it:
  // the row then gets the symbol as a flagged placeholder name that never
  // overwrites a real name and is replaced by the first real one.
  name?: string | null;
  cik?: string | null;
  // Explicit issuer binding for a secondary/alternate-symbol listing when a
  // provider cannot supply CIK. If omitted, a single existing CIK match is
  // used; if neither exists, symbol remains the new entity's display symbol.
  entitySymbol?: string | null;
  exchange?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
  assetClass?: "equity" | "etf" | "fund" | "bond" | "index" | "commodity" | "forex" | "crypto";
  mic?: string | null;
  currency?: string | null;
  source?: string;
  identifiers?: CompanyIdentifierInput[];
  // LV4-04-01/02: which share class this listing belongs to. Null (the
  // default) means "this entity's one undifferentiated security."
  shareClass?: string | null;
}

// LV4-04-01/02: resolves (or creates) the security row a listing belongs
// to. Two separate ON CONFLICT targets because securities has two partial
// unique indexes (Postgres cannot infer a partial index from a bare column
// list without repeating its exact predicate -- see shared/schema.ts's
// securities table comment).
async function upsertSecurity(
  companyId: number,
  shareClass: string | null,
  assetClass: NonNullable<CompanyUpsertInput["assetClass"]>,
  name: string,
  nameIsKnown: boolean,
): Promise<number> {
  const db = getDb();
  // A security created without a real name borrows the entity's name but never
  // overwrites a name an earlier call (or provider) already set.
  const nameOnConflict = nameIsKnown ? sql`excluded.name` : sql`${securities.name}`;
  if (shareClass) {
    const [row] = await db.insert(securities)
      .values({ companyId, shareClass, assetClass, name })
      .onConflictDoUpdate({
        target: [securities.companyId, securities.shareClass, securities.assetClass],
        targetWhere: sql`${securities.shareClass} IS NOT NULL`,
        set: { name: nameOnConflict, updatedAt: new Date() },
      })
      .returning();
    return row.id;
  }
  const [row] = await db.insert(securities)
    .values({ companyId, shareClass: null, assetClass, name })
    .onConflictDoUpdate({
      target: [securities.companyId, securities.assetClass],
      targetWhere: sql`${securities.shareClass} IS NULL`,
      set: { name: nameOnConflict, updatedAt: new Date() },
    })
    .returning();
  return row.id;
}

type CompanyRow = typeof companies.$inferSelect;

function providedName(input: Pick<CompanyUpsertInput, "name">): string | null {
  return input.name?.trim() || null;
}

function issuerBinding(input: CompanyUpsertInput, listingSymbol: string) {
  return {
    entitySymbol: input.entitySymbol?.trim().toUpperCase() || listingSymbol,
    cik: input.cik?.trim() || null,
  };
}

async function findExistingIssuer(
  entitySymbol: string,
  cik: string | null,
  listingSymbol: string,
): Promise<CompanyRow | null> {
  const db = getDb();
  const [companyBySymbol] = await db
    .select()
    .from(companies)
    .where(eq(companies.symbol, entitySymbol))
    .limit(1);
  const companiesByCik = cik
    ? await db.select().from(companies).where(eq(companies.cik, cik)).limit(2)
    : [];
  if (companiesByCik.length > 1) {
    throw new Error(`Cannot bind listing ${listingSymbol}: CIK ${cik} maps to multiple issuer rows.`);
  }

  const companyByCik = companiesByCik[0];
  if (companyBySymbol && companyByCik && companyBySymbol.id !== companyByCik.id) {
    throw new Error(
      `Cannot bind listing ${listingSymbol}: entity symbol ${entitySymbol} and CIK ${cik} resolve to different issuers.`,
    );
  }
  return companyBySymbol ?? companyByCik ?? null;
}

async function updateIssuer(existing: CompanyRow, input: CompanyUpsertInput, cik: string | null, entitySymbol: string) {
  const [row] = await getDb()
    .update(companies)
    .set({
      // A placeholder (ticker-as-name) never replaces a real name; a real name replaces a placeholder.
      // The first listing attached to a symbol-less entity gives it its legacy display symbol
      // (findExistingIssuer already proved no other issuer owns entitySymbol).
      symbol: existing.symbol ?? entitySymbol,
      name: providedName(input) ?? existing.name,
      nameIsPlaceholder: providedName(input) ? false : existing.nameIsPlaceholder,
      cik: cik ?? existing.cik,
      exchange: input.exchange?.trim() || existing.exchange,
      country: input.country?.trim() || existing.country,
      sector: input.sector?.trim() || existing.sector,
      industry: input.industry?.trim() || existing.industry,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, existing.id))
    .returning();
  return row;
}

async function createIssuer(entitySymbol: string, input: CompanyUpsertInput, cik: string | null) {
  const db = getDb();
  const values = {
    symbol: entitySymbol,
    name: providedName(input) ?? entitySymbol,
    nameIsPlaceholder: providedName(input) === null,
    cik,
    exchange: input.exchange?.trim() || null,
    country: input.country?.trim() || null,
    sector: input.sector?.trim() || null,
    industry: input.industry?.trim() || null,
    assetClass: input.assetClass ?? "equity",
  };

  if (cik) {
    const [inserted] = await db
      .insert(companies)
      .values(values)
      .onConflictDoNothing({
        target: companies.cik,
        where: sql`${companies.cik} IS NOT NULL`,
      })
      .returning();
    if (inserted) return inserted;

    // A competing first-seen listing inserted this CIK after the lookup in
    // resolveIssuerForListing(). The unique CIK index prevents the split;
    // re-read then update/reuse the winning issuer rather than forcing the
    // caller to retry a normal concurrent-ingestion race.
    const existing = await findExistingIssuer(entitySymbol, cik, entitySymbol);
    if (existing) return updateIssuer(existing, input, cik, entitySymbol);
    throw new Error(`Cannot bind listing ${entitySymbol}: CIK ${cik} conflicted but no issuer row was found.`);
  }

  const [row] = await db
    .insert(companies)
    .values(values)
    .onConflictDoUpdate({
      target: companies.symbol,
      set: {
        name: sql`case when excluded.name_is_placeholder and not ${companies.nameIsPlaceholder} then ${companies.name} else excluded.name end`,
        nameIsPlaceholder: sql`excluded.name_is_placeholder and ${companies.nameIsPlaceholder}`,
        cik: sql`coalesce(excluded.cik, ${companies.cik})`,
        exchange: sql`coalesce(excluded.exchange, ${companies.exchange})`,
        country: sql`coalesce(excluded.country, ${companies.country})`,
        sector: sql`coalesce(excluded.sector, ${companies.sector})`,
        industry: sql`coalesce(excluded.industry, ${companies.industry})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

async function resolveIssuerForListing(input: CompanyUpsertInput, listingSymbol: string) {
  const { entitySymbol, cik } = issuerBinding(input, listingSymbol);
  const existing = await findExistingIssuer(entitySymbol, cik, listingSymbol);
  return existing ? updateIssuer(existing, input, cik, entitySymbol) : createIssuer(entitySymbol, input, cik);
}

type IdentifierWrite = { type: "cik"; value: string; primary?: boolean } | CompanyIdentifierInput;

// Writes (type, namespace, value) -> company. Identifier values are upper-cased
// like every other identifier; a registry id is stored under its upper-cased
// registry + jurisdiction namespace, a globally unique type under ''.
async function persistIdentifiers(
  db: Pick<DrizzleDb, "insert">,
  companyId: number,
  source: string,
  identifiers: IdentifierWrite[],
): Promise<void> {
  for (const identifier of identifiers) {
    const value = identifier.value.trim().toUpperCase();
    if (!value) continue;
    const registry = identifier.type === "registry_id" ? identifier.registry.trim().toUpperCase() : "";
    if (identifier.type === "registry_id" && !registry) {
      throw new Error(`registry_id ${value} needs a registry: a registry number is only unique inside its registry.`);
    }
    const jurisdiction = identifier.type === "registry_id" ? identifier.jurisdiction?.trim().toUpperCase() ?? "" : "";
    const isPrimary = identifier.primary ?? false;
    await db.insert(companyIdentifiers).values({
      companyId,
      identifierType: identifier.type,
      identifier: value,
      registry,
      jurisdiction,
      source,
      isPrimary,
    }).onConflictDoUpdate({
      target: [companyIdentifiers.identifierType, companyIdentifiers.registry, companyIdentifiers.jurisdiction, companyIdentifiers.identifier],
      set: { companyId, source, isPrimary, updatedAt: new Date() },
    });
  }
}

export async function upsertCompany(input: CompanyUpsertInput): Promise<number> {
  const db = getDb();
  const symbol = input.symbol.trim().toUpperCase();
  const row = await resolveIssuerForListing(input, symbol);
  const exchange = input.exchange?.trim().toUpperCase() || "UNKNOWN";
  const source = input.source?.trim() || "limuria";
  const assetClass = input.assetClass ?? "equity";
  const securityId = await upsertSecurity(row.id, input.shareClass?.trim() || null, assetClass, providedName(input) ?? row.name, providedName(input) !== null);
  await db.insert(companyListings).values({
    companyId: row.id,
    securityId,
    symbol,
    exchange,
    mic: input.mic?.trim().toUpperCase() || null,
    currency: input.currency?.trim().toUpperCase() || null,
    country: input.country?.trim().toUpperCase() || null,
    assetClass,
    isPrimary: true,
    source,
  }).onConflictDoUpdate({
    target: [companyListings.symbol, companyListings.exchange],
    set: {
      companyId: row.id,
      securityId,
      mic: sql`coalesce(excluded.mic, ${companyListings.mic})`,
      currency: sql`coalesce(excluded.currency, ${companyListings.currency})`,
      country: sql`coalesce(excluded.country, ${companyListings.country})`,
      assetClass,
      isPrimary: true,
      source,
      updatedAt: new Date(),
    },
  });

  await persistIdentifiers(db, row.id, source, [
    ...(input.cik?.trim() ? [{ type: "cik" as const, value: input.cik, primary: true }] : []),
    ...(input.identifiers ?? []),
  ]);
  return row.id;
}

export interface EntityUpsertInput {
  // Update this exact entity. Omitted: the entity is found through its CIK /
  // identifiers, and when none matches a new provisional entity is created.
  // A name alone never merges two entities -- "Acme Ltd" is not an identity.
  id?: number;
  name: string;
  cik?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
  jurisdiction?: string | null;
  legalEntityKind?: LegalEntityKind | null;
  legalForm?: string | null;
  lifecycleStatus?: EntityLifecycleStatus;
  identityStatus?: EntityIdentityStatus;
  identifiers?: CompanyIdentifierInput[];
  source?: string;
}

/**
 * Creates or updates an entity that need not have a ticker: `symbol` stays NULL
 * and no security or listing is created. Listings/securities attach later
 * through upsertCompany (by CIK or entitySymbol) without changing the entity's
 * id. Facts that are not supplied are left as they are; nothing is inferred
 * (an entity without a listing is not thereby private, inactive or unlisted).
 * Identifiers that resolve to two different entities throw instead of merging.
 */
export async function upsertEntity(input: EntityUpsertInput): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new Error("An entity needs a name.");
  const cik = input.cik?.trim() || null;
  const source = input.source?.trim() || "limuria";
  const identifiers: IdentifierWrite[] = [
    ...(cik ? [{ type: "cik" as const, value: cik, primary: true }] : []),
    ...(input.identifiers ?? []),
  ];
  const facts = {
    country: input.country?.trim() || null,
    sector: input.sector?.trim() || null,
    industry: input.industry?.trim() || null,
    jurisdiction: input.jurisdiction?.trim().toUpperCase() || null,
    legalEntityKind: input.legalEntityKind ?? null,
    legalForm: input.legalForm?.trim() || null,
  };

  return getDb().transaction(async (tx) => {
    const matched = new Set<number>();
    if (input.id !== undefined) {
      const [byId] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, input.id)).limit(1);
      if (!byId) throw new Error(`Entity ${input.id} does not exist.`);
      matched.add(byId.id);
    }
    if (cik) {
      for (const row of await tx.select({ id: companies.id }).from(companies).where(eq(companies.cik, cik)).limit(2)) matched.add(row.id);
    }
    for (const identifier of identifiers) {
      const value = identifier.value.trim().toUpperCase();
      if (!value) continue;
      const registry = identifier.type === "registry_id" ? identifier.registry.trim().toUpperCase() : "";
      const jurisdiction = identifier.type === "registry_id" ? identifier.jurisdiction?.trim().toUpperCase() ?? "" : "";
      const owners = await tx.select({ companyId: companyIdentifiers.companyId }).from(companyIdentifiers).where(and(
        eq(companyIdentifiers.identifierType, identifier.type),
        eq(companyIdentifiers.registry, registry),
        eq(companyIdentifiers.jurisdiction, jurisdiction),
        eq(companyIdentifiers.identifier, value),
      )).limit(2);
      for (const owner of owners) matched.add(owner.companyId);
    }
    if (matched.size > 1) {
      throw new Error(`Cannot upsert entity "${name}": its id/CIK/identifiers belong to different entities (${[...matched].join(", ")}).`);
    }

    const [existingId] = matched;
    let entityId: number;
    if (existingId === undefined) {
      const [created] = await tx.insert(companies).values({
        symbol: null,
        name,
        cik,
        ...facts,
        lifecycleStatus: input.lifecycleStatus ?? "unknown",
        identityStatus: input.identityStatus ?? "provisional",
      }).returning();
      entityId = created.id;
    } else {
      const [existing] = await tx.select().from(companies).where(eq(companies.id, existingId)).limit(1);
      await tx.update(companies).set({
        name,
        nameIsPlaceholder: false,
        cik: cik ?? existing.cik,
        country: facts.country ?? existing.country,
        sector: facts.sector ?? existing.sector,
        industry: facts.industry ?? existing.industry,
        jurisdiction: facts.jurisdiction ?? existing.jurisdiction,
        legalEntityKind: facts.legalEntityKind ?? existing.legalEntityKind,
        legalForm: facts.legalForm ?? existing.legalForm,
        lifecycleStatus: input.lifecycleStatus ?? existing.lifecycleStatus,
        identityStatus: input.identityStatus ?? existing.identityStatus,
        updatedAt: new Date(),
      }).where(eq(companies.id, existingId));
      entityId = existingId;
    }
    await persistIdentifiers(tx, entityId, source, identifiers);
    return entityId;
  });
}

export interface FilingRecord {
  formType: string;
  accessionNumber: string;
  filedDate: string;
  filingUrl: string;
}

// Filed documents are immutable once accepted (same assumption secEdgarData.ts's
// disk cache already relies on) -- a conflict just means we've already recorded
// this exact filing, nothing to update.
export async function persistFilings(companyId: number, filings: FilingRecord[]): Promise<void> {
  if (filings.length === 0) return;
  const db = getDb();
  await db
    .insert(secFilings)
    .values(filings.map((f) => ({ companyId, formType: f.formType, accessionNumber: f.accessionNumber, filedDate: f.filedDate, filingUrl: f.filingUrl })))
    .onConflictDoNothing({ target: secFilings.accessionNumber });
}

export interface FinancialStatementPeriodInput {
  reportType: string;
  periodEnd: string;
  fiscalYear: string;
  period: string;
  reportedCurrency: string;
  data: Record<string, number>;
  filingDate: string | null;
  source: string;
}

export async function persistFinancialStatementPeriods(companyId: number, rows: FinancialStatementPeriodInput[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  for (const row of rows) {
    await db
      .insert(financialStatementPeriods)
      .values({ companyId, ...row })
      .onConflictDoUpdate({
        target: [financialStatementPeriods.companyId, financialStatementPeriods.reportType, financialStatementPeriods.periodEnd, financialStatementPeriods.period, financialStatementPeriods.source],
        set: { data: row.data, filingDate: row.filingDate, fetchedAt: new Date() },
      });
  }
}

// ── Read-back ────────────────────────────────────────────────────────────
// The write path above is called on every live fetch; these let a caller
// read what's already durably persisted -- used both to serve a dedicated
// "what has this company filed" query and as a fallback when the live SEC
// API is unreachable or rate-limited (the disk cache in secEdgarData.ts is
// ephemeral and TTL-bound, this survives independently of it).

export async function getCompanyBySymbol(symbol: string) {
  const db = getDb();
  const [row] = await db.select().from(companies).where(eq(companies.symbol, symbol.toUpperCase())).limit(1);
  return row ?? null;
}

// Real bulk sector/industry lookup for peer discovery -- backed by the
// backfill in script/fetch_sectors_yfinance.py + script/fetch_bse_sectors_
// yfinance.py (real yfinance company data, not a synthetic label), written
// to this table by script/backfill_sectors_to_db.ts. Only
// rows with a real sector populated are useful for peer matching, so
// filtered here rather than leaving the caller to guard against nulls.
export async function getCompaniesWithSectorIndustry(): Promise<Array<{ symbol: string; sector: string; industry: string }>> {
  const db = getDb();
  const rows = await db
    .select({ symbol: companies.symbol, sector: companies.sector, industry: companies.industry })
    .from(companies)
    .where(and(isNotNull(companies.sector), isNotNull(companies.symbol), eq(companies.assetClass, "equity")));
  return rows
    .flatMap((r) => (r.sector && r.symbol ? [{ symbol: r.symbol, sector: r.sector, industry: r.industry ?? "" }] : []));
}

export async function getFilingsForSymbol(symbol: string, limit = 40) {
  const company = await getCompanyBySymbol(symbol);
  if (!company) return [];
  return getFilingsForCompanyId(company.id, limit);
}

/** Same filing store, keyed by the resolved entity for companies without listings. */
export async function getFilingsForCompanyId(companyId: number, limit = 40) {
  const db = getDb();
  return db
    .select()
    .from(secFilings)
    .where(eq(secFilings.companyId, companyId))
    .orderBy(desc(secFilings.filedDate))
    .limit(limit);
}

export async function getFinancialStatementPeriodsForSymbol(symbol: string, reportType?: string) {
  const company = await getCompanyBySymbol(symbol);
  if (!company) return [];
  const db = getDb();
  const conditions = reportType
    ? and(eq(financialStatementPeriods.companyId, company.id), eq(financialStatementPeriods.reportType, reportType))
    : eq(financialStatementPeriods.companyId, company.id);
  return db
    .select()
    .from(financialStatementPeriods)
    .where(conditions)
    .orderBy(desc(financialStatementPeriods.periodEnd));
}
