/**
 * Shared FRED (Federal Reserve Economic Data) connector, used by every
 * domain whose data happens to live on FRED -- currently Economics &
 * Public Policy, Operations & Supply Chain Logistics (FRED, via the
 * Bureau of Transportation Statistics, also publishes real freight/rail
 * series), Environment & Sustainability (FRED mirrors EIA's CO2
 * emissions-by-sector and renewable generation series), and Tourism &
 * Hospitality (FRED carries Census/BEA/BTS leisure-and-hospitality
 * employment, air travel, hotel revenue and dining-spend series) -- no
 * separate vendor needed for any of these domains' starting catalogs.
 * Mirrors the same optional-API-key pattern as liveStream.ts's Finnhub key
 * (env var or ~/.limuria-terminal/config.json), and the same "be honest
 * when data isn't live" contract as marketData.ts's Quote type -- an
 * indicator with no key configured returns isLive: false rather than a
 * fabricated number.
 *
 * Free key: register at https://fred.stlouisfed.org/docs/api/api_key.html
 */
import { getCredential } from "./terminalConfig";
import { recordConnectorVerification } from "./connectorVerification";

const FRED_BASE_URL = "https://api.stlouisfed.org/fred";

export type IndicatorDomain = "economics_policy" | "supply_chain" | "environment_sustainability" | "tourism_hospitality";

export interface IndicatorProfile {
  seriesId: string;
  name: string;
  unit: string; // "%", "Index", "$B", "Thousands", etc -- for display only
  category: string;
  domain: IndicatorDomain;
}

