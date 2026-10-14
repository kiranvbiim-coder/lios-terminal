import type { QueryClient } from "@tanstack/react-query";
import { alertsUrlFor } from "../useAlerts";
import type { GatewayInvalidationTopic } from "@shared/gatewayProtocol";

/** Query keys held by the UI for each topic the Home can announce (the Gateway `data.invalidate` event). */
export const INVALIDATION_QUERY_KEYS: Record<Exclude<GatewayInvalidationTopic, "quantlab">, ReadonlyArray<readonly unknown[]>> = {
  alerts: [[alertsUrlFor("internal")], [alertsUrlFor("client")]],
  backup: [["/api/backup"]],
  license: [["/api/license/status"]],
  devices: [["/api/devices"]],
};

export function invalidateTopics(queryClient: QueryClient, topics: readonly GatewayInvalidationTopic[]): void {
  for (const topic of topics) {
    if (topic === "quantlab") continue; // Quant Lab keeps its own local state and subscribes to the event directly.
    for (const queryKey of INVALIDATION_QUERY_KEYS[topic]) void queryClient.invalidateQueries({ queryKey });
  }
}

/** After a (re)connect nothing is known to be fresh, so every announced topic is refetched once. */
export function invalidateAllTopics(queryClient: QueryClient): void {
  invalidateTopics(queryClient, Object.keys(INVALIDATION_QUERY_KEYS) as Array<keyof typeof INVALIDATION_QUERY_KEYS>);
}
