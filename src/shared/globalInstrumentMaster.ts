/**
 * LiOS V4 Global Entity & Instrument Master contracts.
 *
 * This module deliberately sits above provider/ticker conventions. Persisted
 * entity/listing/instrument identifiers are the durable identity; a ticker is
 * only one lookup key and is always interpreted in venue/time context.
 *
 * The existing database tables (`companies`, `company_listings`, and
 * `company_identifiers`) remain the storage foundation. This module provides
 * the provider-neutral resolver/ranking contract that all new global market
 * features can share without introducing a second identity system.
 */

export const CANONICAL_ID_KINDS = ["entity", "security", "listing", "instrument"] as const;
export type CanonicalIdKind = (typeof CANONICAL_ID_KINDS)[number];

/**
 * Canonical IDs are derived from immutable persisted record IDs, never from a
 * mutable ticker/name. Prefixing makes accidental cross-kind joins visible.
 */
export function formatLiosId(kind: CanonicalIdKind, persistedId: string | number): string {
  const value = String(persistedId).trim();
  if (!value) throw new Error(`Cannot create ${kind} id from an empty persisted id`);
  return `lios:${kind}:${value}`;
}

export const INSTRUMENT_IDENTIFIER_TYPES = [
  "ticker",
  "provider_id",
  // LV4-04-05: FIGI family granularity, per OpenFIGI's own three-level
  // hierarchy -- "figi" here means the trading-venue/individual-listing
  // level FIGI (one per venue). "composite_figi" groups the individual
  // FIGIs of one security within a single country/exchange-composite
  // (e.g. all US venues of one security share a Composite FIGI).
  // "share_class_figi" sits above both -- one per share class, globally,
  // spanning composites/countries. Three distinct identifiers for the same
  // instrument at different aggregation levels, not three names for one
  // thing -- storing them under one collapsed "figi" type would lose which
  // level a given value actually resolves at.
  "figi",
  "composite_figi",
  "share_class_figi",
  "lei",
  "isin",
  "cik",
  "sedol",
  "cusip",
  // CA-03: a registry-scoped identifier (company number, registration id,
  // GLEIF/OpenCorporates-style record id). Never meaningful alone: it is
  // always qualified by `registry` (+ optional `jurisdiction`), so adding a
  // country or registry needs data, not a new identifier type.
  "registry_id",
  "other",
] as const;
export type InstrumentIdentifierType = (typeof INSTRUMENT_IDENTIFIER_TYPES)[number];

export const INSTRUMENT_LIFECYCLE_STATUSES = [
  "active",
  "suspended",
  "delisted",
  "expired",
  "merged",
  "acquired",
  "renamed",
  "relisted",
] as const;
export type InstrumentLifecycleStatus = (typeof INSTRUMENT_LIFECYCLE_STATUSES)[number];

// CA-03: entity-level attributes, separate from any listing's lifecycle. A
// private company, a fund manager or a provisional entity named in
// conversation has an entity profile and no listing at all. Defaults are the
// honest ones -- nothing is inferred from a name or from a missing ticker.
export const LEGAL_ENTITY_KINDS = [
  "corporation",
  "partnership",
  "limited_liability_company",
  "trust",
  "fund",
  "sovereign",
  "government_agency",
  "nonprofit",
  "individual",
  "other",
] as const;
export type LegalEntityKind = (typeof LEGAL_ENTITY_KINDS)[number];

export const ENTITY_LIFECYCLE_STATUSES = [
  "unknown",
  "active",
  "inactive",
  "dissolved",
  "merged",
  "acquired",
  "insolvent",
] as const;
export type EntityLifecycleStatus = (typeof ENTITY_LIFECYCLE_STATUSES)[number];

export const ENTITY_IDENTITY_STATUSES = ["provisional", "verified"] as const;
export type EntityIdentityStatus = (typeof ENTITY_IDENTITY_STATUSES)[number];

export interface EntityProfile {
  /** Legal domicile (ISO 3166-1/-2). Null = not known; never derived from a ticker suffix or name. */
  jurisdiction: string | null;
  legalEntityKind: LegalEntityKind | null;
  /** Jurisdiction-specific legal form (GmbH, Ltd, GLEIF ELF code). */
  legalForm: string | null;
  lifecycleStatus: EntityLifecycleStatus;
  identityStatus: EntityIdentityStatus;
  /** True when `name` is a ticker/slug stand-in an ingestion provider wrote because it had no legal name. */
  nameIsPlaceholder: boolean;
}

