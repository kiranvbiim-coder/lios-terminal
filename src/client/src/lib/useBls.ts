import { useQuery } from "@tanstack/react-query";

export interface BlsObservation { date: string; value: number }
export interface BlsSeriesResult {
  seriesId: string; name: string; unit: string; history: BlsObservation[]; isLive: boolean;
  status?: "live" | "cached" | "unavailable"; retrievedAt?: string | null; sourceReference?: string;
}
export interface BlsSeriesOptions { yearsBack?: number; startYear?: number; endYear?: number }

export function useBlsSeries(seriesId: string, options: BlsSeriesOptions = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) if (value !== undefined) params.set(key, String(value));
  const suffix = params.toString() ? `?${params}` : "";
  return useQuery<BlsSeriesResult>({
    queryKey: ["/api/bls/series", seriesId, options],
    queryFn: async () => {
      const res = await fetch(`/api/bls/series/${seriesId}${suffix}`);
      if (!res.ok) throw new Error("Failed to fetch BLS series");
      return res.json();
    },
    enabled: !!seriesId,
  });
}

export interface BlsCatalogPage {
  items: Array<{ seriesId: string; name: string; unit: string }>;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextPage: number | null;
  source: string;
}

export function useBlsCatalog(page = 1, limit = 50, search = "") {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set("search", search);
  return useQuery<BlsCatalogPage>({
    queryKey: ["/api/bls/catalog", page, limit, search],
    queryFn: async () => {
      const res = await fetch(`/api/bls/catalog?${params}`);
      if (!res.ok) throw new Error("Failed to fetch BLS catalog");
      return res.json();
    },
  });
}
