import { parseDataStackPins } from "@shared/dataStackPins";
import { hasActiveCommunityConsent } from "./communityDataConsent";
import { getEnvironmentSetupForUser } from "./environmentSetupService";
import { loadOrganizationCredentials } from "./organizationCredentialVault";
import { getRequestIdentity, runWithRequestIdentity, type RequestIdentity } from "./requestContext";

export interface OwnerRef {
  userId: number;
  organizationId: number | null;
}

/**
 * The identity the HTTP middleware (server/index.ts) binds for a signed-in request, rebuilt from the owner's
 * persisted setup and consents. Market-data authorization (source selection, community consent) is read from
 * it, so every transport that runs work for a person must see the same values.
 */
export async function loadOwnerRequestIdentity(owner: OwnerRef): Promise<RequestIdentity> {
  const [setup, communityYahooConsent, publicFillerConsent, credentials] = await Promise.all([
    getEnvironmentSetupForUser(owner.userId),
    hasActiveCommunityConsent(owner.userId, "yahoo_community"),
    hasActiveCommunityConsent(owner.userId, "public_filler"),
    owner.organizationId !== null ? loadOrganizationCredentials(owner.organizationId) : Promise.resolve(undefined),
  ]);
  return {
    userId: owner.userId,
    organizationId: owner.organizationId,
    credentials,
    selectedConnectorIds: setup?.selectedConnectorIds ?? [],
    providerStackOrder: setup?.providerStackOrder ?? [],
    dataStackPins: parseDataStackPins(setup?.dataStackPins ?? []),
    communityYahooConsent,
    publicFillerConsent,
  };
}

/** True when the ambient identity already belongs to this owner (the HTTP middleware bound it for this request). */
export function ambientIdentityMatches(owner: OwnerRef, ambient: RequestIdentity | undefined = getRequestIdentity()): boolean {
  return ambient !== undefined && ambient.userId === owner.userId && (ambient.organizationId ?? null) === owner.organizationId;
}

/**
 * Runs `callback` for `owner` with that owner's market-data identity bound.
 *
 * The WebSocket Gateway (Chat) is not an Express request, so nothing binds an identity there; without this the
 * work would be unscoped and `isMarketDataProviderAuthorized` treats unscoped work as authorized for every
 * provider. An identity that already belongs to this owner is kept as is; any other, including none, is replaced
 * by the owner's persisted state. Another person's ambient identity is never inherited.
 */
export async function withOwnerRequestIdentity<T>(owner: OwnerRef, callback: () => Promise<T>): Promise<T> {
  if (ambientIdentityMatches(owner)) return callback();
  const identity = await loadOwnerRequestIdentity(owner);
  return runWithRequestIdentity(identity, callback);
}
