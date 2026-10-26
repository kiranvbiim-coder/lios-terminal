import {
  universalDataPlanSchema,
  universalDataRequestSchema,
  type UniversalDataPlan,
  type UniversalDataRequest,
  type UniversalDataRequestInput,
  type UniversalProviderCandidate,
} from "@shared/trustContracts";
import { getUserScopedConnectorRegistrySnapshot } from "./connectorService";
import { resolveFamilyProviderOrder } from "./dataStackService";
import type { DataStackPin, DataFamily } from "@shared/dataStackPins";
import type { ConnectorDefinition, ConnectorRegistrySnapshot, ConnectorRuntimeReport } from "@shared/connectorRegistry";
import { getRequestIdentity } from "./requestContext";

const PRICE_ROUTER_CONNECTOR_IDS = new Set([
  "yahoo_finance",
  "bse_india",
  "coingecko",
  "stooq",
  "twelve_data",
  "tiingo",
  "eodhd",
  "polygon",
  "alpha_vantage",
  "coinmarketcap",
]);

function executionPathCompatible(request: UniversalDataRequest, connector: ConnectorDefinition): boolean {
  // A catalog definition is not an executable connector, even if its id
  // appears in an existing routing allow-list. Never request setup for one.
  if (!connector.adapterImplemented) return false;
  // The active price conversation router serves the current request; it does
  // not reconstruct what was known on a past date or an exact past revision.
  // Historical bars are not the same claim as point-in-time knowledge.
  if (request.capability === "prices") {
    return request.pointInTime.mode === "latest" && PRICE_ROUTER_CONNECTOR_IDS.has(connector.id);
  }
  return true;
}

const CAPABILITY_CONTRACTS: Record<UniversalDataRequest["capability"], string[]> = {
  security_resolution: ["instrument_identity"],
  prices: ["market_data", "price_history"],
  statements: ["financial_statements", "fundamentals", "company"],
  estimates: ["fundamentals", "estimates", "company"],
  filings: ["filings"],
  options: ["options", "market_data"],
  curves: ["curves", "macro"],
  macro: ["macro"],
  fx: ["macro", "market_data"],
  portfolios: ["private_data"],
  transactions: ["private_data"],
  provider_extension: ["provider_extension", "research", "private_data"],
};

function stackFamilyFor(request: UniversalDataRequest): DataFamily | undefined {
  if (request.capability === "prices") {
    return request.fields.includes("ohlcv") && !request.fields.includes("quote") ? "ohlcv" : "quote";
  }
  if (request.capability === "statements") return "statements";
  if (request.capability === "estimates") return "fundamentals";
  if (request.capability === "macro" || request.capability === "fx" || request.capability === "curves") return "macro_fx";
  if (request.capability === "filings") return "filings";
  return undefined;
}

function sourceScopeCompatible(request: UniversalDataRequest, connector: ConnectorDefinition): boolean {
  if (request.sourceScope === "auto") return true;
  if (request.sourceScope === "files") return connector.sourceType === "file";
  if (request.sourceScope === "my_data") {
    return connector.custodyMode === "client_private"
      || connector.custodyMode === "local_only"
      || connector.sourceType === "file"
      || connector.sourceType === "database"
      || connector.sourceType === "cloud_storage";
  }
  return connector.custodyMode === "public" || connector.custodyMode === "user_licensed";
}

function connectorPolicyCompatible(request: UniversalDataRequest, connector: ConnectorDefinition): boolean {
  if (request.providerDeny.includes(connector.id)) return false;
  return request.providerAllow.length === 0 || request.providerAllow.includes(connector.id);
}

function relevantCapabilities(connector: ConnectorDefinition, request: UniversalDataRequest) {
  const accepted = new Set(CAPABILITY_CONTRACTS[request.capability]);
  return connector.capabilities.filter((capability) => accepted.has(capability.contractFamily));
}

function candidateFields(connector: ConnectorDefinition, request: UniversalDataRequest): string[] {
  return [...new Set(relevantCapabilities(connector, request).flatMap((capability) => capability.fields ?? []))];
}

function candidateCoverage(connector: ConnectorDefinition, request: UniversalDataRequest): string | null {
  const coverage = relevantCapabilities(connector, request)
    .map((capability) => capability.coverage)
    .filter((value): value is string => Boolean(value));
  return coverage.length ? [...new Set(coverage)].join("; ") : null;
}

