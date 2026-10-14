import { and, eq, ilike, inArray, or } from "drizzle-orm";
import {
  companies,
  companyIdentifiers,
  companyListings,
  instrumentRelationships,
  securities,
} from "@shared/schema";
import {
  formatLiosId,
  resolveInstrument,
  type EntityIdentityStatus,
  type EntityLifecycleStatus,
  type EntityProfile,
  type InstrumentIdentifier,
  type InstrumentIdentifierType,
  type InstrumentLifecycleStatus,
  type InstrumentMasterCandidate,
  type InstrumentProviderFallback,
  type InstrumentResolutionQuery,
  type InstrumentResolutionResult,
  type LegalEntityKind,
  type RelatedInstrumentLink,
} from "@shared/globalInstrumentMaster";
import { getDb } from "./db";

type CompanyRow = typeof companies.$inferSelect;
type ListingRow = typeof companyListings.$inferSelect;
type IdentifierRow = typeof companyIdentifiers.$inferSelect;
type RelationshipRow = typeof instrumentRelationships.$inferSelect;
type SecurityRow = typeof securities.$inferSelect;

export interface PersistedInstrumentMasterRows {
  companies: CompanyRow[];
  listings: ListingRow[];
  identifiers: IdentifierRow[];
  /** Optional for backward compatibility with existing pure-fixture callers
   * that predate LV4-04-06 -- omitted or empty means no relationship data
   * (predecessor/successor/related-instrument fields stay empty arrays). */
  relationships?: RelationshipRow[];
  /** Optional for backward compatibility with existing pure-fixture callers
   * that predate LV4-04-01/02 -- omitted or empty means shareClass stays
   * null on every candidate rather than throwing on a missing join. */
  securities?: SecurityRow[];
}

const MAX_LOCAL_ENTITY_MATCHES = 100;

function normalizeLookup(value: string): string {
  return value.trim().toUpperCase();
}

