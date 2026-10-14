/**
 * FRED-backed FX rate provider (LV4-05-02 follow-up). Populates fx_rates
 * from the Federal Reserve's H.10 daily foreign exchange release via the
 * same FRED connector every other economic indicator in this app already
 * uses (fredData.ts). Every series ID and its quoting direction below was
 * verified live -- not guessed -- against:
 *   https://fred.stlouisfed.org/release?rid=17 (FRED's own H.10 release
 *     page, listing every currently active daily FX series ID)
 *   https://www.federalreserve.gov/releases/h10/current/ (the Fed's own
 *     H.10 table, cross-checked for the direction asterisk convention)
 * Same "verified to exist, not guessed" discipline as fredData.ts's
 * INDICATOR_CATALOG and bseCorporateActions.ts's endpoint verification.
 *
 * H.10 quotes everything against USD, but not consistently in one
 * direction: most currencies are published as "foreign units per 1 USD"
 * (so here, baseCurrency = "USD"), while the Fed's own release marks EUR,
 * GBP, AUD, and NZD with an asterisk as the exception -- those four are
 * "USD per 1 foreign unit" (baseCurrency = that foreign currency).
 * FX_SERIES_CATALOG records the correct (baseCurrency, quoteCurrency)
 * pair per series rather than assuming one direction for all of them.
 *
 * Currencies LiOS's own currency master (LV4-05-01) seeds but that have no
 * H.10 daily series -- IDR, PHP, VND, PLN, TRY, AED, SAR, ILS, RUB -- are
 * deliberately omitted here rather than guessed at. Wiring a second
 * provider for those is a separate, explicitly out-of-scope follow-up.
 */
import { fetchObservationAsOf, resolveApiKey, type IndicatorObservation } from "./fredData";
import { recordFxRate } from "./fxRateStore";

export interface FxSeriesProfile {
  seriesId: string;
  baseCurrency: string;
  quoteCurrency: string;
}

export const FX_SERIES_CATALOG: FxSeriesProfile[] = [
  { seriesId: "DEXJPUS", baseCurrency: "USD", quoteCurrency: "JPY" },
  { seriesId: "DEXUSEU", baseCurrency: "EUR", quoteCurrency: "USD" },
  { seriesId: "DEXCHUS", baseCurrency: "USD", quoteCurrency: "CNY" },
  { seriesId: "DEXUSUK", baseCurrency: "GBP", quoteCurrency: "USD" },
  { seriesId: "DEXKOUS", baseCurrency: "USD", quoteCurrency: "KRW" },
  { seriesId: "DEXCAUS", baseCurrency: "USD", quoteCurrency: "CAD" },
  { seriesId: "DEXINUS", baseCurrency: "USD", quoteCurrency: "INR" },
  { seriesId: "DEXMXUS", baseCurrency: "USD", quoteCurrency: "MXN" },
  { seriesId: "DEXUSAL", baseCurrency: "AUD", quoteCurrency: "USD" },
  { seriesId: "DEXBZUS", baseCurrency: "USD", quoteCurrency: "BRL" },
  { seriesId: "DEXSZUS", baseCurrency: "USD", quoteCurrency: "CHF" },
  { seriesId: "DEXTHUS", baseCurrency: "USD", quoteCurrency: "THB" },
  { seriesId: "DEXSFUS", baseCurrency: "USD", quoteCurrency: "ZAR" },
  { seriesId: "DEXMAUS", baseCurrency: "USD", quoteCurrency: "MYR" },
  { seriesId: "DEXTAUS", baseCurrency: "USD", quoteCurrency: "TWD" },
  { seriesId: "DEXHKUS", baseCurrency: "USD", quoteCurrency: "HKD" },
  { seriesId: "DEXSIUS", baseCurrency: "USD", quoteCurrency: "SGD" },
  { seriesId: "DEXSDUS", baseCurrency: "USD", quoteCurrency: "SEK" },
  { seriesId: "DEXNOUS", baseCurrency: "USD", quoteCurrency: "NOK" },
  { seriesId: "DEXUSNZ", baseCurrency: "NZD", quoteCurrency: "USD" },
  { seriesId: "DEXDNUS", baseCurrency: "USD", quoteCurrency: "DKK" },
];

export interface FxObservationResult {
  profile: FxSeriesProfile;
  observation: IndicatorObservation | null;
}

/**
 * Fetches one series' rate as of a date (omit for the latest available).
 * Returns a null observation, never throws, when no FRED credential is
 * configured or the fetch fails -- same graceful-degradation contract as
 * fredData.ts's getYieldCurve, so a missing key disables FX sync the same
 * way it disables every other FRED-backed feature rather than crashing.
 */
export async function fetchFxObservation(profile: FxSeriesProfile, asOfDate?: string): Promise<FxObservationResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) return { profile, observation: null };
  try {
    const observation = await fetchObservationAsOf(profile.seriesId, apiKey, asOfDate);
    return { profile, observation };
  } catch (err) {
    console.warn(`FRED FX fetch failed for ${profile.seriesId}:`, err instanceof Error ? err.message : err);
    return { profile, observation: null };
  }
}

export interface FxSyncResult extends FxObservationResult {
  recorded: boolean;
}

/**
 * Fetches every catalog series as of a date (omit for latest) and
 * persists each successful observation into fx_rates via
 * server/fxRateStore.ts's recordFxRate. Returns one outcome per series so
 * a caller (a scheduled job, an admin sync route) can report exactly
 * which series did or did not get new data, rather than a single opaque
 * success/failure for the whole batch.
 */
export async function syncFxRates(asOfDate?: string): Promise<FxSyncResult[]> {
  const results = await Promise.all(FX_SERIES_CATALOG.map((profile) => fetchFxObservation(profile, asOfDate)));
  return Promise.all(
    results.map(async (result): Promise<FxSyncResult> => {
      if (!result.observation) return { ...result, recorded: false };
      await recordFxRate({
        baseCurrency: result.profile.baseCurrency,
        quoteCurrency: result.profile.quoteCurrency,
        rateDate: result.observation.date,
        rate: result.observation.value,
        source: "fred",
      });
      return { ...result, recorded: true };
    }),
  );
}
