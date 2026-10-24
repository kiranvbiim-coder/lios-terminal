import type { SourceRegistryGroup, SourceRegistryItem } from "@shared/sourceRegistry";

/**
 * Display-only search of the canonical SourceRegistry returned for this user.
 * Search never enables, configures, transmits or authorizes any source.
 */
export function filterSourceCatalogue(groups: readonly SourceRegistryGroup[], query: string, connectedOnly: boolean): SourceRegistryItem[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  return groups.flatMap(group => group.items.filter(item => {
    if (connectedOnly && !item.connected) return false;
    if (!terms.length) return true;
    const searchable = [
      item.name,
      item.detail,
      item.connectorId,
      item.sourceType,
      item.category,
      item.state.replaceAll("_", " "),
      group.title,
      group.description,
      ...item.capabilities.flatMap(capability => [
        capability.contractFamily,
        capability.coverage ?? "",
        ...(capability.fields ?? []),
      ]),
    ].join(" ").toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }));
}
