import { useQuery } from "@tanstack/react-query";

export interface OwidRow {
  year: number;
  population: number | null;
  gdp: number | null;
  co2: number | null;
  co2PerCapita: number | null;
  co2PerGdp: number | null;
  shareGlobalCo2: number | null;
  tempChangeFromCo2: number | null;
}

export interface OwidCountry { iso3: string; name: string }
export interface OwidCountrySeries { country: string; iso3: string; history: OwidRow[]; isLive: boolean }

export function useOwidCountries() {
  return useQuery<OwidCountry[]>({
    queryKey: ["/api/owid/countries"],
    queryFn: async () => {
      const res = await fetch("/api/owid/countries");
      if (!res.ok) throw new Error("Failed to fetch OWID countries");
      return res.json();
    },
  });
}

export function useOwidCountrySeries(iso3: string) {
  return useQuery<OwidCountrySeries>({
    queryKey: ["/api/owid/country", iso3],
    queryFn: async () => {
      const res = await fetch(`/api/owid/country/${iso3}`);
      if (!res.ok) throw new Error("Failed to fetch OWID country series");
      return res.json();
    },
    enabled: !!iso3,
  });
}