function escapeLikePrefix(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function identifierTypeToStorage(type: InstrumentIdentifierType): string {
  return type === "provider_id" ? "provider" : type;
}

function identifierTypeFromStorage(type: string): InstrumentIdentifierType {
  switch (type.trim().toLowerCase()) {
    case "ticker":
      return "ticker";
    case "provider":
    case "provider_id":
      return "provider_id";
    case "figi":
      return "figi";
    case "composite_figi":
      return "composite_figi";
    case "share_class_figi":
      return "share_class_figi";
    case "lei":
      return "lei";
    case "isin":
      return "isin";
    case "cik":
      return "cik";
    case "sedol":
      return "sedol";
    case "cusip":
      return "cusip";
    case "registry_id":
      return "registry_id";
    default:
      return "other";
  }
}

function lifecycleFromListing(
  listing: Pick<ListingRow, "validTo">,
  asOf: Date,
): InstrumentLifecycleStatus {
  if (!listing.validTo) return "active";
  const validTo = new Date(`${listing.validTo}T23:59:59.999Z`);
  if (Number.isNaN(validTo.getTime())) return "delisted";
  return validTo.getTime() < asOf.getTime() ? "delisted" : "active";
}

function identifierFromRow(row: IdentifierRow): InstrumentIdentifier {
  return {
    type: identifierTypeFromStorage(row.identifierType),
    value: row.identifier,
    provider: row.source,
    // '' is the persisted "globally unique type" namespace; expose it as absent.
    registry: row.registry || null,
    jurisdiction: row.jurisdiction || null,
    validFrom: row.validFrom,
    validTo: row.validTo,
    isPrimary: row.isPrimary,
  };
}

function entityProfileFromRow(company: CompanyRow): EntityProfile {
  return {
    jurisdiction: company.jurisdiction,
    legalEntityKind: company.legalEntityKind as LegalEntityKind | null,
    legalForm: company.legalForm,
    lifecycleStatus: company.lifecycleStatus as EntityLifecycleStatus,
    identityStatus: company.identityStatus as EntityIdentityStatus,
    nameIsPlaceholder: company.nameIsPlaceholder,
  };
}

/**
 * An entity with no listing has no listing lifecycle. Only an explicit,
 * terminal entity lifecycle makes the row historical for ranking; 'unknown'
 * and non-terminal states stay non-historical so the entity remains
 * resolvable, while the honest entity lifecycle is exposed on `entity`.
 */
function lifecycleFromEntity(company: Pick<CompanyRow, "lifecycleStatus">): InstrumentLifecycleStatus {
  switch (company.lifecycleStatus) {
    case "merged":
      return "merged";
    case "acquired":
      return "acquired";
    case "dissolved":
      return "expired";
    default:
      return "active";
  }
}

/**
 * Converts the existing companies/listings/identifiers persistence model into
 * the provider-neutral V4 resolver contract. This is intentionally pure so it
 * can be regression-tested without a database.
 *
 * LV4-04-01/02: securityId is now real (every listing has a persisted
 * security via its FK). instrumentId stays permanently null -- a fourth
 * "instrument" layer below listing is a deliberate, documented scope
 * boundary (see shared/schema.ts's securities table comment), not a gap.
 */
export function materializeInstrumentMasterCandidates(
  rows: PersistedInstrumentMasterRows,
  asOf: Date = new Date(),
): InstrumentMasterCandidate[] {
  const companyById = new Map(rows.companies.map((company) => [company.id, company]));
  const securityById = new Map((rows.securities ?? []).map((security) => [security.id, security]));
  const identifiersByCompany = new Map<number, IdentifierRow[]>();
  for (const identifier of rows.identifiers) {
    const existing = identifiersByCompany.get(identifier.companyId) ?? [];
    existing.push(identifier);
    identifiersByCompany.set(identifier.companyId, existing);
  }

  const listingsByCompany = new Map<number, ListingRow[]>();
  for (const listing of rows.listings) {
    const existing = listingsByCompany.get(listing.companyId) ?? [];
    existing.push(listing);
    listingsByCompany.set(listing.companyId, existing);
  }

  // LV4-04-06/LV4-04-07: index relationship rows both ways so either side of
  // an edge surfaces it. adr_gdr/related_instrument are listing-keyed;
  // succession is company-keyed (predecessor -> successor), matching the
  // instrument_relationships_listing_or_company_shape CHECK constraint.
  const relatedInstrumentsByListing = new Map<number, RelatedInstrumentLink[]>();
  const predecessorEntityIdsByCompany = new Map<number, string[]>();
  const successorEntityIdsByCompany = new Map<number, string[]>();

  for (const relationship of rows.relationships ?? []) {
    if (relationship.relationshipType === "succession") {
      if (relationship.sourceCompanyId == null || relationship.targetCompanyId == null) continue;

      const successorsForPredecessor = successorEntityIdsByCompany.get(relationship.sourceCompanyId) ?? [];
      successorsForPredecessor.push(formatLiosId("entity", relationship.targetCompanyId));
      successorEntityIdsByCompany.set(relationship.sourceCompanyId, successorsForPredecessor);

      const predecessorsForSuccessor = predecessorEntityIdsByCompany.get(relationship.targetCompanyId) ?? [];
      predecessorsForSuccessor.push(formatLiosId("entity", relationship.sourceCompanyId));
      predecessorEntityIdsByCompany.set(relationship.targetCompanyId, predecessorsForSuccessor);
      continue;
    }

    if (relationship.sourceListingId == null || relationship.targetListingId == null) continue;
    const relationshipType = relationship.relationshipType;

    const linksFromSource = relatedInstrumentsByListing.get(relationship.sourceListingId) ?? [];
    linksFromSource.push({
      listingId: formatLiosId("listing", relationship.targetListingId),
      relationshipType,
      ratio: relationship.ratio,
    });
    relatedInstrumentsByListing.set(relationship.sourceListingId, linksFromSource);

    const linksFromTarget = relatedInstrumentsByListing.get(relationship.targetListingId) ?? [];
    linksFromTarget.push({
      listingId: formatLiosId("listing", relationship.sourceListingId),
      relationshipType,
      ratio: relationship.ratio,
    });
    relatedInstrumentsByListing.set(relationship.targetListingId, linksFromTarget);
  }

  const candidates: InstrumentMasterCandidate[] = [];
  for (const company of rows.companies) {
    const companyIdentifiersForEntity = (identifiersByCompany.get(company.id) ?? []).map(identifierFromRow);
    if (company.cik && !companyIdentifiersForEntity.some(
      (identifier) => identifier.type === "cik" && normalizeLookup(identifier.value) === normalizeLookup(company.cik!),
    )) {
      companyIdentifiersForEntity.push({
        type: "cik",
        value: company.cik,
        provider: "sec_edgar",
        isPrimary: true,
      });
    }

    const predecessorEntityIds = predecessorEntityIdsByCompany.get(company.id) ?? [];
    const successorEntityIds = successorEntityIdsByCompany.get(company.id) ?? [];

    const entity = entityProfileFromRow(company);
    const persistedListings = listingsByCompany.get(company.id) ?? [];
    if (persistedListings.length === 0) {
      // An entity without a listing. With a legacy symbol (a pre-listing-
      // backfill row) the symbol is still reported as a ticker; without one
      // there is no symbol, no ticker identifier, no primary listing -- a
      // ticker is never invented for a row that has none.
      candidates.push({
        entityId: formatLiosId("entity", company.id),
        securityId: null,
        listingId: null,
        instrumentId: null,
        name: company.name,
        symbol: company.symbol,
        entity,
        exchange: company.exchange,
        mic: null,
        countryCode: company.country,
        currency: null,
        isPrimaryListing: company.symbol !== null,
        lifecycleStatus: lifecycleFromEntity(company),
        identifiers: [
          ...(company.symbol
            ? [{ type: "ticker" as const, value: company.symbol, provider: "legacy_company_row", isPrimary: true }]
            : []),
          ...companyIdentifiersForEntity,
        ],
        aliases: [],
        relatedInstruments: [],
        predecessorEntityIds,
        successorEntityIds,
        source: company.symbol ? "legacy_company_row" : "entity_record",
        canonical: true,
      });
      continue;
    }

    for (const listing of persistedListings) {
      // The migrated DB constraint makes securityId non-null in real rows.
      // Keep this pure mapper honest for stale fixtures or a corrupted
      // hand-built input: no persisted security id means no security id in
      // the candidate, never the bogus string "lios:security:undefined".
      const persistedSecurityId = listing.securityId ?? null;
      const security = persistedSecurityId === null ? undefined : securityById.get(persistedSecurityId);
      candidates.push({
        entityId: formatLiosId("entity", company.id),
        securityId: persistedSecurityId === null ? null : formatLiosId("security", persistedSecurityId),
        listingId: formatLiosId("listing", listing.id),
        instrumentId: null,
        name: company.name,
        symbol: listing.symbol,
        entity,
        exchange: listing.exchange,
        mic: listing.mic,
        countryCode: listing.country ?? company.country,
        currency: listing.currency,
        // LV4-04-01/02: shareClass now comes from the listing's parent
        // security, not a free-text column on the listing itself -- see
        // shared/schema.ts's securities table comment for why. `security`
        // can be undefined for fixture/test rows that predate this join
        // (PersistedInstrumentMasterRows.securities is optional for
        // backward compatibility, same pattern as .relationships).
        shareClass: security?.shareClass ?? null,
        isPrimaryListing: listing.isPrimary,
        lifecycleStatus: lifecycleFromListing(listing, asOf),
        validFrom: listing.validFrom,
        validTo: listing.validTo,
        identifiers: [
          {
            type: "ticker",
            value: listing.symbol,
            provider: listing.source,
            validFrom: listing.validFrom,
            validTo: listing.validTo,
            isPrimary: listing.isPrimary,
          },
          ...companyIdentifiersForEntity,
        ],
        aliases: [],
        relatedInstruments: relatedInstrumentsByListing.get(listing.id) ?? [],
        predecessorEntityIds,
        successorEntityIds,
        source: listing.source,
        canonical: true,
      });
    }
  }

  // Defensive integrity filter: a corrupt orphan listing/identifier must not
  // manufacture an entity candidate. FK constraints should already prevent
  // this in PostgreSQL, but the pure mapper can receive fixtures/import rows.
  return candidates.filter((candidate) => {
    const rawId = candidate.entityId?.split(":").at(-1);
    return rawId ? companyById.has(Number(rawId)) : false;
  });
}

async function collectCompanyIds(query: InstrumentResolutionQuery): Promise<number[]> {
  const db = getDb();
  const ids = new Set<number>();

  if (query.ticker?.trim()) {
    const ticker = normalizeLookup(query.ticker);
    const listingRows = await db
      .select({ companyId: companyListings.companyId })
      .from(companyListings)
      .where(eq(companyListings.symbol, ticker))
      .limit(MAX_LOCAL_ENTITY_MATCHES);
    for (const row of listingRows) ids.add(row.companyId);

    // Transitional compatibility for pre-0021 rows that may not yet have a
    // listing backfill. New code still resolves to the persisted company id.
    const companyRows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.symbol, ticker))
      .limit(MAX_LOCAL_ENTITY_MATCHES);
    for (const row of companyRows) ids.add(row.id);
  }

  if (query.name?.trim()) {
    const prefix = `${escapeLikePrefix(query.name.trim())}%`;
    const rows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(ilike(companies.name, prefix))
      .limit(MAX_LOCAL_ENTITY_MATCHES);
    for (const row of rows) ids.add(row.id);
  }

  if (query.identifier) {
    if (query.identifier.type === "ticker") {
      const ticker = normalizeLookup(query.identifier.value);
      const rows = await db
        .select({ companyId: companyListings.companyId })
        .from(companyListings)
        .where(eq(companyListings.symbol, ticker))
        .limit(MAX_LOCAL_ENTITY_MATCHES);
      for (const row of rows) ids.add(row.companyId);
    } else if (query.identifier.type !== "registry_id" || query.identifier.registry?.trim()) {
      // A registry_id without a registry is meaningless (scoreCandidate rejects it too):
      // no lookup instead of a scan across every registry.
      const storageType = identifierTypeToStorage(query.identifier.type);
      const value = normalizeLookup(query.identifier.value);
      const conditions = [
        eq(companyIdentifiers.identifierType, storageType),
        eq(companyIdentifiers.identifier, value),
      ];
      if (query.identifier.provider?.trim()) conditions.push(eq(companyIdentifiers.source, query.identifier.provider.trim()));
      if (query.identifier.type === "registry_id") {
        conditions.push(eq(companyIdentifiers.registry, normalizeLookup(query.identifier.registry!)));
        if (query.identifier.jurisdiction?.trim()) {
          conditions.push(eq(companyIdentifiers.jurisdiction, normalizeLookup(query.identifier.jurisdiction)));
        }
      }
      const condition = and(...conditions);
      const rows = await db
        .select({ companyId: companyIdentifiers.companyId })
        .from(companyIdentifiers)
        .where(condition)
        .limit(MAX_LOCAL_ENTITY_MATCHES);
      for (const row of rows) ids.add(row.companyId);
    }
  }

  if (query.providerId?.value.trim()) {
    const rows = await db
      .select({ companyId: companyIdentifiers.companyId })
      .from(companyIdentifiers)
      .where(and(
        eq(companyIdentifiers.identifierType, "provider"),
        eq(companyIdentifiers.identifier, normalizeLookup(query.providerId.value)),
        eq(companyIdentifiers.source, query.providerId.provider.trim()),
      ))
      .limit(MAX_LOCAL_ENTITY_MATCHES);
    for (const row of rows) ids.add(row.companyId);
  }

  return [...ids].slice(0, MAX_LOCAL_ENTITY_MATCHES);
}

