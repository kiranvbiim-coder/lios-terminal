import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeInstrumentMasterCandidates,
  type PersistedInstrumentMasterRows,
} from "./globalInstrumentMasterStore";

type CompanyRow = PersistedInstrumentMasterRows["companies"][number];
type ListingRow = PersistedInstrumentMasterRows["listings"][number];
type IdentifierRow = PersistedInstrumentMasterRows["identifiers"][number];
type RelationshipRow = NonNullable<PersistedInstrumentMasterRows["relationships"]>[number];
type SecurityRow = NonNullable<PersistedInstrumentMasterRows["securities"]>[number];

const createdAt = new Date("2025-01-01T00:00:00.000Z");
const updatedAt = new Date("2025-01-01T00:00:00.000Z");

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: 1,
    symbol: "ACME",
    name: "Acme Holdings",
    nameIsPlaceholder: false,
    jurisdiction: null,
    legalEntityKind: null,
    legalForm: null,
    lifecycleStatus: "unknown",
    identityStatus: "provisional",
    cik: "0000000001",
    exchange: "NASDAQ",
    country: "US",
    sector: null,
    industry: null,
    assetClass: "equity",
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function security(overrides: Partial<SecurityRow> = {}): SecurityRow {
  return {
    id: 101,
    companyId: 1,
    name: "Acme Holdings Common Stock",
    shareClass: null,
    assetClass: "equity",
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function listing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 11,
    companyId: 1,
    securityId: 101,
    symbol: "ACME",
    exchange: "NASDAQ",
    mic: "XNAS",
    currency: "USD",
    country: "US",
    assetClass: "equity",
    isPrimary: true,
    source: "provider-a",
    validFrom: null,
    validTo: null,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function identifier(overrides: Partial<IdentifierRow> = {}): IdentifierRow {
  return {
    id: 21,
    companyId: 1,
    identifierType: "provider",
    identifier: "ACME-001",
    registry: "",
    jurisdiction: "",
    source: "provider-a",
    isPrimary: true,
    validFrom: null,
    validTo: null,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

function relationship(overrides: Partial<RelationshipRow> = {}): RelationshipRow {
  return {
    id: 31,
    relationshipType: "adr_gdr",
    sourceListingId: 11,
    targetListingId: 12,
    sourceCompanyId: null,
    targetCompanyId: null,
    ratio: null,
    note: null,
    source: "limuria",
    validFrom: null,
    validTo: null,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

test("persisted rows materialize stable entity/listing ids and provider-neutral identifiers", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [listing()],
    identifiers: [identifier()],
  }, new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(candidate.entityId, "lios:entity:1");
  assert.equal(candidate.listingId, "lios:listing:11");
  assert.equal(candidate.securityId, "lios:security:101");
  assert.equal(candidate.instrumentId, null);
  assert.equal(candidate.mic, "XNAS");
  assert.equal(candidate.isPrimaryListing, true);
  assert.equal(candidate.canonical, true);
  assert.equal(candidate.identifiers.some((value) => value.type === "ticker" && value.value === "ACME"), true);
  assert.equal(candidate.identifiers.some((value) => value.type === "provider_id" && value.value === "ACME-001"), true);
  assert.equal(candidate.identifiers.some((value) => value.type === "cik" && value.value === "0000000001"), true);
});

test("listing validity closes a listing without inventing lifecycle metadata", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [listing({ validTo: "2025-06-30" })],
    identifiers: [],
  }, new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(candidate.lifecycleStatus, "delisted");
  assert.equal(candidate.validTo, "2025-06-30");
});

test("a company predating listing backfill keeps canonical entity identity but no fake listing id", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company({ id: 7, symbol: "OLD" })],
    listings: [],
    identifiers: [],
  }, new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(candidate.entityId, "lios:entity:7");
  assert.equal(candidate.listingId, null);
  assert.equal(candidate.securityId, null);
  assert.equal(candidate.instrumentId, null);
  assert.equal(candidate.source, "legacy_company_row");
  assert.equal(candidate.canonical, true);
});

test("multiple exchange listings become separate listing candidates for one durable entity", () => {
  const candidates = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [
      listing(),
      listing({
        id: 12,
        symbol: "ACM",
        exchange: "LSE",
        mic: "XLON",
        currency: "GBP",
        country: "GB",
        isPrimary: false,
      }),
    ],
    identifiers: [],
  }, new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(candidates.length, 2);
  assert.deepEqual(new Set(candidates.map((row) => row.entityId)), new Set(["lios:entity:1"]));
  assert.deepEqual(new Set(candidates.map((row) => row.listingId)), new Set(["lios:listing:11", "lios:listing:12"]));
});

