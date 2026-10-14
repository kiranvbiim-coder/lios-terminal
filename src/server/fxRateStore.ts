import { and, desc, eq, lte } from "drizzle-orm";
import { fxRates } from "@shared/schema";
import type { FxConversionOutcome, FxConversionRequest, ResolvedFxRate } from "@shared/fxNormalization";
import { convertAmount } from "@shared/fxNormalization";
import type { MasterCurrency } from "@shared/currencyMaster";
import { getDb } from "./db";

export interface RecordFxRateInput {
  baseCurrency: string;
  quoteCurrency: string;
  rateDate: string;
  rate: number;
  source: string;
}

/**
 * Records (or revises) one FX observation. Upserts on (base, quote, date,
 * source) rather than onConflictDoNothing -- a source re-reporting the
 * same date (e.g. a preliminary value later revised) should be able to
 * correct the stored rate, not silently keep the stale first value.
 */
export async function recordFxRate(input: RecordFxRateInput) {
  const [row] = await getDb()
    .insert(fxRates)
    .values(input)
    .onConflictDoUpdate({
      target: [fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.rateDate, fxRates.source],
      set: { rate: input.rate, retrievedAt: new Date() },
    })
    .returning();
  return row;
}

/**
 * Resolves the most recent stored rate for (base, quote) on or before
 * asOfDate -- the point-in-time lookup shared/fxNormalization.ts's
 * convertAmount calls for both the direct and (with arguments swapped)
 * inverse direction. Returns null, never a stale-but-wrong guess, when no
 * observation exists on or before that date for this exact pair. Ties on
 * rateDate (more than one source reported the same day) break toward the
 * most recently retrieved row, for a deterministic result.
 */
export async function resolveFxRateAsOf(base: string, quote: string, asOfDate: string): Promise<ResolvedFxRate | null> {
  const [row] = await getDb()
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.baseCurrency, base), eq(fxRates.quoteCurrency, quote), lte(fxRates.rateDate, asOfDate)))
    .orderBy(desc(fxRates.rateDate), desc(fxRates.retrievedAt))
    .limit(1);
  return row ? { rate: row.rate, rateDate: row.rateDate } : null;
}

/**
 * Convenience wrapper composing resolveFxRateAsOf into
 * fxNormalization.ts's convertAmount, for callers that just want a
 * converted amount against the persisted fx_rates table.
 */
export async function convertPersistedAmount(
  request: FxConversionRequest,
  toCurrency: Pick<MasterCurrency, "minorUnit">,
): Promise<FxConversionOutcome> {
  return convertAmount(request, resolveFxRateAsOf, toCurrency);
}

/**
 * Explicit-rate evidence lookup for P6's optional multi-currency projection.
 * Returns a persisted row's actual source without claiming the observation's
 * publication/availability clock or any user entitlement.
 */
export async function resolveFxRateEvidenceAsOf(
  base: string, quote: string, asOfDate: string,
): Promise<{ rate: number; rateDate: string; source: string } | null> {
  const [row] = await getDb()
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.baseCurrency, base), eq(fxRates.quoteCurrency, quote), lte(fxRates.rateDate, asOfDate)))
    .orderBy(desc(fxRates.rateDate), desc(fxRates.retrievedAt))
    .limit(1);
  return row ? { rate: row.rate, rateDate: row.rateDate, source: row.source } : null;
}
