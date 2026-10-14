import type {
  ConnectorCategory,
  ConnectorDefinition,
  ConnectorRegistrySnapshot,
  ConnectorRuntimeState,
  ConnectorSourceType,
} from "@shared/connectorRegistry";
import {
  getConnectorLicenseCaveat,
  isConnectorRuntimeOperational,
} from "@shared/connectorRegistry";
import type { SourceConnection } from "@shared/schema";
import type {
  SourceRegistry,
  SourceRegistryGroup,
  SourceRegistryGroupId,
  SourceRegistryItem,
  SourceRegistryItemState,
  SourceRegistrySavedState,
} from "@shared/sourceRegistry";
import { getUserScopedConnectorRegistrySnapshot } from "./connectorService";
import { listSourceConnections } from "./sourceConnectionService";

const GROUP_ORDER: SourceRegistryGroupId[] = [
  "files",
  "finance_market",
  "economic_public",
  "custom",
  "cloud",
];

const GROUP_DETAILS: Record<SourceRegistryGroupId, Omit<SourceRegistryGroup, "id" | "items">> = {
  files: {
    title: "Files",
    description: "Upload structured files and reuse normalized observations downstream.",
  },
  finance_market: {
    title: "Finance & Market",
    description: "Market, fundamentals, filings, and digital-asset data sources.",
  },
  economic_public: {
    title: "Economic & Public",
    description: "Public macroeconomic, research, and policy data sources.",
  },
  custom: {
    title: "Custom",
    description: "Private APIs, databases, sidecars, and other configured integrations.",
  },
  cloud: {
    title: "Cloud",
    description: "Cloud storage sources available to the workspace.",
  },
};

const SAVED_STATES: SourceRegistrySavedState[] = [
  "configured",
  "healthy",
  "degraded",
  "unreachable",
  "invalid",
];

function isSavedState(state: string): state is SourceRegistrySavedState {
  return SAVED_STATES.includes(state as SourceRegistrySavedState);
}

function sourceGroupFor(
  sourceType: ConnectorSourceType,
  category: ConnectorCategory,
): SourceRegistryGroupId {
  if (sourceType === "file") return "files";
  if (sourceType === "cloud_storage") return "cloud";
  if (category === "market" || category === "fundamentals" || category === "filings" || category === "crypto") {
    return "finance_market";
  }
  if (category === "macro" || category === "research") return "economic_public";
  return "custom";
}

function fallbackCatalogState(definition: ConnectorDefinition): ConnectorRuntimeState {
  return definition.adapterImplemented ? "adapter_available" : "catalog_only";
}

function catalogDetail(
  state: ConnectorRuntimeState,
  definition: ConnectorDefinition,
): string {
  if (state === "catalog_only") return "Catalog entry; no runtime adapter is implemented.";
  if (state === "adapter_available") return "Adapter available; live verification has not been completed.";
  return definition.description ?? "Runtime status available.";
}

function connectionDetail(connection: SourceConnection): string {
  return connection.statusDetail?.trim() || `Saved connection status: ${connection.status}.`;
}

function itemForCatalog(
  definition: ConnectorDefinition,
  runtimeState: ConnectorRuntimeState,
  detail: string,
  lastCheckedAt: string | null,
  lastHealthyAt: string | null,
): SourceRegistryItem {
  return {
    id: `catalog:${definition.id}`,
    connectorId: definition.id,
    name: definition.name,
    kind: "catalog",
    group: sourceGroupFor(definition.sourceType, definition.category),
    sourceType: definition.sourceType,
    category: definition.category,
    state: runtimeState,
    detail,
    connected: false,
    operational: isConnectorRuntimeOperational(runtimeState),
    adapterImplemented: definition.adapterImplemented,
    capabilities: definition.capabilities,
    websiteUrl: definition.websiteUrl,
    licenseCaveat: getConnectorLicenseCaveat(definition),
    connectionId: null,
    lastCheckedAt,
    lastHealthyAt,
  };
}

