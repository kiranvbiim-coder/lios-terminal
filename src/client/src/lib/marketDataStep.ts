import { useQuery } from "@tanstack/react-query";
import { decideMarketDataAccess } from "@shared/marketDataAccess";
import { apiRequest } from "./queryClient";
import { SETUP_STATUS_KEY, type AiSetupSelection, type AiSetupStatus } from "./aiConnection";

export const COMMUNITY_CONSENT_KEY = ["/api/setup/community-data-consent"];
/** Marks that this person already chose, so "I'll add provider keys later" is not asked again on every launch. */
const DISMISSED_KEY_PREFIX = "lios.marketDataStep.v1:";

export type MarketDataStepGate = "skip" | "checking" | "show";

interface StoredConsent { scope: string; active: boolean }

/**
 * First-run asks for a market-data source once, after Connect your AI. It is skipped when a source can already
 * serve prices, when the person chose "add keys later", or when this account cannot use market data at all.
 */
export function decideMarketDataStep(input: {
  enabled: boolean;
  setup: Pick<AiSetupSelection, "selectedConnectorIds"> | null | undefined;
  consents: readonly StoredConsent[] | undefined;
  retail: boolean;
  dismissed: boolean;
}): MarketDataStepGate {
  if (!input.enabled || input.dismissed) return "skip";
  if (input.setup === undefined || input.consents === undefined) return "checking";
  const has = (scope: string) => input.consents!.some((consent) => consent.scope === scope && consent.active);
  const access = decideMarketDataAccess({
    selectedConnectorIds: input.setup?.selectedConnectorIds ?? [],
    retail: input.retail,
    communityYahooConsent: has("yahoo_community"),
    publicFillerConsent: has("public_filler"),
  });
  return access.state === "ready" ? "skip" : "show";
}

/** Adds Yahoo to the person's saved selection without touching their AI, runtime or other connectors. */
export function selectionWithYahoo(current: AiSetupSelection | null | undefined): AiSetupSelection {
  const selected = current?.selectedConnectorIds ?? [];
  const stack = current?.providerStackOrder ?? selected;
  return {
    selectedConnectorIds: selected.includes("yahoo_finance") ? selected : [...selected, "yahoo_finance"],
    providerStackOrder: stack.includes("yahoo_finance") ? stack : [...stack, "yahoo_finance"],
    pythonRuntimeId: current?.pythonRuntimeId ?? "lios-managed",
    pythonEnvironmentPath: current?.pythonEnvironmentPath ?? null,
    pythonPackIds: current?.pythonPackIds ?? ["core"],
    aiProviderId: current?.aiProviderId ?? null,
    aiModelId: current?.aiModelId ?? null,
  };
}

function dismissedKey(userId: number | null): string { return `${DISMISSED_KEY_PREFIX}${userId ?? "unknown"}`; }

export function isMarketDataStepDismissed(userId: number | null): boolean {
  try { return window.localStorage.getItem(dismissedKey(userId)) === "1"; } catch { return false; }
}

export function dismissMarketDataStep(userId: number | null): void {
  try { window.localStorage.setItem(dismissedKey(userId), "1"); } catch { /* the step may appear again next launch */ }
}

/** Records the person's explicit Yahoo consent, then selects Yahoo. Consent is never implied by choosing the source. */
export async function enableYahooMarketData(setup: AiSetupStatus | undefined): Promise<void> {
  await apiRequest("PUT", "/api/setup/community-data-consent", { scope: "yahoo_community", accept: true, consentVersion: "v1" });
  await apiRequest("PUT", "/api/setup/status", { ...selectionWithYahoo(setup?.setup), complete: true });
}

export function useMarketDataStepGate(enabled: boolean, retail = true): { gate: MarketDataStepGate; setup: AiSetupStatus | undefined; userId: number | null } {
  const setup = useQuery<AiSetupStatus & { setup: (AiSetupSelection & { userId?: number }) | null }>({
    queryKey: SETUP_STATUS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/setup/status")).json(),
    enabled,
  });
  const consents = useQuery<{ consents: StoredConsent[] }>({
    queryKey: COMMUNITY_CONSENT_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/setup/community-data-consent")).json(),
    enabled,
  });
  const userId = setup.data?.setup?.userId ?? null;
  const gate = decideMarketDataStep({
    enabled,
    setup: setup.data === undefined ? undefined : setup.data.setup,
    consents: consents.data?.consents,
    retail,
    dismissed: userId !== null && isMarketDataStepDismissed(userId),
  });
  return { gate, setup: setup.data, userId };
}
