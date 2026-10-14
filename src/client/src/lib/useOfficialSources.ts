import { useQuery } from "@tanstack/react-query";

// ── CFTC (official, free, no key -- publicreporting.cftc.gov) ──────────────

export interface CftcMarket { code: string; label: string; marketName: string }

export interface CftcCotRow {
  symbol: string; date: string; name: string; sector: string;
  open_interest: number; noncomm_long: number; noncomm_short: number; noncomm_spread: number;
  comm_long: number; comm_short: number; nonrept_long: number; nonrept_short: number;
  change_open_interest: number | null; change_noncomm_long: number | null; change_noncomm_short: number | null;
  change_comm_long: number | null; change_comm_short: number | null;
  pct_noncomm_long: number; pct_noncomm_short: number; pct_comm_long: number; pct_comm_short: number;
  traders_noncomm_long: number; traders_noncomm_short: number; traders_comm_long: number; traders_comm_short: number;
  conc_top4_long: number; conc_top4_short: number; conc_top8_long: number; conc_top8_short: number;
}

export function useCftcCot(code: string) {
  return useQuery<CftcCotRow[]>({
    queryKey: ["/api/cftc/cot", code],
    queryFn: async () => {
      const res = await fetch(`/api/cftc/cot/${code}`);
      if (!res.ok) throw new Error("Failed to fetch CFTC COT data");
      return res.json();
    },
    enabled: !!code,
  });
}

// ── SEC EDGAR (official, free, no key -- data.sec.gov / sec.gov) ───────────

export interface EdgarInsiderTransaction {
  symbol: string; issuerName: string; filerName: string; filerTitle: string | null;
  isDirector: boolean; isOfficer: boolean; isTenPercentOwner: boolean;
  transactionDate: string; transactionCode: string; transactionCodeLabel: string; isOpenMarket: boolean;
  securityTitle: string; isDerivative: boolean;
  shares: number | null; pricePerShare: number | null; value: number | null;
  acquiredDisposed: "A" | "D" | null; sharesOwnedAfter: number | null;
  accessionNumber: string; filingUrl: string;
}

export function useEdgarInsiders(ticker: string) {
  return useQuery<EdgarInsiderTransaction[]>({
    queryKey: ["/api/edgar/insiders", ticker],
    queryFn: async () => {
      const res = await fetch(`/api/edgar/insiders/${ticker}`);
      if (!res.ok) throw new Error("Failed to fetch SEC EDGAR insider data");
      return res.json();
    },
    enabled: !!ticker,
  });
}

// Real filing metadata (10-K/10-Q/8-K/4/DEF 14A, real SEC.gov URLs) -- US
// SEC filers only, so this returns empty for non-US-listed symbols rather
// than fabricating anything.
export interface EdgarFilingSummary {
  formType: string; filedDate: string; accessionNumber: string; filingUrl: string;
}

export function useEdgarFilings(ticker: string, limit = 40) {
  return useQuery<EdgarFilingSummary[]>({
    queryKey: ["/api/edgar/filings", ticker, limit],
    queryFn: async () => {
      const res = await fetch(`/api/edgar/filings/${ticker}?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch SEC EDGAR filings");
      return res.json();
    },
    enabled: !!ticker,
  });
}

// ── World Bank (official, free, no key -- api.worldbank.org) ───────────────

export type WbDomain = "economics_policy" | "supply_chain" | "environment_sustainability" | "tourism_hospitality";
export interface WbIndicatorProfile { code: string; name: string; unit: string; category: string; domain?: WbDomain }
export interface WbCountry { iso2: string; iso3: string; name: string }
export interface WbObservation { year: string; value: number }
export interface WbIndicatorResult {
  code: string; name: string; unit: string; country: string; countryCode: string;
  latestValue: number | null; latestYear: string | null; history: WbObservation[]; isLive: boolean;
  status?: "live" | "cached" | "unavailable"; retrievedAt?: string | null;
  page?: number; limit?: number; hasMore?: boolean; nextPage?: number | null;
}
export interface WbCompareResult { country: string; countryCode: string; value: number | null; year: string | null }
export interface WbCatalogPage<T> { items: T[]; page: number; limit: number; total: number | null; hasMore: boolean; nextPage: number | null; status: "live" | "cached" | "unavailable"; retrievedAt: string | null }

export function useWbCountries() {
  return useQuery<WbCountry[]>({
    queryKey: ["/api/worldbank/countries"],
    queryFn: async () => {
      const res = await fetch("/api/worldbank/countries");
      if (!res.ok) throw new Error("Failed to fetch World Bank countries");
      return res.json();
    },
  });
}

export function useWbProviderCountries(page = 1, limit = 100, search = "") {
  return useQuery<WbCatalogPage<WbCountry>>({
    queryKey: ["/api/worldbank/provider/countries", page, limit, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/worldbank/provider/countries?${params}`);
      if (!res.ok) throw new Error("Failed to fetch World Bank country catalog");
      return res.json();
    },
  });
}