// A curated starting set per domain -- the handful of indicators any
// literate audience expects on day one. FRED has thousands more; add here
// as needed, same spirit as marketData.ts's PROFILE_CATALOG. Series IDs
// for supply_chain were verified to exist (not guessed) before adding.
export const INDICATOR_CATALOG: IndicatorProfile[] = [
  // ── Economics & Public Policy ──
  { seriesId: "GDPC1", name: "Real GDP", unit: "$B (chained 2017)", category: "Growth", domain: "economics_policy" },
  { seriesId: "CPIAUCSL", name: "Consumer Price Index (CPI)", unit: "Index", category: "Inflation", domain: "economics_policy" },
  { seriesId: "UNRATE", name: "Unemployment Rate", unit: "%", category: "Labor", domain: "economics_policy" },
  { seriesId: "FEDFUNDS", name: "Federal Funds Rate", unit: "%", category: "Monetary Policy", domain: "economics_policy" },
  { seriesId: "DGS1MO", name: "1-Month Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS3MO", name: "3-Month Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS6MO", name: "6-Month Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS1", name: "1-Year Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS2", name: "2-Year Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS3", name: "3-Year Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS5", name: "5-Year Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS7", name: "7-Year Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS10", name: "10-Year Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS20", name: "20-Year Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "DGS30", name: "30-Year Treasury Yield", unit: "%", category: "Rates", domain: "economics_policy" },
  { seriesId: "PAYEMS", name: "Nonfarm Payrolls", unit: "Thousands", category: "Labor", domain: "economics_policy" },
  { seriesId: "HOUST", name: "Housing Starts", unit: "Thousands (SAAR)", category: "Housing", domain: "economics_policy" },
  { seriesId: "RSAFS", name: "Retail Sales", unit: "$M", category: "Consumer", domain: "economics_policy" },
  { seriesId: "INDPRO", name: "Industrial Production Index", unit: "Index", category: "Production", domain: "economics_policy" },
  { seriesId: "UMCSENT", name: "Consumer Sentiment (Michigan)", unit: "Index", category: "Sentiment", domain: "economics_policy" },
  // ── Operations & Supply Chain Logistics ──
  { seriesId: "TSIFRGHTC", name: "Freight Transportation Services Index", unit: "Index", category: "Freight Activity", domain: "supply_chain" },
  { seriesId: "RAILFRTCARLOADSD11", name: "Rail Freight Carloads", unit: "Index", category: "Rail", domain: "supply_chain" },
  { seriesId: "RAILFRTINTERMODAL", name: "Rail Freight Intermodal Traffic", unit: "Index", category: "Rail", domain: "supply_chain" },
  { seriesId: "ISRATIO", name: "Total Business Inventories/Sales Ratio", unit: "Ratio", category: "Inventory Pressure", domain: "supply_chain" },
  { seriesId: "MANEMP", name: "Manufacturing Employment", unit: "Thousands", category: "Manufacturing", domain: "supply_chain" },
  { seriesId: "IPMAN", name: "Industrial Production: Manufacturing", unit: "Index", category: "Manufacturing", domain: "supply_chain" },
  { seriesId: "DGORDER", name: "Durable Goods New Orders", unit: "$M", category: "Demand Pipeline", domain: "supply_chain" },
  // ── Environment & Sustainability ──
  { seriesId: "EMISSCO2TOTVTTTOUSA", name: "Total CO2 Emissions (All Sectors)", unit: "Million Metric Tons", category: "Emissions", domain: "environment_sustainability" },
  { seriesId: "EMISSCO2TOTVECTOUSA", name: "Electric Power CO2 Emissions", unit: "Million Metric Tons", category: "Emissions", domain: "environment_sustainability" },
  { seriesId: "EMISSCO2TOTVTCTOUSA", name: "Transportation CO2 Emissions", unit: "Million Metric Tons", category: "Emissions", domain: "environment_sustainability" },
  { seriesId: "EMISSCO2TOTVICTOUSA", name: "Industrial CO2 Emissions", unit: "Million Metric Tons", category: "Emissions", domain: "environment_sustainability" },
  { seriesId: "EMISSCO2TOTVCCTOUSA", name: "Commercial CO2 Emissions", unit: "Million Metric Tons", category: "Emissions", domain: "environment_sustainability" },
  { seriesId: "EMISSCO2TOTVRCTOUSA", name: "Residential CO2 Emissions", unit: "Million Metric Tons", category: "Emissions", domain: "environment_sustainability" },
  { seriesId: "IPN221114T8N", name: "Renewables & Other Electric Power Generation", unit: "Index", category: "Renewable Generation", domain: "environment_sustainability" },
  // ── Tourism & Hospitality ──
  { seriesId: "USLAH", name: "Leisure & Hospitality Employment", unit: "Thousands", category: "Employment", domain: "tourism_hospitality" },
  { seriesId: "AIRRPMTSID11", name: "Air Revenue Passenger Miles", unit: "Index", category: "Travel Demand", domain: "tourism_hospitality" },
  { seriesId: "REV721TAXABL144QNSA", name: "Total Revenue for Accommodation", unit: "$Thousands", category: "Hotel Revenue", domain: "tourism_hospitality" },
  { seriesId: "PCU721110721110", name: "PPI: Hotels & Motels", unit: "Index", category: "Room Rate Pricing", domain: "tourism_hospitality" },
  { seriesId: "IPUTN721110W201000000", name: "Hotel & Motel Employment", unit: "Thousands", category: "Employment", domain: "tourism_hospitality" },
  { seriesId: "RSFSDP", name: "Retail Sales: Food Services & Drinking Places", unit: "$M", category: "Dining Spend", domain: "tourism_hospitality" },
];

export function getIndicatorProfile(seriesId: string): IndicatorProfile | undefined {
  return INDICATOR_CATALOG.find((i) => i.seriesId === seriesId.toUpperCase());
}

export function getIndicatorCatalog(domain: IndicatorDomain): IndicatorProfile[] {
  return INDICATOR_CATALOG.filter((i) => i.domain === domain);
}

/** Exported for reuse by fredFxProvider.ts -- same FRED credential every
 * other indicator in this app resolves through. */
export function resolveApiKey(): string | null {
  return getCredential("FRED_API_KEY", "fredApiKey");
}

let loggedMissingKey = false;

export interface IndicatorObservation {
  date: string;
  value: number;
  realtimeStart?: string;
  realtimeEnd?: string;
}

export interface IndicatorQuote {
  seriesId: string;
  name: string;
  unit: string;
  value: number | null;
  previousValue: number | null;
  change: number | null;
  changePercent: number | null;
  asOf: string | null;
  isLive: boolean;
}

export const FRED_MAX_POINTS = 100_000;
export const FRED_DEFAULT_POINTS = 240;

export interface FredHistoryOptions {
  points?: number;
  startDate?: string;
  endDate?: string;
}

function validateDate(value: string, name: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${name} must be an ISO date (YYYY-MM-DD)`);
  }
  return value;
}

export function normalizeFredHistoryOptions(input: number | FredHistoryOptions): Required<Pick<FredHistoryOptions, "points">> & FredHistoryOptions {
  const options = typeof input === "number" ? { points: input } : input;
  const points = options.points ?? FRED_DEFAULT_POINTS;
  if (!Number.isInteger(points) || points < 1 || points > FRED_MAX_POINTS) {
    throw new RangeError(`points must be an integer between 1 and ${FRED_MAX_POINTS}`);
  }
  const startDate = options.startDate ? validateDate(options.startDate, "startDate") : undefined;
  const endDate = options.endDate ? validateDate(options.endDate, "endDate") : undefined;
  if (startDate && endDate && startDate > endDate) throw new RangeError("startDate must be on or before endDate");
  return { points, startDate, endDate };
}

async function fetchObservations(seriesId: string, input: number | FredHistoryOptions, apiKey: string): Promise<IndicatorObservation[]> {
  const options = normalizeFredHistoryOptions(input);
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: String(options.points),
  });
  if (options.startDate) params.set("observation_start", options.startDate);
  if (options.endDate) params.set("observation_end", options.endDate);
  const url = `${FRED_BASE_URL}/series/observations?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    recordConnectorVerification("fred", false, `FRED API returned ${res.status} for ${seriesId}`);
    throw new Error(`FRED API returned ${res.status} for ${seriesId}`);
  }
  const data = await res.json();
  const rows: Array<{ date: string; value: string; realtime_start?: string; realtime_end?: string }> = data.observations ?? [];
  recordConnectorVerification("fred", true, "FRED responded to a live request.");
  return rows
    .filter((r) => r.value !== ".")
    .map((r) => ({ date: r.date, value: Number(r.value), realtimeStart: r.realtime_start, realtimeEnd: r.realtime_end }))
    .reverse();
}

