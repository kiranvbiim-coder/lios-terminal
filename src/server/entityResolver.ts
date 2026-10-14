import { and, eq } from "drizzle-orm";
import { companies, companyListings } from "@shared/schema";
import type { InstrumentResolutionResult } from "@shared/globalInstrumentMaster";
import { getDb } from "./db";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";

export type CanonicalIdentifierType = "cik" | "isin" | "figi" | "lei" | "provider";

export interface EntityQuery {
  raw: string;
  symbol?: string;
  exchange?: string;
  identifierType?: CanonicalIdentifierType;
  identifier?: string;
}

export function parseEntityQuery(raw: string): EntityQuery {
  const value = raw.trim().toUpperCase();
  if (!value) return { raw: "" };
  const prefixed = /^(CIK|ISIN|FIGI|LEI|PROVIDER)\s*[:=]\s*(.+)$/.exec(value);
  if (prefixed) return {
    raw: value,
    identifierType: prefixed[1].toLowerCase() as CanonicalIdentifierType,
    identifier: prefixed[2].replace(/\s+/g, ""),
  };
  const qualified = /^([A-Z0-9._-]+)\s*(?:@|:)\s*([A-Z0-9._-]+)$/.exec(value);
  if (qualified) return { raw: value, symbol: qualified[1], exchange: qualified[2] };
  return { raw: value, symbol: value };
}

export type ResolvedCompanyEntity = typeof companies.$inferSelect & {
  listing?: typeof companyListings.$inferSelect;
  matched: { kind: "identifier" | "listing" | "name" | "legacy"; value: string | null; type?: string; exchange?: string };
  resolution: InstrumentResolutionResult;
};

export interface AmbiguousCompanyEntity {
  ambiguous: true;
  query: EntityQuery;
  candidates: Array<{ id: number; name: string; symbol: string | null; exchange: string | null; score: number }>;
  resolution: InstrumentResolutionResult;
}

/** Compatibility projection only. P5's Global Instrument Master owns all matching and ranking. */
export async function resolveEntity(raw: string): Promise<ResolvedCompanyEntity | AmbiguousCompanyEntity | null> {
  const query = parseEntityQuery(raw);
  if (!query.raw) return null;
  let resolution: InstrumentResolutionResult;
  if (query.identifierType && query.identifier) {
    resolution = await resolvePersistedInstrument({ identifier: {
      type: query.identifierType === "provider" ? "provider_id" : query.identifierType,
      value: query.identifier,
    } });
  } else {
    if (!query.symbol) return null;
    resolution = await resolvePersistedInstrument({ ticker: query.symbol, exchange: query.exchange });
    // A failed bare-symbol lookup may be a legal name. Never fall through from
    // ambiguity or from an explicit exchange/identifier query to a guessed name.
    if (resolution.status === "not_found" && !query.exchange) {
      resolution = await resolvePersistedInstrument({ name: raw.trim() });
    }
  }

  if (resolution.status === "ambiguous") {
    return {
      ambiguous: true,
      query,
      candidates: resolution.candidates.map(({ candidate, score }) => ({
        id: Number(candidate.entityId?.split(":").at(-1)),
        name: candidate.name,
        symbol: candidate.symbol ?? null,
        exchange: candidate.exchange ?? null,
        score,
      })),
      resolution,
    };
  }
  const match = resolution.match;
  if (resolution.status !== "resolved" || !match?.entityId) return null;
  const companyId = Number(match.entityId.split(":").at(-1));
  if (!Number.isSafeInteger(companyId) || companyId < 1) return null;
  const db = getDb();
  // Hydrate only the identity the canonical resolver selected. These exact-id
  // reads do not perform independent name/symbol/identifier matching.
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return null;
  const listingId = match.listingId ? Number(match.listingId.split(":").at(-1)) : null;
  const [listing] = listingId && Number.isSafeInteger(listingId)
    ? await db.select().from(companyListings).where(and(eq(companyListings.id, listingId), eq(companyListings.companyId, companyId))).limit(1)
    : [];
  // A removed/mismatched listing is not permission to use the issuer's display ticker.
  if (match.listingId && !listing) return null;
  return {
    ...company,
    ...(listing ? { symbol: listing.symbol, listing } : {}),
    matched: query.identifierType
      ? { kind: "identifier", value: query.identifier!, type: query.identifierType }
      : listing
        ? { kind: resolution.query.name ? "name" : "listing", value: listing.symbol, exchange: listing.exchange }
        : { kind: resolution.query.name ? "name" : "legacy", value: company.symbol },
    resolution,
  };
}
