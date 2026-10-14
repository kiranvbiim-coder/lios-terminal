import { useQuery } from "@tanstack/react-query";

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

export interface IndicatorDetail {
  quote: IndicatorQuote;
  history: { date: string; value: number }[];
  provenance?: { provider: string; sourceReference: string; status: "live" | "unavailable" };
}

export function useIndicators() {
  return useQuery<IndicatorQuote[]>({
    queryKey: ["/api/economics/indicators"],
    queryFn: async () => {
      const res = await fetch("/api/economics/indicators");
      if (!res.ok) throw new Error("Failed to fetch indicators");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useIndicatorDetail(seriesId: string, options: { points?: number; start?: string; end?: string } = {}) {
  const query = new URLSearchParams();
  if (options.points !== undefined) query.set("points", String(options.points));
  if (options.start) query.set("start", options.start);
  if (options.end) query.set("end", options.end);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return useQuery<IndicatorDetail>({
    queryKey: ["/api/economics/indicator", seriesId, options],
    queryFn: async () => {
      const res = await fetch(`/api/economics/indicator/${seriesId}${suffix}`);
      if (!res.ok) throw new Error("Failed to fetch indicator detail");
      return res.json();
    },
    enabled: !!seriesId,
  });
}

/**
 * Live risk-free rate reference, sourced from FRED's 3-month (13-week) US
 * Treasury Bill yield (DGS3MO) -- the standard academic/practitioner proxy
 * for the risk-free rate in CAPM/WACC (see Damodaran; this is also the
 * closest real, regularly-quoted instrument to the "T-bill rate" concept --
 * the US Treasury does not actually auction a 14-day bill, so this is the
 * grounded equivalent rather than a literal 14-day series). Every panel that
 * takes a manual risk-free-rate input (Valuation, Options, Risk/Return) can
 * offer a "use live rate" quick-fill from this hook instead of leaving the
 * field permanently defaulted to a stale guess.
 */
export function useRiskFreeRate() {
  const { data, isLoading } = useIndicatorDetail("DGS3MO");
  return {
    ratePercent: data?.quote.value ?? null,
    asOf: data?.quote.asOf ?? null,
    isLive: data?.quote.isLive ?? false,
    isLoading,
  };
}

export function useSupplyChainIndicators() {
  return useQuery<IndicatorQuote[]>({
    queryKey: ["/api/supplychain/indicators"],
    queryFn: async () => {
      const res = await fetch("/api/supplychain/indicators");
      if (!res.ok) throw new Error("Failed to fetch supply chain indicators");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useSupplyChainIndicatorDetail(seriesId: string) {
  return useQuery<IndicatorDetail>({
    queryKey: ["/api/supplychain/indicator", seriesId],
    queryFn: async () => {
      const res = await fetch(`/api/supplychain/indicator/${seriesId}`);
      if (!res.ok) throw new Error("Failed to fetch supply chain indicator detail");
      return res.json();
    },
    enabled: !!seriesId,
  });
}

export function useEnvironmentIndicators() {
  return useQuery<IndicatorQuote[]>({
    queryKey: ["/api/environment/indicators"],
    queryFn: async () => {
      const res = await fetch("/api/environment/indicators");
      if (!res.ok) throw new Error("Failed to fetch environment indicators");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useEnvironmentIndicatorDetail(seriesId: string) {
  return useQuery<IndicatorDetail>({
    queryKey: ["/api/environment/indicator", seriesId],
    queryFn: async () => {
      const res = await fetch(`/api/environment/indicator/${seriesId}`);
      if (!res.ok) throw new Error("Failed to fetch environment indicator detail");
      return res.json();
    },
    enabled: !!seriesId,
  });
}

export function useTourismIndicators() {
  return useQuery<IndicatorQuote[]>({
    queryKey: ["/api/tourism/indicators"],
    queryFn: async () => {
      const res = await fetch("/api/tourism/indicators");
      if (!res.ok) throw new Error("Failed to fetch tourism indicators");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useTourismIndicatorDetail(seriesId: string) {
  return useQuery<IndicatorDetail>({
    queryKey: ["/api/tourism/indicator", seriesId],
    queryFn: async () => {
      const res = await fetch(`/api/tourism/indicator/${seriesId}`);
      if (!res.ok) throw new Error("Failed to fetch tourism indicator detail");
      return res.json();
    },
    enabled: !!seriesId,
  });
}

// Generic FRED-backed domain indicator access -- all four domain-specific
// endpoint groups above (economics/supplychain/environment/tourism) return
// the identical IndicatorQuote/IndicatorDetail shape, just under different
// URL prefixes, so a cross-domain consumer (the Indicator Workbench) can
// dispatch through this map instead of duplicating four near-identical hooks.
export type FredDomain = "economics_policy" | "supply_chain" | "environment_sustainability" | "tourism_hospitality";

const DOMAIN_ENDPOINTS: Record<FredDomain, { list: string; detail: string }> = {
  economics_policy: { list: "/api/economics/indicators", detail: "/api/economics/indicator" },
  supply_chain: { list: "/api/supplychain/indicators", detail: "/api/supplychain/indicator" },
  environment_sustainability: { list: "/api/environment/indicators", detail: "/api/environment/indicator" },
  tourism_hospitality: { list: "/api/tourism/indicators", detail: "/api/tourism/indicator" },
};

export function useDomainIndicators(domain: FredDomain) {
  const endpoint = DOMAIN_ENDPOINTS[domain].list;
  return useQuery<IndicatorQuote[]>({
    queryKey: [endpoint],
    queryFn: async () => {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("Failed to fetch indicators");
      return res.json();
    },
  });
}

export function useDomainIndicatorDetail(domain: FredDomain, seriesId: string, options: { points?: number; start?: string; end?: string } = {}) {
  const endpoint = DOMAIN_ENDPOINTS[domain].detail;
  const query = new URLSearchParams();
  if (options.points !== undefined) query.set("points", String(options.points));
  if (options.start) query.set("start", options.start);
  if (options.end) query.set("end", options.end);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return useQuery<IndicatorDetail>({
    queryKey: [endpoint, seriesId, options],
    queryFn: async () => {
      const res = await fetch(`${endpoint}/${seriesId}${suffix}`);
      if (!res.ok) throw new Error("Failed to fetch indicator detail");
      return res.json();
    },
    enabled: !!seriesId,
  });
}

export interface YieldCurvePoint {
  label: string;
  seriesId: string;
  yield: number | null;
  asOf: string | null;
}

export interface YieldCurveResponse {
  curve: YieldCurvePoint[];
  isLive: boolean;
}

export function useYieldCurve(asOfDate?: string) {
  return useQuery<YieldCurveResponse>({
    queryKey: ["/api/fred/yieldcurve", asOfDate ?? "live"],
    queryFn: async () => {
      const url = asOfDate ? `/api/fred/yieldcurve?date=${asOfDate}` : "/api/fred/yieldcurve";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch yield curve");
      return res.json();
    },
    refetchInterval: asOfDate ? false : 60000,
    staleTime: asOfDate ? Infinity : 30000,
  });
}
