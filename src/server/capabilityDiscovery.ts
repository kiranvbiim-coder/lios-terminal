import type { CapabilitySurface, LiOSCapability } from "@shared/capability";
import type { CapabilityDiscoveryResult } from "@shared/capabilityDiscovery";
import { capabilityRegistry, type CapabilityRegistry } from "./capabilityRegistry";
import type { ConnectorRegistrySnapshot } from "@shared/connectorRegistry";
import type { ManagedRuntimeState } from "./pythonRuntimeManager";
import { evaluateManagedRuntimeReadiness } from "./provisioningReadiness";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

export interface CurrentUserCapabilityReadiness {
  role: string;
  accountActive: boolean;
  selectedConnectorIds: readonly string[];
  connectors: ConnectorRegistrySnapshot;
  runtimeState: ManagedRuntimeState | null;
  pythonAvailable: boolean;
  pythonService: { ready: boolean; packages: Record<string, string>; reason: string };
}

export type CapabilityDiscoveryOptions = {
  surface?: CapabilitySurface;
  limit?: number;
  invocableOnly?: boolean;
  currentUser?: CurrentUserCapabilityReadiness;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function availabilityWeight(capability: LiOSCapability): number {
  switch (capability.availability.state) {
    case "available": return 20;
    case "configurable": return 10;
    case "experimental": return 4;
    case "degraded": return 0;
    case "disabled": return -20;
  }
}

/**
 * Registry invocability describes what can be called now, not merely what
 * was wired for a possible future execution. Authorization, entitlement and
 * live health are still rechecked by the canonical execution authority.
 */
function isInvocableNow(capability: LiOSCapability): boolean {
  return capability.aiHints.invocable && capability.availability.state === "available";
}

function rankCapability(capability: LiOSCapability, rawQuery: string): { score: number; matchedOn: string[] } | null {
  const query = normalize(rawQuery);
  const queryTokens = tokens(query);
  const id = normalize(capability.id);
  const name = normalize(capability.name);
  const description = normalize(capability.description);
  const category = normalize(capability.category);
  const tags = capability.tags.map(normalize);
  const surfaces = capability.uiHints.existingSurfaces.map(normalize);
  const preferredView = normalize(capability.uiHints.preferredView ?? "");
  const searchable = [id, name, description, category, ...tags, ...surfaces, preferredView];

  if (queryTokens.length && !queryTokens.every((token) => searchable.some((field) => field.includes(token)))) {
    return null;
  }

  let score = availabilityWeight(capability);
  const matchedOn = new Set<string>();

  if (!query) {
    if (isInvocableNow(capability)) score += 5;
    if (capability.uiHints.preferredView) score += 3;
    return { score, matchedOn: [] };
  }

  if (id === query) { score += 140; matchedOn.add("id"); }
  if (name === query) { score += 130; matchedOn.add("name"); }
  if (name.startsWith(query)) { score += 80; matchedOn.add("name"); }
  else if (name.includes(query)) { score += 55; matchedOn.add("name"); }
  if (id.startsWith(query)) { score += 55; matchedOn.add("id"); }
  else if (id.includes(query)) { score += 35; matchedOn.add("id"); }
  if (category.includes(query)) { score += 28; matchedOn.add("category"); }
  if (preferredView.includes(query)) { score += 24; matchedOn.add("preferred_view"); }

  for (const token of queryTokens) {
    if (name.includes(token)) { score += 20; matchedOn.add("name"); }
    if (id.includes(token)) { score += 12; matchedOn.add("id"); }
    if (category.includes(token)) { score += 10; matchedOn.add("category"); }
    if (tags.some((tag) => tag.includes(token))) { score += 9; matchedOn.add("tags"); }
    if (surfaces.some((surface) => surface.includes(token))) { score += 7; matchedOn.add("surface"); }
    if (description.includes(token)) { score += 5; matchedOn.add("description"); }
  }

  if (isInvocableNow(capability)) score += 5;
  if (capability.uiHints.preferredView) score += 3;
  return { score, matchedOn: [...matchedOn] };
}

/** Catalog facts remain unchanged; only a fresh request context can claim current-user readiness. */
function resolveCurrentUserReadiness(capability: LiOSCapability, current: CurrentUserCapabilityReadiness): LiOSCapability {
  if (capability.availability.state === "disabled" || capability.availability.state === "experimental") return { ...capability, aiHints: { ...capability.aiHints, invocable: false } };
  let reason: string | null = null;
  if (!current.accountActive) reason = "Current account is inactive, locked or requires a password change.";
  else if (capability.permissions.some((permission) => permission !== "current_authenticated_account")) reason = "Capability permissions require a canonical execution-policy decision; catalog presence is not authorization.";
  else if (capability.entitlements.length) reason = "Entitlement admission must be resolved by the canonical capability caller.";
  else if (capability.source.kind === "connector") {
    const id = capability.source.sourceId;
    const health = current.connectors.health.find((entry) => entry.connectorId === id);
    if (!id || !current.selectedConnectorIds.includes(id)) reason = "Connector is not selected in this user's current Connections setup.";
    else if (health?.state !== "live_verified") reason = health?.detail ?? "No current user-scoped connector verification is available.";
    // A verified connector still has no generic callable handler in this registry.
    return { ...capability, availability: reason ? { state: "configurable", reason: reason.slice(0, 1_000) } : { state: "available", reason: health?.detail.slice(0, 1_000) }, aiHints: { ...capability.aiHints, invocable: false } };
  } else if (capability.execution.target === "python_sidecar") {
    if (!["internal_admin", "internal_analyst", "internal_compliance"].includes(current.role)) reason = "Advanced quant endpoints require the existing internal role boundary.";
    else if (!current.pythonService.ready) reason = current.pythonService.reason;
    else {
      const readiness = evaluateManagedRuntimeReadiness({ state: current.runtimeState, pythonAvailable: current.pythonAvailable, requiredPackIds: ["core"] });
      if (!readiness.ready) reason = `Managed runtime is ${readiness.state}. Review LiOS Doctor in Connections.`;
      else {
        const installed = new Map(Object.entries(current.pythonService.packages).map(([name, version]) => [name.toLowerCase().replace(/[_.]+/g, "-"), version]));
        // Advanced quant spans optional scientific imports; a verified Core alone cannot prove it runnable.
        const missing = MANAGED_RUNTIME_MANIFEST.packs.filter((pack) => ["core", "fixed-income", "forecasting", "econometrics", "ml", "optimization"].includes(pack.id))
          .flatMap((pack) => pack.packages).filter((pkg) => !installed.get(pkg.name.toLowerCase().replace(/[_.]+/g, "-")) || installed.get(pkg.name.toLowerCase().replace(/[_.]+/g, "-")) === "unavailable");
        if (missing.length) reason = `Current Python inventory lacks advanced-quant dependencies: ${missing.map((pkg) => pkg.name).join(", ")}. Review the Quant pack in Connections.`;
      }
    }
  }
  if (!reason) return capability;
  return { ...capability, availability: { state: "configurable", reason: reason.slice(0, 1_000) }, aiHints: { ...capability.aiHints, invocable: false } };
}

export function discoverCapabilities(
  query: string,
  options: CapabilityDiscoveryOptions = {},
  registry: CapabilityRegistry = capabilityRegistry,
): CapabilityDiscoveryResult[] {
  const surface = options.surface ?? "command_palette";
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));

  return registry.list()
    .filter((capability) => capability.surfaces.includes(surface))
    .map((capability) => options.currentUser ? resolveCurrentUserReadiness(capability, options.currentUser) : capability)
    .filter((capability) => !options.invocableOnly || (
      isInvocableNow(capability)
    ))
    .map((capability) => ({ capability, ranking: rankCapability(capability, query) }))
    .filter((entry): entry is { capability: LiOSCapability; ranking: { score: number; matchedOn: string[] } } => Boolean(entry.ranking))
    .sort((left, right) =>
      right.ranking.score - left.ranking.score
      || left.capability.name.localeCompare(right.capability.name)
      || left.capability.id.localeCompare(right.capability.id))
    .slice(0, limit)
    .map(({ capability, ranking }) => ({
      capabilityId: capability.id,
      name: capability.name,
      description: capability.description,
      category: capability.category,
      availability: capability.availability,
      executionTarget: capability.execution.target,
      sourceKind: capability.source.kind,
      invocable: isInvocableNow(capability),
      preferredView: capability.uiHints.preferredView ?? null,
      existingSurfaces: capability.uiHints.existingSurfaces,
      score: ranking.score,
      matchedOn: ranking.matchedOn,
    }));
}
