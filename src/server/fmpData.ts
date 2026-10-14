import { getCredential } from "./terminalConfig";
import { recordConnectorVerification } from "./connectorVerification";

const BASE_URL = "https://financialmodelingprep.com/stable";

function apiKey(): string | null {
  return getCredential("FMP_API_KEY", "fmpApiKey");
}

async function request<T>(endpoint: string, parameters: Record<string, string | number>): Promise<T[]> {
  const key = apiKey(); if (!key) return []; const url = new URL(`${BASE_URL}/${endpoint}`); for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, String(value));
  try { const response = await fetch(url, { headers: { apikey: key }, signal: AbortSignal.timeout(15_000) }); if (!response.ok) { recordConnectorVerification("fmp", false, `FMP ${endpoint} returned HTTP ${response.status}.`); console.warn(`FMP ${endpoint} returned HTTP ${response.status}.`); return []; } const body = await response.json(); if (!Array.isArray(body)) console.warn(`FMP ${endpoint} returned a non-array payload.`); recordConnectorVerification("fmp", true, "FMP responded to a live request."); return Array.isArray(body) ? body as T[] : []; } catch (error) { recordConnectorVerification("fmp", false, error instanceof Error ? error.message : "unknown error"); console.warn(`FMP ${endpoint} request failed:`, error instanceof Error ? error.message : "unknown error"); return []; }
}

export type FmpEstimate = {
  symbol: string; date: string;
  revenueLow?: number; revenueHigh?: number; revenueAvg?: number;
  ebitdaLow?: number; ebitdaHigh?: number; ebitdaAvg?: number;
  ebitLow?: number; ebitHigh?: number; ebitAvg?: number;
  epsLow?: number; epsHigh?: number; epsAvg?: number;
  numAnalystsRevenue?: number; numAnalystsEps?: number;
};
export type FmpRevenueSegment = { symbol: string; fiscalYear: number; period: string; reportedCurrency: string; date: string; data: Record<string, number> };
export interface FmpDataQuery { limit?: number; page?: number }

export function boundFmpQuery(query: FmpDataQuery = {}): { limit: number; page: number } {
  return {
    limit: Math.min(Math.max(Math.trunc(query.limit ?? 20), 1), 100),
    page: Math.max(Math.trunc(query.page ?? 0), 0),
  };
}

function normalizeFmpQuery(query: FmpDataQuery | number): FmpDataQuery {
  return typeof query === "number" ? { limit: query } : query;
}

export const getFmpAnalystEstimates = (symbol: string, query: FmpDataQuery | number = {}) => {
  const { limit, page } = boundFmpQuery(normalizeFmpQuery(query));
  return request<FmpEstimate>("analyst-estimates", { symbol: symbol.toUpperCase(), period: "annual", page, limit });
};

export async function getFmpRevenueSegments(symbol: string, query: FmpDataQuery = {}) {
  const { limit, page } = boundFmpQuery(query);
  const parameters = { symbol: symbol.toUpperCase(), page, limit };
  const [products, geographies] = await Promise.all([
    request<FmpRevenueSegment>("revenue-product-segmentation", parameters),
    request<FmpRevenueSegment>("revenue-geographic-segmentation", parameters),
  ]);
  return { products, geographies };
}