export function useWbCatalog(domain: WbDomain) {
  return useQuery<WbIndicatorProfile[]>({
    queryKey: ["/api/worldbank/catalog", domain],
    queryFn: async () => {
      const res = await fetch(`/api/worldbank/catalog/${domain}`);
      if (!res.ok) throw new Error("Failed to fetch World Bank catalog");
      return res.json();
    },
  });
}

export function useWbProviderCatalog(page = 1, limit = 50, search = "", enabled = true) {
  return useQuery<WbCatalogPage<WbIndicatorProfile & { sourceNote?: string }>>({
    queryKey: ["/api/worldbank/provider/indicators", page, limit, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/worldbank/provider/indicators?${params}`);
      if (!res.ok) throw new Error("Failed to fetch World Bank provider catalog");
      return res.json();
    },
    enabled,
  });
}

export function useWbIndicator(code: string, country: string, options: { yearsBack?: number; startYear?: number; endYear?: number; page?: number; limit?: number } = {}) {
  const params = new URLSearchParams({ country });
  for (const [key, value] of Object.entries(options)) if (value !== undefined) params.set(key, String(value));
  return useQuery<WbIndicatorResult>({
    queryKey: ["/api/worldbank/indicator", code, country, options],
    queryFn: async () => {
      const res = await fetch(`/api/worldbank/indicator/${code}?${params}`);
      if (!res.ok) throw new Error("Failed to fetch World Bank indicator");
      return res.json();
    },
    enabled: !!code && !!country,
  });
}

// Empty/omitted countries list defers to the server's default country set.
export function useWbCompare(code: string, countries: string[] = []) {
  return useQuery<WbCompareResult[]>({
    queryKey: ["/api/worldbank/compare", code, countries.join(",")],
    queryFn: async () => {
      const url = countries.length ? `/api/worldbank/compare/${code}?countries=${countries.join(",")}` : `/api/worldbank/compare/${code}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch World Bank comparison");
      return res.json();
    },
    enabled: !!code,
  });
}

// ── NASA POWER (official, free, no key -- power.larc.nasa.gov) ─────────────

export type LocationTag = "port" | "tourist_hub" | "both";
export interface ClimateLocation { code: string; name: string; lat: number; lon: number; tag: LocationTag }
export interface ClimateReading {
  date: string; tempAvgC: number | null; tempMaxC: number | null; tempMinC: number | null;
  precipMm: number | null; windSpeedMs: number | null; solarKwhM2: number | null;
}
export interface ClimateSnapshot { location: ClimateLocation; readings: ClimateReading[]; latest: ClimateReading | null; isLive: boolean }

export function useClimateLocations() {
  return useQuery<ClimateLocation[]>({
    queryKey: ["/api/climate/locations"],
    queryFn: async () => {
      const res = await fetch("/api/climate/locations");
      if (!res.ok) throw new Error("Failed to fetch climate locations");
      return res.json();
    },
  });
}

export function useClimateSnapshot(code: string, days = 7) {
  return useQuery<ClimateSnapshot | null>({
    queryKey: ["/api/climate/snapshot", code, days],
    queryFn: async () => {
      const res = await fetch(`/api/climate/snapshot/${code}?days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch climate snapshot");
      return res.json();
    },
    enabled: !!code,
  });
}

export function useClimateAll(tag?: LocationTag) {
  return useQuery<ClimateSnapshot[]>({
    queryKey: ["/api/climate/all", tag ?? "any"],
    queryFn: async () => {
      const url = tag ? `/api/climate/all?tag=${tag}` : "/api/climate/all";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch climate data");
      return res.json();
    },
  });
}
