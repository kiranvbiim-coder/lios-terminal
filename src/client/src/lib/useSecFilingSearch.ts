// Real full-text search across SEC filing content (see
// server/secEdgarRoutes.ts's /api/edgar/filing-search, backed by
// python-service/sec_search.py's edgartools/EFTS integration). Distinct
// from useEdgarFilings/useEdgarInsiders in useOfficialSources.ts, which
// cover filing metadata and Form 4 ownership, not text content.
import { useQuery } from "@tanstack/react-query";

export interface FilingSearchResult {
  company: string;
  ticker: string | null;
  cik: number;
  form: string;
  filed: string;
  accessionNumber: string;
  score: number;
  filingUrl: string;
}

export interface FilingSearchResponse {
  results: FilingSearchResult[];
  totalCount: number;
  returnedCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface FilingSearchOptions {
  offset?: number;
  limit?: number;
  from?: string;
  to?: string;
}

export function useSecFilingSearch(query: string, ticker: string, enabled: boolean, options: FilingSearchOptions = {}) {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100);
  return useQuery<FilingSearchResponse>({
    queryKey: ["/api/edgar/filing-search", query, ticker, offset, limit, options.from ?? "", options.to ?? ""],
    queryFn: async () => {
      const res = await fetch("/api/edgar/filing-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          ticker: ticker || undefined,
          limit,
          offset,
          from: options.from || undefined,
          to: options.to || undefined,
        }),
      });
      if (!res.ok) throw new Error("SEC filing search failed");
      return res.json();
    },
    enabled: enabled && !!query.trim(),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