function candidateContractFamily(connector: ConnectorDefinition, request: UniversalDataRequest): string {
  const relevant = relevantCapabilities(connector, request);
  const fieldMatch = relevant.find((capability) => request.fields.some((field) => capability.fields?.includes(field)));
  return fieldMatch?.contractFamily ?? relevant[0]?.contractFamily ?? CAPABILITY_CONTRACTS[request.capability][0];
}

function healthByConnector(health: ConnectorRuntimeReport[]): Map<string, ConnectorRuntimeReport> {
  return new Map(health.map((item) => [item.connectorId, item]));
}

function operationalState(state: ConnectorRuntimeReport["state"]): boolean {
  return state === "live_verified" || state === "credential_configured";
}

function needsConnectionState(state: ConnectorRuntimeReport["state"]): boolean {
  // A catalog-only source needs real adapter implementation, not credentials.
  return state === "adapter_available";
}

export interface UniversalDataPlanningOptions {
  globalStackOrder?: readonly string[];
  pins?: readonly DataStackPin[];
}

export function planUniversalDataFromSnapshot(
  rawRequest: UniversalDataRequestInput,
  snapshot: ConnectorRegistrySnapshot,
  options: UniversalDataPlanningOptions = {},
): UniversalDataPlan {
  const request = universalDataRequestSchema.parse(rawRequest);
  const health = healthByConnector(snapshot.health);
  const acceptedContracts = new Set(CAPABILITY_CONTRACTS[request.capability]);

  let connectors = snapshot.connectors.filter((connector) =>
    connectorPolicyCompatible(request, connector)
    && executionPathCompatible(request, connector)
    && connector.capabilities.some((capability) => acceptedContracts.has(capability.contractFamily)),
  );

  const defaultOrder = connectors.map((connector) => connector.id);
  const stackFamily = stackFamilyFor(request);
  const orderedIds = stackFamily
    ? resolveFamilyProviderOrder(stackFamily, defaultOrder, {
        globalStackOrder: options.globalStackOrder,
        pins: options.pins,
        symbol: request.entity.symbol,
      })
    : options.globalStackOrder?.length
      ? [
          ...options.globalStackOrder.filter((id) => defaultOrder.includes(id)),
          ...defaultOrder.filter((id) => !options.globalStackOrder!.includes(id)),
        ]
      : defaultOrder;
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  connectors = [...connectors].sort((a, b) => (rank.get(a.id) ?? 10_000) - (rank.get(b.id) ?? 10_000));

  const candidates: UniversalProviderCandidate[] = connectors.map((connector, index) => {
    const report = health.get(connector.id) ?? {
      connectorId: connector.id,
      state: "catalog_only" as const,
      detail: "No runtime health report is available.",
      checkedAt: new Date().toISOString(),
      adapterImplemented: connector.adapterImplemented,
      lastVerifiedAt: null,
    };
    const scopeCompatible = sourceScopeCompatible(request, connector);
    return {
      connectorId: connector.id,
      label: connector.name,
      contractFamily: candidateContractFamily(connector, request),
      fields: candidateFields(connector, request),
      coverage: candidateCoverage(connector, request),
      runtimeState: report.state,
      operational: scopeCompatible && operationalState(report.state),
      requiresConnection: scopeCompatible && needsConnectionState(report.state),
      rank: index,
      reason: scopeCompatible
        ? report.detail
        : `${connector.name} is outside the selected ${request.sourceScope} source scope.`,
    };
  });

  const scoped = candidates.filter((candidate) => {
    const connector = connectors.find((item) => item.id === candidate.connectorId);
    return connector ? sourceScopeCompatible(request, connector) : false;
  });
  const operational = scoped.filter((candidate) => candidate.operational);
  // The selected providers, not every listed provider, must actually cover
  // the fields used to claim this plan is ready. Preserve stack priority,
  // prefer providers that close a requested-field gap, then fill remaining
  // slots with eligible fallbacks. Never silently depend on provider #6.
  const selected: UniversalProviderCandidate[] = [];
  const uncovered = new Set(request.fields);
  for (const candidate of operational) {
    if (selected.length >= 5 || uncovered.size === 0) break;
    const contributes = candidate.fields.filter((field) => uncovered.has(field));
    if (!contributes.length) continue;
    selected.push(candidate);
    for (const field of contributes) uncovered.delete(field);
  }
  for (const candidate of operational) {
    if (selected.length >= 5) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  const selectedCandidateIds = selected.map((candidate) => candidate.connectorId);
  const missingFields = request.fields.filter((field) => uncovered.has(field));

  let availability: UniversalDataPlan["availability"];
  if (!scoped.length && candidates.length) availability = "source_scope_blocked";
  else if (!candidates.length) availability = "unavailable";
  else if (!operational.length) availability = scoped.some((candidate) => candidate.requiresConnection) ? "not_connected" : "unavailable";
  else if (missingFields.length) availability = request.allowPartial ? "partial" : "unavailable";
  else availability = "ready";

  const recoveryActions: string[] = [];
  if (request.capability === "prices" && request.pointInTime.mode !== "latest") {
    recoveryActions.push("Use a point-in-time-capable historical data source, or explicitly request latest prices");
  }
  if (availability === "source_scope_blocked") recoveryActions.push("Switch source scope to Auto");
  for (const candidate of scoped.filter((item) => item.requiresConnection).slice(0, 4)) {
    recoveryActions.push(`Connect ${candidate.connectorId}`);
  }
  if (availability !== "ready") {
    recoveryActions.push("Open Connection Center");
    if (request.capability !== "security_resolution") recoveryActions.push("Import compatible data");
  }

  return universalDataPlanSchema.parse({
    schemaVersion: "1",
    request,
    candidates,
    selectedCandidateIds,
    availability,
    missingFields,
    recoveryActions: [...new Set(recoveryActions)].slice(0, 20),
    plannedAt: new Date().toISOString(),
  });
}

export async function planUniversalDataRequest(
  rawRequest: UniversalDataRequestInput,
  options: UniversalDataPlanningOptions = {},
): Promise<UniversalDataPlan> {
  const snapshot = await getUserScopedConnectorRegistrySnapshot();
  const identity = getRequestIdentity();
  const selected = identity?.userId !== null && identity?.userId !== undefined
    ? new Set(identity.selectedConnectorIds ?? [])
    : null;
  const scopedSnapshot: ConnectorRegistrySnapshot = selected
    ? {
        connectors: snapshot.connectors,
        health: snapshot.health.map((report) => selected.has(report.connectorId)
          ? report
          : {
              ...report,
              state: "adapter_available" as const,
              detail: `${snapshot.connectors.find((connector) => connector.id === report.connectorId)?.name ?? report.connectorId} is compatible but is not selected for this LiOS profile.`,
              lastVerifiedAt: null,
            }),
      }
    : snapshot;
  return planUniversalDataFromSnapshot(rawRequest, scopedSnapshot, {
    globalStackOrder: options.globalStackOrder ?? identity?.providerStackOrder,
    pins: options.pins ?? identity?.dataStackPins,
  });
}

export function explainUniversalDataGap(plan: UniversalDataPlan): {
  reason: "unavailable" | "not_connected" | "unsupported";
  providersChecked: string[];
  nextActions: string[];
  message: string;
} {
  const providers = plan.candidates.map((candidate) => `${candidate.label} [${candidate.runtimeState}]`);
  if (plan.request.capability === "prices" && plan.request.pointInTime.mode !== "latest") {
    return {
      reason: "unsupported",
      providersChecked: providers,
      nextActions: plan.recoveryActions,
      message: `The current LiOS price conversation route cannot establish ${plan.request.pointInTime.mode} point-in-time knowledge. Historical market bars alone do not verify what was known at that time.`,
    };
  }
  if (plan.availability === "source_scope_blocked") {
    return {
      reason: "unsupported",
      providersChecked: providers,
      nextActions: plan.recoveryActions,
      message: `The selected source scope does not permit the available ${plan.request.capability} connectors. LiOS did not broaden the scope automatically.`,
    };
  }
  if (plan.availability === "not_connected") {
    return {
      reason: "not_connected",
      providersChecked: providers,
      nextActions: plan.recoveryActions,
      message: `Compatible ${plan.request.capability} connectors exist but none is currently connected/ready for this request.`,
    };
  }
  return {
    reason: "unavailable",
    providersChecked: providers,
    nextActions: plan.recoveryActions,
    message: plan.missingFields.length
      ? `Connected sources do not cover required field(s): ${plan.missingFields.join(", ")}.`
      : `No connected provider can currently satisfy this ${plan.request.capability} request.`,
  };
}
