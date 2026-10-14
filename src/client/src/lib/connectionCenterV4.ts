import type { ConnectionCenterCategoryId } from "@shared/connectionCenter";
import type { SourceRegistry, SourceRegistryItem } from "@shared/sourceRegistry";

export function sourceBelongsToConnectionCategory(
  item: SourceRegistryItem,
  category: ConnectionCenterCategoryId,
): boolean {
  switch (category) {
    case "data_providers":
      return item.category !== "ai"
        && item.sourceType !== "database"
        && item.sourceType !== "file"
        && item.sourceType !== "cloud_storage"
        && item.sourceType !== "local_model";
    case "databases":
      return item.sourceType === "database";
    case "files":
      return item.sourceType === "file" || item.sourceType === "cloud_storage";
    case "ai_providers":
      return item.category === "ai" || item.sourceType === "local_model";
    case "communications":
      return false;
  }
}

export function connectionCategoryItems(
  registry: SourceRegistry,
  category: ConnectionCenterCategoryId,
): SourceRegistryItem[] {
  return registry.groups
    .flatMap((group) => group.items)
    .filter((item) => sourceBelongsToConnectionCategory(item, category));
}

export function connectionCategoryCount(
  registry: SourceRegistry,
  category: ConnectionCenterCategoryId,
): number {
  return connectionCategoryItems(registry, category).length;
}
