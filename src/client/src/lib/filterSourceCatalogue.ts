import type { SourceRegistryGroup, SourceRegistryItem } from "@shared/sourceRegistry";

/** Display-only filtering of P1 canonical source registry records. Never confers permissions. */
export function filterSourceCatalogue(groups: readonly SourceRegistryGroup[], query: string, connectedOnly: boolean): SourceRegistryItem[] {
  const term = query.trim().toLocaleLowerCase();
  return groups.flatMap(group => group.items.filter(item => {
    if (connectedOnly && !item.connected) return false;
    if (!term) return true;
    return [item.name, item.detail, item.state, item.sourceType, group.title].some(value => value.toLocaleLowerCase().includes(term));
  }));
}