function emptyQuote(seriesId: string): IndicatorQuote {
  const profile = getIndicatorProfile(seriesId);
  return {
    seriesId, name: profile?.name ?? seriesId, unit: profile?.unit ?? "",
    value: null, previousValue: null, change: null, changePercent: null, asOf: null, isLive: false,
  };
}

export async function getIndicatorQuote(seriesId: string): Promise<IndicatorQuote> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    if (!loggedMissingKey) {
      console.log("Economics domain disabled (no FRED_API_KEY or ~/.limuria-terminal/config.json fredApiKey). Indicators will show as unavailable.");
      loggedMissingKey = true;
    }
    return emptyQuote(seriesId);
  }

  const profile = getIndicatorProfile(seriesId);
  try {
    const obs = await fetchObservations(seriesId, 2, apiKey);
    if (!obs.length) return emptyQuote(seriesId);
    const latest = obs[obs.length - 1];
    const previous = obs.length > 1 ? obs[obs.length - 2] : null;
    const change = previous ? latest.value - previous.value : null;
    const changePercent = previous && previous.value !== 0 ? (change! / previous.value) * 100 : null;
    return {
      seriesId, name: profile?.name ?? seriesId, unit: profile?.unit ?? "",
      value: latest.value, previousValue: previous?.value ?? null, change, changePercent,
      asOf: latest.date, isLive: true,
    };
  } catch (err) {
    console.warn(`FRED fetch failed for ${seriesId}:`, err instanceof Error ? err.message : err);
    return emptyQuote(seriesId);
  }
}

