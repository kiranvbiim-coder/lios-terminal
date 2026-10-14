import type { CapabilitySurface, LiOSCapability } from "@shared/capability";
import type { CapabilityDiscoveryResult } from "@shared/capabilityDiscovery";
import { capabilityRegistry, type CapabilityRegistry } from "./capabilityRegistry";

export type CapabilityDiscoveryOptions = {
  surface?: CapabilitySurface;
  limit?: number;
  invocableOnly?: boolean;
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
    if (capability.aiHints.invocable) score += 5;
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

  if (capability.aiHints.invocable) score += 5;
  if (capability.uiHints.preferredView) score += 3;
  return { score, matchedOn: [...matchedOn] };
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
    .filter((capability) => !options.invocableOnly || (
      capability.aiHints.invocable && capability.availability.state === "available"
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
      invocable: capability.aiHints.invocable,
      preferredView: capability.uiHints.preferredView ?? null,
      existingSurfaces: capability.uiHints.existingSurfaces,
      score: ranking.score,
      matchedOn: ranking.matchedOn,
    }));
}
