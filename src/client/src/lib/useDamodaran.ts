// React Query hook for Damodaran industry beta/WACC reference data (see
// server/damodaranData.ts). Same "return real data or null, never fabricate"
// contract used across LiOS data hooks -- an unmatched industry resolves to null and
// the UI just doesn't offer a lookup result, not a guessed number.
import { useQuery } from "@tanstack/react-query";

export interface DamodaranIndustryBenchmark {
  industry: string;
  numberOfFirms: number | null;
  beta: number | null;
  unleveredBeta: number | null;
  unleveredBetaCorrectedForCash: number | null;
  debtToEquity: number | null;
  costOfEquityPct: number | null;
  afterTaxCostOfDebtPct: number | null;
  wacc: number | null;
}

export function useDamodaranIndustryLookup(industry: string, enabled: boolean) {
  return useQuery<DamodaranIndustryBenchmark | null>({
    queryKey: ["/api/quant/damodaran/industries", industry],
    queryFn: async () => {
      const res = await fetch(`/api/quant/damodaran/industries/${encodeURIComponent(industry)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: enabled && !!industry.trim(),
    staleTime: 24 * 60 * 60 * 1000, // updates a few times a year -- a day is plenty fresh
    retry: false,
  });
}

export function useDamodaranIndustryList() {
  return useQuery<DamodaranIndustryBenchmark[]>({
    queryKey: ["/api/quant/damodaran/industries"],
    queryFn: async () => {
      const res = await fetch("/api/quant/damodaran/industries");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}
