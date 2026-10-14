import {
  capabilityDiscoveryResponseSchema,
  type CapabilityDiscoveryResult,
} from "@shared/capabilityDiscovery";
import type { ViewMode } from "./terminalTypes";

const SAFE_DISCOVERY_VIEWS = new Set<ViewMode>([
  "valuation",
  "optimizer",
  "fixedincome",
  "options",
  "advancedrisk",
  "macrodashboard",
  "supplychainquant",
  "environmentquant",
  "research",
  "integratedmodel",
  "decisionengine",
  "quantworkbench",
  "connectors",
]);

export function capabilityDiscoveryView(result: CapabilityDiscoveryResult): ViewMode | null {
  const view = result.preferredView;
  return view && SAFE_DISCOVERY_VIEWS.has(view as ViewMode) ? view as ViewMode : null;
}

export async function fetchUniversalCapabilityDiscovery(
  query: string,
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<CapabilityDiscoveryResult[]> {
  const params = new URLSearchParams({
    q: query,
    surface: "command_palette",
    limit: String(Math.max(1, Math.min(options.limit ?? 10, 20))),
  });
  const response = await fetch(`/api/capabilities/discover?${params.toString()}`, {
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Capability discovery failed with ${response.status}`);
  const parsed = capabilityDiscoveryResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Capability discovery returned an invalid response.");
  return parsed.data.results;
}
