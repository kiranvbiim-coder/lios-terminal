import { AsyncLocalStorage } from "node:async_hooks";
import type { DataStackPin } from "@shared/dataStackPins";

export interface RequestIdentity {
  userId: number | null;
  organizationId: number | null;
  credentials?: Readonly<Record<string, string>>;
  selectedConnectorIds?: readonly string[];
  providerStackOrder?: readonly string[];
  /** P0.2/P0.3 conflict pins -- see dataStackService.ts's resolveFamilyProviderOrder. */
  dataStackPins?: readonly DataStackPin[];
  communityYahooConsent?: boolean;
  publicFillerConsent?: boolean;
}

const storage = new AsyncLocalStorage<RequestIdentity>();

export function runWithRequestIdentity<T>(identity: RequestIdentity, callback: () => T): T {
  return storage.run(identity, callback);
}

export function getRequestIdentity(): RequestIdentity | undefined {
  return storage.getStore();
}