export async function getIndicatorQuotes(seriesIds: string[]): Promise<IndicatorQuote[]> {
  return Promise.all(seriesIds.map((id) => getIndicatorQuote(id)));
}

export async function getIndicatorHistory(seriesId: string, options: number | FredHistoryOptions = FRED_DEFAULT_POINTS): Promise<IndicatorObservation[]> {
  const normalized = normalizeFredHistoryOptions(options);
  const apiKey = resolveApiKey();
  if (!apiKey) return [];
  try {
    return await fetchObservations(seriesId, normalized, apiKey);
  } catch (err) {
    console.warn(`FRED history fetch failed for ${seriesId}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

// The 11 standard on-the-run Treasury tenors, in curve order.
export const YIELD_CURVE_TENORS: { label: string; seriesId: string }[] = [
  { label: "1M", seriesId: "DGS1MO" },
  { label: "3M", seriesId: "DGS3MO" },
  { label: "6M", seriesId: "DGS6MO" },
  { label: "1Y", seriesId: "DGS1" },
  { label: "2Y", seriesId: "DGS2" },
  { label: "3Y", seriesId: "DGS3" },
  { label: "5Y", seriesId: "DGS5" },
  { label: "7Y", seriesId: "DGS7" },
  { label: "10Y", seriesId: "DGS10" },
  { label: "20Y", seriesId: "DGS20" },
  { label: "30Y", seriesId: "DGS30" },
];

export interface YieldCurvePoint {
  label: string;
  seriesId: string;
  yield: number | null;
  asOf: string | null;
  realtimeStart?: string | null;
}

/** Exported for reuse by fredFxProvider.ts -- same point-in-time "latest
 * observation on or before a date" primitive getYieldCurve already uses. */
export async function fetchObservationAsOf(seriesId: string, apiKey: string, onOrBefore?: string): Promise<IndicatorObservation | null> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: "1",
  });
  if (onOrBefore) params.set("observation_end", onOrBefore);
  const res = await fetch(`${FRED_BASE_URL}/series/observations?${params}`);
  if (!res.ok) {
    recordConnectorVerification("fred", false, `FRED API returned ${res.status} for ${seriesId}`);
    throw new Error(`FRED API returned ${res.status} for ${seriesId}`);
  }
  const data = await res.json();
  const rows: Array<{ date: string; value: string; realtime_start?: string; realtime_end?: string }> = data.observations ?? [];
  const row = rows.find((r) => r.value !== ".");
  recordConnectorVerification("fred", true, "FRED responded to a live request.");
  return row ? { date: row.date, value: Number(row.value), realtimeStart: row.realtime_start, realtimeEnd: row.realtime_end } : null;
}

// Full 11-tenor curve, live (default) or as of a specific historical date
// (e.g. "2019-06-03" for a pre-COVID snapshot) -- same real series either way,
// just a different observation_end cutoff.
export async function getYieldCurve(asOfDate?: string): Promise<{ curve: YieldCurvePoint[]; isLive: boolean }> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return { curve: YIELD_CURVE_TENORS.map((t) => ({ ...t, yield: null, asOf: null })), isLive: false };
  }
  try {
    const points = await Promise.all(
      YIELD_CURVE_TENORS.map(async (t) => {
        const obs = await fetchObservationAsOf(t.seriesId, apiKey, asOfDate);
        return { ...t, yield: obs?.value ?? null, asOf: obs?.date ?? null, realtimeStart: obs?.realtimeStart ?? null };
      }),
    );
    return { curve: points, isLive: points.some((p) => p.yield !== null) };
  } catch (err) {
    console.warn("FRED yield curve fetch failed:", err instanceof Error ? err.message : err);
    return { curve: YIELD_CURVE_TENORS.map((t) => ({ ...t, yield: null, asOf: null })), isLive: false };
  }
}
