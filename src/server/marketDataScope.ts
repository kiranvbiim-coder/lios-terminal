import crypto from "node:crypto";
import type { ConversationSourceScope } from "@shared/sourceScope";
import { getRequestIdentity, type RequestIdentity } from "./requestContext";
import { isRetailSoftwareProfile } from "./retailSoftwareProfile";

export interface MarketDataScopeContext {
  projectId?: number | null;
  sourceScope?: ConversationSourceScope | null;
}

export interface ResolvedMarketDataScope {
  key: string;
  scoped: boolean;
  retail: boolean;
  userId: number | null;
  organizationId: number | null;
  projectId: number | null;
  sourceScope: ConversationSourceScope | null;
  selectedConnectorIds: readonly string[];
  communityYahooConsent: boolean;
  publicFillerConsent: boolean;
}

interface ResolveMarketDataScopeOptions {
  retail?: boolean;
}

function canonicalPins(identity: RequestIdentity | undefined): string[] {
  return [...(identity?.dataStackPins ?? [])]
    .map((pin) => JSON.stringify({
      scope: pin.scope,
      family: pin.family,
      symbol: pin.symbol,
      metric: pin.metric,
      providerId: pin.providerId,
      createdByUserId: pin.createdByUserId,
    }))
    .sort();
}

function canonicalScopePayload(
  context: MarketDataScopeContext,
  identity: RequestIdentity,
  retail: boolean,
): string {
  return JSON.stringify({
    version: 1,
    retail,
    userId: identity.userId,
    organizationId: identity.organizationId,
    projectId: context.projectId ?? null,
    sourceScope: context.sourceScope ?? null,
    selectedConnectorIds: [...(identity.selectedConnectorIds ?? [])].sort(),
    providerStackOrder: [...(identity.providerStackOrder ?? [])],
    dataStackPins: canonicalPins(identity),
    communityYahooConsent: identity.communityYahooConsent === true,
    publicFillerConsent: identity.publicFillerConsent === true,
    credentialNames: Object.keys(identity.credentials ?? {}).sort(),
  });
}

/**
 * Builds a credential-safe namespace for market-data caches and persisted
 * observations. Anonymous/system work retains the historical global namespace;
 * authenticated work is isolated by user/org/Project/source-policy state.
 */
export function resolveMarketDataScope(
  context: MarketDataScopeContext = {},
  identity: RequestIdentity | undefined = getRequestIdentity(),
  options: ResolveMarketDataScopeOptions = {},
): ResolvedMarketDataScope {
  const retail = options.retail ?? isRetailSoftwareProfile();
  if (!identity || identity.userId === null) {
    return {
      key: "global",
      scoped: false,
      retail,
      userId: null,
      organizationId: identity?.organizationId ?? null,
      projectId: context.projectId ?? null,
      sourceScope: context.sourceScope ?? null,
      selectedConnectorIds: identity?.selectedConnectorIds ?? [],
      communityYahooConsent: identity?.communityYahooConsent === true,
      publicFillerConsent: identity?.publicFillerConsent === true,
    };
  }

  const digest = crypto
    .createHash("sha256")
    .update(canonicalScopePayload(context, identity, retail))
    .digest("hex")
    .slice(0, 32);

  return {
    key: `scope:${digest}`,
    scoped: true,
    retail,
    userId: identity.userId,
    organizationId: identity.organizationId,
    projectId: context.projectId ?? null,
    sourceScope: context.sourceScope ?? null,
    selectedConnectorIds: identity.selectedConnectorIds ?? [],
    communityYahooConsent: identity.communityYahooConsent === true,
    publicFillerConsent: identity.publicFillerConsent === true,
  };
}

export function marketDataCacheKey(base: string, scope: ResolvedMarketDataScope): string {
  return scope.scoped ? `${scope.key}:${base}` : base;
}

/**
 * Only official observations that do not depend on a user-controlled
 * credential/consent are shareable across authenticated scopes.
 */
export function isMarketDataProviderGloballyShareable(providerId: string): boolean {
  return providerId === "bse_india";
}

/**
 * Read-time authorization for persisted observations. A mixed series is safe
 * only when every contributing provider is allowed under the current scope.
 */
export function isMarketDataProviderAuthorized(
  providerId: string,
  scope: ResolvedMarketDataScope,
): boolean {
  if (!scope.scoped) return true;
  if (!scope.selectedConnectorIds.includes(providerId)) return false;
  if (providerId === "yahoo_finance") return !scope.retail || scope.communityYahooConsent;
  if (providerId === "stooq") return !scope.retail || scope.publicFillerConsent;
  return true;
}

export function areMarketDataProvidersAuthorized(
  providerIds: readonly string[],
  scope: ResolvedMarketDataScope,
): boolean {
  if (!scope.scoped) return true;
  if (!providerIds.length) return false;
  return providerIds.every((providerId) => isMarketDataProviderAuthorized(providerId, scope));
}

export function shouldUseGlobalMarketHistory(
  providerIds: readonly string[],
  scope: ResolvedMarketDataScope,
  sourceRefs: readonly string[] = [],
): boolean {
  if (sourceRefs.includes("provenance:legacy-unattributed")) return false;
  return !scope.scoped || (providerIds.length > 0 && providerIds.every(isMarketDataProviderGloballyShareable));
}
