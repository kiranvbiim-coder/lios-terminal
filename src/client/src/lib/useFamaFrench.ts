import { useQuery } from "@tanstack/react-query";

export interface FactorRow3 { date: string; MktRF: number; SMB: number; HML: number; RF: number }
export interface FactorRow4 extends FactorRow3 { Mom: number }
export interface FactorRow5 { date: string; MktRF: number; SMB: number; HML: number; RMW: number; CMA: number; RF: number }

export function useFamaFrenchStatus() {
  return useQuery<{ available: boolean }>({
    queryKey: ["/api/famafrench/status"],
    queryFn: async () => {
      const res = await fetch("/api/famafrench/status");
      if (!res.ok) throw new Error("Failed to fetch Fama-French status");
      return res.json();
    },
  });
}

export function useFamaFrench3(start: string, end: string) {
  return useQuery<FactorRow3[]>({
    queryKey: ["/api/famafrench/factors3", start, end],
    queryFn: async () => {
      const res = await fetch(`/api/famafrench/factors3?start=${start}&end=${end}`);
      if (!res.ok) throw new Error("Failed to fetch Fama-French 3-factor data");
      return res.json();
    },
    enabled: !!start && !!end,
    staleTime: 60 * 60 * 1000,
  });
}

export function useCarhart4(start: string, end: string) {
  return useQuery<FactorRow4[]>({
    queryKey: ["/api/famafrench/carhart4", start, end],
    queryFn: async () => {
      const res = await fetch(`/api/famafrench/carhart4?start=${start}&end=${end}`);
      if (!res.ok) throw new Error("Failed to fetch Carhart 4-factor data");
      return res.json();
    },
    enabled: !!start && !!end,
    staleTime: 60 * 60 * 1000,
  });
}

export function useFamaFrench5(start: string, end: string) {
  return useQuery<FactorRow5[]>({
    queryKey: ["/api/famafrench/factors5", start, end],
    queryFn: async () => {
      const res = await fetch(`/api/famafrench/factors5?start=${start}&end=${end}`);
      if (!res.ok) throw new Error("Failed to fetch Fama-French 5-factor data");
      return res.json();
    },
    enabled: !!start && !!end,
    staleTime: 60 * 60 * 1000,
  });
}