const HISTORICAL_STATUSES = new Set<InstrumentLifecycleStatus>([
  "delisted",
  "expired",
  "merged",
  "acquired",
  "renamed",
]);

export interface InstrumentIdentifier {
  type: InstrumentIdentifierType;
  value: string;
  provider?: string | null;
  /** Issuing registry; required for `registry_id`, absent for globally unique types. */
  registry?: string | null;
  /** Jurisdiction the registry id is scoped to (registry_id only). */
  jurisdiction?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  isPrimary?: boolean;
}

export interface InstrumentAlias {
  value: string;
  kind: "name" | "ticker";
  mic?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

/**
 * LV4-04-06: a typed link to another security -- an ADR/GDR's underlying
 * ordinary listing, or a generic economically-related instrument (e.g. a
 * warrant). `listingId` is the durable LiOS listing id of the other side;
 * `ratio` carries an ADR/GDR conversion ratio when known (e.g. "1:2") and is
 * left null for a plain related_instrument link.
 */
export interface RelatedInstrumentLink {
  listingId: string;
  relationshipType: "adr_gdr" | "related_instrument";
  ratio?: string | null;
}

export interface InstrumentMasterCandidate {
  /** Stable persisted LiOS entity identity. Null only for an unlinked legacy row. */
  entityId: string | null;
  /** Stable persisted LiOS security identity (entity/share-class level).
   * Null only for an unlinked legacy row or an entity predating listing backfill. */
  securityId?: string | null;
  /** Stable persisted LiOS listing identity (security/venue level). */
  listingId: string | null;
  /** Reserved for a future, genuinely distinct non-listing tradable-contract
   * layer (derivatives, warrants, etc.). The confirmed V4 model is the real
   * three-layer hierarchy entity -> security -> listing, so this remains null
   * by design rather than inventing an unused fourth table. */
  instrumentId?: string | null;

  name: string;
  /** Listing symbol. Absent/null for an entity (or security) without a listing -- a ticker is never required and never invented. */
  symbol?: string | null;
  exchange?: string | null;
  mic?: string | null;
  countryCode?: string | null;
  currency?: string | null;
  /** Entity-level facts (jurisdiction, kind, lifecycle, identity confidence). Absent for catalog-only/legacy rows that have no persisted entity. */
  entity?: EntityProfile;
  /** Which class this specific listing represents (e.g. "A" / "C" for
   * GOOGL/GOOG). Distinct listings of the same entityId are already grouped
   * by that shared entity id; this field only labels which class one is. */
  shareClass?: string | null;
  isPrimaryListing: boolean;
  lifecycleStatus: InstrumentLifecycleStatus;
  validFrom?: string | null;
  validTo?: string | null;

  identifiers: InstrumentIdentifier[];
  aliases?: InstrumentAlias[];
  predecessorEntityIds?: string[];
  successorEntityIds?: string[];
  relatedInstruments?: RelatedInstrumentLink[];