/**
 * A relationship row references either two listings (adr_gdr/related_instrument)
 * or two companies (succession), so "relevant to these companies" means the
 * company id appears directly, or one of its own listing ids appears as
 * either side of a listing-keyed edge.
 */
async function loadRelationshipsForCompanies(companyIds: number[]): Promise<RelationshipRow[]> {
  if (companyIds.length === 0) return [];
  const db = getDb();

  const listingRows = await db
    .select({ id: companyListings.id })
    .from(companyListings)
    .where(inArray(companyListings.companyId, companyIds));
  const listingIds = listingRows.map((row) => row.id);

  const conditions = [
    inArray(instrumentRelationships.sourceCompanyId, companyIds),
    inArray(instrumentRelationships.targetCompanyId, companyIds),
  ];
  if (listingIds.length > 0) {
    conditions.push(inArray(instrumentRelationships.sourceListingId, listingIds));
    conditions.push(inArray(instrumentRelationships.targetListingId, listingIds));
  }

  return db.select().from(instrumentRelationships).where(or(...conditions));
}

/** Load the minimal persisted identity neighborhood needed for one lookup. */
export async function loadPersistedInstrumentCandidates(
  query: InstrumentResolutionQuery,
): Promise<InstrumentMasterCandidate[]> {
  const ids = await collectCompanyIds(query);
  if (ids.length === 0) return [];

  const db = getDb();
  const [companyRows, listingRows, identifierRows, relationshipRows, securityRows] = await Promise.all([
    db.select().from(companies).where(inArray(companies.id, ids)),
    db.select().from(companyListings).where(inArray(companyListings.companyId, ids)),
    db.select().from(companyIdentifiers).where(inArray(companyIdentifiers.companyId, ids)),
    loadRelationshipsForCompanies(ids),
    db.select().from(securities).where(inArray(securities.companyId, ids)),
  ]);

  return materializeInstrumentMasterCandidates({
    companies: companyRows,
    listings: listingRows,
    identifiers: identifierRows,
    relationships: relationshipRows,
    securities: securityRows,
  });
}