test("unknown persisted identifier types stay searchable as other instead of being discarded", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company({ cik: null })],
    listings: [listing()],
    identifiers: [identifier({ identifierType: "local_vendor_code", identifier: "VX-9" })],
  });

  assert.equal(candidate.identifiers.some((value) => value.type === "other" && value.value === "VX-9"), true);
});

test("LV4-04-01/02: a listing's share class comes from its parent security, not the listing itself", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company()],
    securities: [security({ id: 102, shareClass: "A" })],
    listings: [listing({ securityId: 102 })],
    identifiers: [],
  });

  assert.equal(candidate.securityId, "lios:security:102");
  assert.equal(candidate.shareClass, "A");
});

test("LV4-04-01/02: shareClass stays null when the securities array is omitted (backward compatibility)", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [listing()],
    identifiers: [],
  });

  assert.equal(candidate.securityId, "lios:security:101");
  assert.equal(candidate.shareClass, null);
});

test("LV4-04-01/02: a stale listing fixture without securityId stays explicitly unlinked", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [listing({ securityId: undefined })],
    identifiers: [],
  });

  assert.equal(candidate.securityId, null);
  assert.notEqual(candidate.securityId, "lios:security:undefined");
});

test("an ADR/GDR relationship links both listings to each other with the ratio, bidirectionally", () => {
  const candidates = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [
      listing({ id: 11, symbol: "ACME", exchange: "NASDAQ" }),
      listing({ id: 12, symbol: "ACME.NS", exchange: "NSE", isPrimary: false }),
    ],
    identifiers: [],
    relationships: [
      relationship({ relationshipType: "adr_gdr", sourceListingId: 11, targetListingId: 12, ratio: "1:2" }),
    ],
  });

  const adr = candidates.find((candidate) => candidate.listingId === "lios:listing:11");
  const ordinary = candidates.find((candidate) => candidate.listingId === "lios:listing:12");
  assert.ok(adr);
  assert.ok(ordinary);
  assert.deepEqual(adr!.relatedInstruments, [{ listingId: "lios:listing:12", relationshipType: "adr_gdr", ratio: "1:2" }]);
  assert.deepEqual(ordinary!.relatedInstruments, [{ listingId: "lios:listing:11", relationshipType: "adr_gdr", ratio: "1:2" }]);
});

test("a related_instrument edge links two listings without a conversion ratio", () => {
  const candidates = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [
      listing({ id: 11, symbol: "ACME" }),
      listing({ id: 13, companyId: 1, symbol: "ACME.WT", exchange: "NASDAQ", isPrimary: false }),
    ],
    identifiers: [],
    relationships: [
      relationship({ id: 32, relationshipType: "related_instrument", sourceListingId: 11, targetListingId: 13, ratio: null }),
    ],
  });

  const common = candidates.find((candidate) => candidate.listingId === "lios:listing:11");
  assert.deepEqual(common!.relatedInstruments, [{ listingId: "lios:listing:13", relationshipType: "related_instrument", ratio: null }]);
});

test("a succession relationship attaches predecessor/successor entity ids to every listing of both companies", () => {
  const predecessor = company({ id: 1, symbol: "OLDCO", name: "Old Co" });
  const successor = company({ id: 2, symbol: "NEWCO", name: "New Co", cik: null });

  const candidates = materializeInstrumentMasterCandidates({
    companies: [predecessor, successor],
    listings: [
      listing({ id: 11, companyId: 1, symbol: "OLDCO" }),
      listing({ id: 12, companyId: 2, symbol: "NEWCO" }),
    ],
    identifiers: [],
    relationships: [
      relationship({ id: 33, relationshipType: "succession", sourceListingId: null, targetListingId: null, sourceCompanyId: 1, targetCompanyId: 2 }),
    ],
  });

  const oldRow = candidates.find((candidate) => candidate.entityId === "lios:entity:1");
  const newRow = candidates.find((candidate) => candidate.entityId === "lios:entity:2");
  assert.deepEqual(oldRow!.successorEntityIds, ["lios:entity:2"]);
  assert.deepEqual(oldRow!.predecessorEntityIds, []);
  assert.deepEqual(newRow!.predecessorEntityIds, ["lios:entity:1"]);
  assert.deepEqual(newRow!.successorEntityIds, []);
});

test("a relationship row with a missing required id half is skipped instead of crashing or fabricating a link", () => {
  const candidates = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [listing({ id: 11 })],
    identifiers: [],
    relationships: [
      // succession missing its company ids
      relationship({ id: 34, relationshipType: "succession", sourceListingId: null, targetListingId: null, sourceCompanyId: null, targetCompanyId: 1 }),
      // adr_gdr missing its target listing id
      relationship({ id: 35, relationshipType: "adr_gdr", sourceListingId: 11, targetListingId: null }),
    ],
  });

  const [candidate] = candidates;
  assert.deepEqual(candidate.relatedInstruments, []);
  assert.deepEqual(candidate.predecessorEntityIds, []);
  assert.deepEqual(candidate.successorEntityIds, []);
});