  /** Provider/source supplying the candidate; identity itself remains LiOS-owned. */
  source?: string | null;
  /** False means a compatibility row still needs linking to persisted LiOS IDs. */
  canonical: boolean;
}

export interface InstrumentResolutionQuery {
  name?: string;
  ticker?: string;
  mic?: string;
  exchange?: string;
  identifier?: {
    type: InstrumentIdentifierType;
    value: string;
    provider?: string;
    /** Required with `registry_id`. */
    registry?: string;
    /** Optional with `registry_id`; omitted, a number that exists in several jurisdictions surfaces as ambiguous. */
    jurisdiction?: string;
  };
  providerId?: {
    provider: string;
    value: string;
  };
  includeHistorical?: boolean;
  // LV4-04-13: "what was true as of this date" (e.g. backtest point-in-time
  // research), distinct from includeHistorical's "besides what's current
  // today, also show what has since become historical." ISO date
  // (YYYY-MM-DD), same convention as InstrumentMasterCandidate's own
  // validFrom/validTo. When set, this entirely supersedes includeHistorical
  // -- filtering becomes "was this candidate's validity window open on this
  // date", which is a stricter, date-anchored question that a binary
  // current/historical toggle cannot answer on its own.
  asOfDate?: string;
}

export type InstrumentResolutionStatus = "resolved" | "ambiguous" | "not_found";

export interface RankedInstrumentCandidate {
  candidate: InstrumentMasterCandidate;
  score: number;
  reasons: string[];
}

export interface InstrumentResolutionResult {
  status: InstrumentResolutionStatus;
  query: InstrumentResolutionQuery;
  match: InstrumentMasterCandidate | null;
  candidates: RankedInstrumentCandidate[];
  source: "local" | "provider_fallback" | "none";
}

export interface InstrumentProviderFallback {
  resolve(query: InstrumentResolutionQuery): Promise<InstrumentMasterCandidate[]>;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

const LEGAL_NAME_SUFFIXES = /\s+(?:INC\.?|INCORPORATED|CORP\.?|CORPORATION|COMPANY|CO\.?|LTD\.?|LIMITED|PLC|LLC|L\.L\.C\.?|N\.?V\.?|S\.?A\.?|AG|SE|CLASS [A-Z]|COMMON STOCK|ORDINARY SHARES)$/;

/** Name comparison key: "Apple Inc." and "apple company" both reduce to "APPLE". */
function companyNameKey(value: string | null | undefined): string {
  let key = normalizeText(value).replace(/[,]/g, "");
  for (let i = 0; i < 3; i += 1) {
    const stripped = key.replace(LEGAL_NAME_SUFFIXES, "");
    if (stripped === key) break;
    key = stripped;
  }
  return key;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

function isHistorical(candidate: InstrumentMasterCandidate): boolean {
  return HISTORICAL_STATUSES.has(candidate.lifecycleStatus) || Boolean(candidate.validTo);
}

// LV4-04-13: date-only comparisons, matching lifecycleFromListing's own
// validTo-inclusive-through-end-of-day convention
// (globalInstrumentMasterStore.ts). Midday UTC for asOfDate itself avoids
// timezone-boundary ambiguity on a date-only (no time component) input.
function parseDateOnlyTime(value: string, timeOfDay: string): number | null {
  const time = new Date(`${value}T${timeOfDay}`).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Was this candidate's persisted validity window open on asOfDate? Malformed
 * dates (on either side) fail the check rather than being treated as an
 * open/unbounded match -- an unparseable date is an explicit "cannot
 * determine", never silently "yes". A candidate with neither validFrom nor
 * validTo set (e.g. the bundled legacy ticker catalog, which never carries
 * temporal metadata at all) has zero information to verify a point-in-time
 * claim against, so it fails closed too -- treating unknown temporal bounds
 * as "valid at every possible date" would make asOfDate:"1800-01-01" match
 * a candidate we know nothing about, defeating the feature's entire
 * backtest purpose. This is deliberately distinct from a candidate with
 * only ONE of the two fields set, which legitimately means open-ended
 * (still active, or unknown start predating our records) rather than
 * "unknown".
 */
function isValidAsOf(candidate: InstrumentMasterCandidate, asOfDate: string): boolean {
  const asOf = parseDateOnlyTime(asOfDate, "12:00:00.000Z");
  if (asOf === null) return false;
  if (!candidate.validFrom && !candidate.validTo) return false;

  if (candidate.validFrom) {
    const from = parseDateOnlyTime(candidate.validFrom, "00:00:00.000Z");
    if (from === null || asOf < from) return false;
  }
  if (candidate.validTo) {
    const to = parseDateOnlyTime(candidate.validTo, "23:59:59.999Z");
    if (to === null || asOf > to) return false;
  }
  return true;
}

function hasExactIdentifier(
  candidate: InstrumentMasterCandidate,
  type: InstrumentIdentifierType,
  value: string,
  provider?: string,
  namespace?: { registry?: string; jurisdiction?: string },
): boolean {
  const expected = normalizeIdentifier(value);
  const expectedProvider = provider ? normalizeText(provider) : null;
  // A registry number means nothing outside its registry: a registry_id lookup
  // without a registry matches nothing instead of guessing across registries.
  const expectedRegistry = namespace?.registry ? normalizeText(namespace.registry) : null;
  if (type === "registry_id" && !expectedRegistry) return false;
  const expectedJurisdiction = namespace?.jurisdiction ? normalizeText(namespace.jurisdiction) : null;
  return candidate.identifiers.some((identifier) => {
    if (identifier.type !== type || normalizeIdentifier(identifier.value) !== expected) return false;
    if (expectedProvider && normalizeText(identifier.provider) !== expectedProvider) return false;
    if (type !== "registry_id") return true;
    if (normalizeText(identifier.registry) !== expectedRegistry) return false;
    return !expectedJurisdiction || normalizeText(identifier.jurisdiction) === expectedJurisdiction;
  });
}

function scoreCandidate(
  candidate: InstrumentMasterCandidate,
  query: InstrumentResolutionQuery,
): RankedInstrumentCandidate | null {
  const reasons: string[] = [];
  let score = 0;
  let matchedLookup = false;

  if (query.identifier) {
    if (!hasExactIdentifier(
      candidate,
      query.identifier.type,
      query.identifier.value,
      query.identifier.provider,
      query.identifier,
    )) return null;
    score += 1200;
    matchedLookup = true;
    reasons.push(`exact ${query.identifier.type} identifier`);
  }

  if (query.providerId) {
    if (!hasExactIdentifier(candidate, "provider_id", query.providerId.value, query.providerId.provider)) {
      return null;
    }
    score += 1200;
    matchedLookup = true;
    reasons.push(`exact ${query.providerId.provider} provider id`);
  }

  if (query.ticker) {
    const ticker = normalizeText(query.ticker);
    // A blank query must never equal the empty normalization of a missing symbol.
    const exactTicker = ticker !== "" && normalizeText(candidate.symbol) === ticker;
    const tickerAlias = (candidate.aliases ?? []).some(
      (alias) => alias.kind === "ticker" && normalizeText(alias.value) === ticker,
    );
    const tickerIdentifier = hasExactIdentifier(candidate, "ticker", query.ticker);

    if (!exactTicker && !tickerAlias && !tickerIdentifier) return null;
    matchedLookup = true;
    if (exactTicker) {
      score += 850;
      reasons.push("exact ticker");
    } else if (tickerIdentifier) {
      score += 800;
      reasons.push("ticker identifier");
    } else {
      score += 680;
      reasons.push("historical/alias ticker");
    }
  }

  if (query.name) {
    const name = normalizeText(query.name);
    const candidateName = normalizeText(candidate.name);
    const exactName = candidateName === name;
    const exactAlias = (candidate.aliases ?? []).some(
      (alias) => alias.kind === "name" && normalizeText(alias.value) === name,
    );
    // A name is a usable prefix of the other only on a word boundary and with enough characters to
    // be meaningful; otherwise a one-letter token "Z" would match "Zzzqx Holdings".
    const queryIsPrefix = name.length >= 3 && candidateName.startsWith(name);
    const candidateIsPrefix = candidateName.length >= 3 && name.startsWith(`${candidateName} `);
    const prefixName = queryIsPrefix || candidateIsPrefix;
    const sameCompanyName = name.length >= 2 && companyNameKey(candidate.name) === companyNameKey(query.name);

    if (!exactName && !exactAlias && !sameCompanyName && !prefixName) return null;
    matchedLookup = true;
    if (exactName) {
      score += 760;
      reasons.push("exact entity name");
    } else if (sameCompanyName) {
      score += 700;
      reasons.push("same company name (legal suffix ignored)");
    } else if (exactAlias) {
      score += 650;
      reasons.push("entity name alias");
    } else {
      score += 420;
      reasons.push("entity name prefix");
    }
  }

  if (!matchedLookup) return null;

  if (query.mic) {
    if (normalizeText(candidate.mic) !== normalizeText(query.mic)) return null;
    score += 300;
    reasons.push("MIC match");
  }

  if (query.exchange) {
    if (normalizeText(candidate.exchange) !== normalizeText(query.exchange)) return null;
    score += 220;
    reasons.push("exchange match");
  }

  // LV4-04-13: candidate.lifecycleStatus reflects "now", not query.asOfDate.
  // A now-delisted candidate that was actively trading on the query date
  // must not be penalized as historical for that date's purposes -- it
  // already passed the isValidAsOf window gate in rankCandidates, so treat
  // it exactly like a currently-active candidate would score today.
  if (query.asOfDate) {
    score += 100;
    reasons.push("valid as of requested date");
  } else if (candidate.lifecycleStatus === "active" || candidate.lifecycleStatus === "relisted") {
    score += 100;
    reasons.push("current listing");
  } else if (candidate.lifecycleStatus === "suspended") {
    score += 25;
    reasons.push("suspended listing");
  } else {
    score -= 120;
    reasons.push("historical listing");
  }

  if (candidate.isPrimaryListing) {
    score += 60;
    reasons.push("primary listing");
  }

  if (candidate.canonical) {
    score += 40;
    reasons.push("canonical LiOS identity");
  } else {
    score -= 250;
    reasons.push("legacy row requires canonical linking");
    // Legacy catalogs list one company on many venues; foreign/secondary listings carry a
    // suffix (AAPL.MX, NVDA.NE). Prefer the unsuffixed ticker; distinct companies still tie.
    if (query.name && candidate.symbol && !/[.\-]/.test(candidate.symbol)) {
      score += 15;
      reasons.push("unsuffixed home-market ticker");
    }
  }

  return { candidate, score, reasons };
}

function rankCandidates(
  query: InstrumentResolutionQuery,
  candidates: InstrumentMasterCandidate[],
): RankedInstrumentCandidate[] {
  const includeHistorical = query.includeHistorical === true;
  return candidates
    .filter((candidate) =>
      query.asOfDate ? isValidAsOf(candidate, query.asOfDate) : includeHistorical || !isHistorical(candidate),
    )
    .map((candidate) => scoreCandidate(candidate, query))
    .filter((candidate): candidate is RankedInstrumentCandidate => candidate !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const mic = normalizeText(a.candidate.mic).localeCompare(normalizeText(b.candidate.mic));
      if (mic !== 0) return mic;
      return normalizeText(a.candidate.symbol).localeCompare(normalizeText(b.candidate.symbol));
    });
}

function finalizeResolution(
  query: InstrumentResolutionQuery,
  candidates: InstrumentMasterCandidate[],
  source: "local" | "provider_fallback",
): InstrumentResolutionResult {
  const ranked = rankCandidates(query, candidates);
  if (ranked.length === 0) {
    return { status: "not_found", query, match: null, candidates: [], source: "none" };
  }

  const top = ranked[0];
  const second = ranked[1];
  const ambiguous = Boolean(second && second.score === top.score);

  return {
    status: ambiguous ? "ambiguous" : "resolved",
    query,
    match: ambiguous ? null : top.candidate,
    candidates: ranked,
    source,
  };
}

/**
 * Resolve against locally materialized identity rows. Equal top scores are
 * deliberately returned as ambiguous instead of silently choosing a ticker.
 */
export function resolveInstrumentLocal(
  query: InstrumentResolutionQuery,
  candidates: InstrumentMasterCandidate[],
): InstrumentResolutionResult {
  return finalizeResolution(query, candidates, "local");
}

/**
 * Local-first resolver. A provider is consulted only after the canonical/local
 * master has no match; ambiguous local identity never falls through to a
 * provider that could mask the ambiguity.
 */
export async function resolveInstrument(
  query: InstrumentResolutionQuery,
  localCandidates: InstrumentMasterCandidate[],
  fallback?: InstrumentProviderFallback,
): Promise<InstrumentResolutionResult> {
  const local = resolveInstrumentLocal(query, localCandidates);
  if (local.status !== "not_found" || !fallback) return local;

  const providerCandidates = await fallback.resolve(query);
  return finalizeResolution(query, providerCandidates, "provider_fallback");
}

/**
 * Legacy symbol catalogs are compatibility inputs, not canonical identity.
 * The adapter intentionally leaves LiOS IDs null so downstream code cannot
 * mistake `ticker` (or ticker+exchange) for a durable entity identity.
 */
export interface LegacySymbolCatalogRow {
  symbol: string;
  name?: string | null;
  exchange?: string | null;
  mic?: string | null;
  countryCode?: string | null;
  currency?: string | null;
  provider?: string | null;
  providerId?: string | null;
  active?: boolean;
}

/** A provider record that carries no ticker (e.g. an OpenFIGI row without one). It must carry a name instead. */
export interface SymbollessCatalogRow extends Omit<LegacySymbolCatalogRow, "symbol" | "name"> {
  symbol?: null;
  name: string;
}

export function adaptLegacySymbolCatalogRow(row: LegacySymbolCatalogRow | SymbollessCatalogRow): InstrumentMasterCandidate {
  const symbol = row.symbol ? row.symbol.trim() : null;
  const provider = row.provider?.trim() || "legacy_catalog";
  // No symbol -> no ticker identifier: a ticker is never derived from another identifier.
  const identifiers: InstrumentIdentifier[] = symbol === null ? [] : [{ type: "ticker", value: symbol, provider }];
  if (row.providerId?.trim()) {
    identifiers.push({ type: "provider_id", value: row.providerId.trim(), provider });
  }

  return {
    entityId: null,
    listingId: null,
    name: row.name?.trim() || symbol || "",
    symbol,
    exchange: row.exchange?.trim() || null,
    mic: row.mic?.trim() || null,
    countryCode: row.countryCode?.trim().toUpperCase() || null,
    currency: row.currency?.trim().toUpperCase() || null,
    isPrimaryListing: false,
    lifecycleStatus: row.active === false ? "delisted" : "active",
    identifiers,
    aliases: [],
    source: provider,
    canonical: false,
  };
}

export function adaptLegacySymbolCatalog(rows: LegacySymbolCatalogRow[]): InstrumentMasterCandidate[] {
  return rows.map(adaptLegacySymbolCatalogRow);
}
