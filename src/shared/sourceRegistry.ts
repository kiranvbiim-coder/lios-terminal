import type {
  ConnectorCapability,
  ConnectorCategory,
  ConnectorRuntimeState,
  ConnectorSourceType,
} from "./connectorRegistry";

export type SourceRegistryGroupId =
  | "files"
  | "finance_market"
  | "economic_public"
  | "custom"
  | "cloud";

export type SourceRegistrySavedState =
  | "configured"
  | "healthy"
  | "degraded"
  | "unreachable"
  | "invalid";

export type SourceRegistryItemState =
  | ConnectorRuntimeState
  | SourceRegistrySavedState;

export interface SourceRegistryItem {
  id: string;
  connectorId: string;
  name: string;
  kind: "catalog" | "connection";
  group: SourceRegistryGroupId;
  sourceType: ConnectorSourceType;
  category: ConnectorCategory;
  state: SourceRegistryItemState;
  detail: string;
  connected: boolean;
  operational: boolean;
  adapterImplemented: boolean;
  capabilities: ConnectorCapability[];
  websiteUrl?: string;
  licenseCaveat: string | null;
  connectionId: number | null;
  lastCheckedAt: string | null;
  lastHealthyAt: string | null;
}

export interface SourceRegistryGroup {
  id: SourceRegistryGroupId;
  title: string;
  description: string;
  items: SourceRegistryItem[];
}

export interface SourceRegistrySummary {
  catalogCount: number;
  connectionCount: number;
  operationalCount: number;
  attentionCount: number;
}

export interface SourceRegistry {
  generatedAt: string;
  groups: SourceRegistryGroup[];
  summary: SourceRegistrySummary;
}
