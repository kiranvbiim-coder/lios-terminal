import { sql } from "drizzle-orm";
import type { CanonicalIdentity } from "@shared/waveCCanonicalAdapters";
import { companyListings } from "@shared/schema";
import type { DrizzleDb } from "./db";

type Db = Pick<DrizzleDb, "select">;

export interface PositionIdentity {
  symbol: string;
  listingId: number | null;
  securityId: number | null;
  resolved: boolean;
}

export async function resolvePositionIdentity(db: Db, rawSymbol: string): Promise<PositionIdentity> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return { symbol, listingId: null, securityId: null, resolved: false };

  const primary = await db
    .select({ id: companyListings.id, securityId: companyListings.securityId })
    .from(companyListings)
    .where(sql`upper(${companyListings.symbol}) = ${symbol} AND ${companyListings.isPrimary} = true`)
    .limit(1);
  if (primary[0]) {
    return { symbol, listingId: primary[0].id, securityId: primary[0].securityId, resolved: true };
  }

  const any = await db
    .select({ id: companyListings.id, securityId: companyListings.securityId })
    .from(companyListings)
    .where(sql`upper(${companyListings.symbol}) = ${symbol}`)
    .orderBy(companyListings.id)
    .limit(1);
  if (any[0]) {
    return { symbol, listingId: any[0].id, securityId: any[0].securityId, resolved: true };
  }

  return { symbol, listingId: null, securityId: null, resolved: false };
}

export function toCanonicalIdentity(identity: PositionIdentity): CanonicalIdentity {
  return {
    listingId: identity.listingId == null ? null : `lios:listing:${identity.listingId}`,
    securityId: identity.securityId == null ? null : `lios:security:${identity.securityId}`,
  };
}

export const UNRESOLVED_LISTING_ERROR =
  "Symbol is not a resolved Global Instrument Master listing. Raw tickers are not durable identity.";