function itemForConnection(
  connection: SourceConnection,
  definition: ConnectorDefinition | undefined,
): SourceRegistryItem {
  const sourceType = definition?.sourceType ?? connection.sourceType as ConnectorSourceType;
  const category = definition?.category ?? "private_data";
  const state = isSavedState(connection.status)
    ? connection.status
    : "invalid";

  return {
    id: `connection:${connection.id}`,
    connectorId: connection.connectorId,
    name: connection.name,
    kind: "connection",
    group: sourceGroupFor(sourceType, category),
    sourceType,
    category,
    state,
    detail: connectionDetail(connection),
    connected: true,
    operational: state === "healthy",
    adapterImplemented: definition?.adapterImplemented ?? false,
    capabilities: definition?.capabilities ?? [],
    websiteUrl: definition?.websiteUrl,
    licenseCaveat: definition ? getConnectorLicenseCaveat(definition) : null,
    connectionId: connection.id,
    lastCheckedAt: connection.lastTestedAt?.toISOString() ?? null,
    lastHealthyAt: connection.lastHealthyAt?.toISOString() ?? null,
  };
}

function sortItems(items: SourceRegistryItem[]): SourceRegistryItem[] {
  return [...items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "connection" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function buildSourceRegistry(
  snapshot: ConnectorRegistrySnapshot,
  connections: SourceConnection[],
  generatedAt = new Date().toISOString(),
): SourceRegistry {
  const healthByConnectorId = new Map(
    snapshot.health.map((report) => [report.connectorId, report]),
  );
  const definitionsById = new Map(snapshot.connectors.map((definition) => [definition.id, definition]));
  const itemsByGroup = new Map<SourceRegistryGroupId, SourceRegistryItem[]>(
    GROUP_ORDER.map((groupId) => [groupId, []]),
  );

  // One credential per provider: once a keyed/public API is connected, the saved connection card is
  // the only card for it. A catalog twin ("connect this provider") next to a healthy connection
  // reads as a duplicate. Multi-instance sources (databases, files, storage, private APIs) keep
  // their catalog tile because each connection is a different instance.
  const singleCredentialTypes = new Set<ConnectorSourceType>(["public_api", "keyed_api"]);
  const connectedSingleCredential = new Set(
    connections
      .filter((connection) => singleCredentialTypes.has((definitionsById.get(connection.connectorId)?.sourceType ?? connection.sourceType) as ConnectorSourceType))
      .map((connection) => connection.connectorId),
  );

  for (const definition of snapshot.connectors) {
    if (connectedSingleCredential.has(definition.id)) continue;
    const health = healthByConnectorId.get(definition.id);
    const runtimeState = health?.state ?? fallbackCatalogState(definition);
    const item = itemForCatalog(
      definition,
      runtimeState,
      health?.detail ?? catalogDetail(runtimeState, definition),
      health?.checkedAt ?? null,
      health?.state === "live_verified" ? health.lastVerifiedAt : null,
    );
    itemsByGroup.get(item.group)?.push(item);
  }

  for (const connection of connections) {
    const item = itemForConnection(connection, definitionsById.get(connection.connectorId));
    itemsByGroup.get(item.group)?.push(item);
  }

  const groups = GROUP_ORDER.map((id) => ({
    id,
    ...GROUP_DETAILS[id],
    items: sortItems(itemsByGroup.get(id) ?? []),
  }));
  const items = groups.flatMap((group) => group.items);

  return {
    generatedAt,
    groups,
    summary: {
      catalogCount: items.filter((item) => item.kind === "catalog").length,
      connectionCount: items.filter((item) => item.kind === "connection").length,
      operationalCount: items.filter((item) => item.operational).length,
      attentionCount: items.filter(
        (item) => item.state === "degraded" || item.state === "rate_limited" || item.state === "unreachable" || item.state === "invalid",
      ).length,
    },
  };
}

export async function getUserSourceRegistry(userId: number): Promise<SourceRegistry> {
  const [snapshot, connections] = await Promise.all([
    getUserScopedConnectorRegistrySnapshot(),
    listSourceConnections(userId),
  ]);
  return buildSourceRegistry(snapshot, connections);
}

export function isSourceRegistryState(state: string): state is SourceRegistryItemState {
  return isSavedState(state) || [
    "catalog_only",
    "adapter_available",
    "credential_configured",
    "live_verified",
    "degraded",
    "rate_limited",
    "disabled",
  ].includes(state);
}
