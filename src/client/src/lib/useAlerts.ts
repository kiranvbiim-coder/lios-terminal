import { useQuery } from "@tanstack/react-query";
import type { Alert } from "@shared/schema";
import { useAudience, type Audience } from "@/lib/audience";

// Internal alerts are personal to each analyst (/api/alerts, keyed off
// req.user.id); the client build reads the org's shared alert list instead
// (/api/client/dashboard/alerts, requireFullClient) -- see
// server/clientRoutes.ts, which now returns the same shape (including
// createdAt/triggeredAt) so this hook's one query works for both audiences.
export const alertsUrlFor = (audience: Audience) => (audience === "client" ? "/api/client/dashboard/alerts" : "/api/alerts");

export function useAlerts() {
  const alertsUrl = alertsUrlFor(useAudience());
  return useQuery<Alert[]>({
    queryKey: [alertsUrl],
    queryFn: async () => {
      const res = await fetch(alertsUrl);
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
    // Refreshed by the Gateway `data.invalidate` event (alert triggered), not by polling.
    staleTime: 10_000,
  });
}