test("materializeInstrumentMasterCandidates without a relationships field behaves exactly as before LV4-04-06", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company()],
    listings: [listing()],
    identifiers: [],
  });

  assert.deepEqual(candidate.relatedInstruments, []);
  assert.deepEqual(candidate.predecessorEntityIds, []);
  assert.deepEqual(candidate.successorEntityIds, []);
  assert.equal(candidate.shareClass, null);
});

test("LV4-04-05: composite and share-class FIGI resolve as distinct types, not collapsed into figi", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company({ cik: null })],
    listings: [listing()],
    identifiers: [
      identifier({ id: 21, identifierType: "figi", identifier: "BBG000B9XRY4" }),
      identifier({ id: 22, identifierType: "composite_figi", identifier: "BBG000BLNNH6" }),
      identifier({ id: 23, identifierType: "share_class_figi", identifier: "BBG001S5N8V8" }),
    ],
  });

  const byValue = new Map(candidate.identifiers.map((value) => [value.value, value.type]));
  assert.equal(byValue.get("BBG000B9XRY4"), "figi");
  assert.equal(byValue.get("BBG000BLNNH6"), "composite_figi");
  assert.equal(byValue.get("BBG001S5N8V8"), "share_class_figi");
});

test("an entity without symbol, security or listing materializes with no invented ticker, listing or lifecycle", () => {
  const [candidate, ...rest] = materializeInstrumentMasterCandidates({
    companies: [company({
      id: 9,
      symbol: null,
      name: "Zephyr Quantum Holdings Ltd",
      cik: null,
      exchange: null,
      country: null,
      jurisdiction: "GB",
      legalEntityKind: "corporation",
    })],
    listings: [],
    identifiers: [],
  }, new Date("2026-01-01T00:00:00.000Z"));

  assert.equal(rest.length, 0);
  assert.equal(candidate.entityId, "lios:entity:9");
  assert.equal(candidate.listingId, null);
  assert.equal(candidate.securityId, null);
  assert.equal(candidate.symbol, null);
  assert.deepEqual(candidate.identifiers, []);
  assert.equal(candidate.isPrimaryListing, false);
  assert.equal(candidate.canonical, true);
  assert.equal(candidate.source, "entity_record");
  assert.deepEqual(candidate.entity, {
    jurisdiction: "GB",
    legalEntityKind: "corporation",
    legalForm: null,
    lifecycleStatus: "unknown",
    identityStatus: "provisional",
    nameIsPlaceholder: false,
  });
});

test("an explicit terminal entity lifecycle makes a listing-less entity historical; 'unknown' stays resolvable", () => {
  const candidates = materializeInstrumentMasterCandidates({
    companies: [
      company({ id: 1, symbol: null, name: "Dissolved Ltd", lifecycleStatus: "dissolved" }),
      company({ id: 2, symbol: null, name: "Absorbed Ltd", lifecycleStatus: "acquired" }),
      company({ id: 3, symbol: null, name: "Unknown Ltd", lifecycleStatus: "unknown" }),
    ],
    listings: [],
    identifiers: [],
  }, new Date("2026-01-01T00:00:00.000Z"));
  assert.deepEqual(candidates.map((row) => row.lifecycleStatus), ["expired", "acquired", "active"]);
  assert.deepEqual(candidates.map((row) => row.entity?.lifecycleStatus), ["dissolved", "acquired", "unknown"]);
});

test("registry identifiers keep their registry + jurisdiction namespace; global types expose none", () => {
  const [candidate] = materializeInstrumentMasterCandidates({
    companies: [company({ id: 5, symbol: null, cik: null })],
    listings: [],
    identifiers: [
      identifier({ id: 1, companyId: 5, identifierType: "registry_id", identifier: "00012345", registry: "UK_COMPANIES_HOUSE", jurisdiction: "GB" }),
      identifier({ id: 2, companyId: 5, identifierType: "lei", identifier: "5493006MHB84DD0ZWV18" }),
    ],
  });
  const registry = candidate.identifiers.find((item) => item.type === "registry_id");
  assert.equal(registry?.registry, "UK_COMPANIES_HOUSE");
  assert.equal(registry?.jurisdiction, "GB");
  const lei = candidate.identifiers.find((item) => item.type === "lei");
  assert.equal(lei?.registry, null);
  assert.equal(lei?.jurisdiction, null);
});
