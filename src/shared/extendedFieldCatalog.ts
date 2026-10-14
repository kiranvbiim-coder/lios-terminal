import type { ExtendedFieldDescriptor } from "./dataFieldDictionary";
import type { ProviderSchemaDiscoveryResult } from "./dataMapping";

export interface ExtendedFieldCatalogEntry extends ExtendedFieldDescriptor {
  datasetKey: string;
  firstSeenAt: string;
  sourceEvidence: "schema_discovery" | "confirmed_mapping";
}

/**
 * Builds a deterministic, provider-namespaced catalog from schema-discovery
 * results. Canonical suggestions are excluded; provider-specific fields stay
 * discoverable without being promoted into the canonical dictionary.
 */
export function buildExtendedFieldCatalog(
  discoveries: readonly ProviderSchemaDiscoveryResult[],
  firstSeenAt = new Date().toISOString(),
): ExtendedFieldCatalogEntry[] {
  const entries = new Map<string, ExtendedFieldCatalogEntry>();
  for (const discovery of discoveries) {
    for (const field of discovery.fields) {
      if (field.descriptor.kind !== "extended") continue;
      const existing = entries.get(field.descriptor.id);
      if (existing) continue;
      entries.set(field.descriptor.id, {
        ...field.descriptor,
        datasetKey: discovery.datasetKey,
        firstSeenAt,
        sourceEvidence: "schema_discovery",
      });
    }
  }
  return [...entries.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function searchExtendedFieldCatalog(
  entries: readonly ExtendedFieldCatalogEntry[],
  query = "",
  providerId?: string,
): ExtendedFieldCatalogEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedProvider = providerId?.trim().toLowerCase();
  return entries.filter((entry) => {
    if (normalizedProvider && entry.providerId.toLowerCase() !== normalizedProvider) return false;
    if (!normalizedQuery) return true;
    return [entry.id, entry.providerId, entry.providerField, entry.name, entry.description, entry.datasetKey]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}