/**
 * Loads every persisted candidate for building a full-universe artifact
 * (e.g. instrumentSearchIndexStore.ts's search index) rather than the
 * bounded, query-scoped set loadPersistedInstrumentCandidates returns.
 * Callers resolving a single lookup should use
 * loadPersistedInstrumentCandidates instead -- this has no MAX_LOCAL_ENTITY_MATCHES
 * cap and is meant to run rarely (index (re)build), not per request.
 */
export async function loadAllPersistedInstrumentCandidates(): Promise<InstrumentMasterCandidate[]> {
  const db = getDb();
  const [companyRows, listingRows, identifierRows, relationshipRows, securityRows] = await Promise.all([
    db.select().from(companies),
    db.select().from(companyListings),
    db.select().from(companyIdentifiers),
    db.select().from(instrumentRelationships),
    db.select().from(securities),
  ]);

  return materializeInstrumentMasterCandidates({
    companies: companyRows,
    listings: listingRows,
    identifiers: identifierRows,
    relationships: relationshipRows,
    securities: securityRows,
  });
}

/**
 * Resolve through the durable local master first, with an optional provider
 * adapter only when no local identity exists. Provider fallback never masks a
 * local ambiguity and does not auto-persist an unverified external identity.
 */
export async function resolvePersistedInstrument(
  query: InstrumentResolutionQuery,
  fallback?: InstrumentProviderFallback,
): Promise<InstrumentResolutionResult> {
  const localCandidates = await loadPersistedInstrumentCandidates(query);
  return resolveInstrument(query, localCandidates, fallback);
}
